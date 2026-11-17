import { prisma } from "../db";
import { getLlm } from "../llm";

export type TikTokAiSuggestion = {
  captions: string[];
  hashtags: string[];
  bestPostingHours: string[];
  performanceSummary: string;
  model: string;
};

/**
 * Creator'ın son TikTok video performanslarını analiz ederek
 * video açıklama/hashtag önerileri, en iyi paylaşım saatleri ve performans özeti üretir.
 */
export async function generateTikTokAiInsights(params: {
  influencerId: string;
  topic?: string;
  campaignName?: string;
}): Promise<TikTokAiSuggestion> {
  const account = await prisma.tikTokAccount.findFirst({
    where: { influencerId: params.influencerId, status: "active" },
    include: {
      videos: {
        orderBy: { createTime: "desc" },
        take: 15,
      },
    },
  });

  const videos = account?.videos ?? [];
  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
  const totalEng = videos.reduce((s, v) => s + v.likeCount + v.commentCount + v.shareCount, 0);
  const avgEr = totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(2) : "0.00";

  // Geçmiş videolardan saat bazlı en yüksek etkileşimi hesapla
  const hourBuckets = new Map<number, { views: number; count: number }>();
  for (const v of videos) {
    const h = v.createTime.getHours();
    const cur = hourBuckets.get(h) ?? { views: 0, count: 0 };
    hourBuckets.set(h, { views: cur.views + v.viewCount, count: cur.count + 1 });
  }
  const topHours = [...hourBuckets.entries()]
    .sort((a, b) => b[1].views / b[1].count - a[1].views / a[1].count)
    .slice(0, 3)
    .map(([h]) => `${String(h).padStart(2, "0")}:00`);

  const bestPostingHours = topHours.length > 0 ? topHours : ["19:00", "21:00", "12:30"];

  const llm = getLlm();
  const prompt = [
    `Hesap: ${account?.username ?? "TikTok Creator"} (${account?.followerCount ?? 0} takipçi)`,
    `Son ${videos.length} video toplam izlenme: ${totalViews}, ortalama etkileşim oranı: %${avgEr}`,
    params.campaignName ? `Kampanya: ${params.campaignName}` : "",
    params.topic ? `İçerik konusu: ${params.topic}` : "",
    "Lütfen 3 kısa Türkçe TikTok video açıklaması, 6 alakalı hashtag ve 2 cümlelik performans özeti öner.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await llm.completeText({
    system: "Sen Nordvow platformunun TikTok içerik ve büyüme stratejisti yapay zekâsısın. Kısa, net ve aksiyon odaklı Türkçe yanıt ver.",
    prompt,
    promptVersion: "tiktok-ai-v1",
  });

  const topicTag = params.topic
    ? `#${params.topic.toLowerCase().replace(/[^a-z0-9ğüşıöç]/gi, "").slice(0, 18)}`
    : "#kesfet";

  const captions =
    llm.name === "mock"
      ? [
          `${params.topic || "Bugünkü favorim"} — detaylar videoda! 👇`,
          `${params.campaignName ? `${params.campaignName} ile ` : ""}günlük rutinime göz atın ✨`,
          `Bunu daha önce denemiş miydiniz? Yorumlarda buluşalım 💬`,
        ]
      : res.text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 8)
          .slice(0, 3);

  const hashtags = Array.from(new Set([topicTag, "#nordvow", "#tiktokturkiye", "#kesfet", "#icerikureticisi", "#ugc"]));

  const performanceSummary =
    llm.name === "mock"
      ? videos.length > 0
        ? `Son ${videos.length} videoda toplam ${totalViews.toLocaleString("tr-TR")} izlenme ve %${avgEr} etkileşim oranına ulaştınız. En yüksek performans ${bestPostingHours[0]} saatlerinde yakalanıyor.`
        : `Henüz senkronize edilmiş video verisi bulunmuyor. İlk videolarınız yüklendikçe en iyi paylaşım saatleri ve etkileşim trendleri burada hesaplanacaktır.`
      : res.text;

  return {
    captions: captions.length > 0 ? captions : [`${params.topic || "Yeni içerik"} ✨`],
    hashtags,
    bestPostingHours,
    performanceSummary,
    model: res.model,
  };
}
