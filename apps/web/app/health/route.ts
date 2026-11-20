import { healthStatus } from "@infulancer/core/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sır dökmez. Veritabanı yanıt veriyorsa 200, aksi halde 503. */
export async function GET() {
  const status = await healthStatus();
  return Response.json(status, { status: status.ok ? 200 : 503 });
}
