import { prisma } from "@infulancer/core/db";
import { verifyMetaSignedRequest } from "@infulancer/core/inbox/meta-security";

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

export async function POST(req: Request) {
  const signedRequest = await extractSignedRequest(req);
  const verified = verifyMetaSignedRequest(signedRequest);
  if (!verified || !verified.user_id) {
    return Response.json({ error: "Geçersiz signed_request imzası." }, { status: 400 });
  }

  const userId = String(verified.user_id);
  const connections = await prisma.channelConnection.findMany({
    where: {
      provider: { in: ["INSTAGRAM", "WHATSAPP"] },
      status: "ACTIVE",
    },
  });

  for (const conn of connections) {
    const ext = (conn.externalIds ?? {}) as Record<string, unknown>;
    if (String(ext.ig_user_id ?? "") === userId || String(ext.page_id ?? "") === userId || String(ext.waba_id ?? "") === userId) {
      await prisma.channelConnection.update({
        where: { id: conn.id },
        data: { status: "REVOKED", revokedAt: new Date(), lastError: "Kullanıcı Meta üzerinden yetkiyi kaldırdı (deauthorize)." },
      });
    }
  }

  return Response.json({ ok: true });
}

