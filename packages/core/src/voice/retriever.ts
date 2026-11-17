import { prisma } from "../db";
import { envStr } from "../env";
import { signedAwsFetch } from "./awsSigV4";
import type { RetrievedChunk } from "./types";

function scoreMatch(query: string, text: string): number {
  const words = query
    .toLocaleLowerCase("tr")
    .split(/[^a-zçğıöşü0-9]+/i)
    .filter((w) => w.length >= 2);
  if (!words.length) return 0;
  const hay = text.toLocaleLowerCase("tr");
  let hits = 0;
  for (const w of words) {
    if (hay.includes(w)) hits++;
  }
  return hits / words.length;
}

/**
 * Bedrock Knowledge Bases (`Retrieve`) üzerinden yalnız `brandId` metadata filtresiyle
 * marka-izole RAG parçalarını getirir. KB tanımlı değilse veya erişilemezse markanın
 * kendi `VoiceFaqItem` ve `VoiceKnowledgeDoc` kayıtlarından arama yapar (markalar asla karışmaz).
 */
export async function retrieveBrandKnowledge(brandId: string, query: string, topK = 5): Promise<RetrievedChunk[]> {
  const kbId = envStr("BEDROCK_KB_ID", "");
  if (kbId && envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const region = envStr("BEDROCK_REGION", envStr("AWS_REGION", "eu-central-1"));
      const res = await signedAwsFetch({
        service: "bedrock",
        region,
        method: "POST",
        host: `bedrock-agent-runtime.${region}.amazonaws.com`,
        path: `/knowledgebases/${encodeURIComponent(kbId)}/retrieve`,
        body: JSON.stringify({
          retrievalQuery: { text: query },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: topK,
              filter: { equals: { key: "brandId", value: brandId } },
            },
          },
        }),
        extraHeaders: { "content-type": "application/json" },
        timeoutMs: 8_000,
      });
      if (res.ok) {
        const j = (await res.json()) as {
          retrievalResults?: { content?: { text?: string }; score?: number; location?: { s3Location?: { uri?: string } } }[];
        };
        const items = (j.retrievalResults ?? [])
          .filter((r) => r.content?.text)
          .map((r, idx) => ({
            docId: `kb-${idx}`,
            title: r.location?.s3Location?.uri?.split("/").pop() ?? "Bilgi Bankası",
            content: r.content!.text!,
            score: r.score ?? 0.8,
          }));
        if (items.length > 0) return items;
      }
    } catch (e) {
      console.warn("[retriever] Bedrock KB retrieve yedeğe düştü:", (e as Error).message);
    }
  }

  // Marka-izole yerel/DB RAG yedeği
  const [faqs, docs] = await Promise.all([
    prisma.voiceFaqItem.findMany({ where: { brandId, active: true }, take: 100 }),
    prisma.voiceKnowledgeDoc.findMany({ where: { brandId, status: "ready" }, take: 50 }),
  ]);

  const candidates: RetrievedChunk[] = [];
  for (const f of faqs) {
    const combined = `Soru: ${f.question}\nCevap: ${f.answer}`;
    candidates.push({
      docId: f.id,
      title: `SSS · ${f.question.slice(0, 60)}`,
      content: combined,
      score: Math.max(0.1, scoreMatch(query, combined)),
    });
  }
  for (const d of docs) {
    const text = d.textPreview ?? "";
    if (!text) continue;
    // Uzun metni 600 karakterlik parçalara böl
    for (let i = 0; i < text.length && i < 6000; i += 500) {
      const slice = text.slice(i, i + 650);
      candidates.push({
        docId: d.id,
        title: d.fileName,
        content: slice,
        score: scoreMatch(query, slice),
      });
    }
  }

  return candidates
    .filter((c) => c.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

