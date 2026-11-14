import { prisma } from "@infulancer/core/db";
import { presignCreativeGet } from "@infulancer/core/creative/uploads";
import { readObject } from "@infulancer/core/storage/s3";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenantOrNull } from "@/lib/creative-tenant";
import { jsonError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stüdyo dosyasını (yükleme veya AI çıktısı) kısa süreli imzalı URL'e yönlendirir.
 * ?t=asset → AI çıktısı (generated_assets), aksi halde yükleme. Sahiplik zorunlu.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiActor("ADMIN", "BRAND", "INFLUENCER");
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return jsonError(404, "Bulunamadı.");
  const own = ownTenantOrNull(auth.actor);
  const isAsset = new URL(req.url).searchParams.get("t") === "asset";
  const row = isAsset
    ? await prisma.generatedAsset.findUnique({ where: { id }, select: { tenantId: true, s3Key: true } })
    : await prisma.creativeUpload.findUnique({ where: { id }, select: { tenantId: true, s3Key: true } });
  if (!row || (own !== null && row.tenantId !== own)) return jsonError(404, "Bulunamadı.");
  // Tuval same-origin ister; imzalı S3 adresine 307, CORS olmadan onload'u hiç ateşlemez.
  if (new URL(req.url).searchParams.get("cors") === "1") {
    const obj = await readObject(row.s3Key);
    if (!obj) return jsonError(404, "Bulunamadı.");
    return new Response(Buffer.from(obj.bytes), {
      headers: {
        "Content-Type": obj.mime,
        "Content-Length": String(obj.bytes.byteLength),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const url = await presignCreativeGet(row.s3Key, 900);
  return new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "private, max-age=600" } });
}
