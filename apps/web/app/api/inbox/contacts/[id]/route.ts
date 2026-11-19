import { z } from "zod";
import {
  deleteInboxContactKvkk,
  exportInboxContactKvkk,
  updateUnifiedContact,
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

const patchContactSchema = z.object({
  name: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  customFields: z.record(z.string(), z.string().max(200)).optional(),
  blocked: z.boolean().optional(),
  nordvowInfluencerId: z.string().max(64).nullish(),
  consent: z
    .object({
      state: z.enum(["GRANTED", "WITHDRAWN"]),
      source: z.string().min(3).max(240),
      note: z.string().max(400).optional(),
    })
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const body = await readJson(req, patchContactSchema);
    const res = await updateUnifiedContact({
      tenantId,
      contactId: id,
      actorId: auth.actor.userId,
      ...body,
    });
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const data = await exportInboxContactKvkk(tenantId, id, auth.actor.userId);
    return Response.json({ exported: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const res = await deleteInboxContactKvkk(tenantId, id, auth.actor.userId);
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

