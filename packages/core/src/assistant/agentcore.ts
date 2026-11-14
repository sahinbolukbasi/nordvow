import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createHash, createHmac } from "node:crypto";
import { envStr } from "../env";

export interface AgentCoreInvokeInput {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCoreInvokeResult {
  text: string;
  raw?: unknown;
}

const SERVICE = "bedrock-agentcore";
let credClient: BedrockRuntimeClient | undefined;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function getSigningKey(secretKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function normalizeSessionId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const prefixed = `nordvow-${clean}`;
  return prefixed.length >= 33 ? prefixed.slice(0, 128) : prefixed.padEnd(33, "0");
}

function extractText(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  for (const key of ["text", "response", "completion", "message", "answer", "result"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  if (obj.output && typeof obj.output === "object") {
    const out = obj.output as Record<string, unknown>;
    if (typeof out.text === "string" && out.text.trim()) return out.text.trim();
    if (typeof out.message === "string" && out.message.trim()) return out.message.trim();
  }
  return "";
}

/**
 * AWS Bedrock AgentCore Runtime etkin mi?
 * `AGENTCORE_RUNTIME_ARN` ortam değişkeni tanımlıysa true döner.
 */
export function isAgentCoreEnabled(): boolean {
  return Boolean(envStr("AGENTCORE_RUNTIME_ARN", "").trim());
}

/**
 * AWS Bedrock AgentCore Runtime'a SigV4 imzalı HTTP isteği gönderir.
 * Hata veya boş yanıt durumunda null döner; çağıran taraf Bedrock Converse'e düşebilir.
 */
export async function invokeAgentCore(input: AgentCoreInvokeInput): Promise<AgentCoreInvokeResult | null> {
  const runtimeArn = envStr("AGENTCORE_RUNTIME_ARN", "").trim();
  if (!runtimeArn) return null;

  const region = envStr("AGENTCORE_REGION", envStr("BEDROCK_REGION", "eu-central-1"));
  credClient ??= new BedrockRuntimeClient({ region });
  const creds = await credClient.config.credentials();

  const host = `bedrock-agentcore.${region}.amazonaws.com`;
  const encodedArn = encodeURIComponent(runtimeArn);
  const canonicalUri = `/runtimes/${encodedArn}/invocations`;
  const canonicalQuery = "qualifier=DEFAULT";
  const endpoint = `https://${host}${canonicalUri}?${canonicalQuery}`;

  const body = JSON.stringify({
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    metadata: input.metadata ?? {},
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const sessionHeader = normalizeSessionId(input.sessionId);

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amzn-bedrock-agentcore-runtime-session-id": sessionHeader,
  };
  if (creds.sessionToken) {
    headers["x-amz-security-token"] = creds.sessionToken;
  }

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const canonicalRequest = ["POST", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", getSigningKey(creds.secretAccessKey, dateStamp, region))
    .update(stringToSign, "utf8")
    .digest("hex");

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AgentCore HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const rawText = await res.text();
  try {
    const parsed: unknown = JSON.parse(rawText);
    const text = extractText(parsed);
    return text ? { text, raw: parsed } : null;
  } catch {
    const trimmed = rawText.trim();
    return trimmed ? { text: trimmed } : null;
  }
}

