import { z } from "zod";
import { envStr } from "@infulancer/core/env";
import { handleConnectGatewayEvent } from "@infulancer/core/voice/connectGateway";
import { errorResponse, jsonError, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const connectEventSchema = z.object({
  event: z.enum(["call_start", "utterance", "call_end"]),
  contactId: z.string().min(1).max(120),
  calledPhone: z.string().max(40).optional(),
  callerPhone: z.string().max(40).optional(),
  utterance: z.string().max(1500).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).optional(),
  durationSec: z.number().int().min(0).optional(),
  outcome: z.enum(["resolved", "transferred", "callback", "missed"]).optional(),
  transcript: z
    .array(
      z.object({
        role: z.enum(["caller", "assistant"]),
        text: z.string(),
        at: z.string(),
      }),
    )
    .optional(),
  unansweredQuestions: z.array(z.string()).optional(),
  callbackTopic: z.string().optional(),
  callerName: z.string().optional(),
});

/**
 * Amazon Connect Contact Flow / Lambda / KVS ECS Consumer Köprüsü.
 * Kimlik doğrulama: `x-voice-connect-secret` başlığı (`VOICE_CONNECT_SECRET`).
 */
export async function POST(req: Request) {
  const expected = envStr("VOICE_CONNECT_SECRET", "");
  if (expected && req.headers.get("x-voice-connect-secret") !== expected) {
    return jsonError(401, "Yetkisiz Amazon Connect isteği.");
  }

  try {
    const body = await readJson(req, connectEventSchema);
    const result = await handleConnectGatewayEvent(body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

