import { listInboxEventsAfter } from "@infulancer/core/inbox/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  inboxDisabledResponse,
  resolveActorInboxTenant,
} from "@/lib/inbox-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
  const url = new URL(req.url);

  // ?after=<timestamp> verilirse kaçan olayları JSON olarak telafi eder
  const afterParam = url.searchParams.get("after");
  if (afterParam !== null) {
    const afterTs = Number(afterParam) || 0;
    const events = listInboxEventsAfter(tenantId, afterTs);
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  }

  let cursorTs = Number(req.headers.get("last-event-id")) || Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: 4000\n:connected tenant=${tenantId}\n\n`));

      const pollTimer = setInterval(() => {
        try {
          const events = listInboxEventsAfter(tenantId, cursorTs);
          for (const ev of events) {
            cursorTs = Math.max(cursorTs, ev.ts);
            const frame = `id: ${ev.ts}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
            controller.enqueue(encoder.encode(frame));
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

