import { prisma } from "@infulancer/core/db";
import { extractEventIdFromParam, slugifyTurkish } from "./event-url";

/**
 * `/etkinlik/[id]` parametresinden etkinliği bulur:
 * 1) `slug--id` veya doğrudan `id` ile arar
 * 2) Bulunamazsa başlık slug'ı eşleşen etkinliği arar (ör. `/etkinlik/yaz-lansmani`).
 */
export async function resolveEventByParam(param: string) {
  const candidateId = extractEventIdFromParam(param);
  const direct = await prisma.event.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (direct) return direct.id;

  const targetSlug = slugifyTurkish(param);
  if (!targetSlug) return null;
  const recent = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, title: true },
  });
  return recent.find((e) => slugifyTurkish(e.title) === targetSlug)?.id ?? null;
}
