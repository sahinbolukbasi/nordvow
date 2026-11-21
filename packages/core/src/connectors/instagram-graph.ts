/// <reference path="../types/facebook-nodejs-business-sdk.d.ts" />
import { FacebookAdsApi, IGUser } from "facebook-nodejs-business-sdk";
import { envStr } from "../env";
import { computeAppSecretProof, createMetaSdkApi } from "../social/meta-business-sdk";
import type { ConnectorMetrics, PlatformConnector } from "./types";

/**
 * Resmî `facebook-nodejs-business-sdk` tabanlı Instagram Graph API bağlayıcısı:
 * - OAuth yetkilendirme bağlantısı üretimi (`getAuthorizeUrl`)
 * - Uzun ömürlü (60 gün) erişim anahtarı takası (`exchangeCode`)
 * - `IGUser` & `IGMedia` üzerinden takipçi, etkileşim oranı ve doğrulanmış gönderi erişimi çekimi (`fetchMetrics`)
 */
export const instagramGraph: PlatformConnector = {
  platform: "INSTAGRAM",

  getAuthorizeUrl(state: string): string {
    const appId = envStr("META_APP_ID", "");
    const appUrl = envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "");
    const redirectUri = `${appUrl}/api/auth/meta/callback`;
    const scopes = [
      "instagram_basic",
      "instagram_manage_insights",
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
    ].join(",");
    const q = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: scopes,
      response_type: "code",
    });
    return `https://www.facebook.com/${FacebookAdsApi.VERSION}/dialog/oauth?${q.toString()}`;
  },

  async exchangeCode(code: string): Promise<{ accessToken: string; expiresAt?: Date }> {
    const clientId = envStr("META_APP_ID", "");
    const clientSecret = envStr("META_APP_SECRET", "");
    const appUrl = envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "");
    const redirectUri = `${appUrl}/api/auth/meta/callback`;

    const shortParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });
    const shortRes = await fetch(`https://graph.facebook.com/${FacebookAdsApi.VERSION}/oauth/access_token?${shortParams.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const shortJson = (await shortRes.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
    if (!shortRes.ok || !shortJson.access_token) {
      throw new Error(shortJson.error?.message ?? "Meta OAuth kod takası başarısız.");
    }

    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortJson.access_token,
    });
    const longRes = await fetch(`https://graph.facebook.com/${FacebookAdsApi.VERSION}/oauth/access_token?${longParams.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const longJson = (await longRes.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    const finalToken = longJson.access_token ?? shortJson.access_token;
    const expiresAt = longJson.expires_in ? new Date(Date.now() + longJson.expires_in * 1000) : new Date(Date.now() + 60 * 86_400_000);
    return { accessToken: finalToken, expiresAt };
  },

  async fetchMetrics(accessToken: string): Promise<ConnectorMetrics> {
    const api = createMetaSdkApi(accessToken);
    const proof = computeAppSecretProof(accessToken);
    const meParams = proof ? { fields: "id,instagram_business_account{id,username,followers_count,media_count}", appsecret_proof: proof } : { fields: "id,instagram_business_account{id,username,followers_count,media_count}" };
    const accountsRes = (await api.call("GET", ["me", "accounts"], meParams)) as {
      data?: { instagram_business_account?: { id?: string; followers_count?: number } }[];
    };
    const igAcct = accountsRes.data?.find((a) => a.instagram_business_account?.id)?.instagram_business_account;
    if (!igAcct?.id) {
      throw new Error("Bu Meta erişim anahtarında bağlı Instagram Business hesabı bulunamadı.");
    }

    const igUser = new IGUser(igAcct.id, {}, undefined, api);
    const mediaCursor = await igUser.getMedia(
      ["id", "permalink", "like_count", "comments_count", "insights.metric(reach)"],
      proof ? { limit: 12, appsecret_proof: proof } : { limit: 12 },
    );

    const posts = mediaCursor.map((m) => {
      const d = m._data as {
        id?: string;
        permalink?: string;
        like_count?: number;
        comments_count?: number;
        insights?: { data?: { name?: string; values?: { value?: number }[] }[] };
      };
      const reachMetric = d.insights?.data?.find((x) => x.name === "reach");
      return {
        externalId: d.id ?? "",
        url: d.permalink ?? "",
        reach: Number(reachMetric?.values?.[0]?.value ?? 0) || undefined,
        likes: Number(d.like_count ?? 0),
        comments: Number(d.comments_count ?? 0),
      };
    });

    const followers = Number(igAcct.followers_count ?? 0);
    const totalEng = posts.reduce((s, p) => s + (p.likes ?? 0) + (p.comments ?? 0), 0);
    const engagementRate = followers > 0 && posts.length > 0 ? totalEng / posts.length / followers : undefined;

    return { followers, engagementRate, posts };
  },
};
