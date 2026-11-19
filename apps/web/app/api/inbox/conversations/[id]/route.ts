import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import {
  getUnifiedConversationDetail,
  updateUnifiedConversation,
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

const patchSchema = z.object({
  status: z.enum(["open", "pending", "snoozed", "resolved"]).optional(),
  snoozedUntil: z.string().max(64).nullish(),
  assigneeId: z.string().max(64).nullish(),
  teamId: z.string().max(64).nullish(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullish(),
  campaignId: z.string().max(64).nullish(),
  addLabel: z.string().max(64).optional(),
  removeLabel: z.string().max(64).optional(),
  markRead: z.boolean().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const detail = await getUnifiedConversationDetail(tenantId, id);
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const body = await readJson(req, patchSchema);
    const user = await prisma.user.findUnique({
      where: { id: auth.actor.userId },
      select: { name: true, email: true },
    });
    const detail = await updateUnifiedConversation({
      tenantId,
      conversationId: id,
      actorId: auth.actor.userId,
      actorName: user?.name ?? user?.email ?? "Temsilci",
      ...body,
    });
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

