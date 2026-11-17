import { TikTokApiError, publishTikTokContent } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/**
 * TikTok Content Posting API (Direkt yayın veya Inbox taslağı).
 * JSON (PULL_FROM_URL) veya multipart/form-data (FILE_UPLOAD) kabul eder.
 */
export async function POST(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const fileBuffer = file instanceof File ? Buffer.from(await file.arrayBuffer()) : undefined;
      const post = await publishTikTokContent({
        influencerId: guard.actor.influencerId!,
        campaignId: (form.get("campaignId") as string | null) || null,
        deliverableId: (form.get("deliverableId") as string | null) || null,
        mode: form.get("mode") === "INBOX" ? "INBOX" : "DIRECT",
        source: "FILE_UPLOAD",
        fileBuffer,
        fileMimeType: file instanceof File ? file.type || "video/mp4" : "video/mp4",
        caption: (form.get("caption") as string | null) ?? "",
        privacyLevel: (form.get("privacyLevel") as string | null) || undefined,
        disableDuet: form.get("disableDuet") === "true",
        disableComment: form.get("disableComment") === "true",
        disableStitch: form.get("disableStitch") === "true",
        brandContentToggle: form.get("brandContentToggle") === "true",
        brandOrganicToggle: form.get("brandOrganicToggle") === "true",
        userConfirmed: form.get("userConfirmed") === "true",
      });
      return Response.json({ ok: true, post }, { status: 201 });
    }

    const body = (await req.json()) as {
      campaignId?: string | null;
      deliverableId?: string | null;
      mode?: "DIRECT" | "INBOX";
      source?: "PULL_FROM_URL";
      videoUrl?: string;
      caption?: string;
      privacyLevel?: string;
      disableDuet?: boolean;
      disableComment?: boolean;
      disableStitch?: boolean;
      videoCoverTimestampMs?: number;
      brandContentToggle?: boolean;
      brandOrganicToggle?: boolean;
      userConfirmed?: boolean;
    };

    const post = await publishTikTokContent({
      influencerId: guard.actor.influencerId!,
      campaignId: body.campaignId ?? null,
      deliverableId: body.deliverableId ?? null,
      mode: body.mode === "INBOX" ? "INBOX" : "DIRECT",
      source: "PULL_FROM_URL",
      videoUrl: body.videoUrl,
      caption: body.caption,
      privacyLevel: body.privacyLevel,
      disableDuet: body.disableDuet,
      disableComment: body.disableComment,
      disableStitch: body.disableStitch,
      videoCoverTimestampMs: body.videoCoverTimestampMs,
      brandContentToggle: body.brandContentToggle,
      brandOrganicToggle: body.brandOrganicToggle,
      userConfirmed: Boolean(body.userConfirmed),
    });

    return Response.json({ ok: true, post }, { status: 201 });
  } catch (err) {
    if (err instanceof TikTokApiError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    return Response.json({ error: err instanceof Error ? err.message : "Yayınlama hatası" }, { status: 500 });
  }
}
