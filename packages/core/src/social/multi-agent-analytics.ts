import { prisma } from "../db";
import { envStr } from "../env";
import { converseChat } from "../llm/bedrock";

export type IngestedComment = {
  id: string;
  mediaId: string;
  username: string;
  text: string;
  timestamp: string;
};

export type IngestedMediaItem = {
  id: string;
  mediaType: "POST" | "CAROUSEL" | "REELS";
  caption: string;
  permalink: string;
  timestamp: string;
  likes: number;
  commentsCount: number;
  saves: number;
  shares: number;
  reach: number;
  impressions: number;
  plays: number;
  comments: IngestedComment[];
};

export type FollowerSampleProfile = {
  username: string;
  hasProfilePic: boolean;
  hasBio: boolean;
  followers: number;
  following: number;
  postsCount: number;
  lastPostDaysAgo: number | null;
};

export type TelemetryErrorCode =
  | "META_API_190"
  | "RATE_LIMIT_429"
  | "PERMISSION_DENIED"
  | "AGENT_TIMEOUT"
  | "NOT_CONFIGURED"
  | "UNKNOWN_ERROR";

export type TelemetryErrorEntry = {
  error_code: TelemetryErrorCode;
  failed_step: string;
  message: string;
  retry_count: number;
  next_retry_at: string;
};

export type AgentExecutionEntry = {
  agent: "DataIngestionWorker" | "ContentReelsAgent" | "SentimentNLPAgent" | "BotDetectorAgent";
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  items_scanned: number;
  duration_ms: number;
  summary: string;
};

export type StandardizedTelemetryJson = {
  user_profile: {
    user_id: string;
    username: string;
    account_status: "ACTIVE" | "PENDING" | "SUSPENDED" | "REJECTED";
    onboarding_completed: boolean;
    onboarding_scan_status: "COMPLETED" | "IN_PROGRESS" | "FAILED";
    daily_sync_status: "ACTIVE" | "PAUSED" | "TOKEN_EXPIRED" | "ERROR";
    last_sync_timestamp: string | null;
  };
  daily_metrics: {
    followers_total: number;
    followers_daily_change: string;
    new_posts_count_24h: number;
    new_likes_24h: number;
    new_comments_24h: number;
    new_reels_plays_24h: number;
    engagement_rate_percent: number;
  };
  agent_analysis: {
    quick_summary: string;
    audience_health: {
      organic_percent: number;
      bot_suspicious_percent: number;
      anomaly_detected: boolean;
    };
    sentiment_breakdown: {
      positive_percent: number;
      neutral_question_percent: number;
      negative_percent: number;
      spam_bot_comments_percent: number;
      urgent_action_comments: { username: string; comment: string; intent: "PURCHASE_INTENT" | "NEGATIVE" }[];
    };
    top_performing_recent_media: {
      media_id: string;
      type: string;
      reason: string;
    } | null;
  };
  admin_telemetry: {
    agents_executed: AgentExecutionEntry[];
    errors: TelemetryErrorEntry[];
  };
};

export type IngestedAccountData = {
  influencerId: string;
  userId: string | null;
  accountStatus: "ACTIVE" | "PENDING" | "SUSPENDED" | "REJECTED";
  handle: string;
  fetchedAt: string;
  apiConnected: boolean;
  apiErrorCode: TelemetryErrorCode | null;
  apiMessage: string;
  followers: number;
  prevFollowers: number | null;
  followsCount: number;
  mediaCount: number;
  erPct: number;
  prevErPct: number | null;
  posts: IngestedMediaItem[];
  reels: IngestedMediaItem[];
  comments: IngestedComment[];
  followerSample: FollowerSampleProfile[];
  durationMs: number;
};

export type ContentAgentResult = {
  top3: { id: string; mediaType: string; topic: string; interactions: number; reason: string }[];
  bottom3: { id: string; mediaType: string; topic: string; interactions: number; reason: string }[];
  formatStats: { format: string; count: number; avgLikes: number; avgComments: number; avgSaves: number; avgPlays: number }[];
  reelsLikeToPlayPct: number;
  reelsViralityPct: number;
  bestHourTr: number | null;
  bestDayTr: string | null;
  durationMs: number;
};

export type SentimentAgentResult = {
  totalComments: number;
  positivePct: number;
  neutralQuestionPct: number;
  negativePct: number;
  spamBotPct: number;
  topTopics: string[];
  urgentAlerts: { username: string; text: string; kind: "NEGATIVE" | "PURCHASE_INTENT" }[];
  durationMs: number;
};

export type BotDetectionAgentResult = {
  sampleSize: number;
  organicFollowerPct: number;
  suspiciousBotPct: number;
  anomalyDetected: boolean;
  flaggedReasons: string[];
  durationMs: number;
};

export type MultiAgentDailyReport = {
  influencerId: string;
  handle: string;
  generatedAt: string;
  mode: "ONBOARDING_QUICK_SCAN" | "DAILY_WORKER";
  dataAvailable: boolean;
  ingestion: IngestedAccountData;
  contentAgent: ContentAgentResult;
  sentimentAgent: SentimentAgentResult;
  botAgent: BotDetectionAgentResult;
  actionPlan: string[];
  rootCauseNotes: string[];
  markdownReport: string;
  telemetry: StandardizedTelemetryJson;
};

const TR_DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const POSITIVE_WORDS = ["harika", "bayıldım", "mükemmel", "süper", "çok güzel", "efsane", "teşekkür", "beğendim", "başarılı", "severek"];
const NEGATIVE_WORDS = ["kötü", "berbat", "pişman", "bozuk", "sahte", "beğenmedim", "rezalet", "yanlış", "hayal kırıklığı", "iade"];
const INTENT_WORDS = ["fiyat", "link", "nereden", "kaç tl", "sipariş", "indirim", "kod", "stok", "var mı", "nasıl alırım"];
const STOP_WORDS = new Set(["çok", "bir", "bu", "ve", "ile", "için", "ama", "de", "da", "mi", "mı", "ben", "sen", "var", "yok", "gibi", "daha", "en"]);

function reportConfigKey(influencerId: string): string {
  return `social.multi_agent_report.${influencerId}`;
}

function classifyMetaError(status: number, message: string, code?: number): TelemetryErrorCode {
  const m = message.toLowerCase();
  if (code === 190 || m.includes("token") || m.includes("oauth") || m.includes("expired")) return "META_API_190";
  if (status === 429 || code === 4 || code === 17 || m.includes("rate limit")) return "RATE_LIMIT_429";
  if (status === 403 || code === 10 || code === 200 || m.includes("permission")) return "PERMISSION_DENIED";
  if (m.includes("timeout") || m.includes("abort")) return "AGENT_TIMEOUT";
  return "UNKNOWN_ERROR";
}

/** Kayıtlı son Multi-Agent telemetri raporunu okur. */
export async function getMultiAgentReport(influencerId: string): Promise<MultiAgentDailyReport | null> {
  const row = await prisma.configValue.findUnique({ where: { key: reportConfigKey(influencerId) }, select: { value: true } });
  if (!row?.value) return null;
  const val = row.value as Partial<MultiAgentDailyReport>;
  if (!val.telemetry) return null;
  return val as MultiAgentDailyReport;
}

/**
 * 1. VERİ ÇEKME VE GÜNLÜK SENKRONİZASYON PROTOKOLÜ (Yalnız gerçek Meta Graph API & DB verisi).
 */
export async function ingestMetaAccountSnapshot(influencerId: string): Promise<IngestedAccountData | null> {
  const start = Date.now();
  const inf = await prisma.influencer.findUnique({
    where: { id: influencerId },
    include: {
      user: { select: { id: true, status: true } },
      socialAccounts: {
        orderBy: { followers: "desc" },
        include: { snapshots: { orderBy: { takenAt: "desc" }, take: 2 } },
      },
    },
  });
  if (!inf) return null;

  const igAcc = inf.socialAccounts.find((a) => a.platform === "INSTAGRAM") ?? inf.socialAccounts[0];
  const handle = (igAcc?.handle ?? inf.name.toLowerCase().replace(/\s+/g, "")).replace(/^@/, "");

  const igUser = envStr("IG_BUSINESS_ACCOUNT_ID", "") || envStr("INSTAGRAM_IG_USER_ID", "");
  const token =
    envStr("IG_GRAPH_TOKEN", "") ||
    envStr("INSTAGRAM_ACCESS_TOKEN", "") ||
    envStr("META_IG_TOKEN", "") ||
    envStr("META_SYSTEM_USER_TOKEN", "");

  let apiConnected = false;
  let apiErrorCode: TelemetryErrorCode | null = null;
  let apiMessage = "Meta Graph API kimlik bilgileri yapılandırılmadı.";
  let followers = igAcc?.followers ?? 0;
  let followsCount = 0;
  let mediaCount = igAcc?.postsCount ?? 0;
  const posts: IngestedMediaItem[] = [];
  const reels: IngestedMediaItem[] = [];
  const comments: IngestedComment[] = [];

  if (!igUser || !token) {
    apiErrorCode = "NOT_CONFIGURED";
  } else if (handle) {
    try {
      const fields = `business_discovery.username(${encodeURIComponent(handle)}){id,followers_count,follows_count,media_count,profile_picture_url,media.limit(20){id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,comments.limit(20){id,text,username,timestamp}}}`;
      const url = `https://graph.facebook.com/v24.0/${igUser}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
        business_discovery?: {
          id?: string;
          followers_count?: number;
          follows_count?: number;
          media_count?: number;
          media?: {
            data?: {
              id: string;
              caption?: string;
              media_type?: string;
              media_product_type?: string;
              timestamp?: string;
              permalink?: string;
              like_count?: number;
              comments_count?: number;
              comments?: { data?: { id: string; text?: string; username?: string; timestamp?: string }[] };
            }[];
          };
        };
      };

      if (res.ok && json.business_discovery) {
        const bd = json.business_discovery;
        apiConnected = true;
        apiMessage = `Meta Graph API bağlantısı aktif (@${handle}).`;
        followers = bd.followers_count ?? followers;
        followsCount = bd.follows_count ?? 0;
        mediaCount = bd.media_count ?? mediaCount;

        for (const m of bd.media?.data ?? []) {
          const isReel = m.media_product_type === "REELS" || m.media_type === "VIDEO";
          const mediaType: IngestedMediaItem["mediaType"] = isReel
            ? "REELS"
            : m.media_type === "CAROUSEL_ALBUM"
              ? "CAROUSEL"
              : "POST";
          const itemComments: IngestedComment[] = (m.comments?.data ?? []).map((c) => ({
            id: c.id,
            mediaId: m.id,
            username: c.username ?? "kullanici",
            text: c.text ?? "",
            timestamp: c.timestamp ?? m.timestamp ?? new Date().toISOString(),
          }));
          comments.push(...itemComments);

          const item: IngestedMediaItem = {
            id: m.id,
            mediaType,
            caption: m.caption ?? "",
            permalink: m.permalink ?? `https://www.instagram.com/${handle}`,
            timestamp: m.timestamp ?? new Date().toISOString(),
            likes: m.like_count ?? 0,
            commentsCount: m.comments_count ?? itemComments.length,
            saves: 0,
            shares: 0,
            reach: 0,
            impressions: 0,
            plays: 0,
            comments: itemComments,
          };
          if (mediaType === "REELS") reels.push(item);
          else posts.push(item);
        }
      } else {
        apiMessage = json.error?.message ?? `Meta Graph API yanıt vermedi (HTTP ${res.status}).`;
        apiErrorCode = classifyMetaError(res.status, apiMessage, json.error?.code);
      }
    } catch (e) {
      apiMessage = `Meta Graph API hatası: ${(e as Error).message}`;
      apiErrorCode = classifyMetaError(0, apiMessage);
    }
  }

  const allMedia = [...posts, ...reels];
  const totalInteractions = allMedia.reduce((s, m) => s + m.likes + m.commentsCount + m.saves + m.shares, 0);
  const erPct =
    followers > 0 && allMedia.length > 0
      ? Number((((totalInteractions / allMedia.length) / followers) * 100).toFixed(2))
      : igAcc
        ? Number((Number(igAcc.engagementRate) * 100).toFixed(2))
        : 0;

  const latestSnap = igAcc?.snapshots[0];
  const prevSnap = igAcc?.snapshots[1] ?? latestSnap;
  const prevFollowers = prevSnap ? prevSnap.followers : null;
  const prevErPct = prevSnap ? Number((Number(prevSnap.engagementRate) * 100).toFixed(2)) : null;

  if (apiConnected && igAcc) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const alreadyToday = latestSnap?.takenAt.toISOString().slice(0, 10) === todayKey;
    const avgLikes = allMedia.length ? Math.round(allMedia.reduce((s, m) => s + m.likes, 0) / allMedia.length) : igAcc.avgLikes;
    const avgComments = allMedia.length ? Math.round(allMedia.reduce((s, m) => s + m.commentsCount, 0) / allMedia.length) : igAcc.avgComments;

    await prisma.socialAccount.update({
      where: { id: igAcc.id },
      data: {
        followers,
        postsCount: mediaCount,
        avgLikes,
        avgComments,
        engagementRate: erPct / 100,
        lastSyncedAt: new Date(),
        syncSource: "instagram_business_discovery",
      },
    });
    if (!alreadyToday) {
      await prisma.socialAccountSnapshot.create({
        data: {
          socialAccountId: igAcc.id,
          followers,
          engagementRate: erPct / 100,
          demographics: {},
          takenAt: new Date(),
        },
      });
    }
  }

  return {
    influencerId: inf.id,
    userId: inf.user?.id ?? null,
    accountStatus: inf.user?.status ?? "ACTIVE",
    handle,
    fetchedAt: new Date().toISOString(),
    apiConnected,
    apiErrorCode,
    apiMessage,
    followers,
    prevFollowers,
    followsCount,
    mediaCount,
    erPct,
    prevErPct,
    posts: posts.slice(0, 20),
    reels: reels.slice(0, 20),
    comments,
    followerSample: [],
    durationMs: Date.now() - start,
  };
}

/** Ajan 1: İçerik ve Algoritma Performans Analisti */
export function runContentAndReelsAgent(data: IngestedAccountData): ContentAgentResult {
  const start = Date.now();
  const all = [...data.posts, ...data.reels];
  const scored = all
    .map((m) => ({
      item: m,
      interactions: m.likes + m.commentsCount + m.saves + m.shares,
      topic: m.caption.split(/\n/)[0]?.slice(0, 60).trim() || `${m.mediaType} (${m.id.slice(-6)})`,
    }))
    .sort((a, b) => b.interactions - a.interactions);

  const top3 = scored.slice(0, 3).map((x) => ({
    id: x.item.id,
    mediaType: x.item.mediaType,
    topic: x.topic,
    interactions: x.interactions,
    reason: `${x.item.likes.toLocaleString("tr-TR")} beğeni, ${x.item.commentsCount} yorum`,
  }));
  const bottom3 = scored
    .slice(-3)
    .reverse()
    .map((x) => ({
      id: x.item.id,
      mediaType: x.item.mediaType,
      topic: x.topic,
      interactions: x.interactions,
      reason: `${x.item.likes.toLocaleString("tr-TR")} beğeni, ${x.item.commentsCount} yorum`,
    }));

  const formats = (["REELS", "CAROUSEL", "POST"] as const).map((fmt) => {
    const list = all.filter((m) => m.mediaType === fmt);
    const n = list.length;
    return {
      format: fmt,
      count: n,
      avgLikes: n ? Math.round(list.reduce((s, m) => s + m.likes, 0) / n) : 0,
      avgComments: n ? Math.round(list.reduce((s, m) => s + m.commentsCount, 0) / n) : 0,
      avgSaves: n ? Math.round(list.reduce((s, m) => s + m.saves, 0) / n) : 0,
      avgPlays: n ? Math.round(list.reduce((s, m) => s + m.plays, 0) / n) : 0,
    };
  });

  const totalReelsPlays = data.reels.reduce((s, r) => s + r.plays, 0);
  const totalReelsLikes = data.reels.reduce((s, r) => s + r.likes, 0);
  const totalReelsReach = data.reels.reduce((s, r) => s + r.reach, 0);
  const totalReelsShares = data.reels.reduce((s, r) => s + r.shares, 0);

  const reelsLikeToPlayPct = totalReelsPlays > 0 ? Number(((totalReelsLikes / totalReelsPlays) * 100).toFixed(2)) : 0;
  const reelsViralityPct = totalReelsReach > 0 ? Number(((totalReelsShares / totalReelsReach) * 100).toFixed(2)) : 0;

  let bestHourTr: number | null = null;
  let bestDayTr: string | null = null;
  if (scored.length > 0) {
    const hourBuckets = new Map<number, number[]>();
    const dayBuckets = new Map<number, number[]>();
    for (const s of scored) {
      const d = new Date(s.item.timestamp);
      const trHour = (d.getUTCHours() + 3) % 24;
      const trDay = d.getUTCDay();
      hourBuckets.set(trHour, [...(hourBuckets.get(trHour) ?? []), s.interactions]);
      dayBuckets.set(trDay, [...(dayBuckets.get(trDay) ?? []), s.interactions]);
    }
    let bestHAvg = -1;
    for (const [h, vals] of hourBuckets) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg > bestHAvg) {
        bestHAvg = avg;
        bestHourTr = h;
      }
    }
    let bestDAvg = -1;
    for (const [day, vals] of dayBuckets) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg > bestDAvg) {
        bestDAvg = avg;
        bestDayTr = TR_DAYS[day] ?? null;
      }
    }
  }

  return { top3, bottom3, formatStats: formats, reelsLikeToPlayPct, reelsViralityPct, bestHourTr, bestDayTr, durationMs: Date.now() - start };
}

/** Ajan 2: Yorum ve Duygu Analizi Uzmanı */
export function runSentimentNlpAgent(comments: IngestedComment[]): SentimentAgentResult {
  const start = Date.now();
  const total = comments.length;
  if (total === 0) {
    return { totalComments: 0, positivePct: 0, neutralQuestionPct: 0, negativePct: 0, spamBotPct: 0, topTopics: [], urgentAlerts: [], durationMs: Date.now() - start };
  }

  let pos = 0;
  let neg = 0;
  let intent = 0;
  let spam = 0;
  const wordCounts = new Map<string, number>();
  const urgentAlerts: SentimentAgentResult["urgentAlerts"] = [];

  for (const c of comments) {
    const text = c.text.trim();
    const lower = text.toLocaleLowerCase("tr");
    const hasLink = /https?:\/\/|bit\.ly|t\.me|wa\.me/i.test(lower);
    const lettersOnly = lower.replace(/[^a-zçğıöşü]/g, "");
    const isSpam = hasLink || lettersOnly.length < 2;

    if (isSpam) {
      spam++;
      continue;
    }

    const isNeg = NEGATIVE_WORDS.some((w) => lower.includes(w));
    const isIntent = INTENT_WORDS.some((w) => lower.includes(w)) || lower.includes("?");
    const isPos = POSITIVE_WORDS.some((w) => lower.includes(w));

    if (isNeg) {
      neg++;
      if (urgentAlerts.length < 5) urgentAlerts.push({ username: c.username, text: text.slice(0, 120), kind: "NEGATIVE" });
    } else if (isIntent) {
      intent++;
      if (urgentAlerts.length < 5) urgentAlerts.push({ username: c.username, text: text.slice(0, 120), kind: "PURCHASE_INTENT" });
    } else if (isPos) {
      pos++;
    } else {
      intent++;
    }

    for (const w of lower.split(/[^a-zçğıöşü0-9]+/)) {
      if (w.length >= 4 && !STOP_WORDS.has(w)) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }

  const topTopics = [...wordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);

  return {
    totalComments: total,
    positivePct: Math.round((pos / total) * 100),
    neutralQuestionPct: Math.round((intent / total) * 100),
    negativePct: Math.round((neg / total) * 100),
    spamBotPct: Math.round((spam / total) * 100),
    topTopics,
    urgentAlerts,
    durationMs: Date.now() - start,
  };
}

/** Ajan 3: Kitle Kalitesi ve Bot Tespit Denetçisi */
export function runAudienceBotDetectionAgent(data: IngestedAccountData): BotDetectionAgentResult {
  const start = Date.now();
  const sample = data.followerSample;
  const followerDelta = data.prevFollowers !== null ? data.followers - data.prevFollowers : 0;
  const spikeAnomaly = data.prevFollowers && data.prevFollowers > 100 ? followerDelta / data.prevFollowers > 0.15 : false;

  if (sample.length === 0) {
    return {
      sampleSize: 0,
      organicFollowerPct: 0,
      suspiciousBotPct: 0,
      anomalyDetected: spikeAnomaly,
      flaggedReasons: spikeAnomaly ? ["Günlük takipçi artışında %15 üzeri ani sıçrama tespit edildi"] : [],
      durationMs: Date.now() - start,
    };
  }

  let suspicious = 0;
  let noPic = 0;
  let randomDigits = 0;
  let followRatio = 0;
  let ghost = 0;

  for (const p of sample) {
    let score = 0;
    if (!p.hasProfilePic) {
      score++;
      noPic++;
    }
    if (/[a-z_]+\d{4,}$/i.test(p.username)) {
      score++;
      randomDigits++;
    }
    if (p.following > 2000 && p.followers < 50) {
      score++;
      followRatio++;
    }
    if (p.postsCount === 0 || (p.lastPostDaysAgo !== null && p.lastPostDaysAgo > 365)) {
      score++;
      ghost++;
    }
    if (score >= 2) suspicious++;
  }

  const botPct = Math.round((suspicious / sample.length) * 100);
  const flaggedReasons: string[] = [];
  if (noPic) flaggedReasons.push(`${noPic} hesapta profil fotoğrafı yok`);
  if (randomDigits) flaggedReasons.push(`${randomDigits} hesapta rastgele sayı dizili kullanıcı adı`);
  if (followRatio) flaggedReasons.push(`${followRatio} hesapta yüksek takip / düşük takipçi oranı (>2000 / <50)`);
  if (ghost) flaggedReasons.push(`${ghost} hayalet/inaktif hesap (0 gönderi veya >1 yıl pasif)`);
  if (spikeAnomaly) flaggedReasons.push("Günlük takipçi artışında %15 üzeri ani sıçrama tespit edildi");

  return {
    sampleSize: sample.length,
    organicFollowerPct: 100 - botPct,
    suspiciousBotPct: botPct,
    anomalyDetected: spikeAnomaly || botPct >= 25,
    flaggedReasons,
    durationMs: Date.now() - start,
  };
}

/** Ajan 4: Baş Stratejist ve Raporlama Lideri */
export async function runLeadGrowthStrategistAgent(params: {
  data: IngestedAccountData;
  content: ContentAgentResult;
  sentiment: SentimentAgentResult;
  bot: BotDetectionAgentResult;
}): Promise<{ actionPlan: string[]; rootCauseNotes: string[]; markdownReport: string }> {
  const { data, content, sentiment, bot } = params;
  const dateStr = data.fetchedAt.slice(0, 10);
  const followerDelta = data.prevFollowers !== null ? data.followers - data.prevFollowers : 0;
  const followerDeltaPct =
    data.prevFollowers && data.prevFollowers > 0 ? Number(((followerDelta / data.prevFollowers) * 100).toFixed(2)) : 0;
  const erDelta = data.prevErPct !== null ? Number((data.erPct - data.prevErPct).toFixed(2)) : 0;

  const rootCauseNotes: string[] = [];
  if (data.prevFollowers !== null && followerDelta < 0) {
    rootCauseNotes.push(`Takipçi sayısında günlük ${followerDelta} düşüş gözlendi; düşük etkileşimli içerik sıklığı incelenmeli.`);
  }
  if (data.prevErPct !== null && erDelta < 0) {
    rootCauseNotes.push(`Etkileşim oranı bir önceki güne göre %${Math.abs(erDelta)} geriledi.`);
  }

  const actionPlan: string[] = [];
  if (content.top3.length > 0) {
    const best = content.top3[0]!;
    actionPlan.push(`En yüksek etkileşim alan ${best.mediaType} formatına (${best.topic}) odaklanarak benzer kanca (hook) kurgusuyla yeni içerik üretin.`);
  }
  if (sentiment.urgentAlerts.length > 0) {
    actionPlan.push(`${sentiment.urgentAlerts.length} adet kritik/satın alma niyetli yoruma öncelikli yanıt verin.`);
  }
  if (content.bestHourTr !== null && content.bestDayTr) {
    actionPlan.push(`Geçmiş verilere göre en yüksek etkileşim ${content.bestDayTr} günleri saat ${String(content.bestHourTr).padStart(2, "0")}:00 civarında yakalanıyor.`);
  }

  if (envStr("LLM_PROVIDER", "mock") === "bedrock" && (data.posts.length > 0 || data.reels.length > 0)) {
    try {
      const out = await converseChat({
        system: "Sen Kıdemli Sosyal Medya Veri Bilimcisi ve Büyüme Stratejistisin. Yalnızca verilen gerçek metriklerden yola çıkarak 3 kısa Türkçe aksiyon maddesi üret.",
        turns: [
          {
            role: "user",
            text: `Hesap: @${data.handle}, Takipçi: ${data.followers}, ER: %${data.erPct}, Post: ${data.posts.length}, Reels: ${data.reels.length}, Yorum: ${sentiment.totalComments}, Pozitif: %${sentiment.positivePct}, Negatif: %${sentiment.negativePct}`,
          },
        ],
        maxTokens: 250,
        temperature: 0.2,
      });
      const lines = out.text.split("\n").map((l) => l.replace(/^[\d.\-*•\s]+/, "").trim()).filter((l) => l.length > 10).slice(0, 3);
      if (lines.length) actionPlan.splice(0, actionPlan.length, ...lines);
    } catch {
      /* deterministik gerçek veri önerileri korunur */
    }
  }

  const hasData = data.followers > 0 || data.posts.length > 0 || data.reels.length > 0;
  const markdownReport = !hasData
    ? [
        `## 📊 Günlük Hesap Özeti & KPI Değişimi (${dateStr})`,
        `* **Durum:** @${data.handle} için henüz Meta Graph API üzerinden çekilmiş gerçek veri bulunmuyor (${data.apiMessage}).`,
      ].join("\n")
    : [
        `## 📊 Günlük Hesap Özeti & KPI Değişimi (${dateStr})`,
        `* **Toplam Takipçi:** ${data.followers.toLocaleString("tr-TR")} (${followerDelta >= 0 ? "+" : ""}${followerDelta}, %${followerDeltaPct})`,
        `* **Ortalama Etkileşim Oranı (ER):** %${data.erPct} (${erDelta >= 0 ? "+" : ""}${erDelta} puan)`,
        `* **Kitle Sağlık Skoru:** ${bot.sampleSize > 0 ? `%${bot.organicFollowerPct} Organik | %${bot.suspiciousBotPct} Şüpheli/Bot` : "Takipçi örneklemi henüz çekilmedi"}`,
        "",
        `## 🎬 Son 20 Post & Reels Performans Analizi`,
        `* **En İyi Performans Gösteren İçerikler:** ${content.top3.length ? content.top3.map((x) => `${x.topic} (${x.reason})`).join(" · ") : "Henüz medya verisi yok"}`,
        `* **Reels Tutundurma & Viralite Özeti:** ${data.reels.length} Reels · Beğeni/İzlenme: %${content.reelsLikeToPlayPct} · Viralite: %${content.reelsViralityPct}`,
        `* **Dikkat Çeken Düşüşler:** ${content.bottom3.length ? content.bottom3.map((x) => `${x.topic} (${x.reason})`).join(" · ") : "Kayıt yok"}`,
        "",
        `## 💬 Yorum & Duygu Analizi (Sentiment)`,
        `* **Duygu Dağılımı (${sentiment.totalComments} yorum):** 🟢 Pozitif: %${sentiment.positivePct} | 🟡 Nötr/Soru: %${sentiment.neutralQuestionPct} | 🔴 Negatif: %${sentiment.negativePct} | 🤖 Spam: %${sentiment.spamBotPct}`,
        `* **Öne Çıkan Konular & Talepler:** ${sentiment.topTopics.length ? sentiment.topTopics.join(", ") : "Yorum verisi yok"}`,
        `* **Yanıt Bekleyen Kritik Yorumlar:** ${sentiment.urgentAlerts.length ? sentiment.urgentAlerts.map((a) => `@${a.username}: "${a.text}"`).join(" | ") : "Kritik uyarı yok"}`,
        "",
        `## 🛡️ Bot & Kitle Denetimi Bulguları`,
        `* ${bot.sampleSize > 0 ? (bot.flaggedReasons.length ? bot.flaggedReasons.join(" · ") : "Şüpheli bot anomalisi tespit edilmedi.") : "Takipçi örneklemi henüz mevcut değil."}`,
        "",
        `## 🚀 Stratejik Aksiyon Önerileri (Yarın İçin Plan)`,
        ...(actionPlan.length ? actionPlan.map((a, i) => `${i + 1}. ${a}`) : ["1. Meta Graph API bağlantısı tamamlandığında günlük aksiyon önerileri üretilecektir."]),
      ].join("\n");

  return { actionPlan, rootCauseNotes, markdownReport };
}

/** Tek bir influencer için 4 aşamalı Multi-Agent veri bilimi & Admin Telemetry raporunu çalıştırır. */
export async function runMultiAgentSocialPipeline(
  influencerId: string,
  opts: { mode?: "ONBOARDING_QUICK_SCAN" | "DAILY_WORKER" } = {},
): Promise<MultiAgentDailyReport | null> {
  const mode = opts.mode ?? "DAILY_WORKER";
  const prevReport = await getMultiAgentReport(influencerId).catch(() => null);
  const data = await ingestMetaAccountSnapshot(influencerId);
  if (!data) return null;

  const contentAgent = runContentAndReelsAgent(data);
  const sentimentAgent = runSentimentNlpAgent(data.comments);
  const botAgent = runAudienceBotDetectionAgent(data);
  const strategist = await runLeadGrowthStrategistAgent({
    data,
    content: contentAgent,
    sentiment: sentimentAgent,
    bot: botAgent,
  });

  // 24 saatlik deltalar (önceki rapora ve medya zaman damgasına göre)
  const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const allMedia = [...data.posts, ...data.reels];
  const newPosts24h = allMedia.filter((m) => new Date(m.timestamp).getTime() >= dayAgoMs).length;
  const prevLikesSum = prevReport ? [...prevReport.ingestion.posts, ...prevReport.ingestion.reels].reduce((s, m) => s + m.likes, 0) : 0;
  const prevCommentsSum = prevReport ? [...prevReport.ingestion.posts, ...prevReport.ingestion.reels].reduce((s, m) => s + m.commentsCount, 0) : 0;
  const prevPlaysSum = prevReport ? prevReport.ingestion.reels.reduce((s, m) => s + m.plays, 0) : 0;

  const curLikesSum = allMedia.reduce((s, m) => s + m.likes, 0);
  const curCommentsSum = allMedia.reduce((s, m) => s + m.commentsCount, 0);
  const curPlaysSum = data.reels.reduce((s, m) => s + m.plays, 0);

  const followerDelta = data.prevFollowers !== null ? data.followers - data.prevFollowers : 0;
  const prevRetry = prevReport?.telemetry.admin_telemetry.errors[0]?.retry_count ?? 0;

  const errors: TelemetryErrorEntry[] = [];
  if (data.apiErrorCode) {
    errors.push({
      error_code: data.apiErrorCode,
      failed_step: "Meta Graph API Data Ingestion",
      message: data.apiMessage,
      retry_count: prevRetry + 1,
      next_retry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  }

  const agentsExecuted: AgentExecutionEntry[] = [
    {
      agent: "DataIngestionWorker",
      status: data.apiConnected ? "SUCCESS" : "FAILED",
      items_scanned: allMedia.length,
      duration_ms: data.durationMs,
      summary: data.apiConnected ? `Tarandı (${allMedia.length} Medya)` : data.apiMessage,
    },
    {
      agent: "ContentReelsAgent",
      status: "SUCCESS",
      items_scanned: allMedia.length,
      duration_ms: contentAgent.durationMs,
      summary: `Tarandı (${data.posts.length} Post, ${data.reels.length} Reels)`,
    },
    {
      agent: "SentimentNLPAgent",
      status: "SUCCESS",
      items_scanned: sentimentAgent.totalComments,
      duration_ms: sentimentAgent.durationMs,
      summary: `Tarandı (${sentimentAgent.totalComments} Yorum)`,
    },
    {
      agent: "BotDetectorAgent",
      status: "SUCCESS",
      items_scanned: botAgent.sampleSize,
      duration_ms: botAgent.durationMs,
      summary: botAgent.sampleSize > 0 ? `Tarandı (${botAgent.sampleSize} Profil) - %${botAgent.organicFollowerPct} Organik` : "Takipçi örneklemi bekleniyor",
    },
  ];

  const hasData = data.followers > 0 || allMedia.length > 0;
  const topMedia = contentAgent.top3[0];
  const dailySyncStatus: StandardizedTelemetryJson["user_profile"]["daily_sync_status"] =
    data.apiErrorCode === "META_API_190"
      ? "TOKEN_EXPIRED"
      : data.apiErrorCode && data.apiErrorCode !== "NOT_CONFIGURED"
        ? "ERROR"
        : data.apiConnected
          ? "ACTIVE"
          : "PAUSED";

  const telemetry: StandardizedTelemetryJson = {
    user_profile: {
      user_id: data.userId ?? data.influencerId,
      username: `@${data.handle}`,
      account_status: data.accountStatus,
      onboarding_completed: prevReport?.telemetry.user_profile.onboarding_completed || data.apiConnected || mode === "ONBOARDING_QUICK_SCAN",
      onboarding_scan_status: data.apiConnected ? "COMPLETED" : "FAILED",
      daily_sync_status: dailySyncStatus,
      last_sync_timestamp: data.apiConnected ? data.fetchedAt : (prevReport?.telemetry.user_profile.last_sync_timestamp ?? null),
    },
    daily_metrics: {
      followers_total: data.followers,
      followers_daily_change: `${followerDelta >= 0 ? "+" : ""}${followerDelta}`,
      new_posts_count_24h: newPosts24h,
      new_likes_24h: prevReport ? Math.max(0, curLikesSum - prevLikesSum) : 0,
      new_comments_24h: prevReport ? Math.max(0, curCommentsSum - prevCommentsSum) : 0,
      new_reels_plays_24h: prevReport ? Math.max(0, curPlaysSum - prevPlaysSum) : 0,
      engagement_rate_percent: data.erPct,
    },
    agent_analysis: {
      quick_summary:
        strategist.actionPlan[0] ??
        (hasData
          ? `@${data.handle} için ${allMedia.length} içerik ve ${sentimentAgent.totalComments} yorum analiz edildi.`
          : "Meta Graph API bağlantısı bekleniyor; henüz gerçek veri yok."),
      audience_health: {
        organic_percent: botAgent.organicFollowerPct,
        bot_suspicious_percent: botAgent.suspiciousBotPct,
        anomaly_detected: botAgent.anomalyDetected,
      },
      sentiment_breakdown: {
        positive_percent: sentimentAgent.positivePct,
        neutral_question_percent: sentimentAgent.neutralQuestionPct,
        negative_percent: sentimentAgent.negativePct,
        spam_bot_comments_percent: sentimentAgent.spamBotPct,
        urgent_action_comments: sentimentAgent.urgentAlerts.map((a) => ({
          username: `@${a.username.replace(/^@/, "")}`,
          comment: a.text,
          intent: a.kind,
        })),
      },
      top_performing_recent_media: topMedia
        ? {
            media_id: topMedia.id,
            type: topMedia.mediaType,
            reason: topMedia.reason,
          }
        : null,
    },
    admin_telemetry: {
      agents_executed: agentsExecuted,
      errors,
    },
  };

  const report: MultiAgentDailyReport = {
    influencerId: data.influencerId,
    handle: data.handle,
    generatedAt: data.fetchedAt,
    mode,
    dataAvailable: hasData,
    ingestion: data,
    contentAgent,
    sentimentAgent,
    botAgent,
    actionPlan: strategist.actionPlan,
    rootCauseNotes: strategist.rootCauseNotes,
    markdownReport: strategist.markdownReport,
    telemetry,
  };

  await prisma.configValue.upsert({
    where: { key: reportConfigKey(influencerId) },
    create: { key: reportConfigKey(influencerId), value: report as never, verified: data.apiConnected, note: `Multi-Agent Telemetri (@${data.handle})` },
    update: { value: report as never, verified: data.apiConnected },
  });

  return report;
}

/** Faz 1: Kullanıcı kabulünde / onayında sıfırıncı gün (T-0) hızlı ön analiz pipeline'ı. */
export async function runOnboardingQuickScan(influencerId: string): Promise<MultiAgentDailyReport | null> {
  return runMultiAgentSocialPipeline(influencerId, { mode: "ONBOARDING_QUICK_SCAN" });
}

/** Faz 2: Zamanlayıcı (Cron) için tüm aktif influencer'larda günlük Multi-Agent pipeline'ını çalıştırır. */
export async function runMultiAgentSocialPipelineAll(limit = 50): Promise<{ processed: number; withData: number }> {
  const list = await prisma.influencer.findMany({
    where: { user: { status: "ACTIVE" } },
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  let processed = 0;
  let withData = 0;
  for (const inf of list) {
    const r = await runMultiAgentSocialPipeline(inf.id, { mode: "DAILY_WORKER" });
    if (r) {
      processed++;
      if (r.dataAvailable) withData++;
    }
  }
  return { processed, withData };
}
