import { z } from "zod";
import {
  getInboxSettings,
  recordInboxAudit,
  saveInboxSettings,
} from "@infulancer/core/inbox/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  inboxDisabledResponse,
  inboxErrorResponse,
  resolveActorInboxTenant,
} from "@/lib/inbox-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settingsPatchSchema = z.object({
  brandVoice: z
    .object({
      tone: z.enum(["samimi", "kurumsal"]).optional(),
      address: z.enum(["sen", "siz"]).optional(),
      useEmoji: z.boolean().optional(),
      signature: z.string().max(80).optional(),
    })
    .optional(),
  aiSuggestionsEnabled: z.boolean().optional(),
  retentionMonths: z.number().int().min(1).max(60).optional(),
  enterToSend: z.boolean().optional(),
  reopenOnNewMessage: z.boolean().optional(),
  humanAgentEnabled: z.boolean().optional(),
  cannedResponses: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        shortCode: z
          .string()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9-_]+$/, { error: "Kısa kod yalnız küçük harf, rakam, - ve _ içerebilir." }),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(100)
    .optional(),
  labels: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(40),
        color: z.string().max(24),
      }),
    )
    .max(60)
    .optional(),
  teams: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(60),
        memberIds: z.array(z.string().max(64)).max(50),
      }),
    )
    .max(30)
    .optional(),
});

export async function GET(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const settings = await getInboxSettings(tenantId);
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const body = await readJson(req, settingsPatchSchema);
    const current = await getInboxSettings(tenantId);
    const settings = await saveInboxSettings(tenantId, {
      ...body,
      brandVoice: body.brandVoice ? { ...current.brandVoice, ...body.brandVoice } : current.brandVoice,
    });
    await recordInboxAudit(tenantId, auth.actor.userId, "settings.update");
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

