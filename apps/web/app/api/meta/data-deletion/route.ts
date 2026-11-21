import { prisma } from "@infulancer/core/db";
import { envStr } from "@infulancer/core/env";
import { verifyMetaSignedRequest } from "@infulancer/core/inbox/meta-security";
import {
  createMetaDataDeletionRequest,
  getMetaDataDeletionStatus,
} from "@infulancer/core/inbox/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function extractSignedRequest(req: Request): Promise<string | null> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { signed_request?: string };
    return body.signed_request ?? null;
  }
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData().catch(() => null);
    const signed = form?.get("signed_request");
    return typeof signed === "string" ? signed : null;
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return params.get("signed_request");
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("kod")?.trim() ?? "";
  if (!code) {
    return Response.json({ error: "Onay kodu (kod) parametresi gereklidir." }, { status: 400 });
  }
  const status = await getMetaDataDeletionStatus(code);
  if (!status) {
    return Response.json({ error: "Veri silme kaydı bulunamadı." }, { status: 404 });
  }
  return Response.json({ status }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Meta App Review veri silme callback'i. signed_request uygulama sırlarıyla doğrulanır.
 * Kişi kaydı temizlenir; onay kodu hem durum sayfasında hem yasal sayfada okunur.
 */
export async function POST(req: Request) {
  const signedRequest = await extractSignedRequest(req);
  const verified = verifyMetaSignedRequest(signedRequest);
  if (!verified || !verified.user_id) {
    return Response.json({ error: "invalid_signed_request" }, { status: 400 });
  }

  const rec = await createMetaDataDeletionRequest(String(verified.user_id));
  await prisma.dataDeletionRequest
    .create({ data: { code: rec.confirmationCode, metaUserId: String(verified.user_id) } })
    .catch(() => undefined);
  const base = envStr("APP_URL", envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com")).replace(/\/$/, "");
  return Response.json({
    url: `${base}/veri-silme-durumu?kod=${encodeURIComponent(rec.confirmationCode)}`,
    confirmation_code: rec.confirmationCode,
  });
}
