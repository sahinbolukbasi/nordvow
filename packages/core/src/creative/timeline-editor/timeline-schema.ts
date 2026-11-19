// Portions adapted from OpenCut (https://github.com/OpenCut-app/opencut-classic)
// Copyright (c) 2025-2026 OpenCut — MIT License. See THIRD_PARTY_NOTICES.md

import { z } from "zod";
import { DomainError } from "../../domain/errors";
import { roundTicks, secondsToTicks, type SupportedFps, type Ticks } from "./time";

export const TIMELINE_SCHEMA_VERSION = 1 as const;

export type AspectPreset = "9:16" | "1:1" | "16:9" | "4:5" | "custom";

export const ASPECT_CANVAS: Record<Exclude<AspectPreset, "custom">, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
};

const ticksSchema = z.number().int().min(0).transform((v) => roundTicks(v));

const transformSchema = z.object({
  x: z.number().min(-2).max(2).default(0),
  y: z.number().min(-2).max(2).default(0),
  scale: z.number().min(0.05).max(5).default(1),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.05).max(1),
  h: z.number().min(0.05).max(1),
});

export const textStyleSchema = z.object({
  fontFamily: z.string().min(1).max(60).default("Inter"),
  fontSize: z.number().int().min(12).max(160).default(52),
  fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700), z.literal(800)]).default(700),
  color: z.string().max(24).default("#FFFFFF"),
  strokeColor: z.string().max(24).optional(),
  strokeWidth: z.number().min(0).max(12).optional(),
  background: z.string().max(32).optional(),
  align: z.enum(["left", "center", "right"]).default("center"),
  maxWidth: z.number().min(0.1).max(1).default(0.86),
  preset: z.enum(["classic", "bold-yellow", "karaoke", "box"]).optional(),
});

const ctaStyleSchema = z.object({
  bgColor: z.string().max(24).default("#111827"),
  textColor: z.string().max(24).default("#FFFFFF"),
  accentColor: z.string().max(24).default("#FF2BD6"),
  borderRadius: z.number().min(0).max(48).default(24),
});

const baseElSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  startTime: ticksSchema,
  duration: ticksSchema.refine((v) => v > 0, { message: "Öğe süresi 0'dan büyük olmalı." }),
  trimStart: ticksSchema.default(0 as Ticks),
  trimEnd: ticksSchema.default(0 as Ticks),
  sourceDuration: ticksSchema.optional(),
  transform: transformSchema.default({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }),
  fadeIn: ticksSchema.optional(),
  fadeOut: ticksSchema.optional(),
  locked: z.boolean().optional(),
  lockedBy: z.enum(["brand"]).optional(),
  slotId: z.string().max(64).optional(),
  placeholderStatus: z.enum(["generating", "missing"]).optional(),
});

export const videoElSchema = baseElSchema.extend({
  type: z.literal("video"),
  assetId: z.string().min(1).max(100),
  volume: z.number().min(0).max(2).default(1),
  sourceAudio: z.boolean().default(true),
  speed: z.number().min(0.25).max(4).default(1),
  crop: cropSchema.optional(),
});

export const imageElSchema = baseElSchema.extend({
  type: z.literal("image"),
  assetId: z.string().min(1).max(100),
  crop: cropSchema.optional(),
});

export const audioElSchema = baseElSchema.extend({
  type: z.literal("audio"),
  assetId: z.string().min(1).max(100),
  volume: z.number().min(0).max(2).default(1),
  speed: z.number().min(0.25).max(4).default(1),
});

export const textElSchema = baseElSchema.extend({
  type: z.literal("text"),
  text: z.string().max(500),
  style: textStyleSchema,
});

export const captionWordSchema = z.object({
  w: z.string().max(80),
  start: ticksSchema,
  end: ticksSchema,
});

export const captionElSchema = baseElSchema.extend({
  type: z.literal("caption"),
  captionGroupId: z.string().min(1).max(80),
  text: z.string().max(400),
  words: z.array(captionWordSchema).optional(),
  style: textStyleSchema,
});

export const logoElSchema = baseElSchema.extend({
  type: z.literal("logo"),
  assetId: z.string().min(1).max(100),
});

export const ctaElSchema = baseElSchema.extend({
  type: z.literal("cta"),
  label: z.string().max(120),
  couponCode: z.string().max(64).optional(),
  url: z.string().max(400).optional(),
  style: ctaStyleSchema,
});

export const shapeElSchema = baseElSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "pill"]),
  fill: z.string().max(24),
  radius: z.number().min(0).max(100),
});

export const videoTrackSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.literal("video"),
  name: z.string().min(1).max(80),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  elements: z.array(z.discriminatedUnion("type", [videoElSchema, imageElSchema])),
});

export const overlayTrackSchema = z.discriminatedUnion("type", [
  videoTrackSchema,
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("text"),
    name: z.string().min(1).max(80),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
    elements: z.array(z.discriminatedUnion("type", [textElSchema, captionElSchema])),
  }),
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("graphic"),
    name: z.string().min(1).max(80),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
    elements: z.array(z.discriminatedUnion("type", [logoElSchema, ctaElSchema, shapeElSchema])),
  }),
]);

export const audioTrackSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.literal("audio"),
  name: z.string().min(1).max(80),
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  elements: z.array(audioElSchema),
});

export const studioTimelineSchema = z.object({
  schemaVersion: z.literal(1),
  settings: z.object({
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).default(30),
    canvas: z.object({
      width: z.number().int().min(240).max(3840).default(1080),
      height: z.number().int().min(240).max(3840).default(1920),
    }),
    aspectPreset: z.enum(["9:16", "1:1", "16:9", "4:5", "custom"]).default("9:16"),
    background: z.discriminatedUnion("type", [
      z.object({ type: z.literal("color"), color: z.string().max(24).default("#09090B") }),
      z.object({ type: z.literal("blur"), intensity: z.number().min(2).max(60).default(24) }),
    ]),
  }),
  tracks: z.object({
    main: videoTrackSchema,
    overlay: z.array(overlayTrackSchema),
    audio: z.array(audioTrackSchema),
  }),
  markers: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        time: ticksSchema,
        note: z.string().max(160).optional(),
        color: z.string().max(24).optional(),
      }),
    )
    .default([]),
});

export type Crop = z.infer<typeof cropSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type VideoEl = z.infer<typeof videoElSchema>;
export type ImageEl = z.infer<typeof imageElSchema>;
export type AudioEl = z.infer<typeof audioElSchema>;
export type TextEl = z.infer<typeof textElSchema>;
export type CaptionEl = z.infer<typeof captionElSchema>;
export type LogoEl = z.infer<typeof logoElSchema>;
export type CtaEl = z.infer<typeof ctaElSchema>;
export type ShapeEl = z.infer<typeof shapeElSchema>;
export type TimelineElement = VideoEl | ImageEl | AudioEl | TextEl | CaptionEl | LogoEl | CtaEl | ShapeEl;
export type VideoTrack = z.infer<typeof videoTrackSchema>;
export type OverlayTrack = z.infer<typeof overlayTrackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type AnyTrack = VideoTrack | OverlayTrack | AudioTrack;
export type StudioTimeline = z.infer<typeof studioTimelineSchema>;

export function createEmptyTimeline(aspectPreset: AspectPreset = "9:16", fps: SupportedFps = 30): StudioTimeline {
  const canvas = aspectPreset === "custom" ? ASPECT_CANVAS["9:16"] : ASPECT_CANVAS[aspectPreset];
  return studioTimelineSchema.parse({
    schemaVersion: 1,
    settings: {
      fps,
      canvas,
      aspectPreset,
      background: { type: "color", color: "#09090B" },
    },
    tracks: {
      main: { id: "main-v1", type: "video", name: "Ana Video (V1)", muted: false, hidden: false, locked: false, elements: [] },
      overlay: [
        { id: "overlay-t2", type: "text", name: "Metin (T2)", hidden: false, locked: false, elements: [] },
        { id: "overlay-t1", type: "text", name: "Altyazı (T1)", hidden: false, locked: false, elements: [] },
        { id: "overlay-g1", type: "graphic", name: "Marka & CTA", hidden: false, locked: false, elements: [] },
      ],
      audio: [{ id: "audio-a1", type: "audio", name: "Ses (A1)", muted: false, locked: false, elements: [] }],
    },
    markers: [],
  });
}

export function allTimelineElements(t: StudioTimeline): TimelineElement[] {
  return [
    ...t.tracks.main.elements,
    ...t.tracks.overlay.flatMap<TimelineElement>((tr) => tr.elements),
    ...t.tracks.audio.flatMap<TimelineElement>((tr) => tr.elements),
  ];
}

export function timelineTotalDurationTicks(t: StudioTimeline): Ticks {
  let max = 0;
  for (const el of allTimelineElements(t)) {
    const end = el.startTime + el.duration;
    if (end > max) max = end;
  }
  return roundTicks(Math.max(max, secondsToTicks(1)));
}

/**
 * Marka şablonundan gelen kilitli katmanların (`lockedBy === "brand"`)
 * creator tarafından silinmediğini veya değiştirilmediğini sunucuda doğrular.
 */
export function assertLockedBrandLayersIntact(prev: StudioTimeline, next: StudioTimeline): void {
  const prevLocked = allTimelineElements(prev).filter((e) => e.locked && e.lockedBy === "brand");
  if (prevLocked.length === 0) return;

  const nextById = new Map(allTimelineElements(next).map((e) => [e.id, e]));
  for (const orig of prevLocked) {
    const cur = nextById.get(orig.id);
    if (!cur) {
      throw new DomainError("KURAL_IHLALI", "Marka tarafından zorunlu tutulan reklam/logo katmanı silinemez.");
    }
    if (!cur.locked || cur.lockedBy !== "brand" || cur.startTime !== orig.startTime || cur.duration !== orig.duration) {
      throw new DomainError("KURAL_IHLALI", "Bu katman marka tarafından zorunlu tutuldu; taşınamaz veya kilidi açılamaz.");
    }
    if (orig.type === "text" && cur.type === "text" && cur.text !== orig.text) {
      throw new DomainError("KURAL_IHLALI", "Marka tarafından zorunlu tutulan reklam ibaresi değiştirilemez.");
    }
  }
}
