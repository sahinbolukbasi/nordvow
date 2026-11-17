import { prisma } from "../db";
import { converseChat } from "../llm/bedrock";
import { dayBucket, recordRun } from "./common";

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /@[\p{L}\p{N}._]+/gu;
const DISCLOSURE_RE = /#(reklam|işbirliği|isbirligi|tanıtım|tanitim|sponsorlu|ad)\b/i;

/**
 * Aktif kampanyalar için Reels, Post, Carousel ve Story içeriklerini tarar;
 * hashtag, @mention/konum, beğeni, yorum ve izlenme verilerini toplayıp
 * AI ile özet yorum üreterek kampanya loglarına (AgentRun) kaydeder.
 */
export async function runCampaignContentTracker(now = new Date()): Promise<boolean[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { status: "AKTIF" },
    select: {
      id: true,
      name: true,
      brand: { select: { name: true } },
      assignments: {
        where: { contractStatus: "KABUL" },
        select: {
          influencer: { select: { name: true } },
          deliverables: {
            where: { status: { not: "IPTAL" } },
            select: {
              id: true,
              platform: true,
              contentType: true,
              status: true,
              postUrl: true,
              caption: true,
              frameTexts: true,
              publishedAt: true,
              metricSnapshots: {
                orderBy: { measuredAt: "desc" },
                take: 1,
                select: {
                  likes: true,
                  comments: true,
                  impressions: true,
                  reach: true,
                  saves: true,
                  shares: true,
                },
              },
            },
          },
        },
      },
    },
    take: 50,
  });

  const out: boolean[] = [];

  for (const camp of campaigns) {
    const deliverables = camp.assignments.flatMap((a) =>
      a.deliverables.map((d) => ({ ...d, influencerName: a.influencer.name })),
    );
    if (deliverables.length === 0) continue;

    let reels = 0;
    let posts = 0;
    let stories = 0;
    let published = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalViews = 0;
    let disclosureMissing = 0;
    const hashtags = new Set<string>();
    const mentions = new Set<string>();

    for (const d of deliverables) {
      if (d.contentType === "REELS" || d.contentType === "VIDEO" || d.contentType === "SHORTS") reels++;
      else if (d.contentType === "STORY") stories++;
      else posts++;

      if (d.publishedAt || ["YAYINLANDI", "METRIK_BEKLIYOR", "TAMAMLANDI"].includes(d.status)) {
        published++;
      }

      const combinedText = [d.caption ?? "", ...(d.frameTexts ?? [])].join(" ");
      for (const h of combinedText.match(HASHTAG_RE) ?? []) hashtags.add(h.toLowerCase());
      for (const m of combinedText.match(MENTION_RE) ?? []) mentions.add(m.toLowerCase());
      if (combinedText.trim() && !DISCLOSURE_RE.test(combinedText)) {
        disclosureMissing++;
      }

      const snap = d.metricSnapshots[0];
      if (snap) {
        totalLikes += snap.likes ?? 0;
        totalComments += snap.comments ?? 0;
        totalViews += snap.impressions ?? snap.reach ?? 0;
      }
    }

    let aiSummary = `${camp.name}: ${published}/${deliverables.length} içerik yayında (${reels} Reels/Video, ${posts} Post, ${stories} Story). Toplam ${totalViews.toLocaleString("tr-TR")} görüntülenme, ${totalLikes.toLocaleString("tr-TR")} beğeni, ${totalComments.toLocaleString("tr-TR")} yorum.`;

    try {
      const llm = await converseChat({
        system:
          "Sen Nordvow kampanya analistisin. Kısa, net, Türkçe ve sonuç odaklı tek paragraf kampanya içerik takip özeti yaz.",
        turns: [
          {
            role: "user",
            text: `Kampanya: ${camp.name} (${camp.brand.name}). Toplam ${deliverables.length} içerik, ${published} yayında. Dağılım: ${reels} Reels/Video, ${posts} Post, ${stories} Story. Görüntülenme: ${totalViews}, Beğeni: ${totalLikes}, Yorum: ${totalComments}. Hashtag sayısı: ${hashtags.size}, Etiket/@mention sayısı: ${mentions.size}, Reklam etiketi eksik içerik: ${disclosureMissing}. 2 cümlede net özet ve öneri yaz.`,
          },
        ],
        maxTokens: 180,
      });
      if (llm.text?.trim()) {
        aiSummary = llm.text.trim();
      }
    } catch {
      // LLM kapalı/hatalıysa deterministik özet korunur.
    }

    const created = await recordRun({
      checkType: "YAYIN_KONTROL",
      targetType: "Campaign",
      targetId: camp.id,
      bucket: `ic-takip:${dayBucket(now)}`,
      severity: disclosureMissing > 0 ? "UYARI" : "BILGI",
      summary: aiSummary,
      findings: {
        totalDeliverables: deliverables.length,
        published,
        formats: { reels, posts, stories },
        metrics: { totalViews, totalLikes, totalComments },
        hashtags: [...hashtags].slice(0, 15),
        mentions: [...mentions].slice(0, 15),
        disclosureMissing,
      },
      model: "kampanya-takip-ai",
      promptVersion: "v1",
    });
    out.push(created);
  }

  return out;
}
