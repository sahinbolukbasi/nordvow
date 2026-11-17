import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { getOrCacheGreetingAudio, synthesizeVoiceSpeech } from "@infulancer/core/voice/ttsService";
import { suggestGreetingWithAi } from "@infulancer/core/voice/voiceAgent";
import { voiceConfigUpdateSchema } from "@infulancer/core/voice/types";
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
  const config = await prisma.voiceAssistantConfig.upsert({
    where: { brandId },
    create: { brandId },
    update: {},
  });
  return Response.json({ config }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(req, voiceConfigUpdateSchema.extend({ brandId: z.string().optional() }));
    const brandId = await resolveVoiceBrandId(auth.actor, body.brandId ?? null);
    if (!brandId) return jsonError(400, "Marka bulunamadı.");

    const cleanPhone = body.connectPhoneNumber?.trim() || null;
    const cached = await getOrCacheGreetingAudio({
      brandId,
      greetingText: body.greetingText,
      modelKey: body.ttsModelKey,
      voiceId: body.ttsVoiceId,
    }).catch(() => null);

    const config = await prisma.voiceAssistantConfig.upsert({
      where: { brandId },
      create: {
        brandId,
        connectPhoneNumber: cleanPhone,
        assistantName: body.assistantName,
        greetingText: body.greetingText,
        greetingCacheKey: cached?.s3Key ?? null,
        ttsModelKey: body.ttsModelKey,
        ttsVoiceId: body.ttsVoiceId,
        tone: body.tone,
        businessHours: body.businessHours,
        routingRules: body.routingRules,
        blockedTopics: body.blockedTopics ?? null,
        active: body.active ?? true,
      },
      update: {
        connectPhoneNumber: cleanPhone,
        assistantName: body.assistantName,
        greetingText: body.greetingText,
        greetingCacheKey: cached?.s3Key ?? null,
        ttsModelKey: body.ttsModelKey,
        ttsVoiceId: body.ttsVoiceId,
        tone: body.tone,
        businessHours: body.businessHours,
        routingRules: body.routingRules,
        blockedTopics: body.blockedTopics ?? null,
        active: body.active ?? true,
      },
    });
    return Response.json({ config }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

const helperSchema = z.object({
  action: z.enum(["suggest_greeting", "preview_voice"]),
  brandId: z.string().optional(),
  tone: z.string().optional(),
  text: z.string().max(600).optional(),
  ttsModelKey: z.string().optional(),
  ttsVoiceId: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(req, helperSchema);
    const brandId = await resolveVoiceBrandId(auth.actor, body.brandId ?? null);
    if (!brandId) return jsonError(400, "Marka bulunamadı.");
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });

    if (body.action === "suggest_greeting") {
      const greetingText = await suggestGreetingWithAi(brand?.name ?? "Marka", body.tone ?? "samimi");
      return Response.json({ greetingText });
    }

    const speech = await synthesizeVoiceSpeech({
      text: body.text || "Merhaba, ben yapay zekâ telefon asistanınızım. Size nasıl yardımcı olabilirim?",
      modelKey: body.ttsModelKey,
      voiceId: body.ttsVoiceId,
      format: "mp3",
    });
    return Response.json({
      audioBase64: Buffer.from(speech.bytes).toString("base64"),
      mime: speech.mime,
      provider: speech.provider,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

