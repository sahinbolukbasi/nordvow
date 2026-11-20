import { envStr } from "../env";

/**
 * Instagram API with Instagram Login.
 * Kişisel, gizli veya Business Discovery'nin göremediği hesaplarda ajans adına BD zorlanmaz;
 * içerik üreticisi kendi hesabını bağlar. Uygulama Unpublished ve izinler "Ready for testing"
 * iken yalnızca uygulamaya rolü olan kullanıcılar bağlanabilir (gelişmiş erişim / App Review yok).
 *
 * İstenen izin: instagram_business_basic
 * İsteğe bağlı (bağlanmazsa profil yine okunur, etkileşim boş kalabilir): instagram_business_manage_insights
 */

function trimEnv(name: string): string {
  return envStr(name, "").trim();
}

export function instagramOAuthApp(): { appId: string; appSecret: string } {
  return {
    appId: trimEnv("INSTAGRAM_APP_ID") || trimEnv("META_APP_ID"),
    appSecret: trimEnv("INSTAGRAM_APP_SECRET") || trimEnv("META_APP_SECRET"),
  };
}

export function instagramOAuthConfigured(): boolean {
  const { appId, appSecret } = instagramOAuthApp();
  return Boolean(appId && appSecret);
}

export const INSTAGRAM_LOGIN_SCOPES = "instagram_business_basic";

export function instagramAuthorizeUrl(args: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: args.appId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: INSTAGRAM_LOGIN_SCOPES,
    state: args.state,
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

export type InstagramTokenResult = { accessToken: string; userId: string | null };

/** Kısa ömürlü kodu, sonra uzun ömürlü belirteci alır. Belirteç dönen metne yazılmaz. */
export async function exchangeInstagramCode(args: {
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<InstagramTokenResult> {
  const { appId, appSecret } = instagramOAuthApp();
  if (!appId || !appSecret) throw new Error("Instagram bağlantısı yapılandırılmadı.");
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
      code: args.code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; user_id?: string | number; error_message?: string };
  if (!res.ok || !json.access_token) throw new Error("Instagram yetkilendirmesi tamamlanamadı.");
  const long = await fetchImpl(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: json.access_token,
    })}`,
    { signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  const longJson = (await long?.json().catch(() => null)) as { access_token?: string } | null;
  return {
    accessToken: longJson?.access_token || json.access_token,
    userId: json.user_id != null ? String(json.user_id) : null,
  };
}
