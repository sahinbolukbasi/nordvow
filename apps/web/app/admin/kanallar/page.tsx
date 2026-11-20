import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { freeTierStatus } from "@infulancer/core/messaging/cost";
import { qualityLabel, statusLabel } from "@infulancer/core/messaging/templates";
import { tierCapacity } from "@infulancer/core/messaging/tiers";
import { EMBEDDED_SIGNUP_VERSION } from "@infulancer/core/channels/onboarding";
import { UNVERIFIED_FACTS } from "@infulancer/core/unverified";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { UnverifiedBadge } from "@/components/ui/unverified";
import { requireActor } from "@/lib/auth-guard";
import { DocLink } from "@/components/docs/doc-components";
import { PageGuide } from "@/components/ui/page-guide";
import { getInstagramAutoReplies } from "@infulancer/core/messaging/instagram-auto-reply";
import { InstagramAutoReplyPanel } from "@/components/channels/instagram-auto-reply-panel";
import { RunJobButton } from "@/components/forms/operations-forms";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { etiketle } from "@/lib/iletisim/etiketler";

export const metadata: Metadata = { title: "Kanallar" };

const num = new Intl.NumberFormat("tr-TR");

export default async function AdminChannelsPage() {
  const tt = await getTT();
  await requireActor("ADMIN");
  const [connections, numbers, templates, brands] = await Promise.all([
    prisma.channelConnection.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.whatsAppNumber.findMany(),
    prisma.messageTemplate.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
  ]);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const [assistants, settings, conversations] = await Promise.all([
    prisma.agentConfig.findMany({ orderBy: [{ enabled: "desc" }, { agentId: "asc" }], take: 100 }),
    prisma.tenantSettings.findMany({ select: { tenantId: true, mode: true } }),
    prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 60,
      include: { contact: { select: { name: true, phoneE164: true, externalId: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true } } },
    }),
  ]);
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
  const ready = (k: keyof (typeof readiness)[number]) => readiness.filter((r) => r[k]).length;
  const defaultBrandId = brands[0]?.id ?? "default";
  const igAutoReplies = await getInstagramAutoReplies(defaultBrandId);
  const quotas = await Promise.all(numbers.map(async (n) => ({ n, q: await freeTierStatus(n.phoneNumberId) })));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={tt("Kanallar")}
        description={`WhatsApp (Embedded Signup ${EMBEDDED_SIGNUP_VERSION}), Instagram ve Messenger bağlantıları, template sağlığı ve mesaj kotası.`}
        actions={<RunJobButton job="channel-health" label={tt("Bağlantıları şimdi kontrol et")} />}
      />
      <PageGuide
        what="Markaların müşterileriyle WhatsApp ve Instagram üzerinden konuştuğu kanalların kontrol paneli. Her markanın kendi numarası ve bağlantısı olur; mesajlar markanın Gelen kutusu’na düşer, sohbet asistanı ilk cevabı verir."
        why="Pencere (24 saat) kapandıktan sonra yalnız Meta onaylı template ile yazılabilir; template kalitesi düşerse gönderim otomatik durur. Bu sayfa hangi markanın neyi eksik olduğunu gösterir."
        steps={[
          { label: "Marka WhatsApp numarasını bağlar", done: ready("whatsapp") === brands.length && brands.length > 0, hint: `${ready("whatsapp")}/${brands.length} marka · Marka panelinde Kanallar sayfasından` },
          { label: "Marka WhatsApp Manager’da ödeme yöntemini ekler", done: ready("payment") === brands.length && brands.length > 0, hint: `${ready("payment")}/${brands.length} marka · olmadan mesaj gönderilemez` },
          { label: "En az bir template Meta onayından geçer", done: ready("template") === brands.length && brands.length > 0, hint: `${ready("template")}/${brands.length} marka` },
          { label: "Sohbet asistanı açılır ve bilgi tabanı doldurulur", done: ready("assistant") === brands.length && brands.length > 0, hint: `${ready("assistant")}/${brands.length} marka · Agent merkezi → Sohbet asistanları` },
          { label: "KVKK bildirimi tamamlanıp marka canlı moda geçer", done: ready("live") === brands.length && brands.length > 0, hint: `${ready("live")}/${brands.length} marka · Uyum sayfası` },
        ]}
      />
      <DataTable
        caption={tt("Marka kanal ve asistan hazırlık durumu")}
        emptyText={tt("Henüz marka yok.")}
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
            brand: { sort: r.brand.name, display: <a href={`/admin/markalar/${r.brand.id}`} className="font-medium hover:underline">{r.brand.name}</a> },
            whatsapp: <StatusDot tone={r.whatsapp ? "active" : "passive"}>{r.whatsapp ? tt("Var") : tt("Yok")}</StatusDot>,
            payment: <StatusDot tone={r.payment ? "active" : "passive"}>{r.payment ? tt("Var") : tt("Yok")}</StatusDot>,
            template: <StatusDot tone={r.template ? "active" : "passive"}>{r.template ? tt("Var") : tt("Yok")}</StatusDot>,
            instagram: <StatusDot tone={r.instagram ? "active" : "passive"}>{r.instagram ? tt("Var") : tt("Yok")}</StatusDot>,
            assistant: <StatusDot tone={r.assistant ? "active" : "passive"}>{r.assistant ? tt("Var") : tt("Yok")}</StatusDot>,
            live: <StatusDot tone={r.live ? "active" : "passive"}>{r.live ? tt("Var") : tt("Yok")}</StatusDot>,
          },
        }))}
      />

      <DataTable
        caption={tt("Mesajlar ve Konuşma Takibi")}
        emptyText={tt("Henüz mesaj konuşması yok.")}
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
            channel: c.channel === "WHATSAPP" ? "WhatsApp" : c.channel === "INSTAGRAM" ? "Instagram" : c.channel,
            brand: brandName.get(c.tenantId) ?? "Ajans",
            contact: c.contact.name ?? c.contact.phoneE164 ?? "İsimsiz kişi",
            lastMsg: <span className="line-clamp-1 max-w-xs text-fg-muted">{c.messages[0]?.body ?? "—"}</span>,
            status: { sort: c.status, display: <StatusDot tone={c.status === "awaiting_human" ? "critical" : c.status === "closed" ? "passive" : "active"}>{etiketle(c.status)}</StatusDot> },
            updated: { sort: c.updatedAt.getTime(), display: fmtDateTime(c.updatedAt) },
          },
        }))}
      />

      <DataTable
        caption={tt("Asistanlar Takip Tablosu")}
        emptyText={tt("Yapılandırılmış asistan yok.")}
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
            brand: brandName.get(a.tenantId) ?? "Ajans",
            agent: etiketle(a.agentId),
            status: { sort: a.enabled ? 1 : 0, display: <StatusDot tone={a.enabled ? "active" : "passive"}>{a.enabled ? tt("Açık") : tt("Kapalı")}</StatusDot> },
            conf: `%${Math.round(Number(a.confidenceThreshold) * 100)}`,
            turns: String(a.maxTurnsBeforeHandoff),
          },
        }))}
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label={tt("WhatsApp numaraları")}>
        {quotas.map(({ n, q }) => (
          <Card key={n.id} interactive={false} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{brandName.get(n.tenantId) ?? "Ajans"}</CardTitle>
              <StatusDot tone={n.paymentMethod === "payment_method_confirmed" ? "active" : "critical"}>
                {n.paymentMethod === "payment_method_confirmed" ? tt("Onboarding tamam") : tt("Ödeme yöntemi bekleniyor")}
              </StatusDot>
            </div>
            <p className="text-sm text-fg-muted">{n.displayNumber ?? n.phoneNumberId}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-fg-muted">{tt("Mesaj limiti (portföy)")}</dt>
                <dd className="tabular-nums">
                  {etiketle(n.messagingLimit, n.messagingLimit)} · {Number.isFinite(tierCapacity(n.messagingLimit)) ? `${num.format(tierCapacity(n.messagingLimit))} tekil alıcı / 24 sa` : tt("sınırsız")}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">{tt("Ücretsiz servis mesajı (bu ay)")}</dt>
                <dd className="tabular-nums">
                  {num.format(q.remaining)} / {num.format(q.free)}{" "}{tt("kaldı")}{q.exhaustAt ? ` · tahmini bitiş ${fmtDate(q.exhaustAt)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">{tt("Kalite")}</dt>
                <dd>{n.qualityRating ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{" "}{tt("Throughput")}<UnverifiedBadge title={UNVERIFIED_FACTS.waThroughput} />
                </dt>
                <dd>{n.throughputLevel ?? tt("Meta bildirimi bekleniyor")}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </section>
      <DocLink slug="whatsapp-cloud-api" />

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Bağlantılar")}</CardTitle>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {brandName.get(c.tenantId) ?? "Ajans"} · {c.provider === "WHATSAPP" ? "WhatsApp" : c.provider === "INSTAGRAM" ? "Instagram" : c.provider}
              </span>
              <span className="text-fg-muted">{" "}{tt("Son doğrulama:")}{" "}{c.lastVerifiedAt ? fmtDateTime(c.lastVerifiedAt) : "—"}
                {c.lastError ? ` · ${c.lastError}` : ""}
              </span>
              <StatusDot tone={c.status === "ACTIVE" ? "active" : c.status === "REVOKED" ? "critical" : "muted"}>{etiketle(c.status)}</StatusDot>
            </li>
          ))}
        </ul>
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Şablonlar")}</CardTitle>
        <p className="text-[13px] text-fg-muted">{" "}{tt("Kalite Orta olunca gönderim hızı %50’ye kısılır; Düşük olunca gönderim otomatik durur. 1. duraklatma 3 saat, 2. duraklatma 6 saat; 3. duraklatmada şablon devre dışı kalır.")}</p>
        <table className="w-full text-sm">
          <caption className="sr-only">{tt("Şablon durumu ve kalitesi")}</caption>
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="py-2 font-normal">{tt("Marka")}</th>
              <th className="py-2 font-normal">{tt("Şablon")}</th>
              <th className="py-2 font-normal">{tt("Kategori")}</th>
              <th className="py-2 font-normal">{tt("Durum")}</th>
              <th className="py-2 font-normal">{tt("Kalite")}</th>
              <th className="py-2 font-normal">{tt("Hız")}</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-border">
                <td className="py-2">{brandName.get(t.tenantId) ?? "Ajans"}</td>
                <td className="py-2">{t.name}</td>
                <td className="py-2">{t.containsPromotion && t.category !== "marketing" ? `${etiketle(t.category)} (promosyon → pazarlama)` : etiketle(t.category)}</td>
                <td className="py-2">{statusLabel[t.status]}</td>
                <td className="py-2">
                  <StatusDot tone={t.quality === "LOW" ? "critical" : t.quality === "MEDIUM" ? "muted" : "active"}>{qualityLabel[t.quality]}</StatusDot>
                </td>
                <td className="py-2 tabular-nums">%{Math.round(Number(t.sendRateFactor) * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <InstagramAutoReplyPanel tenantId={defaultBrandId} initialRules={igAutoReplies} />

      <Card interactive={false} className="flex flex-col gap-2">
        <CardTitle>{tt("Kanal kuralları")}</CardTitle>
        <DocLink slug="whatsapp-cloud-api" />
        <DocLink slug="messenger-instagram-dm" />
        <DocLink slug="tiktok-content-api" />
        <p className="text-[12px] text-fg-passive">
          {UNVERIFIED_FACTS.igRateLimits} <UnverifiedBadge />
        </p>
      </Card>
    </div>
  );
}
