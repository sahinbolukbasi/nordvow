import { prisma } from "./db";

/** Yük dengeleyici için sır sızdırmayan durum. Ortam değişkeni veya belirteç dönmez. */
export async function healthStatus(): Promise<{ ok: boolean; db: "up" | "down" }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, db: "up" };
  } catch {
    return { ok: false, db: "down" };
  }
}
