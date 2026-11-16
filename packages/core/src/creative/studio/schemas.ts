import { z } from "zod";

export const aspectSchema = z.enum(["9:16", "1:1", "16:9"]).default("9:16");
export type PipelineAspect = z.infer<typeof aspectSchema>;

export const videoModelChoiceSchema = z.enum(["kling", "veo", "wan", "hailuo"]).default("hailuo");
export type VideoModelChoice = z.infer<typeof videoModelChoiceSchema>;

export const transitionTypeSchema = z.enum(["cut", "fade", "wipeleft", "slideleft", "dissolve"]).default("fade");
export type TransitionType = z.infer<typeof transitionTypeSchema>;

export const pipelineStatusSchema = z.enum(["queued", "planning", "generating", "rendering", "done", "failed"]);
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;

export const storyboardSceneSchema = z.object({
  sceneIndex: z.number().int().min(0),
  uploadIndex: z.number().int().min(0),
  uploadId: z.string().optional(),
  motionPrompt: z.string().min(5).max(800),
  cameraMove: z.string().max(120).default("yavaş zoom-in"),
  durationSec: z.number().int().min(3).max(10).default(5),
  transition: transitionTypeSchema.default("fade"),
  voiceoverText: z.string().max(400).optional().default(""),
  subtitleText: z.string().max(160).optional().default(""),
});

export const storyboardSchema = z.object({
  title: z.string().min(2).max(120).default("Yeni Video Hikâyesi"),
  musicStyle: z.string().min(2).max(120).default("modern enerjik elektronik fon müziği"),
  voiceoverScript: z.string().max(1500).optional().default(""),
  scenes: z.array(storyboardSceneSchema).min(1).max(20),
});

export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;

export const editPlanSchema = z.object({
  summary: z.array(z.string().max(160)).min(1).max(10),
  trim: z
    .object({
      startSec: z.number().min(0).max(3600).default(0),
      endSec: z.number().min(0.5).max(3600).nullable().default(null),
      targetDurationSec: z.number().min(2).max(180).nullable().default(null),
    })
    .optional(),
  speed: z.number().min(0.5).max(2.5).default(1),
  aspect: z.enum(["orijinal", "9:16", "1:1", "16:9"]).default("orijinal"),
  colorLook: z.enum(["orijinal", "canli", "siyah-beyaz", "sicak", "soguk"]).default("orijinal"),
  transition: transitionTypeSchema.default("fade"),
  reorder: z.array(z.number().int().min(0)).optional(),
  subtitles: z
    .object({
      enabled: z.boolean().default(false),
      lines: z
        .array(
          z.object({
            startSec: z.number().min(0),
            endSec: z.number().min(0.2),
            text: z.string().min(1).max(140),
          }),
        )
        .max(40)
        .default([]),
    })
    .optional(),
  audioMix: z
    .object({
      muteOriginal: z.boolean().default(false),
      musicPrompt: z.string().max(200).nullable().default(null),
      voiceoverText: z.string().max(1200).nullable().default(null),
      musicVolume: z.number().min(0.05).max(1).default(0.28),
    })
    .optional(),
  regenerateScene: z
    .object({
      enabled: z.boolean().default(false),
      sceneIndex: z.number().int().min(0).default(0),
      prompt: z.string().max(600).default(""),
      durationSec: z.number().int().min(3).max(10).default(5),
      insertAtSec: z.number().min(0).default(0),
    })
    .optional(),
});

export type EditPlan = z.infer<typeof editPlanSchema>;

export type SceneJobState = {
  sceneIndex: number;
  uploadId?: string;
  modelKey: string;
  requestId: string | null;
  status: "pending" | "submitted" | "completed" | "failed";
  retries: number;
  durationSec: number;
  costUsd: number;
  startedAt: number;
  durationMs: number | null;
  clipS3Key: string | null;
  error: string | null;
};

