import { prisma } from "@infulancer/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ALB & ECS hedef grubu için veritabanı bağlantılı sağlık kontrolü. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { ok: true, dbLatencyMs: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, dbLatencyMs: Date.now() - startedAt },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

