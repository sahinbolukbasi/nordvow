import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireApiActor } from "@/lib/auth-guard";
import {
  type EArsivFaturaJson,
  buildCampaignInvoiceDraft,
  renderEArsivHtml,
} from "@infulancer/core/finance/campaign-invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function publicAssetDataUrl(fileName: string, mime: string) {
  const file = await readFile(path.join(process.cwd(), "public", "brand", fileName));
  return `data:${mime};base64,${file.toString("base64")}`;
}

/**
 * Kampanya e-Arşiv Fatura Taslağı API'si
 * GET /api/fatura/[id]?format=json|html&download=1
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;

  const { id: campaignId } = await params;
  if (!campaignId) {
    return Response.json({ error: "Kampanya ID zorunludur." }, { status: 400 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const shouldDownload = url.searchParams.get("download") === "1";

  try {
    const brandId = auth.actor.role === "BRAND" ? auth.actor.brandId ?? undefined : undefined;
    const { draft, campaignName } = await buildCampaignInvoiceDraft(campaignId, brandId);

    if (draft.durum === "HATA") {
      return Response.json(draft, { status: 422 });
    }

    if (format === "html") {
      const [nordvowLogoDataUrl, gibLogoDataUrl] = await Promise.all([
        publicAssetDataUrl("nordvow-logo-dark.svg", "image/svg+xml"),
        publicAssetDataUrl("gib-logo.png", "image/png"),
      ]);
      const html = await renderEArsivHtml(draft as EArsivFaturaJson, {
        generateQrCodeIfMissing: true,
        sellerLogoDataUrl: nordvowLogoDataUrl,
        logoDataUrl: gibLogoDataUrl,
      });

      const headers: Record<string, string> = {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      };

      if (shouldDownload) {
        const safeSlug = draft.faturaNo.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        headers["Content-Disposition"] = `attachment; filename="${safeSlug}.html"`;
      }

      return new Response(html, { status: 200, headers });
    }

    // Default JSON
    return Response.json(draft, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Fatura taslağı üretilirken bir hata oluştu.";
    return Response.json({ error: message }, { status: 404 });
  }
}
