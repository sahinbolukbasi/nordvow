import * as crypto from "node:crypto";
import { prisma } from "../db";
import { MediaJobResult, ModelAlias } from "./types";

/**
 * Aynı prompt, parametre ve referans dosya girdileri için benzersiz bir SHA-256 hash üretir.
 */
export function computePromptHash(params: {
  alias: ModelAlias;
  prompt: string;
  negativePrompt?: string;
  parameters?: Record<string, unknown>;
  inputMediaUrls?: string[];
}): string {
  const normalized = JSON.stringify({
    alias: params.alias,
    prompt: params.prompt.trim().toLowerCase(),
    negativePrompt: params.negativePrompt ? params.negativePrompt.trim().toLowerCase() : "",
    parameters: params.parameters ?? {},
    inputMediaUrls: (params.inputMediaUrls ?? []).sort(),
  });

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Başarıyla tamamlanmış aynı hash'e sahip bir iş varsa önbellekten döner (Örn. son 7 gün içinde).
 */
export async function getCachedMediaJob(
  promptHash: string,
  ttlHours = 168
): Promise<MediaJobResult | null> {
  const thresholdDate = new Date(Date.now() - ttlHours * 3600 * 1000);

  const cached = await prisma.mediaJob.findFirst({
    where: {
      promptHash,
      status: "SUCCEEDED",
      outputMediaUrls: { isEmpty: false },
      completedAt: { gte: thresholdDate },
    },
    orderBy: { completedAt: "desc" },
  });

  if (!cached || cached.outputMediaUrls.length === 0) {
    return null;
  }

  return {
    jobId: cached.id,
    status: "SUCCEEDED",
    alias: cached.alias as ModelAlias,
    providerUsed: cached.providerUsed ?? undefined,
    modelUsed: cached.modelUsed ?? undefined,
    outputUrls: cached.outputMediaUrls,
    creditsCharged: 0, // Önbellekten dönen iş için kullanıcıdan tekrar tam ücret alınmaz
    costBreakdown: {
      officialCostUsd: 0,
      loadedCostUsd: 0,
      retailPriceUsd: 0,
      marginPercentage: 100,
    },
    inferenceMs: cached.inferenceMs ?? 0,
    c2paManifestId: cached.c2paManifestId ?? undefined,
    cached: true,
  };
}
