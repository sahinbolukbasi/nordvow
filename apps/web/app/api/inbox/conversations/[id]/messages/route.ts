import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import {
  getUnifiedConversationDetail,
  sendUnifiedInboxMessage,
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

const sendSchema = z.object({
  type: z.enum(["text", "attachment", "template", "note"]).default("text"),
  content: z.string().max(4000).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().max(100),
        kind: z.string().max(32),
        url: z.string().max(500),
        name: z.string().max(160),
      }),
    )
    .max(5)
    .optional(),
  template: z
    .object({
      id: z.string().max(80).optional(),
      name: z.string().min(1).max(120),
      language: z.string().max(12).default("tr"),
      params: z.array(z.string().max(200)).max(10).optional(),
      bodyPreview: z.string().max(1000).optional(),
    })
    .optional(),
  aiAssisted: z.boolean().optional(),
  mentions: z.array(z.string().max(64)).max(15).optional(),
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
    return Response.json(
      { messages: detail.conversation.messages, notes: detail.conversation.notes, activities: detail.conversation.activities },
      { headers: { "Cache-Control": "no-store" } },
    );
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
    const body = await readJson(req, sendSchema);
    const user = await prisma.user.findUnique({
      where: { id: auth.actor.userId },
      select: { name: true, email: true },
    });
    const senderName = user?.name ?? user?.email?.split("@")[0] ?? "Temsilci";

    const result = await sendUnifiedInboxMessage({
      tenantId,
      conversationId: id,
      senderUserId: auth.actor.userId,
      senderName,
      type: body.type,
      content: body.content,
      attachments: body.attachments,
      template: body.template,
      aiAssisted: body.aiAssisted,
      mentions: body.mentions,
    });
    return Response.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

