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

export async function POST(req: Request) {
  const signedRequest = await extractSignedRequest(req);
  const verified = verifyMetaSignedRequest(signedRequest);
  if (!verified || !verified.user_id) {
    return Response.json({ error: "Geçersiz signed_request imzası." }, { status: 400 });
  }

  const rec = await createMetaDataDeletionRequest(String(verified.user_id));
  const baseUrl = envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com").replace(/\/$/, "");
  return Response.json({
    url: `${baseUrl}/veri-silme-durumu?kod=${encodeURIComponent(rec.confirmationCode)}`,
    confirmation_code: rec.confirmationCode,
  });
}
