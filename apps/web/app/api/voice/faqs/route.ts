import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { syncBrandFaqsToKb } from "@infulancer/core/voice/knowledgeIngestion";
import { requireApiActor } from "@/lib/auth-guard";
import { resolveVoiceBrandId } from "@/lib/voice-brand";
import { errorResponse, jsonError, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const faqSchema = z.object({
  brandId: z.string().optional(),
  question: z.string().min(3).max(400),
  answer: z.string().min(3).max(2000),
});

export async function GET(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const brandId = await resolveVoiceBrandId(auth.actor, new URL(req.url).searchParams.get("brandId"));
  if (!brandId) return jsonError(400, "Marka bulunamadı.");
  const faqs = await prisma.voiceFaqItem.findMany({ where: { brandId }, orderBy: { createdAt: "desc" } });
  return Response.json({ faqs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(req, faqSchema);
    const brandId = await resolveVoiceBrandId(auth.actor, body.brandId ?? null);
    if (!brandId) return jsonError(400, "Marka bulunamadı.");
    const faq = await prisma.voiceFaqItem.create({
      data: { brandId, question: body.question.trim(), answer: body.answer.trim(), active: true },
    });
    void syncBrandFaqsToKb(brandId);
    return Response.json({ faq }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const u = new URL(req.url);
  const id = u.searchParams.get("id") ?? "";
  const brandId = await resolveVoiceBrandId(auth.actor, u.searchParams.get("brandId"));
  if (!brandId || !id) return jsonError(400, "Geçersiz parametre.");
  await prisma.voiceFaqItem.deleteMany({ where: { id, brandId } });
  void syncBrandFaqsToKb(brandId);
  return Response.json({ ok: true });
}

