import { randomUUID } from "node:crypto";
import { prisma } from "../../db";
import { objectStore } from "../../channels/raw-store";
import { chargeHold, placeHold, releaseHold } from "../credits";
import { humanizeCreativeError } from "../errors";
import { fal, type FalWebhook } from "../fal";
import { getOwnedUpload } from "../uploads";
import { planAiVideoEdit } from "./editPlanner";
import {
  FAL_VIDEO_ADAPTERS,
  generateBackgroundMusicAsset,
  generateVoiceoverAsset,
  pollFalSceneResult,
  submitSceneVideoToFal,
} from "./falVideoService";
import { probeVideoDuration, renderAiVideoEdit, renderStoryboardMontage } from "./ffmpegRenderer";
import { detectAssetSilence, transcribeAssetWithAi } from "../timeline-editor/compile-ffmpeg";
import { computeSilenceKeepIntervals } from "../timeline-editor/ops";
import { ticksToSeconds } from "../timeline-editor/time";
import {
  aspectSchema,
  editPlanSchema,
  storyboardSchema,
  videoModelChoiceSchema,
  type EditPlan,
  type PipelineAspect,
  type SceneJobState,
  type Storyboard,
  type VideoModelChoice,
} from "./schemas";

/**
 * Photo-to-Video & AI Video Edit arka plan iş kuyruğu:
 * queued → planning → generating → rendering → done / failed
 */
export async function startPhotoToVideoJob(input: {
  tenantId: string;
  uploadIds: string[];
  modelChoice: VideoModelChoice;
  aspect: PipelineAspect;
  storyboard?: Storyboard;
  goal?: string;
  musicStyle?: string;
  defaultDurationSec?: number;
  logoUploadId?: string | null;
}) {
  const aspect = aspectSchema.parse(input.aspect);
  const modelChoice = videoModelChoiceSchema.parse(input.modelChoice);
  const ids = [...new Set(input.uploadIds)].slice(0, 20);
  if (!ids.length) throw new Error("En az 1 fotoğraf seçilmelidir.");

  // Sahiplik kontrolü
  await Promise.all(ids.map((id) => getOwnedUpload(input.tenantId, id)));

  const sb = input.storyboard
    ? storyboardSchema.parse(input.storyboard)
    : (
        await (
          await import("./storyboardService")
        ).generateStoryboardFromPhotos({
          tenantId: input.tenantId,
          uploadIds: ids,
          aspect,
          goal: input.goal,
          musicStyle: input.musicStyle,
          defaultDurationSec: input.defaultDurationSec,
        })
      ).storyboard;

  // Tahmini maliyet hesapla ve bakiye bloke et (hata olursa otomatik iade edilir)
  const spec = FAL_VIDEO_ADAPTERS[modelChoice];
  const totalSec = sb.scenes.reduce((s, x) => s + x.durationSec, 0);
  const estTry = Math.max(5, Math.ceil(spec.usdPerSec * totalSec * 40));
  const hold = await placeHold(input.tenantId, estTry);

  const job = await prisma.videoPipelineJob.create({
    data: {
      tenantId: input.tenantId,
      kind: "photo_to_video",
      status: "queued",
      progress: 10,
      aspect,
      modelKey: modelChoice,
      sourceUploadIds: ids,
      storyboard: sb,
      logoUploadId: input.logoUploadId ?? null,
      creditHoldId: hold.id,
    },
  });
  await prisma.videoPipelineJob.update({ where: { id: job.id }, data: { rootJobId: job.id } });

  // Arka planda sahne üretimlerini paralel başlat
  void runPhotoToVideoGeneration(job.id).catch((e) => {
    console.error("[jobQueue] photo-to-video başlatma hatası:", e);
  });

  return job;
}

async function runPhotoToVideoGeneration(jobId: string) {
  const startedAt = Date.now();
  const job = await prisma.videoPipelineJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    await prisma.videoPipelineJob.update({ where: { id: jobId }, data: { status: "generating", progress: 20 } });
    const sb = storyboardSchema.parse(job.storyboard);
    const modelChoice = videoModelChoiceSchema.parse(job.modelKey);
    const aspect = aspectSchema.parse(job.aspect);

    // Opsiyonel seslendirme ve fon müziğini paralel hazırla
    const [voiceRes, musicRes] = await Promise.all([
      sb.voiceoverScript?.trim()
        ? generateVoiceoverAsset(job.tenantId, sb.voiceoverScript.trim()).catch(() => null)
        : Promise.resolve(null),
      sb.musicStyle?.trim()
        ? generateBackgroundMusicAsset(
            job.tenantId,
            sb.musicStyle.trim(),
            sb.scenes.reduce((s, x) => s + x.durationSec, 0),
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Tüm sahneleri paralel olarak fal.ai queue'ya gönder (retry=2 dahil)
    const sceneStates: SceneJobState[] = await Promise.all(
      sb.scenes.map(async (scene) => {
        const t0 = Date.now();
        const submitted = await submitSceneVideoToFal({
          tenantId: job.tenantId,
          modelChoice,
          prompt: `${scene.motionPrompt}. Camera: ${scene.cameraMove}`,
          aspect,
          durationSec: scene.durationSec,
          uploadId: scene.uploadId,
          maxRetries: 2,
        });
        return {
          sceneIndex: scene.sceneIndex,
          uploadId: scene.uploadId,
          modelKey: submitted.modelKey,
          requestId: submitted.requestId,
          status: submitted.immediateS3Key ? ("completed" as const) : ("submitted" as const),
          retries: submitted.retriesUsed,
          durationSec: submitted.durationSec,
          costUsd: submitted.estimatedCostUsd,
          startedAt: t0,
          durationMs: submitted.immediateS3Key ? Date.now() - t0 : null,
          clipS3Key: submitted.immediateS3Key ?? null,
          error: null,
        };
      }),
    );

    const totalCostUsd =
      sceneStates.reduce((s, x) => s + x.costUsd, 0) + (voiceRes?.costUsd ?? 0) + (musicRes?.costUsd ?? 0);

    await prisma.videoPipelineJob.update({
      where: { id: jobId },
      data: {
        sceneJobs: sceneStates,
        voiceoverAudio: voiceRes?.s3Key ?? null,
        musicAudio: musicRes?.s3Key ?? null,
        costUsd: totalCostUsd,
        progress: sceneStates.every((s) => s.status === "completed") ? 75 : 40,
      },
    });

    if (sceneStates.every((s) => s.status === "completed")) {
      await finalizePhotoToVideoRender(jobId, startedAt);
    }
  } catch (e) {
    await failPipelineJob(jobId, e instanceof Error ? e.message : "Sahne üretimi başlatılamadı.");
  }
}

async function finalizePhotoToVideoRender(jobId: string, startedAt?: number) {
  const claim = await prisma.videoPipelineJob.updateMany({
    where: { id: jobId, status: { in: ["generating", "queued"] } },
    data: { status: "rendering", progress: 80 },
  });
  if (claim.count !== 1) return;

  const job = await prisma.videoPipelineJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const sb = storyboardSchema.parse(job.storyboard);
    const aspect = aspectSchema.parse(job.aspect);
    const scenes = (job.sceneJobs as SceneJobState[] | null) ?? [];
    const orderedKeys = [...scenes]
      .sort((a, b) => a.sceneIndex - b.sceneIndex)
      .map((s) => s.clipS3Key)
      .filter((x): x is string => !!x);

    const rendered = await renderStoryboardMontage({
      tenantId: job.tenantId,
      aspect,
      storyboard: sb,
      clipS3Keys: orderedKeys,
      voiceoverS3Key: job.voiceoverAudio,
      musicS3Key: job.musicAudio,
      logoUploadId: job.logoUploadId,
    });

    if (job.creditHoldId) await chargeHold(job.creditHoldId);

    const durationMs = startedAt ? Date.now() - startedAt : Date.now() - job.createdAt.getTime();
    await prisma.$transaction(async (tx) => {
      await tx.videoPipelineJob.update({
        where: { id: jobId },
        data: { status: "done", progress: 100, outputUploadId: rendered.uploadId, durationMs },
      });
      await tx.videoVersion.create({
        data: {
          tenantId: job.tenantId,
          pipelineJobId: job.id,
          rootJobId: job.rootJobId ?? job.id,
          versionNumber: job.versionNumber,
          uploadId: rendered.uploadId,
          editCommand: "Fotoğraftan ilk video üretimi",
          editPlan: sb,
        },
      });
    });
    console.info(`[jobQueue] photo_to_video tamamlandı job=${jobId} costUsd=${job.costUsd} durationMs=${durationMs}`);
  } catch (e) {
    await failPipelineJob(jobId, e instanceof Error ? e.message : "FFmpeg montajı başarısız.");
  }
}

/**
 * Doğal dil komutuyla AI Video Edit işi başlatır ve yeni bir versiyon oluşturur.
 */
export async function startAiVideoEditJob(input: {
  tenantId: string;
  sourceUploadId: string;
  command: string;
  rootJobId?: string;
  modelChoice?: VideoModelChoice;
}) {
  const source = await getOwnedUpload(input.tenantId, input.sourceUploadId);
  if (source.kind !== "video") throw new Error("Düzenlemek için bir video dosyası seçin.");

  const rootId = input.rootJobId ?? source.id;
  const lastVer = await prisma.videoVersion.findFirst({
    where: { tenantId: input.tenantId, rootJobId: rootId },
    orderBy: { versionNumber: "desc" },
  });
  const nextVersion = (lastVer?.versionNumber ?? 0) + 1;

  const job = await prisma.videoPipelineJob.create({
    data: {
      tenantId: input.tenantId,
      kind: "ai_video_edit",
      status: "planning",
      progress: 15,
      modelKey: input.modelChoice ?? "hailuo",
      sourceUploadIds: [source.id],
      rootJobId: rootId,
      versionNumber: nextVersion,
    },
  });

  void runAiVideoEditPipeline(job.id, source.id, input.command, source.durationSec ?? null, lastVer?.id ?? null).catch((e) => {
    console.error("[jobQueue] ai-video-edit hatası:", e);
  });

  return job;
}

async function runAiVideoEditPipeline(
  jobId: string,
  sourceUploadId: string,
  command: string,
  durationSec: number | null,
  parentVersionId: string | null,
) {
  const startedAt = Date.now();
  const job = await prisma.videoPipelineJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    // 1. Ham videonun süre & sessizlik analizini yap (Bedrock planlamasını güçlendirir)
    const silenceInfo = await detectAssetSilence(job.tenantId, sourceUploadId, {
      thresholdDb: -35,
      minSilenceSec: 0.45,
    }).catch(() => null);

    const detectedDuration = silenceInfo?.durationSec ?? durationSec;
    const silences = silenceInfo?.silences ?? [];
    const silenceTotalSec = silences.reduce((s, x) => s + Math.max(0, x.endSec - x.startSec), 0);

    const planned = await planAiVideoEdit({
      command,
      videoDurationSec: detectedDuration,
      silenceCount: silences.length,
      silenceTotalSec,
    });
    const plan: EditPlan = planned.plan;

    const keepIntervals =
      plan.removeSilences?.enabled && detectedDuration && silences.length > 0
        ? computeSilenceKeepIntervals(detectedDuration, silences, 0.12)
        : null;

    await prisma.videoPipelineJob.update({
      where: { id: jobId },
      data: { editPlan: plan, status: "generating", progress: 35 },
    });

    let voiceKey: string | null = null;
    let musicKey: string | null = null;
    let regenClipKey: string | null = null;
    let costUsd = 0;

    // 2. fal.ai + Bedrock tabanlı yardımcı üretimleri paralel çalıştır
    const needAutoTranscribe = !!(plan.autoTranscribe || (plan.subtitles?.enabled && plan.subtitles.lines.length === 0));

    const [transcribeRes, voiceRes, musicRes, regenRes] = await Promise.all([
      needAutoTranscribe
        ? transcribeAssetWithAi(job.tenantId, sourceUploadId, {
            language: "tr",
            fixWithLlm: true,
          }).catch((e) => {
            console.warn("[jobQueue] otomatik transkripsiyon yedeğe düştü:", (e as Error).message);
            return null;
          })
        : Promise.resolve(null),
      plan.audioMix?.voiceoverText
        ? generateVoiceoverAsset(job.tenantId, plan.audioMix.voiceoverText).catch((e) => {
            console.warn("[jobQueue] seslendirme üretilemedi:", (e as Error).message);
            return null;
          })
        : Promise.resolve(null),
      plan.audioMix?.musicPrompt
        ? generateBackgroundMusicAsset(job.tenantId, plan.audioMix.musicPrompt, detectedDuration ?? 20).catch((e) => {
            console.warn("[jobQueue] fon müziği üretilemedi:", (e as Error).message);
            return null;
          })
        : Promise.resolve(null),
      plan.regenerateScene?.enabled && plan.regenerateScene.prompt
        ? (async () => {
            const modelChoice = videoModelChoiceSchema.parse(job.modelKey);
            const sub = await submitSceneVideoToFal({
              tenantId: job.tenantId,
              modelChoice,
              prompt: plan.regenerateScene!.prompt,
              aspect: plan.aspect === "orijinal" ? "9:16" : plan.aspect,
              durationSec: plan.regenerateScene!.durationSec,
              maxRetries: 2,
            });
            let clipKey: string | null = sub.immediateS3Key ?? null;
            if (!clipKey) {
              const spec = FAL_VIDEO_ADAPTERS[modelChoice];
              for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 3000));
                const p = await pollFalSceneResult(spec.t2vEndpoint, sub.requestId);
                if (p.status === "COMPLETED" && p.videoUrl) {
                  const dl = await fal().download(p.videoUrl);
                  const k = `pipeline/${job.tenantId}/clips/${sub.requestId}.mp4`;
                  await objectStore().put(k, dl.bytes, "video/mp4");
                  clipKey = k;
                  break;
                }
                if (p.status === "FAILED") break;
              }
            }
            return { clipKey, costUsd: sub.estimatedCostUsd };
          })().catch((e) => {
            console.warn("[jobQueue] B-roll sahne üretilemedi:", (e as Error).message);
            return null;
          })
        : Promise.resolve(null),
    ]);

    if (transcribeRes) {
      const capLines =
        transcribeRes.captions.length > 0
          ? transcribeRes.captions.map((c) => {
              const startSec = ticksToSeconds(c.startTime);
              return {
                startSec,
                endSec: startSec + ticksToSeconds(c.duration),
                text: c.text,
              };
            })
          : transcribeRes.segments.map((s) => ({
              startSec: s.startSec,
              endSec: s.endSec,
              text: s.text,
            }));
      if (capLines.length > 0) {
        plan.subtitles = { enabled: true, lines: capLines.slice(0, 120) };
      }
      if (transcribeRes.provider === "fal") costUsd += 0.01;
    }

    if (voiceRes) {
      voiceKey = voiceRes.s3Key;
      costUsd += voiceRes.costUsd;
    }
    if (musicRes) {
      musicKey = musicRes.s3Key;
      costUsd += musicRes.costUsd;
    }
    if (regenRes) {
      regenClipKey = regenRes.clipKey;
      costUsd += regenRes.costUsd;
    }

    await prisma.videoPipelineJob.update({
      where: { id: jobId },
      data: { editPlan: plan, status: "rendering", progress: 75, costUsd, voiceoverAudio: voiceKey, musicAudio: musicKey },
    });

    const rendered = await renderAiVideoEdit({
      tenantId: job.tenantId,
      sourceUploadId,
      plan,
      keepIntervals,
      voiceoverS3Key: voiceKey,
      musicS3Key: musicKey,
      regeneratedClipS3Key: regenClipKey,
    });

    const durationMs = Date.now() - startedAt;
    await prisma.$transaction(async (tx) => {
      await tx.videoPipelineJob.update({
        where: { id: jobId },
        data: { status: "done", progress: 100, outputUploadId: rendered.uploadId, durationMs },
      });
      await tx.videoVersion.create({
        data: {
          tenantId: job.tenantId,
          pipelineJobId: job.id,
          rootJobId: job.rootJobId ?? job.id,
          versionNumber: job.versionNumber,
          uploadId: rendered.uploadId,
          editCommand: command,
          editPlan: plan,
          parentVersionId,
        },
      });
    });
    console.info(`[jobQueue] ai_video_edit tamamlandı job=${jobId} version=${job.versionNumber} durationMs=${durationMs}`);
  } catch (e) {
    await failPipelineJob(jobId, e instanceof Error ? e.message : "AI video düzenleme başarısız.");
  }
}

async function failPipelineJob(jobId: string, errorMsg: string) {
  const job = await prisma.videoPipelineJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.creditHoldId) {
    await releaseHold(job.creditHoldId).catch(() => undefined);
  }
  await prisma.videoPipelineJob.update({
    where: { id: jobId },
    data: { status: "failed", error: `${humanizeCreativeError(errorMsg).slice(0, 260)} (Ücret alınmadı, bakiye korundu.)` },
  });
}

/**
 * fal.ai webhook'u geldiğinde ilgili `VideoPipelineJob` sahnesini günceller;
 * tüm sahneler tamamlandıysa FFmpeg montajını başlatır.
 */
export async function handlePipelineFalWebhook(w: FalWebhook): Promise<boolean> {
  const activeJobs = await prisma.videoPipelineJob.findMany({
    where: { status: "generating", kind: "photo_to_video" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  for (const job of activeJobs) {
    const scenes = (job.sceneJobs as SceneJobState[] | null) ?? [];
    const idx = scenes.findIndex((s) => s.requestId === w.request_id);
    if (idx < 0) continue;

    const scene = scenes[idx]!;
    if (scene.status === "completed") return true;

    if (w.status === "OK" && w.payload?.video?.url) {
      const dl = await fal().download(w.payload.video.url);
      const clipKey = `pipeline/${job.tenantId}/clips/${randomUUID()}.mp4`;
      await objectStore().put(clipKey, dl.bytes, "video/mp4");
      scenes[idx] = {
        ...scene,
        status: "completed",
        clipS3Key: clipKey,
        durationMs: Date.now() - scene.startedAt,
      };
    } else {
      // Retry hakkı varsa (en fazla 2 tekrar) yeniden gönder
      if (scene.retries < 2) {
        const modelChoice = videoModelChoiceSchema.parse(job.modelKey);
        const aspect = aspectSchema.parse(job.aspect);
        const sb = storyboardSchema.parse(job.storyboard);
        const sbScene = sb.scenes[scene.sceneIndex];
        const retried = await submitSceneVideoToFal({
          tenantId: job.tenantId,
          modelChoice,
          prompt: sbScene ? `${sbScene.motionPrompt}. Camera: ${sbScene.cameraMove}` : "Cinematic motion",
          aspect,
          durationSec: scene.durationSec,
          uploadId: scene.uploadId,
          maxRetries: 0,
        });
        scenes[idx] = {
          ...scene,
          requestId: retried.requestId,
          retries: scene.retries + 1,
          status: retried.immediateS3Key ? "completed" : "submitted",
          clipS3Key: retried.immediateS3Key ?? null,
        };
      } else {
        scenes[idx] = { ...scene, status: "failed", error: w.error ?? "Sahne üretilemedi." };
        await prisma.videoPipelineJob.update({ where: { id: job.id }, data: { sceneJobs: scenes } });
        await failPipelineJob(job.id, w.error ?? "Sahne üretilemedi.");
        return true;
      }
    }

    const doneCount = scenes.filter((s) => s.status === "completed").length;
    const pct = Math.min(75, 25 + Math.round((doneCount / scenes.length) * 50));
    await prisma.videoPipelineJob.update({
      where: { id: job.id },
      data: { sceneJobs: scenes, progress: pct },
    });

    if (doneCount === scenes.length) {
      void finalizePhotoToVideoRender(job.id);
    }
    return true;
  }
  return false;
}

/**
 * Polling sırasında geciken fal sahnelerini sorgulayıp tamamlar ve güncel durumu döndürür.
 */
export async function getPipelineJobWithReconcile(tenantId: string, jobId: string) {
  const job = await prisma.videoPipelineJob.findUnique({
    where: { id: jobId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!job || job.tenantId !== tenantId) return null;

  if (job.status === "generating" && job.kind === "photo_to_video") {
    const scenes = (job.sceneJobs as SceneJobState[] | null) ?? [];
    const modelChoice = videoModelChoiceSchema.parse(job.modelKey);
    const spec = FAL_VIDEO_ADAPTERS[modelChoice];
    let changed = false;

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]!;
      if (s.status !== "submitted" || !s.requestId) continue;
      if (Date.now() - s.startedAt < 4000) continue;
      const endpoint = s.uploadId ? spec.i2vEndpoint : spec.t2vEndpoint;
      const polled = await pollFalSceneResult(endpoint, s.requestId).catch(() => null);
      if (polled?.status === "COMPLETED" && polled.videoUrl) {
        const dl = await fal().download(polled.videoUrl);
        const clipKey = `pipeline/${job.tenantId}/clips/${randomUUID()}.mp4`;
        await objectStore().put(clipKey, dl.bytes, "video/mp4");
        scenes[i] = { ...s, status: "completed", clipS3Key: clipKey, durationMs: Date.now() - s.startedAt };
        changed = true;
      } else if (polled?.status === "FAILED") {
        await failPipelineJob(job.id, polled.error ?? "fal.ai sahne hatası");
        return prisma.videoPipelineJob.findUnique({ where: { id: jobId }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
      }
    }

    if (changed) {
      const doneCount = scenes.filter((s) => s.status === "completed").length;
      const pct = Math.min(75, 25 + Math.round((doneCount / scenes.length) * 50));
      await prisma.videoPipelineJob.update({ where: { id: job.id }, data: { sceneJobs: scenes, progress: pct } });
      if (doneCount === scenes.length) {
        await finalizePhotoToVideoRender(job.id);
      }
    }
  }

  const fresh = await prisma.videoPipelineJob.findUnique({
    where: { id: jobId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!fresh) return null;
  const rootId = fresh.rootJobId ?? fresh.id;
  const allVersions = await prisma.videoVersion.findMany({
    where: { tenantId, rootJobId: rootId },
    orderBy: { versionNumber: "desc" },
    take: 25,
  });
  return { ...fresh, versions: allVersions.length ? allVersions : fresh.versions };
}

/** Önceki bir versiyona geri döner (yeni aktif versiyon olarak kaydeder). */
export async function revertVideoToVersion(tenantId: string, versionId: string) {
  const target = await prisma.videoVersion.findUnique({ where: { id: versionId } });
  if (!target || target.tenantId !== tenantId) throw new Error("Versiyon bulunamadı.");
  const latest = await prisma.videoVersion.findFirst({
    where: { tenantId, rootJobId: target.rootJobId },
    orderBy: { versionNumber: "desc" },
  });
  const nextNum = (latest?.versionNumber ?? target.versionNumber) + 1;
  return prisma.videoVersion.create({
    data: {
      tenantId,
      pipelineJobId: target.pipelineJobId,
      rootJobId: target.rootJobId,
      versionNumber: nextNum,
      uploadId: target.uploadId,
      editCommand: `v${target.versionNumber} sürümüne geri dönüldü`,
      editPlan: target.editPlan ?? undefined,
      parentVersionId: target.id,
    },
  });
}

export { editPlanSchema, probeVideoDuration };

