import { isValidInstagramHandle, normalizeInstagramHandle } from "./handles";

/**
 * Graph hedefi okuyamadığında kullanılan yedek.
 * Ağ çağrısı yok: kazıma yok, gizli hesaba istek yok. Yalnız daha önce kaydedilmiş herkese açık alanlar.
 */
export type StoredPublicProfile = {
  handle: string;
  followers: number;
  postsCount: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  engagementRate: number | null;
  avatarUrl: string | null;
  displayName: string | null;
  bioSnippet: string | null;
  profileUrl: string | null;
};

export type PublicApiReason = "TOKEN_INVALID" | "MISSING_PERMISSION" | "RATE_LIMITED" | "TARGET_NOT_DISCOVERABLE" | "NOT_CONFIGURED";

export type PublicFallbackResult =
  | {
      ok: true;
      source: "INSTAGRAM_PUBLIC";
      reason: PublicApiReason | null;
      handle: string;
      followers: number;
      postsCount: number | null;
      avgLikes: number | null;
      avgComments: number | null;
      engagementRate: number | null;
      profileUrl: string;
      avatarUrl: string | null;
      displayName: string | null;
      bioSnippet: string | null;
    }
  | { ok: false; source: "NONE"; reason: PublicApiReason | null; oauthRequired: boolean; message: string };

/**
 * Ağ çağrısı yok. 110/2207013 (kişisel, gizli, kısıtlı) burada durur ve OAuth ister.
 * Belirteç, izin veya hız sınırı yüzünden API yoksa yalnız daha önce kaydedilmiş herkese açık alanlar kullanılır.
 */
export function publicProfileFallback(input: StoredPublicProfile & { apiClass?: PublicApiReason | null }): PublicFallbackResult {
  const handle = normalizeInstagramHandle(input.handle);
  const reason = input.apiClass ?? null;
  if (reason === "TARGET_NOT_DISCOVERABLE") {
    return {
      ok: false,
      source: "NONE",
      reason,
      oauthRequired: true,
      message: `@${handle || "hesap"} herkese açık değil (110/2207013). Kişisel, gizli veya kısıtlı hesap kazınmaz. Instagram ile bağlayın.`,
    };
  }
  if (!isValidInstagramHandle(handle)) {
    return { ok: false, source: "NONE", reason, oauthRequired: false, message: "Geçerli bir Instagram kullanıcı adı yok. Gizli profile istek atılmaz." };
  }
  const hasPublic =
    input.followers > 0 || input.postsCount != null || input.avgLikes != null || input.avgComments != null || Boolean(input.displayName) || Boolean(input.bioSnippet);
  if (!hasPublic) {
    return {
      ok: false,
      source: "NONE",
      reason,
      oauthRequired: false,
      message: "Herkese açık profil verisi yok. Gizli hesaba istek atılmaz. İçerik üreticisi Instagram ile bağlayabilir.",
    };
  }
  return {
    ok: true,
    source: "INSTAGRAM_PUBLIC",
    reason,
    handle,
    followers: input.followers,
    postsCount: input.postsCount,
    avgLikes: input.avgLikes,
    avgComments: input.avgComments,
    engagementRate: input.engagementRate,
    profileUrl: input.profileUrl && input.profileUrl.startsWith("https://") ? input.profileUrl : `https://instagram.com/${handle}`,
    avatarUrl: input.avatarUrl,
    displayName: input.displayName,
    bioSnippet: input.bioSnippet,
  };
}
