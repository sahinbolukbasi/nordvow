import { getTT } from "@/lib/i18n/tt-server";
import type { ReactNode } from "react";
import Link from "next/link";
import { prisma, type Platform } from "@infulancer/core/db";
import { categoryLabel } from "@infulancer/core/domain/categories";
import { evaluate23ACompliance } from "@infulancer/core/domain/compliance-23a";
import { contentTypeLabels, formatKurus, platformLabels } from "@infulancer/core/domain/labels";
import { runInstagramExplorerForInfluencer } from "@infulancer/core/social/explorer";
import { computeInfluencerNordvowScore } from "@infulancer/core/scoring/engine";
import { InfluencerAnalyticsDeck } from "@/components/showcase/influencer-analytics-deck";
import { CreatorProfileTabs } from "@/components/showcase/creator-profile-tabs";
import { NordvowScorePanel } from "@/components/scoring/nordvow-score-panel";
import { BrandBadge, type BrandLogoName } from "@/components/icons/brand-logos";
import { ExternalIcon } from "@/components/icons";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar, pickAvatar } from "@/components/ui/avatar";
import { GuvenRozeti, KaynakRozeti, Uyumluluk23ARozeti } from "@/components/ui/trust-badges";
import { compact, fmtPctValue } from "@/lib/format";
import { fmtDate } from "@/lib/time";

const PUBLISHED = ["YAYINLANDI", "METRIK_BEKLIYOR", "TAMAMLANDI"] as const;
const LOGO: Record<Platform, BrandLogoName> = { INSTAGRAM: "instagram", TIKTOK: "tiktok", YOUTUBE: "youtube" };

export function profileLink(platform: Platform, handle: string, profileUrl?: string | null): string {
  if (profileUrl && /^https:\/\//.test(profileUrl)) return profileUrl;
  const h = handle.replace(/^@/, "");
  return platform === "INSTAGRAM"
    ? `https://www.instagram.com/${h}`
    : platform === "TIKTOK"
      ? `https://www.tiktok.com/@${h}`
      : `https://www.youtube.com/@${h}`;
}

function isMeaningfulBio(bio?: string | null): boolean {
  if (!bio) return false;
  const cleaned = bio.replace(/[.…\s\-_]+/g, "").trim();
  return cleaned.length >= 3;
}

/**
 * İçerik üreticisinin vitrini: markalar (Influencer bul → profil) ve üreticinin kendi önizlemesi aynı görünümü kullanır.
 * Above the fold 5 ana sayı + uyum nedeni + 4–6 içerik thumbnail; derinlik sekmelerde.
 */
export async function CreatorShowcase({
  influencerId,
  actions,
  isAdmin = false,
  view,
}: {
  influencerId: string;
  actions?: ReactNode;
  isAdmin?: boolean;
  view?: "brand" | "influencer" | "admin";
}) {
  const tt = await getTT();
  const inf = await prisma.influencer.findUnique({
    where: { id: influencerId },
    select: {
      id: true,
      name: true,
      city: true,
      bio: true,
      headline: true,
      category: true,
      showPrices: true,
      showCollaborations: true,
      avatarKey: true,
      categories: { include: { category: { include: { parent: { select: { name: true } } } } }, orderBy: { primary: "desc" } },
      socialAccounts: {
        orderBy: { followers: "desc" },
        select: {
          platform: true,
          handle: true,
          followers: true,
          engagementRate: true,
          avatarUrl: true,
          profileUrl: true,
          postsCount: true,
          avgLikes: true,
          avgComments: true,
          avgViews: true,
          verified: true,
          lastSyncedAt: true,
          syncSource: true,
        },
      },
    },
  });
  if (!inf) return null;
  const showPricesEffective = inf.showPrices || isAdmin;
  const showCollabsEffective = inf.showCollaborations || isAdmin;
  const [rates, portfolio, collabs, explorerReport, tikTokAccount, nordvowScore] = await Promise.all([
    showPricesEffective
      ? prisma.rateCard.findMany({ where: { influencerId, active: true }, orderBy: [{ platform: "asc" }, { priceKurus: "asc" }] })
      : Promise.resolve([]),
    prisma.portfolioItem.findMany({ where: { influencerId }, orderBy: [{ sort: "asc" }, { createdAt: "desc" }], take: 24 }),
    showCollabsEffective
      ? prisma.assignment.findMany({
          where: { influencerId, contractStatus: "KABUL" },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            feeKurus: true,
            campaign: { select: { name: true, startsAt: true, endsAt: true, brand: { select: { name: true } } } },
            deliverables: { where: { status: { in: [...PUBLISHED] } }, select: { platform: true, contentType: true, postUrl: true } },
          },
        })
      : Promise.resolve([]),
    runInstagramExplorerForInfluencer(influencerId, { triggeredBy: isAdmin ? "admin" : "brand" }),
    prisma.tikTokAccount.findFirst({
      where: { influencerId, status: "active" },
      select: {
        username: true,
        displayName: true,
        bio: true,
        followerCount: true,
        followingCount: true,
        likesCount: true,
        videoCount: true,
        lastSyncedAt: true,
        videos: {
          orderBy: { createTime: "desc" },
          take: 50,
          select: {
            id: true,
            title: true,
            videoDescription: true,
            createTime: true,
            coverImageUrl: true,
            shareUrl: true,
            viewCount: true,
            likeCount: true,
            commentCount: true,
            shareCount: true,
          },
        },
      },
    }),
    computeInfluencerNordvowScore(influencerId).catch(() => null),
  ]);

  const resolvedView = view ?? (isAdmin ? "admin" : "brand");
  const totalFollowers = inf.socialAccounts.reduce((s, a) => s + a.followers, 0) || (explorerReport?.followers ?? 0);
  const primaryAcc = inf.socialAccounts[0];

  // Tek kaynaklı ER (her yerde aynı değer ve TR virgül biçimi)
  const unifiedErText = explorerReport
    ? fmtPctValue(explorerReport.avgErPct)
    : primaryAcc && Number(primaryAcc.engagementRate) > 0
      ? fmtPctValue(Number(primaryAcc.engagementRate) * 100)
      : "—";

  // Kitle güveni
  const authScore = explorerReport?.sentiment.authenticityScore ?? 0;
  const authTrustLevel: "YUKSEK" | "ORTA" | "DUSUK" | null =
    authScore > 0 ? (authScore >= 80 ? "YUKSEK" : authScore >= 60 ? "ORTA" : "DUSUK") : null;

  // Fiyat aralığı (asla ₺0 yazma; beyan yoksa açık mesaj)
  const positiveRates = rates.filter((r) => r.priceKurus > 0);
  const minRate = positiveRates.length ? Math.min(...positiveRates.map((r) => r.priceKurus)) : null;
  const maxRate = positiveRates.length ? Math.max(...positiveRates.map((r) => r.priceKurus)) : null;

  // Ort. izlenme (ölçülmediyse "Hesap bağlanınca görünür", asla 0 yazılmaz)
  const avgViewsVal =
    (explorerReport?.avgReelsViews ?? 0) > 0
      ? explorerReport!.avgReelsViews
      : (primaryAcc?.avgViews ?? 0) > 0
        ? primaryAcc!.avgViews!
        : 0;

  // Uyum skoru güven durumu
  const isPreliminaryScore = Boolean(nordvowScore?.isEstimated || (nordvowScore && nordvowScore.confidence === "DUSUK"));
  const whyReasons: string[] = [];
  if (authScore > 0) {
    whyReasons.push(`${tt("Kitle sinyali:")} %${authScore} ${tt("gerçek kitle")}`);
  } else {
    whyReasons.push(tt("Kitle güveni henüz hesaplanamadı"));
  }
  if (unifiedErText !== "—") {
    whyReasons.push(`${tt("Etkileşim oranı:")} ${unifiedErText} (${tt("takipçi paydalı")})`);
  }
  if (collabs.length === 0 && (explorerReport?.brandCollaborations.length ?? 0) === 0) {
    whyReasons.push(tt("Platformda iş birliği yok — ticari skor üretilmedi"));
  } else {
    whyReasons.push(`${Math.max(collabs.length, explorerReport?.brandCollaborations.length ?? 0)} ${tt("iş birliği kaydı")}`);
  }

  const rawBio = inf.bio || explorerReport?.biography;
  const displayBio = isMeaningfulBio(rawBio) ? rawBio : null;
  const showcaseAvatar =
    pickAvatar(inf.socialAccounts, inf.avatarKey) ??
    (explorerReport?.avatarUrl && /^https?:\/\//.test(explorerReport.avatarUrl) ? explorerReport.avatarUrl : null);

  const previewMedia = explorerReport?.recentMedia.slice(0, 6) ?? [];

  // 23/A Uyum kontrolü geçmiş yayınlardan
  const complianceChecks = (explorerReport?.recentMedia ?? [])
    .filter((m) => m.isSponsored || /reklam|tanıtım|işbirliği|isbirligi|#/i.test(m.caption))
    .slice(0, 12)
    .map((m) => ({
      id: m.id,
      caption: m.caption,
      publishedAt: m.publishedAt,
      permalink: m.permalink,
      result: evaluate23ACompliance({ caption: m.caption, isPublished: true }),
    }));

  const kitleTab = (
    <div className="flex flex-col gap-6">
      {explorerReport ? <InfluencerAnalyticsDeck report={explorerReport} isAdmin={isAdmin} /> : null}

      <section aria-labelledby="sc-social" className="flex flex-col gap-3">
        <h2 id="sc-social" className="text-section">
          {tt("Sosyal medya hesapları")}
        </h2>
        {inf.socialAccounts.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Bağlı hesap yok.")}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {inf.socialAccounts.map((a) => (
              <li key={a.platform} className="flex flex-col gap-3 rounded-3xl border border-line bg-glass p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <BrandBadge name={LOGO[a.platform]} size={40} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">@{a.handle.replace(/^@/, "")}</span>
                      <span className="text-[12px] text-fg-muted">
                        {platformLabels[a.platform]}
                        {a.verified ? tt(" · doğrulanmış") : ""}
                      </span>
                    </div>
                  </div>
                  <KaynakRozeti source="API" />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                  <div>
                    <dt className="text-fg-passive">{tt("Takipçi")}</dt>
                    <dd className="text-base font-semibold tabular-nums">{compact.format(a.followers)}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-passive">{tt("Etkileşim")}</dt>
                    <dd className="text-base font-semibold tabular-nums">
                      {a.platform === "INSTAGRAM" && explorerReport
                        ? unifiedErText
                        : fmtPctValue(Number(a.engagementRate) * 100)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-passive">{a.avgViews ? tt("Ort. izlenme") : tt("Ort. beğeni")}</dt>
                    <dd className="text-base font-semibold tabular-nums">
                      {a.avgViews ? compact.format(a.avgViews) : a.avgLikes ? compact.format(a.avgLikes) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-passive">{a.avgComments ? tt("Ort. yorum") : tt("Gönderi")}</dt>
                    <dd className="text-base font-semibold tabular-nums">
                      {a.avgComments ? compact.format(a.avgComments) : a.postsCount ? compact.format(a.postsCount) : "—"}
                    </dd>
                  </div>
                </dl>
                <a
                  href={profileLink(a.platform, a.handle, a.profileUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[13px] font-medium transition-standard hover:border-neon-pink hover:text-neon-pink"
                >
                  {platformLabels[a.platform]}
                  {tt("'da aç")} <ExternalIcon size={13} />
                </a>
                {a.lastSyncedAt ? (
                  <span className="text-[11px] text-fg-passive">
                    {tt("Profil istatistikleri")} {fmtDate(a.lastSyncedAt)} {tt("tarihinde API ile güncellendi (yorum metinleri için OAuth gerekir)")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const performansTab = (
    <div className="flex flex-col gap-6">
      {nordvowScore ? (
        <NordvowScorePanel report={nordvowScore} view={resolvedView} />
      ) : (
        <p className="text-sm text-fg-passive">{tt("Performans skoru henüz hesaplanamadı.")}</p>
      )}
    </div>
  );

  const iceriklerTab = (
    <div className="flex flex-col gap-6">
      {tikTokAccount ? (
        <section aria-labelledby="sc-tiktok" className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="sc-tiktok" className="text-section">
                {tt("TikTok Performans ve Videolar")} {tikTokAccount.username ? `(@${tikTokAccount.username.replace(/^@/, "")})` : ""}
              </h2>
              {isMeaningfulBio(tikTokAccount.bio) ? (
                <p className="mt-0.5 text-[13px] text-fg-muted">{tikTokAccount.bio}</p>
              ) : null}
            </div>
            {tikTokAccount.lastSyncedAt ? (
              <span className="text-[11px] text-fg-passive">
                {tt("Son TikTok senkronu:")} {fmtDate(tikTokAccount.lastSyncedAt)}
              </span>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [tt("TikTok Takipçi"), compact.format(tikTokAccount.followerCount)],
              [tt("Takip Edilen"), compact.format(tikTokAccount.followingCount)],
              [tt("Toplam Beğeni"), compact.format(tikTokAccount.likesCount)],
              [tt("Video Sayısı"), compact.format(tikTokAccount.videoCount)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-bg/40 p-3">
                <dt className="text-[12px] text-fg-muted">{k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {tikTokAccount.videos.length > 0 ? (
            <div className="max-h-[480px] overflow-auto rounded-2xl border border-line">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-left text-[12px] text-fg-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{tt("Video")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("İzlenme")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Beğeni")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Yorum")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Paylaşım")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {tikTokAccount.videos.map((v) => (
                    <tr key={v.id} className="align-top">
                      <td className="max-w-sm px-4 py-2.5">
                        <div className="flex items-start gap-2.5">
                          {v.coverImageUrl ? (
                            <img src={v.coverImageUrl} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-md border border-line object-cover" />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[12px] text-fg">{v.title || v.videoDescription || "TikTok Videosu"}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-passive">
                              <span>{fmtDate(v.createTime)}</span>
                              {v.shareUrl ? (
                                <a href={v.shareUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-fg-muted underline hover:text-fg">
                                  TikTok <ExternalIcon size={10} />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums">{v.viewCount > 0 ? compact.format(v.viewCount) : "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{compact.format(v.likeCount)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{compact.format(v.commentCount)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{compact.format(v.shareCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="sc-portfolio" className="flex flex-col gap-3">
        <h2 id="sc-portfolio" className="text-section">
          {tt("Öne çıkan işler")}
        </h2>
        {portfolio.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Henüz öne çıkarılan iş yok.")}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {portfolio.map((p) => (
              <li key={p.id}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full flex-col gap-2 rounded-3xl border border-line bg-glass p-4 transition-standard hover:-translate-y-0.5 hover:border-neon-pink/60"
                >
                  <span className="flex items-center gap-2 text-[12px] text-fg-muted">
                    <BrandBadge name={LOGO[p.platform]} size={24} />
                    {platformLabels[p.platform]}
                    {p.brandName ? ` · ${p.brandName}` : ""}
                  </span>
                  <span className="font-medium group-hover:text-neon-pink">{p.title}</span>
                  {p.note ? <span className="text-[13px] text-fg-muted">{p.note}</span> : null}
                  <span className="mt-auto inline-flex items-center gap-1 text-[12px] text-fg-muted">
                    {tt("İçeriği aç")} <ExternalIcon size={12} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const markalarTab = (
    <div className="flex flex-col gap-6">
      {showPricesEffective ? (
        <section aria-labelledby="sc-rates" className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 id="sc-rates" className="text-section">
              {tt("İçerik ücretleri")}
            </h2>
            <KaynakRozeti source="BEYAN" />
          </div>
          {rates.length === 0 ? (
            <p className="text-sm text-fg-passive">{tt("Üretici fiyatı yok; teklif gönderilebilir.")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {rates.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 rounded-2xl border border-line bg-glass p-4">
                  <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                    <PlatformIcon platform={r.platform} size={12} /> {platformLabels[r.platform]} {contentTypeLabels[r.contentType]}
                  </span>
                  <span className="text-xl font-semibold tabular-nums">{formatKurus(r.priceKurus)}</span>
                  {r.note ? <span className="text-[11px] text-fg-passive">{r.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {showCollabsEffective ? (
        <section aria-labelledby="sc-collabs" className="flex flex-col gap-3">
          <h2 id="sc-collabs" className="text-section">
            {tt("Platform içi yer aldığı iş birlikleri")}
          </h2>
          {collabs.length === 0 ? (
            <p className="text-sm text-fg-passive">{tt("Platformda tamamlanmış iş birliği yok.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-3xl border border-line">
              {collabs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{c.campaign.brand.name}</span>
                    <span className="text-[12px] text-fg-muted">
                      {c.campaign.name} · {fmtDate(c.campaign.startsAt)} – {fmtDate(c.campaign.endsAt)}
                    </span>
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{formatKurus(c.feeKurus)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );

  const uyumTab = (
    <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-section">{tt("23/A Reklam İfşası Geçmişi")}</h2>
          <p className="text-[13px] text-fg-muted">
            {tt("Son içeriklerdeki 'Reklam' veya 'Tanıtım' ibaresi uyumu kontrol edilir.")}
          </p>
        </div>
        <KaynakRozeti source="SISTEM" />
      </div>
      {complianceChecks.length === 0 ? (
        <p className="text-sm text-fg-passive">{tt("Son gönderilerde sponsorlu içerik etiketi tespit edilmedi.")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {complianceChecks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 font-medium text-fg">{c.caption}</p>
                <p className="text-xs text-fg-muted">{c.result.reason}</p>
              </div>
              <Uyumluluk23ARozeti status={c.result.status} reason={c.result.reason} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ABOVE THE FOLD: Karar Ekranı */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-glass p-6">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-neon-pink/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-5">
          <Avatar name={inf.name} src={showcaseAvatar} size={88} className="ring-2 ring-neon-pink/60" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{inf.name}</h1>
              {explorerReport ? (
                <span
                  className={
                    isPreliminaryScore
                      ? "rounded-full border border-border bg-surface-muted px-3 py-0.5 text-[12px] font-medium text-fg-muted"
                      : "rounded-full bg-fg px-3 py-0.5 text-[12px] font-semibold text-bg"
                  }
                >
                  {isPreliminaryScore
                    ? `${tt("Ön Değerlendirme:")} ${explorerReport.scores.overallScore}/100 · ${explorerReport.scores.priorityTier}`
                    : `${tt("Uyum:")} ${explorerReport.scores.overallScore}/100 · ${explorerReport.scores.priorityTier}`}
                </span>
              ) : null}
            </div>
            <p className="text-[13px] text-fg-muted">
              {primaryAcc ? `@${primaryAcc.handle.replace(/^@/, "")} · ` : ""}
              {inf.categories[0] ? categoryLabel(inf.categories[0].category) : inf.category}
              {inf.city ? ` · ${inf.city}` : ""}
            </p>
            {displayBio ? (
              <p className="mt-1 max-w-3xl text-sm leading-relaxed whitespace-pre-line text-fg-muted">{displayBio}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>

        {/* 5 Ana Sayı (Sabit Sıra) */}
        <dl className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* 1. Takipçi */}
          <div className="rounded-2xl border border-line bg-bg/40 p-3.5">
            <div className="flex items-center justify-between gap-1">
              <dt className="text-[12px] text-fg-muted">{tt("Takipçi")}</dt>
              <KaynakRozeti source="API" />
            </div>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{compact.format(totalFollowers)}</dd>
          </div>

          {/* 2. ER (tek kaynak, TR virgül) */}
          <div
            className="rounded-2xl border border-line bg-bg/40 p-3.5"
            title={tt("Keşif ER'si takipçi paydalıdır (medyan etkileşim / takipçi).")}
          >
            <div className="flex items-center justify-between gap-1">
              <dt className="text-[12px] text-fg-muted">ER</dt>
              <KaynakRozeti source="API" />
            </div>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{unifiedErText}</dd>
          </div>

          {/* 3. Kitle güveni */}
          <div className="rounded-2xl border border-line bg-bg/40 p-3.5">
            <div className="flex items-center justify-between gap-1">
              <dt className="text-[12px] text-fg-muted">{tt("Kitle güveni")}</dt>
              {authTrustLevel ? <GuvenRozeti level={authTrustLevel} /> : null}
            </div>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {authScore > 0 ? `%${authScore}` : "—"}
            </dd>
            {authScore === 0 ? <span className="text-[11px] text-fg-passive">{tt("Ön veri · hesaplanamadı")}</span> : null}
          </div>

          {/* 4. Fiyat aralığı */}
          <div className="rounded-2xl border border-line bg-bg/40 p-3.5">
            <div className="flex items-center justify-between gap-1">
              <dt className="text-[12px] text-fg-muted">{tt("Fiyat aralığı")}</dt>
              {minRate != null ? <KaynakRozeti source="BEYAN" /> : null}
            </div>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {minRate != null && maxRate != null
                ? minRate === maxRate
                  ? formatKurus(minRate)
                  : `${formatKurus(minRate)} – ${formatKurus(maxRate)}`
                : tt("Üretici fiyatı yok")}
            </dd>
            {minRate == null ? (
              <span className="text-[11px] text-fg-passive">{tt("Teklif gönderilebilir")}</span>
            ) : null}
          </div>

          {/* 5. Ort. izlenme */}
          <div className="rounded-2xl border border-line bg-bg/40 p-3.5">
            <div className="flex items-center justify-between gap-1">
              <dt className="text-[12px] text-fg-muted">{tt("Ort. izlenme")}</dt>
              <KaynakRozeti source="API" />
            </div>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {avgViewsVal > 0 ? compact.format(avgViewsVal) : tt("Hesap bağlanınca görünür")}
            </dd>
          </div>
        </dl>

        {/* Uyum Skoru — Neden (en fazla 3 madde) */}
        <div className="relative mt-4 flex flex-col gap-1.5 rounded-2xl border border-line bg-bg/30 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {isPreliminaryScore ? tt("Ön değerlendirme — neden?") : tt("Uyum skoru — neden?")}
          </span>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-fg-muted">
            {whyReasons.slice(0, 3).map((r) => (
              <li key={r} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-fg" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 4–6 İçerik Thumbnail Önizlemesi */}
        {previewMedia.length > 0 ? (
          <div className="relative mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {previewMedia.map((m) => (
              <a
                key={m.id}
                href={m.permalink || "#"}
                target={m.permalink ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="group relative aspect-[9/12] overflow-hidden rounded-xl border border-line bg-bg/50"
              >
                {m.thumbnailUrl ? (
                  <img
                    src={m.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-standard group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-fg-passive">
                    {m.mediaType}
                  </div>
                )}
                <span className="absolute top-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                  {m.isSponsored ? tt("Sponsorlu") : tt("Organik")}
                </span>
              </a>
            ))}
          </div>
        ) : null}
      </section>

      {/* Sekmeler: Kitle | Performans | İçerikler | Markalar / Geçmiş | Uyum / 23-A */}
      <CreatorProfileTabs
        kitle={kitleTab}
        performans={performansTab}
        icerikler={iceriklerTab}
        markalar={markalarTab}
        uyum={uyumTab}
      />

      {!inf.showPrices || !inf.showCollaborations ? (
        <p className="text-[12px] text-fg-passive">{tt("Bazı bölümler içerik üreticisinin tercihiyle gizli.")}</p>
      ) : null}
    </div>
  );
}
