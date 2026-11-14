import { getConfig } from "../config/store";
import { envStr } from "../env";

/**
 * Meta Graph / WhatsApp Cloud API istemcisi. Tüm çağrılar sunucudan sunucuya.
 * META_API_MODE=http değilse deterministik mock kullanılır (testler ve kimlik bilgisi yokken).
 */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly subcode?: number,
    readonly type?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Token iptali: OAuthException / 190 ailesi (iptal için doğrulanmış webhook yok). */
export function isRevocationError(err: unknown): boolean {
  return err instanceof MetaApiError && (err.code === 190 || err.type === "OAuthException" && [102, 190, 463, 467].includes(err.code));
}

/** whatsapp_business_management izni eksikse sahip olunmayan hesaplara çağrı 200 hata kodu döner. */
export function isPermissionMissing(err: unknown): boolean {
  return err instanceof MetaApiError && err.code === 200;
}

export function isRateLimited(err: unknown): boolean {
  return err instanceof MetaApiError && (err.httpStatus === 429 || [4, 17, 32, 613, 80007].includes(err.code));
}

export type SendPayload =
  | { kind: "text"; to: string; body: string }
  | { kind: "template"; to: string; templateName: string; language: string; params?: string[] };

export interface MetaClient {
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  subscribeApp(wabaId: string, token: string): Promise<{ success: boolean }>;
  registerNumber(phoneNumberId: string, pin: string, token: string): Promise<{ success: boolean }>;
  sendWhatsApp(phoneNumberId: string, token: string, payload: SendPayload): Promise<{ messageId: string }>;
  sendInstagram(igUserId: string, token: string, recipientId: string, body: string, tag?: "HUMAN_AGENT"): Promise<{ messageId: string }>;
  /** Hafif okuma çağrısı (health-check). */
  verifyToken(token: string): Promise<{ ok: true }>;
  /** Creator hesapları webhook almadan önce bir Conversations API çağrısı yapmalı. */
  primeConversations(igUserId: string, token: string): Promise<void>;
  downloadMedia(url: string, token: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

let counter = 0;

/** Mock: 'revoked' içeren token → 190; 'noperm' → 200; aksi halde başarı. */
export const mockMetaClient: MetaClient = {
  async exchangeCode(code) {
    if (!code) throw new MetaApiError("Geçersiz kod", 100);
    return { accessToken: `mock-token-${code}` };
  },
  async subscribeApp(_waba, token) {
    guard(token);
    return { success: true };
  },
  async registerNumber(_id, pin, token) {
    guard(token);
    if (!/^\d{6}$/.test(pin)) throw new MetaApiError("PIN 6 hane olmalı", 100);
    return { success: true };
  },
  async sendWhatsApp(_id, token) {
    guard(token);
    return { messageId: `wamid.mock.${++counter}` };
  },
  async sendInstagram(_id, token) {
    guard(token);
    return { messageId: `ig.mock.${++counter}` };
  },
  async verifyToken(token) {
    guard(token);
    return { ok: true };
  },
  async primeConversations(_id, token) {
    guard(token);
  },
  async downloadMedia() {
    return { bytes: new TextEncoder().encode("mock-media"), mime: "image/jpeg" };
  },
};

function guard(token: string) {
  if (token.includes("revoked")) throw new MetaApiError("Error validating access token", 190, 460, "OAuthException", 401);
  if (token.includes("noperm")) throw new MetaApiError("Permission missing", 200, undefined, "OAuthException", 403);
}

/** Gerçek Graph API istemcisi (META_API_MODE=http). */
export function httpMetaClient(): MetaClient {
  const base = "https://graph.facebook.com";
  async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const version = await getConfig("whatsapp.graphApiVersion");
    const res = await fetch(`${base}/${version}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message: string; code: number; error_subcode?: number; type?: string } };
    if (!res.ok || json.error) {
      const e = json.error;
      throw new MetaApiError(e?.message ?? `HTTP ${res.status}`, e?.code ?? res.status, e?.error_subcode, e?.type, res.status);
    }
    return json as T;
  }
  return {
    async exchangeCode(code) {
      const q = new URLSearchParams({ client_id: envStr("META_APP_ID", ""), client_secret: envStr("META_APP_SECRET", ""), code });
      const r = await call<{ access_token: string }>(`/oauth/access_token?${q}`);
      return { accessToken: r.access_token };
    },
    subscribeApp: (waba, token) => call(`/${waba}/subscribed_apps`, { method: "POST", token }),
    registerNumber: (id, pin, token) => call(`/${id}/register`, { method: "POST", token, body: JSON.stringify({ messaging_product: "whatsapp", pin }) }),
    async sendWhatsApp(id, token, p) {
      const body =
        p.kind === "text"
          ? { messaging_product: "whatsapp", to: p.to, type: "text", text: { body: p.body } }
          : {
            messaging_product: "whatsapp",
            to: p.to,
            type: "template",
            template: {
              name: p.templateName,
              language: { code: p.language },
              components: p.params?.length ? [{ type: "body", parameters: p.params.map((t) => ({ type: "text", text: t })) }] : [],
            },
          };
      const r = await call<{ messages: { id: string }[] }>(`/${id}/messages`, { method: "POST", token, body: JSON.stringify(body) });
      return { messageId: r.messages[0]!.id };
    },
    async sendInstagram(igId, token, recipient, text, tag) {
      const body = JSON.stringify({ recipient: { id: recipient }, message: { text }, ...(tag ? { messaging_type: "MESSAGE_TAG", tag } : {}) });
      // Facebook Login (EAA…) token'larında Instagram DM, IG hesabına bağlı Sayfa üzerinden ve Sayfa token'ıyla gönderilir.
      const page = await resolveIgPage(igId, token).catch(() => null);
      if (page) {
        const r = await call<{ message_id: string }>(`/${page.pageId}/messages`, { method: "POST", token: page.pageToken, body });
        return { messageId: r.message_id };
      }
      const r = await call<{ message_id: string }>(`/${igId}/messages`, { method: "POST", token, body });
      return { messageId: r.message_id };
    },
    async verifyToken(token) {
      await call(`/me?fields=id`, { token });
      return { ok: true };
    },
    async primeConversations(igId, token) {
      await call(`/${igId}/conversations?platform=instagram&limit=1`, { token });
    },
    async downloadMedia(url, token) {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
    },
  };
}

type IgPage = { pageId: string; pageToken: string };
const igPageCache = new Map<string, { page: IgPage | null; at: number }>();

async function graphGet<T>(path: string, token: string): Promise<T> {
  const version = await getConfig("whatsapp.graphApiVersion");
  const res = await fetch(`https://graph.facebook.com/${version}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message: string; code: number } };
  if (!res.ok || json.error) throw new MetaApiError(json.error?.message ?? `HTTP ${res.status}`, json.error?.code ?? res.status, undefined, undefined, res.status);
  return json;
}

/** IG hesabına bağlı Facebook Sayfası ve Sayfa token'ı (1 saat önbellek). Instagram Login token'larında null. */
export async function resolveIgPage(igId: string, token: string): Promise<IgPage | null> {
  if (!token.startsWith("EAA")) return null;
  const key = `${igId}:${token.slice(-12)}`;
  const hit = igPageCache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.page;
  const r = await graphGet<{ data?: { id: string; access_token?: string; instagram_business_account?: { id: string } }[] }>(
    `/me/accounts?fields=id,access_token,instagram_business_account&limit=100`,
    token,
  );
  const p = (r.data ?? []).find((x) => x.instagram_business_account?.id === igId);
  const page = p?.access_token ? { pageId: p.id, pageToken: p.access_token } : null;
  igPageCache.set(key, { page, at: Date.now() });
  return page;
}

/** Instagram gönderen (IGSID) profil bilgisi: kullanıcı adı ve ad. */
export async function fetchIgSenderProfile(igsid: string, igId: string, token: string): Promise<{ username: string | null; name: string | null }> {
  if (envStr("META_API_MODE", "mock") !== "http") return { username: null, name: null };
  const page = await resolveIgPage(igId, token).catch(() => null);
  const r = await graphGet<{ username?: string; name?: string }>(`/${igsid}?fields=username,name`, page?.pageToken ?? token);
  return { username: r.username ?? null, name: r.name ?? null };
}

/**
 * "Yazıyor…" göstergesi: WhatsApp'ta mesajı okundu işaretler + typing indicator, Instagram'da typing_on.
 * Hatalar yutulur (yalnız deneyim iyileştirmesi).
 */
export async function showTyping(opts: { channel: "WHATSAPP" | "INSTAGRAM"; token: string; phoneNumberId?: string; inboundMessageId?: string; igId?: string; recipientId?: string }) {
  if (envStr("META_API_MODE", "mock") !== "http") return;
  try {
    const version = await getConfig("whatsapp.graphApiVersion");
    if (opts.channel === "WHATSAPP" && opts.phoneNumberId && opts.inboundMessageId) {
      await fetch(`https://graph.facebook.com/${version}/${opts.phoneNumberId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: opts.inboundMessageId, typing_indicator: { type: "text" } }),
        signal: AbortSignal.timeout(5_000),
      });
    } else if (opts.channel === "INSTAGRAM" && opts.igId && opts.recipientId) {
      const page = await resolveIgPage(opts.igId, opts.token).catch(() => null);
      await fetch(`https://graph.facebook.com/${version}/${page?.pageId ?? opts.igId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${page?.pageToken ?? opts.token}` },
        body: JSON.stringify({ recipient: { id: opts.recipientId }, sender_action: "typing_on" }),
        signal: AbortSignal.timeout(5_000),
      });
    }
  } catch {
    /* yok say */
  }
}

let override: MetaClient | undefined;
export function metaClient(): MetaClient {
  if (override) return override;
  return envStr("META_API_MODE", "mock") === "http" ? httpMetaClient() : mockMetaClient;
}
/** Testler için. */
export function setMetaClient(c: MetaClient | undefined): void {
  override = c;
}
