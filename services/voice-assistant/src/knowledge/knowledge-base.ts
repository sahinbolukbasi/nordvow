import fs from 'node:fs';
import path from 'node:path';

export interface KnowledgeChunk {
  id: string;
  sourceFile: string;
  title: string;
  content: string;
  tokens: string[];
}

export interface KnowledgeSearchResult {
  sourceFile: string;
  title: string;
  content: string;
  score: number;
}

const TURKISH_STOPWORDS = new Set([
  've',
  'ile',
  'bir',
  'bu',
  'da',
  'de',
  'mi',
  'mu',
  'mı',
  'mü',
  'icin',
  'için',
  'gibi',
  'ama',
  'fakat',
  'veya',
  'ya',
  'ne',
  'nasıl',
  'nasil',
  'nedir',
  'var',
  'yok',
  'olarak',
  'kadar',
  'en',
  'cok',
  'çok',
  'ben',
  'sen',
  'siz',
  'biz',
]);

/**
 * Türkçe metni küçük harfe çevirip arama için normalize eder.
 */
export function normalizeTurkishTokens(text: string): string[] {
  const normalized = text
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ');

  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !TURKISH_STOPWORDS.has(token));
}

/**
 * Markdown / metin belgelerini başlık ve soru-cevap bloklarına göre parçalar.
 */
function chunkDocument(sourceFile: string, rawText: string): KnowledgeChunk[] {
  const sections = rawText
    .split(/\n(?=##?\s)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: KnowledgeChunk[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const firstLine = lines[0].replace(/^#+\s*/, '').trim();
    const title = firstLine || sourceFile;

    // Eğer bölüm içinde ### alt başlıkları veya Soru:/S: blokları varsa böl
    const subBlocks = section
      .split(/\n(?=###\s|Soru:|S:)/g)
      .map((b) => b.trim())
      .filter((b) => b.replace(/^#+\s.*$/gm, '').trim().length > 0);
    if (subBlocks.length > 0) {
      subBlocks.forEach((clean, j) => {
        chunks.push({
          id: `${sourceFile}#${i}-${j}`,
          sourceFile,
          title,
          content: clean,
          tokens: normalizeTurkishTokens(clean),
        });
      });
    } else if (section.replace(/^#+\s.*$/gm, '').trim().length > 0) {
      chunks.push({
        id: `${sourceFile}#${i}`,
        sourceFile,
        title,
        content: section,
        tokens: normalizeTurkishTokens(section),
      });
    }
  }

  return chunks;
}

/**
 * Vektör veritabanı maliyeti olmadan yerel, hızlı Türkçe belge/SSS arama motoru.
 * İstenirse AWS Bedrock Knowledge Base (`BEDROCK_KB_ID`) ile genişletilebilir.
 */
export class KnowledgeBase {
  private readonly dirPath: string;
  private chunks: KnowledgeChunk[] = [];
  private docFrequency: Map<string, number> = new Map();

  constructor(knowledgeDir: string) {
    this.dirPath = knowledgeDir;
    this.reload();
  }

  reload(): void {
    this.chunks = [];
    this.docFrequency.clear();

    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
      return;
    }

    const files = fs
      .readdirSync(this.dirPath)
      .filter((f) => /\.(md|txt|json)$/i.test(f));

    for (const file of files) {
      const fullPath = path.join(this.dirPath, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (file.endsWith('.json')) {
        this.loadJsonFaq(file, content);
      } else {
        this.chunks.push(...chunkDocument(file, content));
      }
    }

    for (const chunk of this.chunks) {
      const unique = new Set(chunk.tokens);
      for (const token of unique) {
        this.docFrequency.set(token, (this.docFrequency.get(token) || 0) + 1);
      }
    }
  }

  private loadJsonFaq(file: string, raw: string): void {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item, idx) => {
          const q = item.question || item.soru || '';
          const a = item.answer || item.cevap || '';
          const text = `Soru: ${q}\nCevap: ${a}`.trim();
          if (text) {
            this.chunks.push({
              id: `${file}#${idx}`,
              sourceFile: file,
              title: q || file,
              content: text,
              tokens: normalizeTurkishTokens(text),
            });
          }
        });
      }
    } catch {
      // Geçersiz JSON dosyalarını sessizce atla
    }
  }

  addDocument(filename: string, content: string): { filename: string; chunks: number } {
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.mkdirSync(this.dirPath, { recursive: true });
    fs.writeFileSync(path.join(this.dirPath, safeName), content, 'utf-8');
    this.reload();
    return {
      filename: safeName,
      chunks: this.chunks.filter((c) => c.sourceFile === safeName).length,
    };
  }

  listDocuments(): Array<{ filename: string; chunkCount: number }> {
    const counts = new Map<string, number>();
    for (const c of this.chunks) {
      counts.set(c.sourceFile, (counts.get(c.sourceFile) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([filename, chunkCount]) => ({
      filename,
      chunkCount,
    }));
  }

  search(query: string, topK = 3): KnowledgeSearchResult[] {
    const queryTokens = normalizeTurkishTokens(query);
    if (queryTokens.length === 0 || this.chunks.length === 0) return [];

    const totalDocs = this.chunks.length;
    const avgLen =
      this.chunks.reduce((acc, c) => acc + c.tokens.length, 0) / totalDocs || 1;
    const k1 = 1.5;
    const b = 0.75;

    const scored: KnowledgeSearchResult[] = [];

    for (const chunk of this.chunks) {
      let score = 0;
      const tfMap = new Map<string, number>();
      for (const t of chunk.tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      for (const qt of queryTokens) {
        // Kısmi kök eşleşmesi (ör. "randevu" -> "randevunuz", "iptal" -> "iptali")
        let tf = tfMap.get(qt) || 0;
        let df = this.docFrequency.get(qt) || 0;

        if (tf === 0 && qt.length >= 4) {
          for (const [docToken, count] of tfMap.entries()) {
            if (docToken.startsWith(qt.slice(0, 4))) {
              tf += count * 0.7;
              df = Math.max(df, this.docFrequency.get(docToken) || 1);
            }
          }
        }

        if (tf > 0) {
          const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
          const denom = tf + k1 * (1 - b + b * (chunk.tokens.length / avgLen));
          score += idf * ((tf * (k1 + 1)) / denom);
        }
      }

      if (score > 0) {
        scored.push({
          sourceFile: chunk.sourceFile,
          title: chunk.title,
          content: chunk.content,
          score: Number(score.toFixed(4)),
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
