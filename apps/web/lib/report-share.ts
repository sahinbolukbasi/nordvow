import { createHmac, timingSafeEqual } from "node:crypto";

function shareSecret(): string {
  return process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "nordvow-report-share-dev";
}

export function signCampaignShareToken(campaignId: string, expiresAtMs: number): string {
  const payload = `${campaignId}.${expiresAtMs}`;
  const sig = createHmac("sha256", shareSecret()).update(payload).digest("hex").slice(0, 24);
  return `${expiresAtMs}.${sig}`;
}

export function verifyCampaignShareToken(campaignId: string, token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expiresAtMs = Number(parts[0]);
  const sig = parts[1] ?? "";
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  const expected = createHmac("sha256", shareSecret())
    .update(`${campaignId}.${expiresAtMs}`)
    .digest("hex")
    .slice(0, 24);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

