"use server";
import { z } from "zod";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { cleanSocialHandle } from "@infulancer/core/social/handle";
import { assertUniqueInstagramHandle, normalizeInstagramHandle } from "@infulancer/core/social/handles";
import { syncInfluencer, syncSocialAccount } from "@infulancer/core/social/sync";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

const schema = z.object({
  platform: z.enum(["INSTAGRAM", "YOUTUBE"]),
  handle: z.string().trim().max(200).optional(),
});

/**
 * Influencer kendi Instagram/YouTube kullanıcı adını ekler ya da değiştirir; hesap hemen resmî API'den
 * senkronlanır (takipçi, etkileşim, profil fotoğrafı). Instagram için hesap Business/Creator olmalı.
 */
export async function saveOwnAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  return attempt(async () => {
    const input = parseInput(schema, { platform: str(fd, "platform"), handle: optStr(fd, "handle") }, { handle: "Kullanıcı adı" });
    if (!input.handle) {
      revalidateAll();
      return { ok: true, message: "Kullanıcı adı boş bırakıldı; mevcut bilgiler korunuyor." };
    }
    const cleaned = cleanSocialHandle(input.handle, input.platform);
    const handle = input.platform === "INSTAGRAM"
      ? normalizeInstagramHandle(cleaned)
      : cleaned.replace(/^@/, "");
    if (input.platform === "INSTAGRAM" && !/^[a-z0-9._]{1,30}$/.test(handle)) throw new DomainError("DOGRULAMA", "Geçerli bir Instagram kullanıcı adı girin.");
    if (input.platform === "YOUTUBE" && !/^[A-Za-z0-9._-]{2,40}$/.test(handle)) throw new DomainError("DOGRULAMA", "Geçerli bir YouTube kullanıcı adı girin.");
    const influencerId = actor.influencerId!;
    if (input.platform === "INSTAGRAM") await assertUniqueInstagramHandle(prisma, handle, influencerId);
    const prev = await prisma.socialAccount.findUnique({ where: { influencerId_platform: { influencerId, platform: input.platform } } });
    const acc = prev
      ? await prisma.socialAccount.update({ where: { id: prev.id }, data: { handle, syncError: null, lastErrorClass: null, retryCount: 0 } })
      : await prisma.socialAccount.create({ data: { influencerId, platform: input.platform, handle, followers: 0, engagementRate: 0, demographics: {} } });
    await audit.append({ actor: toAuditActor(actor), action: prev ? "SOCIAL_ACCOUNT_UPDATED" : "SOCIAL_ACCOUNT_ADDED", entityType: "SocialAccount", entityId: acc.id, data: { platform: input.platform, handle, from: prev?.handle ?? null } });
    const r = await syncSocialAccount(acc.id, new Date(), { force: true }).catch(() => null);
    revalidateAll();
    return r?.ok ? { ok: true, message: "Hesap bağlandı; takipçi ve profil fotoğrafı güncellendi." } : { ok: true, message: `Hesap kaydedildi. ${r?.message ?? "Otomatik güncelleme şu an kapalı."}` };
  });
}

export async function syncOwnAccountsAction(): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  return attempt(async () => {
    const results = await syncInfluencer(actor.influencerId!, undefined, { force: true });
    revalidateAll();
    const ok = results.filter((r) => r.ok).length;
    return { ok: true, message: results.length ? `${ok}/${results.length} hesap güncellendi.` : "Güncellenecek hesap yok." };
  });
}
