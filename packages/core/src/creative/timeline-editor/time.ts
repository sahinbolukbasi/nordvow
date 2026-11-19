// Portions adapted from OpenCut (https://github.com/OpenCut-app/opencut-classic)
// Copyright (c) 2025-2026 OpenCut — MIT License. See THIRD_PARTY_NOTICES.md

export const TICKS_PER_SECOND = 120_000;

export type Ticks = number & { readonly __ticks: unique symbol };

export type SupportedFps = 24 | 25 | 30 | 50 | 60;

export function roundTicks(value: number): Ticks {
  if (!Number.isFinite(value)) return 0 as Ticks;
  return Math.max(0, Math.round(value)) as Ticks;
}

export function secondsToTicks(seconds: number): Ticks {
  if (!Number.isFinite(seconds)) return 0 as Ticks;
  return roundTicks(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: number): number {
  if (!Number.isFinite(ticks)) return 0;
  return ticks / TICKS_PER_SECOND;
}

export function addTicks(a: Ticks, b: Ticks): Ticks {
  return roundTicks(a + b);
}

export function subTicks(a: Ticks, b: Ticks): Ticks {
  return roundTicks(Math.max(0, a - b));
}

export function ticksPerFrame(fps: SupportedFps): Ticks {
  return roundTicks(TICKS_PER_SECOND / fps);
}

export function snapToFrame(ticks: Ticks, fps: SupportedFps): Ticks {
  const step = ticksPerFrame(fps);
  return roundTicks(Math.round(ticks / step) * step);
}

export function formatTimecode(ticks: Ticks, fps: SupportedFps = 30): string {
  const totalSec = ticksToSeconds(ticks);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const remTicks = ticks - secondsToTicks(mins * 60 + secs);
  const frames = Math.floor(remTicks / ticksPerFrame(fps));
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}
