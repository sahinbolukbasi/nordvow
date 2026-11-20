"use server";
import { syncInfluencer } from "@infulancer/core/social/sync";
import { revalidateAll } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

/** Marka veya ajans: içerik üreticisinin bağlı sosyal medya hesaplarından anlık veri çeker. */
export async function syncInfluencerForBrandAction(influencerId: string): Promise<{ ok: boolean; message: string }> {
  await requireActor("BRAND", "ADMIN");
  if (!influencerId) return { ok: false, message: "Geçersiz üretici." };
  const results = await syncInfluencer(influencerId, undefined, { force: true });
  revalidateAll();
  if (!results.length) return { ok: false, message: "Bağlı sosyal medya hesabı bulunamadı." };
  const okCount = results.filter((r) => r.ok).length;
  const firstMsg = results.map((r) => r.message).join(" · ");
  return { ok: okCount > 0, message: firstMsg };
}

