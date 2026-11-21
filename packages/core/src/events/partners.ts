import { prisma } from "../db";

const PREFIX = "event.partners.";

function keyFor(eventId: string): string {
  return `${PREFIX}${eventId}`;
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/** Etkinliğe eklenmiş iş birliği (partner) marka kimliklerini döndürür. */
export async function getEventPartnerIds(eventId: string): Promise<string[]> {
  const row = await prisma.configValue.findUnique({ where: { key: keyFor(eventId) }, select: { value: true } });
  return parseIds(row?.value);
}

/** Etkinliğin iş birliği yapılan markalarını kaydeder. */
export async function setEventPartnerIds(eventId: string, partnerBrandIds: string[]): Promise<void> {
  const clean = [...new Set(partnerBrandIds.filter(Boolean))];
  const key = keyFor(eventId);
  if (clean.length === 0) {
    await prisma.configValue.deleteMany({ where: { key } });
    return;
  }
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: clean, verified: true, note: "Etkinlik iş birliği markaları" },
    update: { value: clean },
  });
}

/** Birden fazla etkinlik için partner marka listesini toplu çeker. */
export async function getEventsPartnerMap(eventIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (eventIds.length === 0) return map;
  const rows = await prisma.configValue.findMany({
    where: { key: { in: eventIds.map(keyFor) } },
    select: { key: true, value: true },
  });
  for (const r of rows) {
    const eventId = r.key.slice(PREFIX.length);
    const ids = parseIds(r.value);
    if (ids.length) map.set(eventId, ids);
  }
  return map;
}

/** Belirli bir markanın partner (ortak düzenleyen) olduğu etkinlik ID'lerini döndürür. */
export async function getEventIdsForBrand(brandId: string): Promise<string[]> {
  const rows = await prisma.configValue.findMany({
    where: { key: { startsWith: PREFIX } },
    select: { key: true, value: true },
  });
  const out: string[] = [];
  for (const r of rows) {
    if (parseIds(r.value).includes(brandId)) {
      out.push(r.key.slice(PREFIX.length));
    }
  }
  return out;
}

/** Marka bu etkinliği yönetebilir mi (ana düzenleyen veya iş birliği markası)? */
export async function canBrandManageEvent(event: { id: string; tenantId: string | null }, brandId: string): Promise<boolean> {
  if (event.tenantId === brandId) return true;
  const partners = await getEventPartnerIds(event.id);
  return partners.includes(brandId);
}

