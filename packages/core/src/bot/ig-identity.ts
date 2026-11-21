import { envStr } from "../env";

export type IgPublicProfile = { username: string; name: string | null };

export interface IgIdentityClient {
  username(igsid: string): Promise<IgPublicProfile | null>;
}

/** Mock modda bilinen IGSID → kullanıcı adı. Testler setIgIdentity ile değiştirir. */
const FIXTURE: Record<string, IgPublicProfile> = {
  "igsid-demo": { username: "nordvow", name: "Nordvow" },
};

let override: IgIdentityClient | undefined;

export function setIgIdentity(client: IgIdentityClient | undefined) {
  override = client;
}

const httpIgIdentity: IgIdentityClient = {
  async username(igsid) {
    const token = envStr("INSTAGRAM_ACCESS_TOKEN", "") || envStr("META_IG_TOKEN", "") || envStr("IG_GRAPH_TOKEN", "");
    if (!token || !/^\d{5,}$/.test(igsid)) return null;
    const url = `https://graph.facebook.com/v24.0/${encodeURIComponent(igsid)}?fields=username,name&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { username?: string; name?: string; error?: { message?: string } };
    if (!res.ok || json.error || !json.username) return null;
    return { username: json.username, name: json.name ?? null };
  },
};

const fixtureIgIdentity: IgIdentityClient = {
  async username(igsid) {
    return FIXTURE[igsid] ?? null;
  },
};

export function igIdentity(): IgIdentityClient {
  if (override) return override;
  return envStr("META_API_MODE", "mock") === "http" ? httpIgIdentity : fixtureIgIdentity;
}
