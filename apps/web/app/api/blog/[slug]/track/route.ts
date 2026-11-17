import { z } from "zod";
import { trackBlogEvent } from "@infulancer/core/blog/service";

const trackSchema = z.object({
  event: z.enum(["view", "read"]),
  durationSeconds: z.number().min(0).max(3600).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Geçersiz izleme isteği." }, { status: 400 });
  }

  try {
    const updated = await trackBlogEvent(
      slug,
      parsed.data.event,
      parsed.data.durationSeconds,
    );
    return Response.json({ ok: Boolean(updated), stats: updated });
  } catch {
    return Response.json({ ok: false }, { status: 200 });
  }
}

