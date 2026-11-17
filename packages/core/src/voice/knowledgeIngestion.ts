import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../db";
import { envStr } from "../env";
import { bucket, s3 } from "../storage/s3";
import { signedAwsFetch } from "./awsSigV4";

const ALLOWED_EXT = new Set([".md", ".pdf", ".txt", ".docx"]);

function extOfFile(name: string): string {
  const m = /\.[a-z0-9]+$/i.exec(name.trim());
  return (m?.[0] ?? ".txt").toLowerCase();
}

function extractReadableText(bytes: Uint8Array, ext: string): string {
  if (ext === ".md" || ext === ".txt") {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\s+/g, " ").trim();
  }
  // PDF veya DOCX için temel metin çıkarımı (üretimde Bedrock KB + Textract tam OCR yapar)
  const latin = new TextDecoder("latin1").decode(bytes);
  const chunks = latin.match(/[A-Za-zÇçĞğİıÖöŞşÜü0-9.,!?:;()\-/\s]{6,}/g) ?? [];
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

async function runTextractIfPdf(bytes: Uint8Array): Promise<string | null> {
  if (envStr("VOICE_ENABLE_TEXTRACT", "0") !== "1" || bytes.byteLength > 4.5 * 1024 * 1024) return null;
  try {
    const region = envStr("BEDROCK_REGION", envStr("AWS_REGION", "eu-central-1"));
    const res = await signedAwsFetch({
      service: "textract",
      region,
      method: "POST",
      host: `textract.${region}.amazonaws.com`,
      path: "/",
      body: JSON.stringify({ Document: { Bytes: Buffer.from(bytes).toString("base64") } }),
      extraHeaders: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "Textract.DetectDocumentText",
      },
      timeoutMs: 25_000,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { Blocks?: { BlockType?: string; Text?: string }[] };
    const lines = (j.Blocks ?? []).filter((b) => b.BlockType === "LINE" && b.Text).map((b) => b.Text!);
    return lines.join(" ").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Bedrock Knowledge Base veri kaynağı senkronizasyonunu tetikler.
 */
export async function triggerBedrockKbSync(): Promise<string | null> {
  const kbId = envStr("BEDROCK_KB_ID", "");
  const dsId = envStr("BEDROCK_KB_DATA_SOURCE_ID", "");
  if (!kbId || !dsId) return null;

  try {
    const region = envStr("BEDROCK_REGION", envStr("AWS_REGION", "eu-central-1"));
    const res = await signedAwsFetch({
      service: "bedrock",
      region,
      method: "POST",
      host: `bedrock-agent.${region}.amazonaws.com`,
      path: `/knowledgebases/${encodeURIComponent(kbId)}/datasources/${encodeURIComponent(dsId)}/ingestionjobs/`,
      body: JSON.stringify({ description: "Marka sesli asistan belge güncellemesi" }),
      extraHeaders: { "content-type": "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { ingestionJob?: { ingestionJobId?: string } };
    return j.ingestionJob?.ingestionJobId ?? null;
  } catch (e) {
    console.warn("[knowledgeIngestion] Bedrock KB sync atlandı:", (e as Error).message);
    return null;
  }
}

/**
 * Marka belgesini (.md, .pdf, .txt, .docx) S3'te marka klasörüne (`voice-kb/{brandId}/...`)
 * + metadata filtresi dosyasıyla (`brandId`) yükler, veritabanına işler ve KB senkronizasyonu başlatır.
 */
export async function ingestBrandKnowledgeDoc(input: {
  brandId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  replaceDocId?: string | null;
}) {
  const ext = extOfFile(input.fileName);
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error("Yalnız .md, .pdf, .txt veya .docx dosyaları yüklenebilir.");
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > 25 * 1024 * 1024) {
    throw new Error("Belge boyutu 1 byte ile 25 MB arasında olmalıdır.");
  }

  if (input.replaceDocId) {
    await deleteBrandKnowledgeDoc(input.brandId, input.replaceDocId).catch(() => undefined);
  }

  const fileId = randomUUID();
  const s3Key = `voice-kb/${input.brandId}/${fileId}${ext}`;
  const metadataS3Key = `${s3Key}.metadata.json`;
  const metadataJson = JSON.stringify({ metadataAttributes: { brandId: input.brandId, fileName: input.fileName } });

  const doc = await prisma.voiceKnowledgeDoc.create({
    data: {
      brandId: input.brandId,
      fileName: input.fileName.slice(0, 160),
      mimeType: input.mimeType || "application/octet-stream",
      sizeBytes: input.bytes.byteLength,
      s3Key,
      metadataS3Key,
      status: "processing",
    },
  });

  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: s3Key,
        Body: input.bytes,
        ContentType: input.mimeType || "application/octet-stream",
      }),
    );
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: metadataS3Key,
        Body: metadataJson,
        ContentType: "application/json",
      }),
    );

    let extracted = extractReadableText(input.bytes, ext);
    if (ext === ".pdf" && extracted.length < 80) {
      const ocr = await runTextractIfPdf(input.bytes);
      if (ocr) extracted = ocr;
    }

    const ingestionJobId = await triggerBedrockKbSync();
    return prisma.voiceKnowledgeDoc.update({
      where: { id: doc.id },
      data: {
        status: "ready",
        textPreview: extracted.slice(0, 24_000),
        ingestionJobId,
      },
    });
  } catch (e) {
    return prisma.voiceKnowledgeDoc.update({
      where: { id: doc.id },
      data: { status: "error", error: (e as Error).message.slice(0, 240) },
    });
  }
}

export async function deleteBrandKnowledgeDoc(brandId: string, docId: string) {
  const doc = await prisma.voiceKnowledgeDoc.findUnique({ where: { id: docId } });
  if (!doc || doc.brandId !== brandId) throw new Error("Belge bulunamadı.");
  await prisma.voiceKnowledgeDoc.delete({ where: { id: docId } });
  await Promise.all([
    s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: doc.s3Key })).catch(() => undefined),
    doc.metadataS3Key
      ? s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: doc.metadataS3Key })).catch(() => undefined)
      : Promise.resolve(),
  ]);
  void triggerBedrockKbSync();
  return { ok: true };
}

/** SSS maddesini S3 bilgi bankasına marka izolasyonuyla senkronize eder. */
export async function syncBrandFaqsToKb(brandId: string) {
  const faqs = await prisma.voiceFaqItem.findMany({ where: { brandId, active: true }, orderBy: { createdAt: "asc" } });
  const key = `voice-kb/${brandId}/faqs.md`;
  const md = faqs.map((f) => `## ${f.question}\n${f.answer}`).join("\n\n");
  await s3()
    .send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: md || "# SSS", ContentType: "text/markdown; charset=utf-8" }))
    .catch(() => undefined);
  await s3()
    .send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: `${key}.metadata.json`,
        Body: JSON.stringify({ metadataAttributes: { brandId, source: "faq" } }),
        ContentType: "application/json",
      }),
    )
    .catch(() => undefined);
  void triggerBedrockKbSync();
}

