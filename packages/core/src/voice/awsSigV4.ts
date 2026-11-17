import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createHash, createHmac } from "node:crypto";
import { envStr } from "../env";

let credClient: BedrockRuntimeClient | undefined;
function getCredClient(region: string): BedrockRuntimeClient {
  credClient ??= new BedrockRuntimeClient({ region });
  return credClient;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * AWS servislerine (Bedrock Agent, Bedrock Agent Runtime, Textract, Polly)
 * ekstra SDK paketi kurmadan SigV4 imzalı HTTP çağrısı yapar.
 */
export async function signedAwsFetch(opts: {
  service: string;
  region?: string;
  method: "GET" | "POST";
  host: string;
  path: string;
  body?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}): Promise<Response> {
  const region = opts.region ?? envStr("BEDROCK_REGION", envStr("AWS_REGION", "eu-central-1"));
  const creds = await getCredClient(region).config.credentials();
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const bodyStr = opts.body ?? "";
  const payloadHash = sha256Hex(bodyStr);

  const headers: Record<string, string> = {
    host: opts.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(opts.extraHeaders ?? {}),
  };
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;

  const sorted = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) normalized[k.toLowerCase()] = v;

  const canonicalHeaders = sorted.map((k) => `${k}:${normalized[k]}\n`).join("");
  const signedHeaders = sorted.join(";");
  const canonicalReq = [opts.method, opts.path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalReq)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, dateStamp), region), opts.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  normalized.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${opts.host}${opts.path}`, {
    method: opts.method,
    headers: normalized,
    body: opts.method === "POST" ? bodyStr : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
}

