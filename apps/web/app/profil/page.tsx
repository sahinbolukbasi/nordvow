import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { audit } from "@infulancer/core/audit";
import { prisma, type ContentType, type Platform } from "@infulancer/core/db";
import { contentTypeLabels, platformLabels, roleLabels } from "@infulancer/core/domain/labels";
import { platformRules } from "@infulancer/core/domain/platform-rules";
import { syncInfluencer, syncSourceLabels } from "@infulancer/core/social/sync";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { DefaultModeCard, type AgencyOption } from "@/components/campaign/default-mode-card";
import { PasswordForm, ProfileForm } from "@/components/profile/profile-forms";
import { WhatsAppConnectCard } from "@/components/profile/whatsapp-connect-card";
import { getOrCreateWhatsAppLink } from "@infulancer/core/messaging/user-whatsapp-ai";
import { envStr } from "@infulancer/core/env";
import { listInfluencerAddresses } from "@infulancer/core/shipping/service";
import { InfluencerAddressForm } from "@/components/shipping/influencer-address-form";
import { BrandBillingAddressForm } from "@/components/profile/brand-billing-address-form";
import { listBrandAddresses } from "@infulancer/core/profile/addresses";
import { OwnAccountForm } from "@/components/forms/own-account-forms";
import { TikTokCreatorPanel } from "@/components/tiktok/tiktok-creator-panel";
import { RateCardForm, type RateRow } from "@/components/offers/offer-forms";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar, pickAvatar } from "@/components/ui/avatar";
import { Card, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { Tabs } from "@/components/ui/tabs";
import { requireActor } from "@/lib/auth-guard";
import { compact, pct1 } from "@/lib/format";
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
 * Tüm roller için tek profil sayfası. İçerik üreticisinde kişisel bilgiler,
 * hesaplar, fiyat listesi ve teslimat adresi tek profil akışında yönetilir.
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
    const [inf, initialAccounts, cards, savedAddresses] = await Promise.all([
      prisma.influencer.findUniqueOrThrow({ where: { id }, select: { city: true, avatarKey: true, socialAccounts: { select: { platform: true, avatarUrl: true } } } }),
      prisma.socialAccount.findMany({ where: { influencerId: id }, orderBy: { platform: "asc" } }),
      prisma.rateCard.findMany({ where: { influencerId: id, active: true } }),
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
    const rateRows: RateRow[] = (Object.entries(platformRules) as [Platform, { contentTypes: readonly ContentType[] }][]).flatMap(([p, r]) =>
      r.contentTypes.map((ct) => {
        const c = cards.find((x) => x.platform === p && x.contentType === ct);
        return { platform: p, platformLabel: platformLabels[p], contentType: ct, contentLabel: contentTypeLabels[ct], priceTl: c ? String(c.priceKurus / 100) : "" };
      }),
    );

    // Hesaplarım
    tabs.push({
      id: "ayarlar",
      label: "Hesaplarım · Fiyat listem · Teslimat adresim",
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
          <Card interactive={false} className="flex flex-col gap-4">
            <CardTitle>{tt("İçerik fiyatlarım")}</CardTitle>
            <RateCardForm rows={rateRows} />
          </Card>
          <Card interactive={false} className="flex flex-col gap-3">
            <CardTitle>{tt("Ürün gönderimi için teslimat adresim")}</CardTitle>
            <InfluencerAddressForm initial={savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null} />
          </Card>
        </div>
      ),
    });
  }
  let brandModeSettings: { mode: "SELF" | "AJANS"; selectedAgencyId: string | null; agencies: AgencyOption[] } | null = null;
  if (actor.role === "BRAND" && actor.brandId) {
    const brandId = actor.brandId;
    const [brandCfg, agencies, brandAddresses] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId }, select: { defaultExecutionMode: true, preferredAgencyUserId: true } }),
      prisma.user.findMany({ where: { role: "AGENCY", status: "ACTIVE" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
      listBrandAddresses(brandId),
    ]);
    brandModeSettings = { mode: brandCfg?.defaultExecutionMode ?? "AJANS", selectedAgencyId: brandCfg?.preferredAgencyUserId ?? null, agencies };
    headline = `${user.brand?.name ?? "Marka"} · marka yetkilisi`;
    tabs.push({
      id: "fatura",
      label: "Fatura & Adres",
      content: (
        <Card interactive={false} className="flex flex-col gap-4">
          <CardTitle>{tt("Fatura ve gönderim bilgileri")}</CardTitle>
          <p className="text-[13px] text-fg-muted">{tt("Fatura ve kargo süreçlerinde kullanılacak şirket, vergi ve adres bilgilerinizi güncel tutun.")}</p>
          <BrandBillingAddressForm initialAddress={brandAddresses.find((a) => a.isBilling) ?? brandAddresses[0] ?? null} />
        </Card>
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
          {actor.role === "INFLUENCER" ? (
            <ButtonLink href="/profil?sekme=ayarlar" variant="secondary" size="sm" className="w-fit">
              {tt("Hesaplarım, fiyat listem ve teslimat adresim →")}
            </ButtonLink>
          ) : null}
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
  const visibleTabs = actor.role === "INFLUENCER" ? tabs.filter((tab) => ["bilgiler", "ayarlar", "islemler"].includes(tab.id)) : tabs;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-line bg-glass p-5">
        <Avatar name={user.name} src={avatar} size={72} className="ring-2 ring-neon-pink/50" />
        <div className="flex min-w-0 flex-col">
          <PageHeader title={user.name} description={`${headline} · ${user.email} · üye ${fmtDate(user.createdAt)}`} />
        </div>
      </div>
      <Tabs
        key={sekme ?? "bilgiler"}
        label={tt("Profil bölümleri")}
        defaultTab={visibleTabs.some((tab) => tab.id === sekme) ? sekme : "bilgiler"}
        tabs={visibleTabs}
      />
    </div>
  );
}
