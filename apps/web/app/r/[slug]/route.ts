import { resolveDmTrackedLinkAndRecordClick } from "@infulancer/core/dm-automation/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const baseUrl = new URL(req.url).origin;

  if (!/^[A-Za-z0-9_-]{6,24}$/.test(slug)) {
    return Response.redirect(baseUrl, 302);
  }

  const url = new URL(req.url);
  const recipientToken = url.searchParams.get("r");
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

  const destination = await resolveDmTrackedLinkAndRecordClick(slug, {
    recipientToken,
    ip,
    userAgent: req.headers.get("user-agent"),
    referrer: req.headers.get("referer"),
  });

  if (!destination) {
    return Response.redirect(baseUrl, 302);
  }

  return Response.redirect(destination, 302);
}

