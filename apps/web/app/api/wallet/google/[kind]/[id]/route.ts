import { buildGoogleWalletLink } from "@infulancer/core/wallet/google-pass";
import { googleWalletConfigured } from "@infulancer/core/wallet/passes";
import { loadWalletPassData } from "@/lib/wallet-pass-data";

export const runtime = "nodejs";

/**
 * Google Wallet "Save to Wallet" yönlendiricisi. Anahtar tanımlıysa imzalı JWT linkine
 * 303 yönlendirir (telefonda doğrudan cüzdana ekleme). Tanımlı değilse web görünümüne.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const path = kind === "ticket" ? "bilet" : "kupon";
  const base = process.env.APP_URL ?? "http://localhost:3000";
  if (!googleWalletConfigured()) return Response.redirect(new URL(`/${path}/${id}`, base), 307);

  const data = await loadWalletPassData(kind, id);
  if (!data) return new Response("Bulunamadı", { status: 404 });

  const link = await buildGoogleWalletLink(data, id);
  if (!link) return Response.redirect(new URL(`/${path}/${id}`, base), 307);
  return Response.redirect(link, 303);
}
