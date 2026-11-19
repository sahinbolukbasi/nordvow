import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { listDmCampaignsWithSummary } from "@infulancer/core/dm-automation/store";
import { getInstagramAutoReplies } from "@infulancer/core/messaging/instagram-auto-reply";
import { freeTierStatus } from "@infulancer/core/messaging/cost";
import { qualityLabel, statusLabel } from "@infulancer/core/messaging/templates";
import { tierCapacity } from "@infulancer/core/messaging/tiers";
import { BrandAssistants } from "@/components/channels/brand-assistants";
import { InstagramAutoReplyPanel } from "@/components/channels/instagram-auto-reply-panel";
import { DmAutomationShell } from "@/components/dm-automation/dm-automation-shell";
import { BrandBadge } from "@/components/icons/brand-logos";
import {
  ConfirmPaymentButton,
  InstagramConnectForm,
  TemplateForm,
  WhatsAppSignupForm,
} from "@/components/inbox/inbox-forms";
import { UnifiedInboxShell } from "@/components/inbox/unified-inbox-shell";
import { RunJobButton } from "@/components/forms/operations-forms";
import { AppShell } from "@/components/shell/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { buttonClass } from "@/components/ui/form";
import { SetupWizard } from "@/components/ui/setup-wizard";
import { StatusDot } from "@/components/ui/status";
import { InfoNote } from "@/components/ui/unverified";
import { cn } from "@/lib/cn";
import { loadDmAutomationPageContext } from "@/lib/dm-automation-page";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "İletişim Merkezi · NordVow" };
export const dynamic = "force-dynamic";

type HubTab = "mesajlar" | "otomasyon" | "kanallar" | "asistan";
type SearchParams = { sekme?: string; marka?: string };

const numFmt = new Intl.NumberFormat("tr-TR");

function normalizeTab(raw?: string): HubTab {
  if (raw === "otomasyon" || raw === "kanallar" || raw === "asistan") return raw;
  return "mesajlar";
}

export default async function CommunicationHubPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const tab = normalizeTab(sp.sekme);
  const ctx = await loadDmAutomationPageContext();
  const { actor, actorName, tenantOptions, initialTenantId, tenantAllowed, canAdminExport } = ctx;
  const isAdmin = actor.role === "ADMIN";
  const isBrand = actor.role === "BRAND" && !!actor.brandId;

  const tenantScope = isAdmin ? {} : { tenantId: initialTenantId };

  // Üst özet şeridi için hafif paralel sayaçlar
  const [openConversations, awaitingHuman, activeAutomationsList, activeChannels, activeAssistants] =
    await Promise.all([
      prisma.conversation.count({
        where: { ...tenantScope, status: { not: "closed" } },
      }),
      prisma.conversation.count({
        where: { ...tenantScope, status: "awaiting_human" },
      }),
      listDmCampaignsWithSummary(initialTenantId, "ACTIVE").catch(() => null),
      prisma.channelConnection.count({
        where: { ...tenantScope, status: "ACTIVE" },
      }),
      prisma.agentConfig.count({
        where: { ...tenantScope, enabled: true },
      }),
    ]);
  const activeAutomations = activeAutomationsList?.campaigns.length ?? 0;

  // Sadece aktif sekmenin ihtiyacı olan ek verileri yükle
  const selectedBrandId = isBrand
    ? actor.brandId!
    : sp.marka && tenantOptions.some((t) => t.id === sp.marka && t.kind === "Marka")
      ? sp.marka
      : (tenantOptions.find((t) => t.kind === "Marka")?.id ?? initialTenantId);

  const tabs: {
    id: HubTab;
    title: string;
    subtitle: string;
    metric: string;
    badge?: string;
    badgeTone?: "warn" | "ok";
  }[] = [
      {
        id: "mesajlar",
        title: "Mesaj Kutusu",
        subtitle: "WhatsApp & Instagram DM",
        metric: `${numFmt.format(openConversations)} açık`,
        badge: awaitingHuman > 0 ? `${awaitingHuman} bekliyor` : undefined,
        badgeTone: "warn",
      },
      {
        id: "otomasyon",
        title: "DM Otomasyonu",
        subtitle: "Yorum, hikâye & anahtar kelime",
        metric: `${numFmt.format(activeAutomations)} aktif akış`,
      },
      {
        id: "kanallar",
        title: "Kanallar & Mesajlar",
        subtitle: "Bağlantılar, şablonlar & takip",
        metric: `${numFmt.format(activeChannels)} bağlı kanal`,
        badge: activeChannels > 0 ? "Hazır" : undefined,
        badgeTone: "ok",
      },
      {
        id: "asistan",
        title: "AI Asistan",
        subtitle: "Otomatik yanıt & bilgi tabanı",
        metric: `${numFmt.format(activeAssistants)} aktif asistan`,
      },
    ];

  return (
    <AppShell role={actor.role} fullBleed>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-3 sm:p-5">
        {/* Üst Komuta Şeridi */}
        <header className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-fg sm:text-lg">
                  İletişim Merkezi
                </h1>
                <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
                  Tek Panel
                </span>
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">
                Mesaj kutusu, DM otomasyonu, kanal bağlantıları ve AI sohbet asistanını tek merkezden yönetin.
              </p>
            </div>

            {tab === "kanallar" && isAdmin ? (
              <RunJobButton job="channel-health" label="Bağlantıları kontrol et" />
            ) : null}
          </div>

          {/* 4 Modüllü İşlevsel Navigasyon & Özet Kartları */}
          <nav
            aria-label="İletişim Merkezi modülleri"
            className="grid grid-cols-2 gap-2.5 lg:grid-cols-4"
          >
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <Link
                  key={item.id}
                  href={`/dashboard/iletisim?sekme=${item.id}${sp.marka ? `&marka=${encodeURIComponent(sp.marka)}` : ""}`}
                  className={cn(
                    "group flex flex-col justify-between gap-2 rounded-xl border px-3.5 py-3 transition",
                    active
                      ? "border-fg bg-bg ring-1 ring-fg"
                      : "border-line bg-bg/50 hover:border-fg/40 hover:bg-bg",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-fg sm:text-[13px]">
                        {item.title}
                      </p>
                      <p className="truncate text-[11px] text-fg-muted">{item.subtitle}</p>
                    </div>
                    {item.badge ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          item.badgeTone === "warn"
                            ? "border-amber-500/30 bg-amber-500/15 text-amber-700"
                            : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700",
                        )}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium tabular-nums text-fg">{item.metric}</span>
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        active ? "text-fg" : "text-fg-muted group-hover:text-fg",
                      )}
                    >
                      {active ? "Aktif" : "Aç →"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </header>

        {/* 1. Sekme: Mesaj Kutusu (WhatsApp + Instagram DM) */}
        {tab === "mesajlar" ? (
          <UnifiedInboxShell
            initialTenantId={initialTenantId}
            tenantOptions={tenantOptions}
            actorName={actorName}
          />
        ) : null}

        {/* 2. Sekme: DM Otomasyonu */}
        {tab === "otomasyon" ? (
          <DmAutomationShell
            initialTenantId={initialTenantId}
            tenantOptions={tenantOptions}
            initialView="list"
            featureAllowed={tenantAllowed}
            canAdminExport={canAdminExport}
          />
        ) : null}

        {/* 3. Sekme: Kanallar & Mesajlar */}
        {tab === "kanallar" ? (
          isAdmin ? (
            <AdminChannelsSection />
          ) : isBrand ? (
            <BrandChannelsSection tenantId={actor.brandId!} />
          ) : (
            <InfluencerChannelsSection tenantId={initialTenantId} />
          )
        ) : null}

        {/* 4. Sekme: AI Asistan */}
        {tab === "asistan" ? (
          isBrand ? (
            <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <BrandAssistants tenantId={actor.brandId!} />
            </div>
          ) : isAdmin ? (
            <AdminAssistantsSection
              brands={tenantOptions.filter((t) => t.kind === "Marka")}
              selectedBrandId={selectedBrandId}
            />
          ) : (
            <Card interactive={false} className="flex flex-col gap-3">
              <CardTitle>AI Yanıt Asistanı</CardTitle>
              <p className="text-sm text-fg-muted">
                Creator hesabınızda gelen Instagram DM ve WhatsApp konuşmalarında AI yanıt önerilerini{" "}
                <Link href="/dashboard/iletisim?sekme=mesajlar" className="font-medium text-fg underline">
                  Mesaj Kutusu
                </Link>{" "}
                içinden tek tıkla kullanabilir, otomatik yanıt akışlarını{" "}
                <Link href="/dashboard/iletisim?sekme=otomasyon" className="font-medium text-fg underline">
                  DM Otomasyonu
                </Link>{" "}
                sekmesinden kurabilirsiniz.
              </p>
            </Card>
          )
        ) : null}
      </div>
    </AppShell>
  );
}

async function AdminChannelsSection() {
  const [connections, numbers, templates, brands, assistants, settings, conversations] =
    await Promise.all([
      prisma.channelConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.whatsAppNumber.findMany(),
      prisma.messageTemplate.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
      prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.agentConfig.findMany({ orderBy: [{ enabled: "desc" }, { agentId: "asc" }], take: 100 }),
      prisma.tenantSettings.findMany({ select: { tenantId: true, mode: true } }),
      prisma.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 40,
        include: {
          contact: { select: { name: true, phoneE164: true, externalId: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true } },
        },
      }),
    ]);

  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const readiness = brands.map((b) => {
    const n = numbers.find((x) => x.tenantId === b.id);
    const conns = connections.filter((c) => c.tenantId === b.id);
    return {
      brand: b,
      whatsapp: !!n,
      payment: n?.paymentMethod === "payment_method_confirmed",
      template: templates.some((t) => t.tenantId === b.id && t.status === "ACTIVE"),
      instagram: conns.some((c) => c.provider === "INSTAGRAM" && c.status === "ACTIVE"),
      assistant: assistants.some((a) => a.tenantId === b.id && a.enabled),
      live: settings.find((x) => x.tenantId === b.id)?.mode === "production",
    };
  });
  const defaultBrandId = brands[0]?.id ?? "default";
  const igAutoReplies = await getInstagramAutoReplies(defaultBrandId);
  const quotas = await Promise.all(numbers.map(async (n) => ({ n, q: await freeTierStatus(n.phoneNumberId) })));

  return (
    <div className="flex flex-col gap-6">
      <DataTable
        caption="Marka kanal ve asistan hazırlık durumu"
        emptyText="Henüz marka yok."
        columns={[
          { key: "brand", header: "Marka", sortable: true },
          { key: "whatsapp", header: "WhatsApp" },
          { key: "payment", header: "Ödeme" },
          { key: "template", header: "Template" },
          { key: "instagram", header: "Instagram" },
          { key: "assistant", header: "Asistan" },
          { key: "live", header: "Canlı" },
        ]}
        rows={readiness.map((r) => ({
          id: r.brand.id,
          cells: {
            brand: {
              sort: r.brand.name,
              display: (
                <Link
                  href={`/dashboard/iletisim?sekme=asistan&marka=${encodeURIComponent(r.brand.id)}`}
                  className="font-medium hover:underline"
                >
                  {r.brand.name}
                </Link>
              ),
            },
            whatsapp: <StatusDot tone={r.whatsapp ? "active" : "passive"}>{r.whatsapp ? "Var" : "Yok"}</StatusDot>,
            payment: <StatusDot tone={r.payment ? "active" : "passive"}>{r.payment ? "Var" : "Yok"}</StatusDot>,
            template: <StatusDot tone={r.template ? "active" : "passive"}>{r.template ? "Var" : "Yok"}</StatusDot>,
            instagram: <StatusDot tone={r.instagram ? "active" : "passive"}>{r.instagram ? "Var" : "Yok"}</StatusDot>,
            assistant: <StatusDot tone={r.assistant ? "active" : "passive"}>{r.assistant ? "Var" : "Yok"}</StatusDot>,
            live: <StatusDot tone={r.live ? "active" : "passive"}>{r.live ? "Var" : "Yok"}</StatusDot>,
          },
        }))}
      />

      <DataTable
        caption="Son Mesajlar ve Konuşma Takibi"
        emptyText="Henüz mesaj konuşması yok."
        columns={[
          { key: "channel", header: "Kanal", sortable: true },
          { key: "brand", header: "Marka", sortable: true },
          { key: "contact", header: "Kişi", sortable: true },
          { key: "lastMsg", header: "Son Mesaj" },
          { key: "status", header: "Durum", sortable: true },
          { key: "updated", header: "Güncelleme", sortable: true },
        ]}
        rows={conversations.map((c) => ({
          id: c.id,
          cells: {
            channel: c.channel,
            brand: brandName.get(c.tenantId) ?? c.tenantId.slice(-6),
            contact: c.contact.name ?? c.contact.phoneE164 ?? c.contact.externalId,
            lastMsg: <span className="line-clamp-1 max-w-xs text-fg-muted">{c.messages[0]?.body ?? "—"}</span>,
            status: {
              sort: c.status,
              display: (
                <StatusDot tone={c.status === "awaiting_human" ? "critical" : c.status === "closed" ? "passive" : "active"}>
                  {c.status}
                </StatusDot>
              ),
            },
            updated: { sort: c.updatedAt.getTime(), display: fmtDateTime(c.updatedAt) },
          },
        }))}
      />

      {quotas.length > 0 ? (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="WhatsApp numaraları">
          {quotas.map(({ n, q }) => (
            <Card key={n.id} interactive={false} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{brandName.get(n.tenantId) ?? n.tenantId}</CardTitle>
                <StatusDot tone={n.paymentMethod === "payment_method_confirmed" ? "active" : "critical"}>
                  {n.paymentMethod === "payment_method_confirmed" ? "Onboarding tamam" : "Ödeme bekleniyor"}
                </StatusDot>
              </div>
              <p className="text-sm text-fg-muted">{n.displayNumber ?? n.phoneNumberId}</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-fg-muted">Mesaj limiti</dt>
                  <dd className="tabular-nums">
                    {n.messagingLimit} ·{" "}
                    {Number.isFinite(tierCapacity(n.messagingLimit))
                      ? `${numFmt.format(tierCapacity(n.messagingLimit))} / 24 sa`
                      : "sınırsız"}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Ücretsiz servis mesajı</dt>
                  <dd className="tabular-nums">
                    {numFmt.format(q.remaining)} / {numFmt.format(q.free)} kaldı
                    {q.exhaustAt ? ` · ${fmtDate(q.exhaustAt)}` : ""}
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </section>
      ) : null}

      {templates.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>Mesaj Şablonları (Templates)</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-fg-muted">
                  <th className="py-2 font-normal">Marka</th>
                  <th className="py-2 font-normal">Template</th>
                  <th className="py-2 font-normal">Durum</th>
                  <th className="py-2 font-normal">Kalite</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-line">
                    <td className="py-2">{brandName.get(t.tenantId) ?? t.tenantId}</td>
                    <td className="py-2">{t.name}</td>
                    <td className="py-2">{statusLabel[t.status]}</td>
                    <td className="py-2">
                      <StatusDot tone={t.quality === "LOW" ? "critical" : t.quality === "MEDIUM" ? "muted" : "active"}>
                        {qualityLabel[t.quality]}
                      </StatusDot>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <InstagramAutoReplyPanel tenantId={defaultBrandId} initialRules={igAutoReplies} />
    </div>
  );
}

async function BrandChannelsSection({ tenantId: t }: { tenantId: string }) {
  const [num, ig, templates, configs, candidates, tenant, igAutoReplies] = await Promise.all([
    prisma.whatsAppNumber.findUnique({ where: { tenantId: t } }),
    prisma.channelConnection.findFirst({ where: { tenantId: t, provider: "INSTAGRAM" }, orderBy: { createdAt: "desc" } }),
    prisma.messageTemplate.findMany({ where: { tenantId: t }, orderBy: { name: "asc" } }),
    prisma.agentConfig.findMany({ where: { tenantId: t } }),
    prisma.influencerCandidate.findMany({ where: { tenantId: t }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.tenantSettings.findUnique({ where: { tenantId: t }, select: { mode: true } }),
    getInstagramAutoReplies(t),
  ]);

  const paid = num?.paymentMethod === "payment_method_confirmed";
  const activeTpl = templates.filter((x) => x.status === "ACTIVE").length;
  const assistantOn = configs.some((c) => c.enabled);
  const live = tenant?.mode === "production";
  const igOk = ig?.status === "ACTIVE";

  const goAssistant = (
    <Link href="/dashboard/iletisim?sekme=asistan" className={buttonClass("primary", "sm")}>
      Asistanı aç →
    </Link>
  );
  const goLive = (
    <Link href="/marka/uyum" className={buttonClass("primary", "sm")}>
      Uyum adımlarına git →
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          {
            logo: "whatsapp" as const,
            title: "WhatsApp",
            ok: !!num && paid,
            text: num ? (paid ? `Bağlı · ${num.displayNumber ?? num.phoneNumberId}` : "Ödeme bekleniyor") : "Bağlı değil",
          },
          {
            logo: "instagram" as const,
            title: "Instagram DM",
            ok: igOk,
            text: igOk ? "Bağlı" : ig?.status === "REVOKED" ? "Erişim iptal edildi" : "Bağlı değil",
          },
          {
            logo: "meta" as const,
            title: "Sohbet Asistanı",
            ok: assistantOn,
            text: assistantOn ? `${configs.filter((c) => c.enabled).length} asistan açık` : "Kapalı",
          },
        ].map((o) => (
          <div
            key={o.title}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-surface p-4",
              o.ok ? "border-emerald-500/40" : "border-line",
            )}
          >
            <BrandBadge name={o.logo} size={40} />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-fg">{o.title}</span>
              <span className={cn("text-xs", o.ok ? "text-emerald-700" : "text-fg-muted")}>
                {o.ok ? "✓ " : ""}
                {o.text}
              </span>
            </div>
          </div>
        ))}
      </div>

      {!live ? (
        <InfoNote>
          Hesabınız deneme modunda: mesajlar gerçek alıcılara gitmez. KVKK adımları tamamlanınca canlıya geçin.
        </InfoNote>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SetupWizard
          title="WhatsApp kurulumu"
          doneText="WhatsApp hazır. Mesajlar Mesaj Kutusu'na düşüyor."
          steps={[
            {
              key: "numara",
              title: "Numaranızı bağlayın",
              done: !!num,
              hint: "Meta ile giriş yapın, işletme numaranızı seçin.",
              content: num ? (
                <p className="text-sm text-fg-muted">Bağlı: {num.displayNumber ?? num.phoneNumberId}</p>
              ) : (
                <WhatsAppSignupForm />
              ),
            },
            {
              key: "odeme",
              title: "Ödeme yöntemini ekleyin",
              done: paid,
              hint: "Mesaj ücretini Meta doğrudan sizden alır.",
              content:
                num?.onboardingStep === "identity_verification" ? (
                  <InfoNote>Meta iş doğrulaması istiyor; WhatsApp Manager&apos;da tamamlayın.</InfoNote>
                ) : (
                  <ConfirmPaymentButton />
                ),
            },
            {
              key: "sablon",
              title: "Bir mesaj şablonu onaylatın",
              done: activeTpl > 0,
              hint: "24 saati geçen konuşmalara yalnız onaylı şablonla yazılır.",
              content: (
                <div className="flex flex-col gap-3">
                  {templates.length ? (
                    <ul className="flex flex-wrap gap-2 text-[12px]">
                      {templates.map((x) => (
                        <li key={x.id} className="rounded-full border border-line px-2 py-0.5">
                          {x.name} · {statusLabel[x.status]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <TemplateForm />
                </div>
              ),
            },
            {
              key: "asistan",
              title: "Asistanı WhatsApp'ta açın",
              done: assistantOn,
              hint: "İlk yanıtı asistan verir, gerekirse size aktarır.",
              content: goAssistant,
            },
            {
              key: "canli",
              title: "Canlıya geçin",
              done: live,
              hint: "KVKK bildirimi tamamlanınca açılır.",
              content: goLive,
            },
          ]}
        />

        <SetupWizard
          title="Instagram DM kurulumu"
          doneText="Instagram hazır. DM'ler Mesaj Kutusu'na düşüyor."
          steps={[
            {
              key: "pro",
              title: "Hesabı Professional yapın",
              done: igOk,
              hint: "Instagram ayarlarından Business veya Creator hesaba geçin ve Facebook Sayfasına bağlayın.",
            },
            {
              key: "bagla",
              title: "Instagram'ı bağlayın",
              done: igOk,
              hint: "Meta ile giriş yapıp mesaj izni verin.",
              content: igOk ? <p className="text-sm text-fg-muted">Bağlı.</p> : <InstagramConnectForm />,
            },
            {
              key: "asistan",
              title: "Asistanı Instagram'da açın",
              done: igOk && assistantOn,
              hint: "Aynı asistan iki kanalda da çalışır.",
              content: goAssistant,
            },
            {
              key: "canli",
              title: "Canlıya geçin",
              done: live,
              content: goLive,
            },
          ]}
        />
      </div>

      <InstagramAutoReplyPanel tenantId={t} initialRules={igAutoReplies} />

      {candidates.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>DM&apos;den Gelen İçerik Üreticisi Başvuruları ({candidates.length})</CardTitle>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-col py-2">
                <span>
                  @{c.handle ?? "?"} · {c.category ?? "kategori yok"}
                </span>
                <span className="text-[13px] text-fg-muted">
                  {c.followers ? `${c.followers.toLocaleString("tr-TR")} takipçi` : "takipçi bilinmiyor"} ·{" "}
                  {c.priceExpectation ?? "fiyat yok"} · {c.contact ?? "iletişim yok"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

async function InfluencerChannelsSection({ tenantId }: { tenantId: string }) {
  const igAutoReplies = await getInstagramAutoReplies(tenantId);
  return (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-2">
        <CardTitle>Instagram & Mesaj Bağlantıları</CardTitle>
        <p className="text-sm text-fg-muted">
          Instagram hesabınız bağlıysa gelen DM ve yorumlar otomatik olarak Mesaj Kutusu ve DM Otomasyonu akışlarına aktarılır.
        </p>
      </Card>
      <InstagramAutoReplyPanel tenantId={tenantId} initialRules={igAutoReplies} />
    </div>
  );
}

async function AdminAssistantsSection({
  brands,
  selectedBrandId,
}: {
  brands: { id: string; name: string; kind: string }[];
  selectedBrandId: string;
}) {
  const assistants = await prisma.agentConfig.findMany({
    orderBy: [{ enabled: "desc" }, { agentId: "asc" }],
    take: 100,
  });
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  return (
    <div className="flex flex-col gap-6">
      {brands.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3">
          <span className="text-xs font-semibold text-fg-muted">Marka Asistanı Seç:</span>
          {brands.slice(0, 12).map((b) => {
            const active = b.id === selectedBrandId;
            return (
              <Link
                key={b.id}
                href={`/dashboard/iletisim?sekme=asistan&marka=${encodeURIComponent(b.id)}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  active
                    ? "border-fg bg-fg text-bg"
                    : "border-line bg-bg text-fg-muted hover:border-fg/40 hover:text-fg",
                )}
              >
                {b.name}
              </Link>
            );
          })}
        </div>
      ) : null}

      {selectedBrandId && selectedBrandId !== "ajans" ? (
        <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <BrandAssistants tenantId={selectedBrandId} />
        </div>
      ) : null}

      <DataTable
        caption="Tüm Markalar · Asistan Takip Tablosu"
        emptyText="Yapılandırılmış asistan yok."
        columns={[
          { key: "brand", header: "Marka", sortable: true },
          { key: "agent", header: "Asistan", sortable: true },
          { key: "status", header: "Durum", sortable: true },
          { key: "conf", header: "Güven Eşiği", sortable: true },
          { key: "turns", header: "Maks. Tur", sortable: true },
        ]}
        rows={assistants.map((a) => ({
          id: a.id,
          cells: {
            brand: brandName.get(a.tenantId) ?? a.tenantId.slice(-6),
            agent: a.agentId,
            status: {
              sort: a.enabled ? 1 : 0,
              display: <StatusDot tone={a.enabled ? "active" : "passive"}>{a.enabled ? "Açık" : "Kapalı"}</StatusDot>,
            },
            conf: `%${Math.round(Number(a.confidenceThreshold) * 100)}`,
            turns: String(a.maxTurnsBeforeHandoff),
          },
        }))}
      />
    </div>
  );
}
