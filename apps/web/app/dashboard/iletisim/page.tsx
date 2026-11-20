import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function buildQuery(sp: SearchParams, omit: string[], extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (omit.includes(k) || v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else {
      qs.set(k, v);
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    qs.set(k, v);
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

/**
 * Eski /dashboard/iletisim?sekme=... bağlantılarını yeni 3 sekmeli yapıya yönlendirir.
 */
export default async function LegacyCommunicationHubRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [actor, sp] = await Promise.all([requireActor("ADMIN", "BRAND", "INFLUENCER"), searchParams]);
  const sekme = typeof sp.sekme === "string" ? sp.sekme : "";
  const isAdmin = actor.role === "ADMIN" || actor.role === "AGENCY";

  if (sekme === "otomasyon") {
    redirect(`/dashboard/iletisim/otomasyonlar${buildQuery(sp, ["sekme"], { tur: "yorum-dm" })}`);
  }
  if (sekme === "asistan") {
    redirect(`/dashboard/iletisim/otomasyonlar${buildQuery(sp, ["sekme"], { tur: "asistan" })}`);
  }
  if (sekme === "kanallar") {
    if (isAdmin && !sp.marka) {
      redirect(`/admin/iletisim${buildQuery(sp, ["sekme"])}`);
    }
    redirect(`/dashboard/iletisim/ayarlar/kanallar${buildQuery(sp, ["sekme"])}`);
  }
  redirect(`/dashboard/iletisim/gelen-kutusu${buildQuery(sp, ["sekme"])}`);
}
