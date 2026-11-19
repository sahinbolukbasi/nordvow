// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

export type KeywordMatchMode = "WHOLE_WORD" | "CONTAINS" | "ANY_COMMENT";

export type KeywordMatchResult = {
  matched: boolean;
  matchedKeyword: string | null;
};

const ARABIC_CHAR_MAP: Record<string, string> = {
  ك: "ک",
  ي: "ی",
  ى: "ی",
  ة: "ه",
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ؤ: "و",
  ئ: "ی",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

const TURKISH_FOLD_MAP: Record<string, string> = {
  ı: "i",
  ş: "s",
  ğ: "g",
  ü: "u",
  ö: "o",
  ç: "c",
};

const EMOJI_RANGES_RE =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1FAFF}\u{200D}\u{20E3}]/gu;

/** Arapça/Farsça harf ve rakam varyantlarını sadeleştirir. */
export function normalizeArabicScript(input: string): string {
  return input
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/[كيىةأإآؤئ٠-٩۰-۹]/g, (ch) => ARABIC_CHAR_MAP[ch] ?? ch);
}

/**
 * Emoji aralıklarını ve noktalama/özel karakterleri temizler; birleşik işaretleri (\p{M})
 * korur ki NFD metinde kelimeler bölünmesin.
 */
export function stripSpecialCharacters(input: string): string {
  return input
    .replace(EMOJI_RANGES_RE, " ")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * NFD açılımında Latin taban harflerinden sonra gelen birleşik aksanları siler
 * (örn. `preço` → `preco`, `İ` → `I`), Latin dışı yazılardaki işaretleri korur ve NFC toplar.
 */
export function foldDiacritics(input: string): string {
  const nfd = input.normalize("NFD");
  const folded = nfd.replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, "$1");
  return folded.normalize("NFC");
}

/**
 * Türkçe harf katlama: `tr-TR` locale ile küçültüp (`I→ı`, `İ→i`)
 * ardından `ı→i`, `ş→s`, `ğ→g`, `ü→u`, `ö→o`, `ç→c` katlaması uygular.
 */
export function normalizeTurkish(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0307/g, "")
    .replace(/[ışğüöç]/g, (ch) => TURKISH_FOLD_MAP[ch] ?? ch);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Anahtar kelime veya yorum metnini eşleştirme boru hattından geçirir. */
export function normalizeKeywordText(input: string, isNumericKeyword = false): string {
  const arabic = normalizeArabicScript(input);
  const stripped = stripSpecialCharacters(arabic);
  const folded = foldDiacritics(stripped);
  let normalized = normalizeTurkish(folded);
  if (isNumericKeyword) {
    normalized = normalized.replace(/[oO]/g, "0");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

/**
 * Yorum veya DM metnini tanımlanan anahtar kelimelerle eşleştirir.
 * Anahtar kelimeler arasında VEYA mantığı uygulanır; ilk eşleşen ham anahtar kelime döner.
 */
export function matchKeyword(
  commentText: string | null | undefined,
  keywords: string[],
  mode: KeywordMatchMode,
): KeywordMatchResult {
  const rawComment = (commentText ?? "").trim();
  if (!rawComment) {
    return { matched: false, matchedKeyword: null };
  }

  if (mode === "ANY_COMMENT") {
    return { matched: true, matchedKeyword: "*" };
  }

  const baseComment = normalizeKeywordText(rawComment, false);
  if (!baseComment) {
    return { matched: false, matchedKeyword: null };
  }

  for (const rawKeyword of keywords) {
    const trimmedKeyword = rawKeyword.trim();
    if (!trimmedKeyword) continue;

    const strippedKw = stripSpecialCharacters(normalizeArabicScript(trimmedKeyword));
    const isNumeric = /^[0-9oO]+$/.test(strippedKw);
    const normKeyword = normalizeKeywordText(trimmedKeyword, isNumeric);
    if (!normKeyword) continue;

    const normComment = isNumeric ? normalizeKeywordText(rawComment, true) : baseComment;
    if (!normComment) continue;

    if (mode === "WHOLE_WORD") {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegex(normKeyword)}(?![\\p{L}\\p{N}])`,
        "iu",
      );
      if (pattern.test(normComment)) {
        return { matched: true, matchedKeyword: trimmedKeyword };
      }
    } else if (normComment.includes(normKeyword)) {
      return { matched: true, matchedKeyword: trimmedKeyword };
    }
  }

  return { matched: false, matchedKeyword: null };
}

/** Kayıt esnasında kullanılmak üzere anahtar kelime dizisini normalize eder. */
export function normalizeKeywordList(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 20);
}

