import { BedrockRuntimeClient, ConverseCommand, type ImageFormat } from "@aws-sdk/client-bedrock-runtime";
import { envStr, requireEnv } from "../env";
import { prompts } from "./prompts";
import type { LlmProvider, TextRequest, VisionRequest } from "./types";

let client: BedrockRuntimeClient | undefined;
function bedrock(): BedrockRuntimeClient {
  // Kimlik bilgisi SDK zincirinden (profil, ortam, IAM rolü) çözülür.
  client ??= new BedrockRuntimeClient({ region: envStr("BEDROCK_REGION", "eu-central-1") });
  return client;
}

function textOf(output: unknown): string {
  const content = (output as { message?: { content?: { text?: string }[] } })?.message?.content ?? [];
  return content.map((c) => c.text ?? "").join("").trim();
}

/** Model yanıtındaki ilk JSON nesnesini savunmacı biçimde ayrıştırır. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function imageFormat(mime: string): ImageFormat {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpeg";
}

export type ChatTurn = { role: "user" | "assistant"; text: string };

/**
 * Çok turlu, düşük maliyetli sohbet çağrısı (WhatsApp/Instagram botu).
 * Varsayılan model Amazon Nova Lite (Haiku'dan ~15-20 kat ucuz); BOT_LLM_MODEL_ID ile değiştirilebilir.
 * Model hata verirse BEDROCK_TEXT_MODEL_ID ile bir kez yeniden denenir.
 */
export async function converseChat(opts: { system: string; turns: ChatTurn[]; maxTokens?: number; temperature?: number }): Promise<{ text: string; model: string }> {
  // Converse: ilk mesaj user olmalı, roller ardışık tekrar etmemeli.
  const merged: ChatTurn[] = [];
  for (const t of opts.turns) {
    if (!t.text.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n${t.text}`;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0]!.role !== "user") merged.shift();
  if (!merged.length) merged.push({ role: "user", text: "Merhaba" });
  const models = [envStr("BOT_LLM_MODEL_ID", "eu.amazon.nova-lite-v1:0"), envStr("BEDROCK_TEXT_MODEL_ID", "")].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr: unknown;
  for (const modelId of models) {
    try {
      const res = await bedrock().send(
        new ConverseCommand({
          modelId,
          system: [{ text: opts.system }],
          messages: merged.map((t) => ({ role: t.role, content: [{ text: t.text }] })),
          inferenceConfig: { maxTokens: opts.maxTokens ?? 400, temperature: opts.temperature ?? 0.5 },
        }),
      );
      return { text: textOf(res.output), model: modelId };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM çağrısı başarısız");
}

/**
 * AWS Bedrock Converse API + Structured Outputs (outputConfig.textFormat JSON Schema)
 * Çok turlu konuşma geçmişini (`turns`) korur ve yanıtı kesinlikle verilen JSON şemasına uygun döndürür.
 */
export async function converseStructured<T = Record<string, unknown>>(opts: {
  system: string;
  turns: ChatTurn[];
  schemaName: string;
  schemaDescription?: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ data: T | null; rawText: string; model: string }> {
  const merged: ChatTurn[] = [];
  for (const t of opts.turns) {
    if (!t.text.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n${t.text}`;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0]!.role !== "user") merged.shift();
  if (!merged.length) merged.push({ role: "user", text: "Merhaba" });

  const structuredModels = [
    envStr("BEDROCK_TEXT_MODEL_ID", "eu.anthropic.claude-haiku-4-5-20251001-v1:0"),
    "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  for (const modelId of structuredModels) {
    try {
      const res = await bedrock().send(
        new ConverseCommand({
          modelId,
          system: [{ text: opts.system }],
          messages: merged.map((t) => ({ role: t.role, content: [{ text: t.text }] })),
          inferenceConfig: { maxTokens: opts.maxTokens ?? 700, temperature: opts.temperature ?? 0.3 },
          outputConfig: {
            textFormat: {
              type: "json_schema",
              structure: {
                jsonSchema: {
                  name: opts.schemaName,
                  description: opts.schemaDescription ?? opts.schemaName,
                  schema: JSON.stringify(opts.schema),
                },
              },
            },
          },
        }),
      );
      const rawText = textOf(res.output);
      const parsed = parseJsonObject(rawText) as T | null;
      if (parsed) return { data: parsed, rawText, model: modelId };
    } catch {
      // Structured output desteklemeyen model/bölge durumunda standart Converse JSON ayrıştırmaya düş
    }
  }

  const fallback = await converseChat({
    system: `${opts.system}\n\nSADECE şu JSON şemasına uygun geçerli bir JSON nesnesi döndür:\n${JSON.stringify(opts.schema)}`,
    turns: merged,
    maxTokens: opts.maxTokens ?? 700,
    temperature: opts.temperature ?? 0.3,
  });
  return {
    data: parseJsonObject(fallback.text) as T | null,
    rawText: fallback.text,
    model: fallback.model,
  };
}

export const bedrockProvider: LlmProvider = {
  name: "bedrock",
  async completeText(req: TextRequest) {
    const modelId = requireEnv("BEDROCK_TEXT_MODEL_ID");
    const res = await bedrock().send(
      new ConverseCommand({
        modelId,
        system: req.system ? [{ text: req.system }] : undefined,
        messages: [{ role: "user", content: [{ text: req.prompt }] }],
        inferenceConfig: { maxTokens: 800, temperature: 0.2 },
      }),
    );
    return { text: textOf(res.output), model: modelId };
  },
  async readScreenshotNumbers(req: VisionRequest) {
    const modelId = requireEnv("BEDROCK_VISION_MODEL_ID");
    const fields = Object.keys(req.expectedFields);
    const res = await bedrock().send(
      new ConverseCommand({
        modelId,
        system: [{ text: prompts.metrikOkuma.system }],
        messages: [
          {
            role: "user",
            content: [
              { image: { format: imageFormat(req.mime), source: { bytes: req.imageBytes } } },
              { text: `Okunacak alanlar: ${fields.join(", ")}. Yalnız JSON döndür.` },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 400, temperature: 0 },
      }),
    );
    const parsed = parseJsonObject(textOf(res.output)) ?? {};
    const values: Record<string, number | null> = {};
    for (const f of fields) {
      const raw = parsed[f];
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^\d.]/g, "")) : NaN;
      values[f] = Number.isFinite(n) ? n : null;
    }
    return { values, model: modelId };
  },
};
