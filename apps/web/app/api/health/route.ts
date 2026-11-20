export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * ALB liveness. Varsayılan yanıt veritabanına ve dış servislere bakmaz, her zaman 200 döner.
 * `?deep=1` mevcut sağlık kontrolünü çalıştırır ve gerçek durum kodunu verir. Sır veya config yok.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (!deep) {
    return Response.json({ status: "ok" }, { status: 200, headers: NO_STORE });
  }
  const { healthStatus } = await import("@infulancer/core/health");
  const status = await healthStatus();
  return Response.json(
    { status: status.ok ? "ok" : "degraded", db: status.db },
    { status: status.ok ? 200 : 503, headers: NO_STORE },
  );
}
