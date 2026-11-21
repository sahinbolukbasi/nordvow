import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { qualityLabel, statusLabel } from "@infulancer/core/messaging/templates";
import { BrandBadge } from "@/components/icons/brand-logos";
import { ConfirmPaymentButton, InstagramConnectForm, TemplateForm, WhatsAppSignupForm } from "@/components/inbox/inbox-forms";
import { IletisimAyarlarClient } from "@/components/iletisim/ayarlar-panel";
import { IletisimShell } from "@/components/iletisim/iletisim-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { loadIletisimContext } from "@/lib/iletisim/context";
import { etiketle } from "@/lib/iletisim/etiketler";

export const metadata: Metadata = { title: "İletişim Ayarları · Nordvow" };
export const dynamic = "force-dynamic";

type Bolum = "kanallar" | "sablonlar" | "kisayollar" | "etiketler" | "gizlilik";
const VALID = new Set<Bolum>(["kanallar", "sablonlar", "kisayollar", "etiketler", "gizlilik"]);

const NAV_ITEMS: { id: Bolum; label: string }[] = [
  { id: "kanallar", label: "Kanallar" },
  { id: "sablonlar", label: "WhatsApp şablonları" },
  { id: "kisayollar", label: "Kısayol yanıtlar" },
  { id: "etiketler", label: "Etiketler" },
  { id: "gizlilik", label: "Gizlilik & KVKK" },
];

export default async function IletisimAyarlarBolumPage({
  params,
  searchParams,
}: {
  params: Promise<{ bolum: string }>;
  searchParams: Promise<{ marka?: string }>;
}) {
  const [{ bolum }, sp] = await Promise.all([params, searchParams]);
  if (!VALID.has(bolum as Bolum)) notFound();
  const activeSection = bolum as Bolum;

  const ctx = await loadIletisimContext(sp.marka);
  const t = ctx.activeTenantId;

  const [waNum, igConn, templates] = await Promise.all([
    activeSection === "kanallar"
      ? prisma.whatsAppNumber.findUnique({ where: { tenantId: t } }).catch(() => null)
      : Promise.resolve(null),
    activeSection === "kanallar"
      ? prisma.channelConnection
          .findFirst({ where: { tenantId: t, provider: "INSTAGRAM" }, orderBy: { createdAt: "desc" } })
          .catch(() => null)
      : Promise.resolve(null),
    activeSection === "sablonlar"
      ? prisma.messageTemplate.findMany({ where: { tenantId: t }, orderBy: { name: "asc" } }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const paid = waNum?.paymentMethod === "payment_method_confirmed";

  return (
    <IletisimShell
      role={ctx.actor.role}
      activeTab="ayarlar"
      awaitingHuman={ctx.awaitingHuman}
      banner={ctx.banner}
      isAdmin={ctx.isAdmin}
      activeTenantName={ctx.activeTenantName}
      markaQs={ctx.markaQs}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sol Ayarlar Menüsü */}
        <nav aria-label="İletişim ayarları" className="flex flex-row flex-wrap gap-1.5 lg:flex-col">
          {NAV_ITEMS.map((item) => {
            const active = activeSection === item.id;
            return (
              <Link
                key={item.id}
                href={`/dashboard/iletisim/ayarlar/${item.id}${ctx.markaQs}`}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-xs font-medium transition sm:text-[13px]",
                  active
                    ? "bg-fg text-bg"
                    : "border border-line bg-surface text-fg-muted hover:border-fg/40 hover:text-fg lg:border-transparent lg:bg-transparent",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Sağ İçerik */}
        <div className="min-w-0">
          {activeSection === "kanallar" ? (
            <div className="flex flex-col gap-5">
              <Card interactive={false} className="flex flex-col gap-4">
                <CardTitle>Bağlı Kanallar</CardTitle>

                {/* Instagram */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-bg/50 p-4">
                  <div className="flex items-center gap-3">
                    <BrandBadge name="instagram" size={38} />
                    <div>
                      <p className="text-sm font-semibold text-fg">Instagram</p>
                      <p className="text-xs text-fg-muted">
                        {igConn?.status === "ACTIVE"
                          ? "Bağlı · DM ve yorumlar Gelen Kutusu'na düşer"
                          : igConn?.status === "REVOKED"
                            ? etiketle("REVOKED")
                            : etiketle("DISCONNECTED")}
                      </p>
                    </div>
                  </div>
                  <StatusDot
                    tone={igConn?.status === "ACTIVE" ? "active" : igConn?.status === "REVOKED" ? "critical" : "passive"}
                  >
                    {igConn ? etiketle(igConn.status) : etiketle("DISCONNECTED")}
                  </StatusDot>
                </div>

                {igConn?.status !== "ACTIVE" ? (
                  <div className="rounded-2xl border border-dashed border-line p-4">
                    <p className="mb-3 text-xs font-medium text-fg">
                      {igConn?.status === "REVOKED"
                        ? "Instagram hesabınızı yeniden bağlayın:"
                        : "Instagram Business veya Creator hesabınızı bağlayın:"}
                    </p>
                    <InstagramConnectForm />
                  </div>
                ) : null}

                {/* WhatsApp */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-bg/50 p-4">
                  <div className="flex items-center gap-3">
                    <BrandBadge name="whatsapp" size={38} />
                    <div>
                      <p className="text-sm font-semibold text-fg">WhatsApp Business</p>
                      <p className="text-xs text-fg-muted">
                        {waNum
                          ? `${waNum.displayNumber ?? "Bağlı numara"} · ${paid ? "Hazır" : "Ödeme yöntemi bekleniyor"}`
                          : etiketle("DISCONNECTED")}
                      </p>
                    </div>
                  </div>
                  <StatusDot tone={waNum && paid ? "active" : waNum ? "muted" : "passive"}>
                    {waNum ? (paid ? "Bağlı" : "Ödeme bekleniyor") : etiketle("DISCONNECTED")}
                  </StatusDot>
                </div>

                {!waNum ? (
                  <div className="rounded-2xl border border-dashed border-line p-4">
                    <WhatsAppSignupForm />
                  </div>
                ) : !paid ? (
                  <div className="rounded-2xl border border-dashed border-line p-4">
                    <ConfirmPaymentButton />
                  </div>
                ) : null}
              </Card>
            </div>
          ) : null}

          {activeSection === "sablonlar" ? (
            <Card interactive={false} className="flex flex-col gap-5">
              <div>
                <CardTitle>WhatsApp şablonları</CardTitle>
                <p className="mt-1 text-xs text-fg-muted">
                  24 saatlik yanıt penceresi kapandığında yalnızca onaylı şablonlarla mesaj gönderebilirsiniz.
                </p>
              </div>
              {templates.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-fg-muted">
                        <th className="py-2 font-medium">Şablon adı</th>
                        <th className="py-2 font-medium">Tür</th>
                        <th className="py-2 font-medium">Durum</th>
                        <th className="py-2 font-medium">Kalite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((tpl) => (
                        <tr key={tpl.id} className="border-b border-line text-xs">
                          <td className="py-2.5 font-medium text-fg">{tpl.name}</td>
                          <td className="py-2.5 text-fg-muted">{etiketle(tpl.category, tpl.category)}</td>
                          <td className="py-2.5">{statusLabel[tpl.status]}</td>
                          <td className="py-2.5">
                            <StatusDot tone={tpl.quality === "LOW" ? "critical" : tpl.quality === "MEDIUM" ? "muted" : "active"}>
                              {qualityLabel[tpl.quality]}
                            </StatusDot>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-fg-muted">Henüz onaylı şablon yok.</p>
              )}
              <div className="border-t border-line pt-4">
                <TemplateForm />
              </div>
            </Card>
          ) : null}

          {activeSection === "kisayollar" || activeSection === "etiketler" || activeSection === "gizlilik" ? (
            <IletisimAyarlarClient tenantId={t} section={activeSection} />
          ) : null}
        </div>
      </div>
    </IletisimShell>
  );
}

