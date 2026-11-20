import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { freeTierStatus } from "@infulancer/core/messaging/cost";
import { qualityLabel, statusLabel } from "@infulancer/core/messaging/templates";
import { tierCapacity } from "@infulancer/core/messaging/tiers";
import { RunJobButton } from "@/components/forms/operations-forms";
import { InstagramConnectForm, WhatsAppSignupForm } from "@/components/inbox/inbox-forms";
import { AppShell } from "@/components/shell/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { StatusDot } from "@/components/ui/status";
import { CopyCode } from "@/components/wallet/copy-code";
import { requireActor } from "@/lib/auth-guard";
import { etiketle } from "@/lib/iletisim/etiketler";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Admin · İletişim Yönetimi" };
export const dynamic = "force-dynamic";

const numFmt = new Intl.NumberFormat("tr-TR");

/**
 * Yalnızca ADMIN erişimine açık markalar arası iletişim yönetim merkezi.
 * Marka kullanıcılarının görmemesi gereken tüm markalar arası tablolar, ham ID'ler,
 * WhatsApp TIER/kota kartları ve manuel kanal bağlantı alanları burada toplanır.
 */
export default async function AdminIletisimPage() {
  const actor = await requireActor("ADMIN");

  const [connections, numbers, templates, brands, assistants, settings, conversations] = await Promise.all([
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
    const igActive = conns.some((c) => c.provider === "INSTAGRAM" && c.status === "ACTIVE");
    const igRevoked = !igActive && conns.some((c) => c.provider === "INSTAGRAM" && c.status === "REVOKED");
    const brandAssistants = assistants.filter((a) => a.tenantId === b.id);
    const hasActiveAssistant = brandAssistants.some((a) => a.enabled);
    const hasConfiguredAssistant = brandAssistants.length > 0;
    return {
      brand: b,
      whatsapp: !!n,
      payment: n?.paymentMethod === "payment_method_confirmed",
      template: templates.some((t) => t.tenantId === b.id && t.status === "ACTIVE"),
      instagram: igActive ? "ACTIVE" : igRevoked ? "REVOKED" : "DISCONNECTED",
      assistantState: hasActiveAssistant ? "active" : hasConfiguredAssistant ? "disabled" : "unconfigured",
      live: settings.find((x) => x.tenantId === b.id)?.mode === "production",
    };
  });

  const quotas = await Promise.all(numbers.map(async (n) => ({ n, q: await freeTierStatus(n.phoneNumberId) })));

  return (
    <AppShell role={actor.role}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-title text-fg">Admin · İletişim Yönetimi</h1>
            <p className="text-sm text-fg-muted">
              Tüm markaların kanal sağlığı, konuşmaları, WhatsApp kotaları, şablon kalitesi ve manuel bağlantıları.
            </p>
          </div>
          <RunJobButton job="channel-health" label="Bağlantıları kontrol et" />
        </header>

        {/* 1. Markalar Arası Kanal Hazırlık Tablosu */}
        <DataTable
          caption={`Markalar (${brands.length})`}
          emptyText="Henüz marka yok."
          columns={[
            { key: "brand", header: "Marka", sortable: true },
            { key: "instagram", header: "Instagram" },
            { key: "whatsapp", header: "WhatsApp" },
            { key: "template", header: "Şablonlar" },
            { key: "assistant", header: "Asistan" },
            { key: "live", header: "Canlı" },
            { key: "actions", header: "İşlem" },
          ]}
          rows={readiness.map((r) => ({
            id: r.brand.id,
            cells: {
              brand: {
                sort: r.brand.name,
                display: (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">{r.brand.name}</span>
                    <CopyCode code={r.brand.id} label="ID" size="sm" />
                  </div>
                ),
              },
              instagram: (
                <StatusDot tone={r.instagram === "ACTIVE" ? "active" : r.instagram === "REVOKED" ? "critical" : "passive"}>
                  {etiketle(r.instagram)}
                </StatusDot>
              ),
              whatsapp: <StatusDot tone={r.whatsapp ? "active" : "passive"}>{r.whatsapp ? "Bağlı" : "Yok"}</StatusDot>,
              template: <StatusDot tone={r.template ? "active" : "passive"}>{r.template ? "Var" : "Yok"}</StatusDot>,
              assistant: (
                <StatusDot tone={r.assistantState === "active" ? "active" : r.assistantState === "disabled" ? "muted" : "passive"}>
                  {r.assistantState === "active" ? "Açık" : r.assistantState === "disabled" ? "Kapalı" : "Kurulmadı"}
                </StatusDot>
              ),
              live: <StatusDot tone={r.live ? "active" : "passive"}>{r.live ? "Evet" : "Hayır"}</StatusDot>,
              actions: (
                <Link
                  href={`/dashboard/iletisim/gelen-kutusu?marka=${encodeURIComponent(r.brand.id)}`}
                  className="text-xs font-medium text-fg underline underline-offset-4"
                >
                  Markaya git →
                </Link>
              ),
            },
          }))}
        />

        {/* 2. Tüm Markaların Konuşmaları (marka önekiyle + Türkçe etiketler) */}
        <DataTable
          caption="Tüm Markaların Konuşmaları"
          emptyText="Henüz konuşma yok."
          columns={[
            { key: "ref", header: "Konuşma" },
            { key: "channel", header: "Kanal", sortable: true },
            { key: "brand", header: "Marka", sortable: true },
            { key: "contact", header: "Kişi", sortable: true },
            { key: "lastMsg", header: "Son Mesaj" },
            { key: "status", header: "Durum", sortable: true },
            { key: "updated", header: "Güncelleme", sortable: true },
          ]}
          rows={conversations.map((c) => {
            const bLabel = brandName.get(c.tenantId) ?? "Ajans";
            return {
              id: c.id,
              cells: {
                ref: <span className="font-mono text-xs text-fg-muted">{bLabel.slice(0, 6).toUpperCase()}-{c.id.slice(-4)}</span>,
                channel: c.channel === "WHATSAPP" ? "WhatsApp" : "Instagram",
                brand: bLabel,
                contact: c.contact.name ?? c.contact.phoneE164 ?? c.contact.externalId,
                lastMsg: <span className="line-clamp-1 max-w-xs text-fg-muted">{c.messages[0]?.body ?? "—"}</span>,
                status: {
                  sort: c.status,
                  display: (
                    <StatusDot tone={c.status === "awaiting_human" ? "critical" : c.status === "closed" ? "passive" : "active"}>
                      {etiketle(c.status)}
                    </StatusDot>
                  ),
                },
                updated: { sort: c.updatedAt.getTime(), display: fmtDateTime(c.updatedAt) },
              },
            };
          })}
        />

        {/* 3. WhatsApp Hesapları & Kotaları */}
        {quotas.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="WhatsApp hesapları">
            {quotas.map(({ n, q }) => (
              <Card key={n.id} interactive={false} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle>{brandName.get(n.tenantId) ?? "Marka"}</CardTitle>
                    <CopyCode code={n.tenantId} label="ID" size="sm" />
                  </div>
                  <StatusDot tone={n.paymentMethod === "payment_method_confirmed" ? "active" : "critical"}>
                    {n.paymentMethod === "payment_method_confirmed" ? "Kurulum tamam" : "Ödeme bekleniyor"}
                  </StatusDot>
                </div>
                <p className="text-sm text-fg-muted">{n.displayNumber ?? n.phoneNumberId}</p>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-fg-muted">Mesaj limiti</dt>
                    <dd className="tabular-nums">
                      {etiketle(n.messagingLimit, n.messagingLimit)}
                      {Number.isFinite(tierCapacity(n.messagingLimit))
                        ? ` (${numFmt.format(tierCapacity(n.messagingLimit))} / 24 sa)`
                        : ""}
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

        {/* 4. Şablon Kalitesi */}
        {templates.length > 0 ? (
          <Card interactive={false} className="flex flex-col gap-3">
            <CardTitle>Şablon Kalitesi (Tüm Markalar)</CardTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-fg-muted">
                    <th className="py-2 font-normal">Marka</th>
                    <th className="py-2 font-normal">Şablon</th>
                    <th className="py-2 font-normal">Tür</th>
                    <th className="py-2 font-normal">Durum</th>
                    <th className="py-2 font-normal">Kalite</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-b border-line">
                      <td className="py-2">{brandName.get(t.tenantId) ?? "Marka"}</td>
                      <td className="py-2">{t.name}</td>
                      <td className="py-2 text-fg-muted">{etiketle(t.category, t.category)}</td>
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

        {/* 5. Admin Manuel Kanal Bağlantısı */}
        <Card interactive={false} className="flex flex-col gap-4">
          <CardTitle>Sistem &amp; Manuel Kanal Bağlantısı (Yalnızca Admin)</CardTitle>
          <p className="text-xs text-fg-muted">
            İşleyici durumu sağlıklı. Marka adına manuel OAuth / Page ID / WABA ID bağlantısı gerekiyorsa aşağıdaki formları kullanın.
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <InstagramConnectForm />
            <WhatsAppSignupForm />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

