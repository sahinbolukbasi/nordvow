import { prisma } from "@infulancer/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ALB & ECS hedef grubu için veritabanı bağlantılı sağlık kontrolü. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

