import { randomBytes } from "node:crypto";
import { prisma } from "@infulancer/core/db";
import { envStr } from "@infulancer/core/env";
import { parseMetaSignedRequest } from "@infulancer/core/channels/meta-signed-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta App Review veri silme callback'i. signed_request, META_APP_SECRET ile doğrulanır.
 * Dönüş: { url, confirmation_code }.
 */
export async function POST(req: Request) {
  const secret = envStr("META_APP_SECRET", "");
  const form = await req.formData().catch(() => null);
  const signed = String(form?.get("signed_request") ?? "");
  const payload = parseMetaSignedRequest(signed, secret);
  if (!payload) return Response.json({ error: "invalid_signed_request" }, { status: 400 });
  const code = randomBytes(9).toString("base64url");
  await prisma.dataDeletionRequest.create({ data: { code, metaUserId: payload.user_id ?? null } }).catch(() => undefined);
  const base = envStr("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  return Response.json({ url: `${base}/veri-silme?kod=${code}`, confirmation_code: code });
}
