/**
 * infulancer-prod/integrations sırrını çalışma anında okur.
 * Dolu ortam değişkeni her zaman kazanır. Boş olanlar sırdaki string değerle dolar.
 * Sır yoksa veya rol okuyamazsa süreç durmaz; mock/env davranışı sürer.
 */

export type IntegrationsResult = {
  filledKeys: string[];
  skipped: boolean;
  reason?: string;
};

const KEY = /^[A-Z][A-Z0-9_]{0,80}$/;

export function integrationsSecretId(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.INTEGRATIONS_SECRET_ID?.trim();
  if (explicit) return explicit;
  if (env.VAULT_MODE !== "aws") return null;
  const prefix = env.VAULT_SECRET_PREFIX?.trim() ?? "";
  if (prefix.endsWith("/tenants")) return `${prefix.slice(0, -"/tenants".length)}/integrations`;
  return null;
}

/** Dolu env kazanır. Yalnız boş anahtarlar ve boş olmayan string değerler yazılır. */
export function mergeSecretIntoEnv(env: NodeJS.ProcessEnv, values: Record<string, unknown>): string[] {
  const filled: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!KEY.test(key)) continue;
    if (env[key]?.trim()) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = value;
    filled.push(key);
  }
  return filled;
}

export function shellAssign(key: string, value: string): string {
  return `${key}='${value.replace(/'/g, `'\\''`)}'`;
}

export type SecretReader = (secretId: string) => Promise<string | undefined>;

async function defaultReader(secretId: string): Promise<string | undefined> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-central-1";
  const res = await new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: secretId }));
  return res.SecretString;
}

export async function hydrateIntegrations(opts: { env?: NodeJS.ProcessEnv; read?: SecretReader } = {}): Promise<IntegrationsResult> {
  const env = opts.env ?? process.env;
  const secretId = integrationsSecretId(env);
  if (!secretId) return { filledKeys: [], skipped: true, reason: "kapali" };
  try {
    const raw = await (opts.read ?? defaultReader)(secretId);
    if (!raw?.trim()) return { filledKeys: [], skipped: true, reason: "bos" };
    const json = JSON.parse(raw) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) return { filledKeys: [], skipped: true, reason: "json" };
    const filledKeys = mergeSecretIntoEnv(env, json as Record<string, unknown>);
    return { filledKeys, skipped: false };
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    return { filledKeys: [], skipped: true, reason: name };
  }
}
