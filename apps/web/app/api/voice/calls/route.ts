import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { promoteQuestionToFaq } from "@infulancer/core/voice/callLogService";
import { requireApiActor } from "@/lib/auth-guard";
import { resolveVoiceBrandId } from "@/lib/voice-brand";
import { errorResponse, jsonError, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const brandId = await resolveVoiceBrandId(auth.actor, new URL(req.url).searchParams.get("brandId"));
  if (!brandId) return jsonError(400, "Marka bulunamadı.");

  const [calls, callbacks] = await Promise.all([
    prisma.voiceCallLog.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.voiceCallbackRequest.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const unanswered = calls.flatMap((c) => {
    const qs = Array.isArray(c.unansweredQuestions) ? (c.unansweredQuestions as string[]) : [];
    return qs.map((q) => ({ callId: c.id, question: q, at: c.createdAt }));
  });

  return Response.json({ calls, callbacks, unanswered }, { headers: { "Cache-Control": "no-store" } });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("promote_faq"),
    brandId: z.string().optional(),
    question: z.string().min(2).max(400),
    answer: z.string().min(2).max(2000),
  }),
  z.object({
    action: z.literal("callback_status"),
    brandId: z.string().optional(),
    callbackId: z.string().min(1),
    status: z.enum(["bekliyor", "arandi", "kapandi"]),
  }),
]);

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(req, actionSchema);
    const brandId = await resolveVoiceBrandId(auth.actor, body.brandId ?? null);
    if (!brandId) return jsonError(400, "Marka bulunamadı.");

    if (body.action === "promote_faq") {
      const faq = await promoteQuestionToFaq({ brandId, question: body.question, answer: body.answer });
      return Response.json({ faq });
    }

    await prisma.voiceCallbackRequest.updateMany({
      where: { id: body.callbackId, brandId },
      data: { status: body.status },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

