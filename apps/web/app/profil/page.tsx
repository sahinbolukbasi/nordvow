import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { audit } from "@infulancer/core/audit";
import { prisma, type ContentType, type Platform } from "@infulancer/core/db";
import { campaignStatusLabels, contentTypeLabels, formatKurus, platformLabels, roleLabels, taxStatusLabels } from "@infulancer/core/domain/labels";
import { platformRules } from "@infulancer/core/domain/platform-rules";
import { computeBalances } from "@infulancer/core/domain/ledger";
import { syncInfluencer, syncSourceLabels } from "@infulancer/core/social/sync";
import { WorkHistory } from "@/components/history/work-history";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { DefaultModeCard, type AgencyOption } from "@/components/campaign/default-mode-card";
import { PasswordForm, ProfileForm } from "@/components/profile/profile-forms";
import { WhatsAppConnectCard } from "@/components/profile/whatsapp-connect-card";
import { getOrCreateWhatsAppLink } from "@infulancer/core/messaging/user-whatsapp-ai";
import { envStr } from "@infulancer/core/env";
import { shipmentStatusLabels, type SenderAddress } from "@infulancer/core/shipping/types";
import { listInfluencerAddresses } from "@infulancer/core/shipping/service";
import { BrandSenderAddressForm } from "@/components/shipping/brand-sender-address-form";
import { InfluencerAddressForm } from "@/components/shipping/influencer-address-form";
import { OwnAccountForm } from "@/components/forms/own-account-forms";
import { TikTokCreatorPanel } from "@/components/tiktok/tiktok-creator-panel";
import { RateCardForm, type RateRow } from "@/components/offers/offer-forms";
import { CreatorShowcase } from "@/components/showcase/creator-showcase";
import { AddPortfolioForm, PortfolioList, ShowcaseSettingsForm } from "@/components/showcase/showcase-forms";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar, pickAvatar } from "@/components/ui/avatar";
import { Card, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import { InfoNote } from "@/components/ui/unverified";
import { requireActor } from "@/lib/auth-guard";
import { compact, pct1 } from "@/lib/format";
import { itemsSummary, statusLabel, statusTone } from "@/lib/offers-view";
import { campaignTone } from "@/lib/status-tone";
import { fmtDate, fmtDateTime } from "@/lib/time";
export const metadata: Metadata = { title: "Profilim" };
export const dynamic = "force-dynamic";
const ACTION_TR: Record<string, string> = {
  PROFILE_UPDATED: "Profil güncellendi",
  PASSWORD_CHANGED: "Şifre değiştirildi",
  OFFER_SENT: "Teklif gönderildi",
  OFFER_ACCEPTED: "Teklif kabul edildi",
  OFFER_DECLINED: "Teklif reddedildi",
  OFFER_WITHDRAWN: "Teklif geri çekildi",
  RATE_CARD_UPDATED: "Fiyat listesi güncellendi",
  PAYOUT_REQUESTED: "Çekim talebi oluşturuldu",
  CONTRACT_DECISION: "Sözleşme kararı",
  DELIVERABLE_STATUS: "İş durumu değişti",
  POST_URL_UPDATED: "Paylaşım bağlantısı güncellendi",
  ASSET_UPLOADED: "Dosya yüklendi",
  METRIC_SUBMITTED: "Metrik girildi",
  SOCIAL_ACCOUNT_ADDED: "Sosyal hesap eklendi",
  SOCIAL_ACCOUNT_UPDATED: "Sosyal hesap güncellendi",
  CAMPAIGN_REQUESTED: "Kampanya talebi gönderildi",
  CAMPAIGN_CREATED: "Kampanya oluşturuldu",
  CAMPAIGN_UPDATED: "Kampanya güncellendi",
  ASSIGNMENT_CREATED: "Influencer atandı",
  INVITE_CREATED: "Davet oluşturuldu",
  REVIEW_SUBMITTED: "İçerik incelendi",
};
const humanize = (a: string) => ACTION_TR[a] ?? a.toLocaleLowerCase("tr").replace(/_/g, " ").replace(/^./, (c) => c.toLocaleUpperCase("tr"));
/**
 * Tüm roller için tek profil sayfası. İçerik üreticisinde Bilgiler + Vitrin + Hesaplar +
 * Fiyat listesi + Para çekme + İş birlikleri + İşlemler hepsi buradadır (ayrı sayfalar yok).
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const tt = await getTT();
  const actor = await requireActor();
  const { sekme } = await searchParams;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, email: true, phone: true, role: true, createdAt: true, avatarKey: true, brand: { select: { name: true } } } });
  const [activity, waLink] = await Promise.all([
    audit.listByActor(actor.userId, 60).catch(() => []),
    getOrCreateWhatsAppLink(actor.userId),
  ]);
  const tabs: { id: string; label: string; content: React.ReactNode }[] = [];
  let avatar: string | null = user.avatarKey ? `/api/avatar/${user.avatarKey.replace(/^avatars\//, "")}` : null;
  let headline = roleLabels[user.role];
  if (actor.role === "INFLUENCER" && actor.influencerId) {
    const id = actor.influencerId;
    const now = new Date();
    const [inf, balances, offers, initialAccounts, cards, portfolio, published, savedAddresses] = await Promise.all([
      prisma.influencer.findUniqueOrThrow({ where: { id }, select: { iban: true, ibanHolder: true, taxStatus: true, city: true, avatarKey: true, headline: true, bio: true, showcaseVisible: true, showPrices: true, showCollaborations: true, socialAccounts: { select: { platform: true, avatarUrl: true } } } }),
      computeBalances(id, now),
      prisma.offer.findMany({ where: { influencerId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.socialAccount.findMany({ where: { influencerId: id }, orderBy: { platform: "asc" } }),
      prisma.rateCard.findMany({ where: { influencerId: id, active: true } }),
      prisma.portfolioItem.findMany({ where: { influencerId: id }, orderBy: [{ sort: "asc" }, { createdAt: "desc" }] }),
      prisma.deliverable.findMany({
        where: { assignment: { influencerId: id }, postUrl: { not: null } },
        orderBy: { publishedAt: "desc" },
        take: 50,
        select: { id: true, platform: true, contentType: true, publishedAt: true, assignment: { select: { campaign: { select: { brand: { select: { name: true } } } } } } },
      }),
      listInfluencerAddresses(id),
    ]);
    let accounts = initialAccounts;
    avatar = pickAvatar(inf.socialAccounts, inf.avatarKey);
    if (accounts.some((a) => a.syncError || a.followers === 0)) {
      await syncInfluencer(id).catch(() => {});
      accounts = await prisma.socialAccount.findMany({ where: { influencerId: id }, orderBy: { platform: "asc" } });
    } else if (accounts.some((a) => !a.lastSyncedAt || a.lastSyncedAt.getTime() < now.getTime() - 3_600_000)) {
      void syncInfluencer(id).catch(() => {});
    }
    headline = `İçerik üreticisi${inf.city ? ` · ${inf.city}` : ""}`;
    const tiktokAcc = accounts.find((a) => a.platform === "TIKTOK");
    const usedDeliverables = new Set(portfolio.map((i) => i.deliverableId).filter(Boolean));
    const rateRows: RateRow[] = (Object.entries(platformRules) as [Platform, { contentTypes: readonly ContentType[] }][]).flatMap(([p, r]) =>
      r.contentTypes.map((ct) => {
        const c = cards.find((x) => x.platform === p && x.contentType === ct);
        return { platform: p, platformLabel: platformLabels[p], contentType: ct, contentLabel: contentTypeLabels[ct], priceTl: c ? String(c.priceKurus / 100) : "" };
      }),
    );

    // Vitrinim
    tabs.push({
      id: "vitrin",
      label: "Vitrinim",
      content: (
        <div className="flex flex-col gap-4">
          <InfoNote>{inf.showcaseVisible ? tt("Markalar profilinizi bu haliyle görür.") : tt("Profiliniz şu an markalara gizli.")}</InfoNote>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card interactive={false} className="flex flex-col gap-4">
              <CardTitle>{tt("Profil ve görünürlük")}</CardTitle>
              <ShowcaseSettingsForm v={inf} />
            </Card>
            <Card interactive={false} className="flex flex-col gap-4">
              <CardTitle>{tt("Öne çıkan işler (")}{portfolio.length}/24)</CardTitle>
              <AddPortfolioForm published={published.filter((d) => !usedDeliverables.has(d.id)).map((d) => ({ id: d.id, label: `${d.assignment.campaign.brand.name} · ${platformLabels[d.platform]} ${contentTypeLabels[d.contentType]}${d.publishedAt ? ` · ${fmtDate(d.publishedAt)}` : ""}` }))} />
              <PortfolioList items={portfolio.map((i) => ({ id: i.id, title: i.title, url: i.url, platformLabel: platformLabels[i.platform], brandName: i.brandName }))} />
            </Card>
          </div>
          <details className="rounded-3xl border border-line px-5 py-4">
            <summary className="cursor-pointer text-sm text-fg-muted hover:text-fg">{tt("Markaların gördüğü önizleme")}</summary>
            <div className="mt-4">
              <CreatorShowcase influencerId={id} view="influencer" />
            </div>
          </details>
        </div>
      ),
    });

    // Hesaplarım
    tabs.push({
      id: "hesaplar",
      label: `Hesaplarım (${accounts.length})`,
      content: (
        <div className="flex flex-col gap-4">
          <Card interactive={false} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{tt("Hesap bağla")}</CardTitle>
            </div>
            <p className="text-[13px] text-fg-muted">{tt("Kullanıcı adını ekle; takipçi ve profil fotoğrafın otomatik gelsin.")}</p>
            <OwnAccountForm />
          </Card>
          {accounts.length ? (
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={tt("Sosyal medya hesapları")}>
              {accounts.map((a) => (
                <Card key={a.id} interactive={false} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={a.handle} src={a.avatarUrl} size={40} />
                    <span className="flex items-center gap-2">
                      <PlatformIcon platform={a.platform} size={14} aria-hidden />
                      <CardTitle>{platformLabels[a.platform]}</CardTitle>
                    </span>
                  </div>
                  <p className="text-sm text-fg-muted">@{a.handle.replace(/^@/, "")}</p>
                  <dl className="grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-label text-fg-muted">{tt("Takipçi")}</dt>
                      <dd className="text-xl font-semibold tabular-nums">{compact.format(a.followers)}</dd>
                    </div>
                    <div>
                      <dt className="text-label text-fg-muted">{tt("ER")}</dt>
                      <dd className="text-xl font-semibold tabular-nums">{pct1.format(Number(a.engagementRate))}</dd>
                    </div>
                  </dl>
                  <p className="text-[12px] text-fg-passive">
                    {syncSourceLabels[a.syncSource] ?? a.syncSource}
                    {a.lastSyncedAt ? ` · son güncelleme ${fmtDate(a.lastSyncedAt)}` : ""}
                  </p>
                  {a.syncError ? <span className="text-[12px] text-critical">{a.syncError}</span> : null}
                </Card>
              ))}
            </section>
          ) : (
            <p className="text-sm text-fg-passive">{tt("Henüz hesap yok. Yukarıdan kullanıcı adını ekle.")}</p>
          )}
          <TikTokCreatorPanel />
        </div>
      ),
    });

    // Fiyat listem
    tabs.push({
      id: "fiyat",
      label: `Fiyat listem (${cards.length})`,
      content: (
        <Card interactive={false} className="flex flex-col gap-4">
          <CardTitle>{tt("İçerik fiyatlarım")}</CardTitle>
          <p className="text-[13px] text-fg-muted">{tt("Fiyatlarınız markalara yalnız vitrininizde \"fiyatları göster\" açıksa görünür. Teklifleri \"Teklifler\" sayfasından yanıtlarsınız.")}</p>
          <RateCardForm rows={rateRows} />
        </Card>
      ),
    });

    // Bakiye özeti (detaylı çekim ve geçmiş "Ödemeler" sayfasında; burada yalnız özet + kısayol).
    tabs.push({
      id: "odeme",
      label: "Bakiye",
      content: (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Çekilebilir", formatKurus(balances.cekilebilir)],
              ["Hakedilen (beklemede)", formatKurus(balances.hakedilen)],
              ["Ödeme sürecinde", formatKurus(balances.islemde)],
              ["Vergi profili", taxStatusLabels[inf.taxStatus]],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-glass p-4">
                <dt className="text-[12px] text-fg-muted">{k}</dt>
                <dd className="text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <ButtonLink href="/influencer/odemeler" variant="primary" size="sm" className="w-fit">{tt("Çekim talebi ve ödeme geçmişi →")}</ButtonLink>
        </div>
      ),
    });
    tabs.push({ id: "isbirlikleri", label: "İş birlikleri ve çekimler", content: <WorkHistory influencerId={id} mode="influencer" /> });
    tabs.push({
      id: "teklifler",
      label: `Teklifler (${offers.length})`,
      content: (
        <div className="flex flex-col gap-3">
          <ButtonLink href="/influencer/teklifler" variant="secondary" size="sm" className="w-fit">{tt("Teklifleri yanıtla →")}</ButtonLink>
          <OfferRows offers={offers} />
        </div>
      ),
    });
    const defaultAddress = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;
    tabs.push({
      id: "kargo",
      label: "Teslimat Adresim",
      content: (
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Ürün Gönderimi İçin Teslimat Adresim")}</CardTitle>
          <p className="text-[13px] text-fg-muted">
            {tt("Ürün gönderimli kampanyalarda kargolarınız burada kayıtlı adresinize gönderilir. Kampanya sırasında tekrar adres girmenize gerek kalmaz.")}
          </p>
          <InfluencerAddressForm initial={defaultAddress} />
        </Card>
      ),
    });
  }
  let brandModeSettings: { mode: "SELF" | "AJANS"; selectedAgencyId: string | null; agencies: AgencyOption[] } | null = null;
  if (actor.role === "BRAND" && actor.brandId) {
    const brandId = actor.brandId;
    const [campaigns, offers, brandCfg, agencies, shippingIntegrations, brandShipments] = await Promise.all([
      prisma.campaign.findMany({ where: { brandId }, orderBy: { startsAt: "desc" }, select: { id: true, name: true, status: true, startsAt: true, endsAt: true, brandTotalFeeKurus: true, _count: { select: { assignments: { where: { contractStatus: { not: "RED" } } } } } } }),
      prisma.offer.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.brand.findUnique({ where: { id: brandId }, select: { defaultExecutionMode: true, preferredAgencyUserId: true } }),
      prisma.user.findMany({ where: { role: "AGENCY", status: "ACTIVE" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
      prisma.brandShippingIntegration.findMany({
        where: { brandId },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
        select: { senderAddress: true },
      }),
      prisma.shipment.findMany({
        where: { brandId },
        orderBy: { updatedAt: "desc" },
        take: 40,
        select: {
          id: true,
          campaignId: true,
          status: true,
          trackingNumber: true,
          carrierName: true,
          updatedAt: true,
          campaign: { select: { name: true } },
          influencer: { select: { name: true } },
        },
      }),
    ]);
    const savedSenderAddress =
      (shippingIntegrations.find((i) => i.senderAddress)?.senderAddress as SenderAddress | null | undefined) ?? null;
    const shipStats = {
      total: brandShipments.length,
      pending: brandShipments.filter((s) => s.status === "PENDING_ADDRESS" || s.status === "READY_TO_SHIP").length,
      inTransit: brandShipments.filter((s) => s.status === "LABEL_CREATED" || s.status === "IN_TRANSIT" || s.status === "OUT_FOR_DELIVERY").length,
      delivered: brandShipments.filter((s) => s.status === "DELIVERED").length,
    };
    brandModeSettings = { mode: brandCfg?.defaultExecutionMode ?? "AJANS", selectedAgencyId: brandCfg?.preferredAgencyUserId ?? null, agencies };
    headline = `${user.brand?.name ?? "Marka"} · marka yetkilisi`;
    tabs.push({
      id: "isbirlikleri",
      label: `İş birlikleri (${campaigns.length})`,
      content: campaigns.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <Link href={`/marka/kampanyalar/${c.id}`} className="text-sm hover:underline">
                {c.name}
              </Link>
              <span className="flex items-center gap-4 text-[13px] text-fg-muted tabular-nums">
                {fmtDate(c.startsAt)} – {fmtDate(c.endsAt)} · {c._count.assignments}{" "}{tt("influencer ·")}{" "}{formatKurus(Number(c.brandTotalFeeKurus))}
                <StatusDot tone={campaignTone(c.status)}>{campaignStatusLabels[c.status]}</StatusDot>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-passive">{tt("Henüz kampanya yok.")}</p>
      ),
    });
    tabs.push({ id: "teklifler", label: `Teklifler (${offers.length})`, content: <OfferRows offers={offers} /> });
    tabs.push({
      id: "kargo",
      label: `Kargo & Gönderici (${shipStats.total})`,
      content: (
        <div className="flex flex-col gap-5">
          <Card interactive={false} className="flex flex-col gap-3">
            <CardTitle>{tt("Gönderici Adresi")}</CardTitle>
            <p className="text-[13px] text-fg-muted">
              {tt("Ürün gönderimli kampanyalarınızda kullanılacak varsayılan gönderici adresiniz. Kargo firma entegrasyonları ajans/admin tarafından yönetilir.")}
            </p>
            <BrandSenderAddressForm initial={savedSenderAddress} />
          </Card>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [tt("Toplam Gönderi"), String(shipStats.total)],
              [tt("Hazırlanan / Adres Bekleyen"), String(shipStats.pending)],
              [tt("Yoldaki Kargolar"), String(shipStats.inTransit)],
              [tt("Teslim Edilen"), String(shipStats.delivered)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-bg/40 p-3">
                <dt className="text-[12px] text-fg-muted">{k}</dt>
                <dd className="text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <Card interactive={false} className="flex flex-col gap-3">
            <CardTitle>{tt("Kampanya Gönderileri & Kargo Takibi")}</CardTitle>
            {brandShipments.length === 0 ? (
              <p className="text-sm text-fg-passive">{tt("Henüz ürün gönderimi kaydı bulunmuyor.")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                {brandShipments.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium text-fg">
                        {s.influencer.name} · <span className="text-fg-muted">{s.campaign.name}</span>
                      </span>
                      <span className="text-[12px] text-fg-passive">
                        {s.carrierName ? `${s.carrierName} · ` : ""}
                        {s.trackingNumber ? `Takip: ${s.trackingNumber}` : tt("Takip numarası bekleniyor")} · {fmtDateTime(s.updatedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-fg">
                        {shipmentStatusLabels[s.status]}
                      </span>
                      <Link href={`/marka/kampanyalar/${s.campaignId}#kargo`} className="text-xs underline underline-offset-4">
                        {tt("Kampanyada yönet →")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ),
    });
  }
  tabs.push({
    id: "islemler",
    label: "Yaptığım işlemler",
    content: activity.length ? (
      <ol className="flex flex-col rounded-2xl border border-line">
        {activity.map((a) => (
          <li key={a.id} className="grid grid-cols-[150px_1fr] gap-4 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0">
            <time dateTime={a.at.toISOString()} className="tabular-nums text-fg-passive">
              {fmtDateTime(a.at)}
            </time>
            <span>{humanize(a.action)}</span>
          </li>
        ))}
      </ol>
    ) : (
      <p className="text-sm text-fg-passive">{tt("Henüz kayıtlı işlem yok.")}</p>
    ),
  });
  const [botPhoneCfg, dbWaNum] = await Promise.all([
    prisma.configValue.findUnique({ where: { key: "whatsapp.bot_phone" } }),
    prisma.whatsAppNumber.findFirst({
      where: { displayNumber: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { displayNumber: true },
    }),
  ]);
  const cfgBotPhone = typeof botPhoneCfg?.value === "string" ? botPhoneCfg.value.trim() : "";
  const botPhone = cfgBotPhone || envStr("WHATSAPP_BOT_PHONE", "") || dbWaNum?.displayNumber || "";

  tabs.unshift({
    id: "bilgiler",
    label: "Bilgilerim",
    content: (
      <div className="flex flex-col gap-4">
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Profil fotoğrafı")}</CardTitle>
          <AvatarUploader name={user.name} current={avatar} />
        </Card>
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Kişisel bilgiler")}</CardTitle>
          <ProfileForm name={user.name} phone={user.phone} />
          <p className="text-[12px] text-fg-passive">{tt("E-posta (")}{user.email}{tt(") giriş adresinizdir; değiştirmek için ajansınıza yazın.")}</p>
        </Card>
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Güvenlik")}</CardTitle>
          <PasswordForm />
        </Card>
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("WhatsApp Bağlantısı")}</CardTitle>
          <WhatsAppConnectCard
            pairingCode={waLink.pairingCode}
            verified={waLink.verified}
            waPhone={waLink.waPhone}
            botPhone={botPhone}
          />
        </Card>
        {brandModeSettings ? (
          <DefaultModeCard
            mode={brandModeSettings.mode}
            agencies={brandModeSettings.agencies}
            selectedAgencyId={brandModeSettings.selectedAgencyId}
          />
        ) : null}
        {actor.role === "INFLUENCER" || actor.role === "BRAND" ? (
          <Card interactive={false} className="flex flex-col gap-3">
            <CardTitle>{tt("Hızlı erişim")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {actor.role === "INFLUENCER" ? (
                <ButtonLink href="/influencer/davet" variant="secondary" size="sm">{tt("Arkadaşını davet et →")}</ButtonLink>
              ) : null}
              {actor.role === "BRAND" ? (
                <ButtonLink href="/marka/uyum" variant="secondary" size="sm">{tt("Uyum ve yasal gereklilikler →")}</ButtonLink>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    ),
  });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-line bg-glass p-5">
        <Avatar name={user.name} src={avatar} size={72} className="ring-2 ring-neon-pink/50" />
        <div className="flex min-w-0 flex-col">
          <PageHeader title={user.name} description={`${headline} · ${user.email} · üye ${fmtDate(user.createdAt)}`} />
        </div>
      </div>
      <Tabs key={sekme ?? "bilgiler"} label={tt("Profil bölümleri")} defaultTab={sekme} tabs={tabs} />
    </div>
  );
}
async function OfferRows({ offers }: { offers: { id: string; title: string; totalKurus: number; status: string; createdAt: Date; items: unknown }[] }) {
  const tt = await getTT();
  if (!offers.length) return <p className="text-sm text-fg-passive">{tt("Henüz teklif yok.")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
      {offers.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">{o.title}</span>
            <span className="truncate text-[12px] text-fg-muted">{itemsSummary(o.items).join(" · ")}</span>
          </span>
          <span className="flex items-center gap-4 text-[13px] tabular-nums">
            {formatKurus(o.totalKurus)}
            <StatusDot tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusDot>
            <span className="text-fg-passive">{fmtDate(o.createdAt)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
