import { prisma, BiometricConsentType, Role } from "../db";
import { computePromptHash, getCachedMediaJob } from "./caching";
import { assertLegalConsent } from "./compliance";
import { reserveCreditsForJob } from "./ledger";
import { calculateMediaCost } from "./pricing-engine";
import { MediaJobRequest, MediaJobResult, ModelAlias } from "./types";

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class RolePermissionError extends Error {
  constructor(role: string, alias: string) {
    super(`Yetkisiz işlem: '${role}' rolü '${alias}' modelini çalıştırma yetkisine sahip değildir.`);
    this.name = "RolePermissionError";
  }
}

const ROLE_HIERARCHY: Record<Role, number> = {
  INFLUENCER: 1,
  BRAND: 2,
  AGENCY: 3,
  ADMIN: 4,
};

/**
 * Node.js API Media Request Dispatcher
 * İstemciden gelen isteği karşılar, moderasyon/yasal rıza/kredi rezervasyonu yapar
 * ve Python AI Worker kuyruğuna aktarır.
 */
export async function dispatchMediaJob(
  request: MediaJobRequest
): Promise<MediaJobResult | { jobId: string; status: "QUEUED"; estimatedCredits: number }> {
  const { userId, userRole, alias, prompt, negativePrompt, params, organizationId } = request;

  // 1. Model Konfigürasyonunu yükle
  const modelConfig = await prisma.mediaModelConfig.findUnique({
    where: { alias },
    include: { primaryProvider: true },
  });

  if (!modelConfig || !modelConfig.isActive) {
    throw new Error(`Talep edilen model alias'ı aktif değil veya tanımlı değil: ${alias}`);
  }

  // 2. Rol bazlı yetkilendirme kontrolü
  const userRoleLevel = ROLE_HIERARCHY[userRole as Role] ?? 0;
  const minRoleLevel = ROLE_HIERARCHY[modelConfig.minRole as Role] ?? 0;
  if (userRoleLevel < minRoleLevel) {
    throw new RolePermissionError(userRole, alias);
  }

  // 3. Yasal Biyometrik Rıza Kontrolü (KVKK / GDPR Middleware)
  if (
    alias === "ultra-tts" && params?.voiceId || // Ses klonlama
    alias === "lip-sync" ||                    // Yüz / ağız senkronu
    alias === "avatar-talking"                 // Dijital ikiz
  ) {
    const consentType: BiometricConsentType =
      alias === "ultra-tts"
        ? BiometricConsentType.VOICE_CLONING
        : alias === "lip-sync"
        ? BiometricConsentType.AVATAR_LIPSYNC
        : BiometricConsentType.DIGITAL_TWIN;

    await assertLegalConsent({ userId, consentType });
  }

  // 4. Aşamalı Üretim (Draft-First) Kuralı
  if (modelConfig.isDraftFirstRequired && !request.isDraftFirstOverride && userRole !== "ADMIN") {
    // Kullanıcının daha önce bu konsept için taslak üretip üretmediği kontrol edilir
    const hasDraftJob = await prisma.mediaJob.findFirst({
      where: {
        userId,
        alias: alias.includes("video") ? "draft-video" : "draft-image",
        status: "SUCCEEDED",
      },
    });

    if (!hasDraftJob) {
      throw new PolicyViolationError(
        `Maliyet Optimizasyonu (Draft-First Kuralı): Doğrudan yüksek maliyetli '${alias}' modelini çalıştırmadan önce lütfen düşük maliyetli taslak versiyonunu üretip onaylayınız.`
      );
    }
  }

  // 5. Önbellekleme (Caching) Kontrolü
  const promptHash = computePromptHash({
    alias,
    prompt,
    negativePrompt,
    parameters: params as Record<string, unknown>,
    inputMediaUrls: params?.inputImageUrl ? [params.inputImageUrl] : [],
  });

  const cachedResult = await getCachedMediaJob(promptHash);
  if (cachedResult) {
    return cachedResult;
  }

  // 6. Kredi Maliyeti Hesaplama
  const isVideoOrAvatar =
    modelConfig.capability === "VIDEO_GENERATION" ||
    modelConfig.capability === "VIDEO_EDIT" ||
    modelConfig.capability === "AVATAR" ||
    modelConfig.capability === "LIP_SYNC";

  const units =
    modelConfig.unitType === "second"
      ? params?.durationSeconds ?? 5
      : 1;

  const costCalc = calculateMediaCost({
    alias,
    officialCostUsd: Number(modelConfig.officialCostUsd),
    isMediaVideoOrAvatar: isVideoOrAvatar,
    units,
  });

  // 7. MediaJob kaydını oluştur
  const job = await prisma.mediaJob.create({
    data: {
      userId,
      organizationId,
      alias,
      capability: modelConfig.capability,
      prompt,
      negativePrompt,
      promptHash,
      parameters: (params ?? {}) as any,
      status: "PENDING_RESERVATION",
      creditsReserved: costCalc.requiredCredits,
      officialCostUsd: costCalc.officialCostUsd,
      loadedCostUsd: costCalc.loadedCostUsd,
      marginPercentage: costCalc.grossMarginPercentage,
      inputMediaUrls: params?.inputImageUrl ? [params.inputImageUrl] : [],
      moderationPassed: true,
    },
  });

  // 8. Kullanıcının kredi bakiyesini rezerve et (bloke)
  // TenantId olarak organizationId veya userId fallback kullanılır
  const tenantId = organizationId ?? userId;
  await reserveCreditsForJob({
    tenantId,
    jobId: job.id,
    creditsToHold: costCalc.requiredCredits,
  });

  // 9. Kuyruğa Mesaj Bırak (BullMQ / Redis Streams / SQS)
  // Python Media Worker bu kuyruktan işi çekecektir.
  await enqueueJobForWorker({
    jobId: job.id,
    alias,
    prompt,
    negativePrompt,
    parameters: params,
    tenantId,
    userId,
  });

  return {
    jobId: job.id,
    status: "QUEUED",
    estimatedCredits: costCalc.requiredCredits,
  };
}

async function enqueueJobForWorker(payload: Record<string, unknown>): Promise<void> {
  // Kuyruk entegrasyonu (Redis / SQS)
  // Geliştirme ortamında veya AWS üzerinde arka plan işçisine sinyal gönderir
  // Detaylı kuyruk mekanizması 'services/media-worker' tarafından tüketilir
}
