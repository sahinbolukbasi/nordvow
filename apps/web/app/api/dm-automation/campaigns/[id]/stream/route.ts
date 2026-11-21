import { listDmRealtimeEventsAfter } from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  const { id } = await params;
  const tenantId = await resolveActorDmTenant(auth.actor, req.url);
  const denied = await verifyDmApiAccess(auth.actor, tenantId, "view", { campaignId: id });
  if (denied) return denied;

  const url = new URL(req.url);
  const afterParam = url.searchParams.get("after");
  if (afterParam !== null) {
    const events = listDmRealtimeEventsAfter(tenantId, id, Number(afterParam) || 0);
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  }

  let cursorTs = Number(req.headers.get("last-event-id")) || Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: 4000\n:connected campaign=${id}\n\n`));

      const pollTimer = setInterval(() => {
        try {
          const events = listDmRealtimeEventsAfter(tenantId, id, cursorTs);
          for (const ev of events) {
            cursorTs = Math.max(cursorTs, ev.ts);
            controller.enqueue(
              encoder.encode(`id: ${ev.ts}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
            );
          }
        } catch {
          // stream closed
        }
      }, 2000);

      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:ping ${Date.now()}\n\n`));
        } catch {
          // stream closed
        }
      }, 25000);

      req.signal.addEventListener("abort", () => {
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

