import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import {
  bulkUpdateUnifiedConversations,
  getInboxSettings,
  listUnifiedConversations,
  type InboxPriority,
} from "@infulancer/core/inbox/store";
import type { InboxChannelType } from "@infulancer/core/inbox/messaging-window";
import type { InboxUiStatus } from "@infulancer/core/inbox/rules";
import { requireApiActor } from "@/lib/auth-guard";
import {
  inboxDisabledResponse,
  inboxErrorResponse,
  resolveActorInboxTenant,
} from "@/lib/inbox-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(50),
  status: z.enum(["open", "pending", "snoozed", "resolved"]).optional(),
  assigneeId: z.string().max(64).nullish(),
  addLabel: z.string().max(64).optional(),
});

export async function GET(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const sp = new URL(req.url).searchParams;
    const tab = (sp.get("tab") ?? "all") as "mine" | "unassigned" | "all";
    const status = (sp.get("status") ?? "open") as InboxUiStatus | "all";
    const channel = (sp.get("channel") ?? "ALL") as InboxChannelType | "ALL";
    const label = sp.get("label") ?? undefined;
    const priority = (sp.get("priority") ?? undefined) as InboxPriority | undefined;
    const teamId = sp.get("teamId") ?? undefined;
    const unreadOnly = sp.get("unread") === "1";
    const sortBy = (sp.get("sort") ?? "last_activity") as "last_activity" | "waiting_longest" | "created";
    const q = sp.get("q") ?? undefined;

    const [{ conversations, counts }, settings, agents] = await Promise.all([
      listUnifiedConversations(tenantId, {
        userId: auth.actor.userId,
        tab,
        status,
        channel,
        label,
        priority,
        teamId,
        unreadOnly,
        sortBy,
        q,
      }),
      getInboxSettings(tenantId),
      prisma.user.findMany({
        where: {
          OR: [{ brandId: tenantId }, { role: "ADMIN" }],
        },
        select: { id: true, name: true, email: true, role: true },
        take: 30,
      }),
    ]);

    return Response.json(
      {
        tenantId,
        currentUser: { id: auth.actor.userId, role: auth.actor.role },
        conversations,
        counts,
        settings,
        agents: agents.map((u) => ({
          id: u.id,
          name: u.name ?? u.email.split("@")[0] ?? "Temsilci",
          email: u.email,
          role: u.role,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const body = await readJson(req, bulkSchema);
    const user = await prisma.user.findUnique({
      where: { id: auth.actor.userId },
      select: { name: true, email: true },
    });
    const res = await bulkUpdateUnifiedConversations({
      tenantId,
      actorId: auth.actor.userId,
      actorName: user?.name ?? user?.email ?? "Temsilci",
      ids: body.ids,
      status: body.status,
      assigneeId: body.assigneeId,
      addLabel: body.addLabel,
    });
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

