import { prisma } from "@infulancer/core/db";
import type { Actor } from "@infulancer/core/access/actor";

export async function resolveVoiceBrandId(actor: Actor, requestedBrandId?: string | null): Promise<string | null> {
  if (actor.role === "BRAND") return actor.brandId ?? null;
  if (actor.role === "ADMIN") {
    if (requestedBrandId) return requestedBrandId;
    const first = await prisma.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    return first?.id ?? null;
  }
  return null;
}

