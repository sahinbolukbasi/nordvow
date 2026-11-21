import { envStr } from "../../env";
import { converseChat, parseJsonObject, type ChatTurn } from "../../llm/bedrock";

export type CreativeSkillId =
  | "generate_image"
  | "edit_image"
  | "generate_video"
  | "photo_to_video_montage"
  | "ai_video_edit"
  | "video_voiceover"
  | "post_brief"
  | "library_search"
  | "credit_status"
  | "creative_director";

export type CreativeSkillDef = {
  id: CreativeSkillId;
  label: string;
  agentName: string;
  description: string;
  requiresMedia?: "image" | "video" | "multi_image" | "none";
};

/**
 * Nordvow Creative AI kayıtlı yetenek (skill) kataloğu.
 * Yeni bir yetenek eklemek için buraya tanım ekleyip dispatcher'a bağlamak yeterlidir.
 */
export const CREATIVE_SKILLS: CreativeSkillDef[] = [
  {
    id: "generate_image",
    label: "Görsel Üretim",
    agentName: "Görsel Üretim Agent'ı",
    description: "Sıfırdan ürün fotoğrafı, Instagram Post/Story, afiş veya konsept görseli üretir.",
    requiresMedia: "none",
  },
  {
    id: "edit_image",
    label: "Görsel Düzenleme",
    agentName: "Görsel Düzenleme Agent'ı",
    description: "Yüklenen veya seçilen fotoğrafı komutla düzenler (arka plan kaldırma, netleştirme, ışık/stil değiştirme).",
    requiresMedia: "image",
  },
  {
    id: "generate_video",
    label: "Video Üretim",
    agentName: "Video Üretim Agent'ı",
    description: "Metinden veya tek bir referans fotoğraftan 5–10 sn sinematik Reels/TikTok videosu üretir.",
    requiresMedia: "none",
  },
  {
    id: "photo_to_video_montage",
    label: "Fotoğraftan Video Montajı",
    agentName: "Storyboard & Montaj Agent'ı",
    description: "Birden fazla fotoğraftan AI storyboard, geçiş efektleri ve müzikli Reels/video montajı oluşturur.",
    requiresMedia: "multi_image",
  },
  {
    id: "ai_video_edit",
    label: "AI Video Kurgu (FFmpeg)",
    agentName: "AI Video Kurgu Agent'ı",
    description:
      "Mevcut videoyu doğal dil komutuyla kurgular: kesme, kırpma, sessizlik temizleme, otomatik altyazı, fon müziği, hız, renk düzenleme, 9:16/16:9/1:1 oran dönüşümü ve metin ekleme.",
    requiresMedia: "video",
  },
  {
    id: "video_voiceover",
    label: "Videoya Seslendirme",
    agentName: "Seslendirme Agent'ı",
    description: "Mevcut bir videonun üzerine doğal Türkçe/İngilizce yapay zekâ seslendirmesi üretip gömer.",
    requiresMedia: "video",
  },
  {
    id: "post_brief",
    label: "Post Brief & Metin",
    agentName: "İçerik & Brief Agent'ı",
    description: "Instagram/TikTok için açılış kancası (hook), açıklama metni, hashtag seti ve #reklam uyumlu brief yazar.",
    requiresMedia: "none",
  },
  {
    id: "library_search",
    label: "Kitaplık Sorgusu",
    agentName: "Kitaplık Agent'ı",
    description: "Kullanıcının daha önce yüklediği veya ürettiği fotoğraf ve videoları sohbette listeler.",
    requiresMedia: "none",
  },
  {
    id: "credit_status",
    label: "Kredi & Fiyat Bilgisi",
    agentName: "Kredi Agent'ı",
    description: "Kullanıcının mevcut kredi bakiyesini ve tahmini üretim maliyetlerini gösterir.",
    requiresMedia: "none",
  },
  {
    id: "creative_director",
    label: "Kreatif Direktör",
    agentName: "Kreatif Direktör Agent'ı",
    description: "Fikir geliştirme, kampanya stratejisi, prompt iyileştirme ve genel sohbet.",
    requiresMedia: "none",
  },
];

export const SKILL_BY_ID: Record<CreativeSkillId, CreativeSkillDef> = Object.fromEntries(
  CREATIVE_SKILLS.map((s) => [s.id, s]),
) as Record<CreativeSkillId, CreativeSkillDef>;

export type SkillRouteInput = {
  message: string;
  history: ChatTurn[];
  attachedImagesCount: number;
  hasAttachedVideo: boolean;
  hasLastGeneratedVideo: boolean;
};

export type SkillRouteDecision = {
  skill: CreativeSkillId;
  reason: string;
  extractedScript?: string;
  aspect?: "9:16" | "16:9" | "1:1" | "4:5";
  source: "llm" | "rules";
};

function detectAspect(norm: string): "9:16" | "16:9" | "1:1" | "4:5" | undefined {
  if (/16\s*:\s*9|yatay|youtube/.test(norm)) return "16:9";
  if (/1\s*:\s*1|kare/.test(norm)) return "1:1";
  if (/4\s*:\s*5|post/.test(norm)) return "4:5";
  if (/9\s*:\s*16|dikey|reels|story|tiktok/.test(norm)) return "9:16";
  return undefined;
}

/**
 * Deterministik hızlı skill yönlendirici (LLM kapalıyken veya yedek olarak çalışır).
 */
export function routeCreativeSkillDeterministic(input: SkillRouteInput): SkillRouteDecision {
  const msg = input.message.trim();
  const norm = msg.toLocaleLowerCase("tr");
  const aspect = detectAspect(norm);

  if (/(kredim|bakiyem|ne kadar kredi|kaç kredi|fiyatlar|kredi durumu|bakiye sorgula)/.test(norm)) {
    return { skill: "credit_status", reason: "Kullanıcı kredi/bakiye bilgisi istedi.", source: "rules" };
  }

  if (/(kitaplığım|kitapligim|dosyalarım|dosyalarim|galerim|yüklediğim|yukledigim|önceki videolar|onceki videolar|önceki görseller|son üretimler)/.test(norm)) {
    return { skill: "library_search", reason: "Kullanıcı kitaplık/medya listesini istedi.", source: "rules" };
  }

  if (/(videoma ses|videoya ses|bu videoya ses|videoyu seslendir|videonun üzerine ses|seslendirme ekle|voiceover)/.test(norm) && (input.hasAttachedVideo || input.hasLastGeneratedVideo)) {
    const colonIdx = msg.indexOf(":");
    const quoteMatch = msg.match(/['"“”]([^'"“”]{4,})['"“”]/);
    const extractedScript = quoteMatch?.[1] ?? (colonIdx >= 0 ? msg.slice(colonIdx + 1).trim() : undefined);
    return { skill: "video_voiceover", reason: "Videoya AI seslendirme istendi.", extractedScript, aspect, source: "rules" };
  }

  // Çoklu fotoğraftan montaj / storyboard videosu
  if (
    input.attachedImagesCount >= 2 &&
    /(video|reels|montaj|slayt|storyboard|canlandır|canlandir|dönüştür|donustur|klip)/.test(norm)
  ) {
    return {
      skill: "photo_to_video_montage",
      reason: "Birden fazla fotoğraftan video montajı istendi.",
      aspect: aspect ?? "9:16",
      source: "rules",
    };
  }

  // Mevcut video üzerinde herhangi bir kurgu / FFmpeg / AI düzenleme talebi
  const videoEditVerbs =
    /(altyazı|alt yazı|altyazi|subtitle|caption|müzik|muzik|fon müziği|sessiz|sessizliği|kes|kırp|kirp|kısalt|kisalt|hızlandır|hizlandir|yavaşlat|yavaslat|renk|filtre|yazı ekle|yazi ekle|başlık ekle|metin ekle|9:16|16:9|1:1|dikey yap|yatay yap|kurgu|montaj|düzenle|duzenle|editle|edit|sahne|geçiş|gecis)/;
  if ((input.hasAttachedVideo || input.hasLastGeneratedVideo) && videoEditVerbs.test(norm) && !/(yeni video üret|sıfırdan video)/.test(norm)) {
    return {
      skill: "ai_video_edit",
      reason: "Mevcut video üzerinde AI kurgu / FFmpeg düzenleme istendi.",
      aspect: aspect ?? "9:16",
      source: "rules",
    };
  }

  if (/(post brief|brief hazırla|caption yaz|hashtag|açıklama metni|sosyal medya metni|reklam metni)/.test(norm) && !/(görsel üret|fotoğraf üret|video üret)/.test(norm)) {
    return { skill: "post_brief", reason: "Sosyal medya brief/metin istendi.", source: "rules" };
  }

  if (input.attachedImagesCount >= 1 && /(arka plan|arkaplan|netleştir|netlestir|upscale|düzenle|duzenle|değiştir|degistir|ışık|isik|temizle)/.test(norm) && !/(video|reels|canlandır|canlandir)/.test(norm)) {
    return { skill: "edit_image", reason: "Referans fotoğraf üzerinde düzenleme istendi.", aspect, source: "rules" };
  }

  if (/(video|reels|tiktok|klip|canlandır|canlandir|animasyon|hareketlendir)/.test(norm)) {
    return { skill: "generate_video", reason: "Video üretimi istendi.", aspect: aspect ?? "9:16", source: "rules" };
  }

  if (/(görsel|gorsel|fotoğraf|fotograf|afiş|afis|banner|story|post|tasarla|çiz|ciz|üret|uret|oluştur|olustur)/.test(norm)) {
    return { skill: "generate_image", reason: "Görsel üretimi istendi.", aspect, source: "rules" };
  }

  return { skill: "creative_director", reason: "Genel kreatif sohbet / yönlendirme.", aspect, source: "rules" };
}

/**
 * LLM tabanlı Skill Agent Router (AWS Bedrock).
 * Kullanıcının doğal dil mesajına ve ekli dosyalara bakarak hangi kayıtlı skill'in çağrılacağına karar verir.
 * Bedrock erişilemezse veya kapalıysa deterministik yönlendiriciye güvenli şekilde düşer.
 */
export async function routeCreativeSkill(input: SkillRouteInput): Promise<SkillRouteDecision> {
  const fallback = routeCreativeSkillDeterministic(input);
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") {
    return fallback;
  }

  const skillMenu = CREATIVE_SKILLS.map(
    (s) => `- ${s.id}: ${s.description} (medya: ${s.requiresMedia ?? "none"})`,
  ).join("\n");

  const system = [
    "Sen Nordvow Creative AI orkestratörüsün. Kullanıcının isteğini inceleyip aşağıdaki kayıtlı skill'lerden EN UYGUN TEK birini seç.",
    "SADECE şu JSON'u döndür (başka metin yok):",
    '{"skill":"<skill_id>","reason":"<kısa Türkçe gerekçe>","aspect":"9:16|16:9|1:1|4:5|null","extractedScript":"<varsa seslendirme metni veya null>"}',
    "Kayıtlı Skill'ler:",
    skillMenu,
    `Bağlam: ekliFotoğrafSayısı=${input.attachedImagesCount}, ekliVideoVar=${input.hasAttachedVideo}, sonÜretilenVideoVar=${input.hasLastGeneratedVideo}.`,
    "Kurallar:",
    "- Kullanıcı 2+ fotoğraf eklediyse ve video/montaj/reels istiyorsa photo_to_video_montage seç.",
    "- Ekli veya son video üzerinde kesme, kırpma, altyazı, müzik, sessizlik silme, hız, renk, yazı ekleme, 9:16 yapma gibi her kurgu isteğinde ai_video_edit seç.",
    "- Kullanıcı kitaplığını/dosyalarını soruyorsa library_search, kredisini/bakiyesini soruyorsa credit_status seç.",
  ].join("\n");

  try {
    const turns: ChatTurn[] = [
      ...input.history.slice(-6),
      { role: "user", text: input.message },
    ];
    const res = await converseChat({
      system,
      turns,
      maxTokens: 180,
      temperature: 0.1,
    });
    const parsed = parseJsonObject(res.text);
    const skillId = typeof parsed?.skill === "string" ? (parsed.skill as CreativeSkillId) : null;
    if (skillId && skillId in SKILL_BY_ID) {
      const aspectRaw = typeof parsed?.aspect === "string" ? parsed.aspect : undefined;
      const aspect =
        aspectRaw === "9:16" || aspectRaw === "16:9" || aspectRaw === "1:1" || aspectRaw === "4:5"
          ? aspectRaw
          : fallback.aspect;
      return {
        skill: skillId,
        reason: typeof parsed?.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : fallback.reason,
        aspect,
        extractedScript:
          typeof parsed?.extractedScript === "string" && parsed.extractedScript.trim()
            ? parsed.extractedScript.trim()
            : fallback.extractedScript,
        source: "llm",
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

