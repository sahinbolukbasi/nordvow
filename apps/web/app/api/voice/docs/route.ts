import { prisma } from "@infulancer/core/db";
import { deleteBrandKnowledgeDoc, ingestBrandKnowledgeDoc } from "@infulancer/core/voice/knowledgeIngestion";
import { requireApiActor } from "@/lib/auth-guard";
import { resolveVoiceBrandId } from "@/lib/voice-brand";
import { jsonError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const brandId = await resolveVoiceBrandId(auth.actor, new URL(req.url).searchParams.get("brandId"));
  if (!brandId) return jsonError(400, "Marka bulunamadı.");
  const docs = await prisma.voiceKnowledgeDoc.findMany({ where: { brandId }, orderBy: { createdAt: "desc" } });
  return Response.json({ docs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  try {
    const fd = await req.formData();
    const brandId = await resolveVoiceBrandId(auth.actor, String(fd.get("brandId") ?? "") || null);
    if (!brandId) return jsonError(400, "Marka bulunamadı.");
    const file = fd.get("file");
    if (!(file instanceof File)) return jsonError(400, "Dosya seçilmedi.");
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
      return jsonError(413, "Belge boyutu 1 byte ile 25 MB arasında olmalıdır.");
    }
    const replaceDocId = String(fd.get("replaceDocId") ?? "") || null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await ingestBrandKnowledgeDoc({
      brandId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
      replaceDocId,
    });
    return Response.json({ doc }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "Belge yüklenemedi.");
  }
}

export async function DELETE(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get("id") ?? "";
    const brandId = await resolveVoiceBrandId(auth.actor, u.searchParams.get("brandId"));
    if (!brandId || !id) return jsonError(400, "Geçersiz parametre.");
    await deleteBrandKnowledgeDoc(brandId, id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "Belge silinemedi.");
  }
}

