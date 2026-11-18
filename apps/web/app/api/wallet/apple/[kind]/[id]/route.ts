import { buildPkpass } from "@infulancer/core/wallet/apple-pass";
import { appleWalletConfigured } from "@infulancer/core/wallet/passes";
import { loadWalletPassData } from "@/lib/wallet-pass-data";

export const runtime = "nodejs";

/**
 * Apple Wallet .pkpass indirme. Sertifika tanımlıysa imzalı dosya indirilir (telefonda
 * doğrudan cüzdana eklenir). Tanımlı değilse web bilet/kupon görünümüne yönlendirir.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const path = kind === "ticket" ? "bilet" : "kupon";
  const base = process.env.APP_URL ?? "http://localhost:3000";

  if (!appleWalletConfigured()) {
    return Response.redirect(new URL(`/${path}/${id}`, base), 307);
  }

  const data = await loadWalletPassData(kind, id);
  if (!data) return new Response("Bulunamadı", { status: 404 });

  const pkpass = await buildPkpass(data, id);
  if (!pkpass) {
    console.error(`[apple-wallet] .pkpass üretilemedi (kind=${kind}, id=${id})`);
    return new Response("Apple Wallet kartı oluşturulamadı; sertifika yapılandırmasını kontrol edin.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(new Uint8Array(pkpass), {
    headers: {
      "content-type": "application/vnd.apple.pkpass",
      "content-disposition": `inline; filename="${kind}-${id}.pkpass"`,
      "content-length": String(pkpass.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
