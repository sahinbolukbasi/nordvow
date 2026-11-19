import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { listInbox, instagramInboxNotes } from "@infulancer/core/messaging/inbox";
import { isOpen, minutesLeft } from "@infulancer/core/messaging/windows";
import { handoffReasonLabels, type HandoffReason } from "@infulancer/core/assistant/runtime";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { InfoNote } from "@/components/ui/unverified";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Gelen kutusu ve Botlar" };
export const dynamic = "force-dynamic";

const statusLabels = { open: "Bot aktif", awaiting_human: "Temsilci bekliyor", assigned: "Temsilcide", closed: "Kapalı" } as const;

function countdown(min: number | null) {
  if (min == null) return "—";
  if (min <= 0) return "Kapandı";
  const h = Math.floor(min / 60);
  return h ? `${h} sa ${min % 60} dk` : `${min} dk`;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ kanal?: string }> }) {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const brandId = actor.brandId!;
  const { kanal } = await searchParams;
  const selectedChannel = kanal === "WHATSAPP" || kanal === "INSTAGRAM" ? kanal : null;

  const now = new Date();
  const [list, connections, activeBots] = await Promise.all([
    listInbox(brandId),
    prisma.channelConnection.findMany({
      where: { tenantId: brandId, provider: { in: ["WHATSAPP", "INSTAGRAM"] } },
      select: { provider: true, status: true },
    }),
    prisma.agentConfig.count({ where: { tenantId: brandId, enabled: true } }),
  ]);

  const hasWaKey = connections.some((c) => c.provider === "WHATSAPP" && c.status === "ACTIVE");
  const hasIgKey = connections.some((c) => c.provider === "INSTAGRAM" && c.status === "ACTIVE");
  const botActive = activeBots > 0;

  if (!selectedChannel) {
    const waCount = list.filter((c) => c.channel === "WHATSAPP").length;
    const igCount = list.filter((c) => c.channel === "INSTAGRAM").length;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={tt("Kanal ve Bot Seçimi")}
          description={tt("Gelen kutusunu açmadan önce çalışmak istediğiniz kanalı seçin. Gerekli API anahtarları ve firma botu aktif olduğunda sistem gelen mesajları otomatik yönetir.")}
          actions={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/dashboard/mesaj-kutusu" size="sm">{tt("Birleşik Mesaj Kutusu'nu Aç →")}</ButtonLink>
              <ButtonLink href="/marka/kanallar" variant="secondary" size="sm">{tt("API Anahtarlarını Yönet")}</ButtonLink>
              <ButtonLink href="/marka/asistanlar" variant="secondary" size="sm">{tt("Firma Botu Ayarları")}</ButtonLink>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            { id: "WHATSAPP" as const, title: "WhatsApp Bot & Gelen Kutusu", hasKey: hasWaKey, count: waCount },
            { id: "INSTAGRAM" as const, title: "Instagram DM Bot & Gelen Kutusu", hasKey: hasIgKey, count: igCount },
          ].map((ch) => (
            <Card key={ch.id} interactive={false} className="flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{tt(ch.title)}</CardTitle>
                  <StatusDot tone={ch.hasKey ? "active" : "passive"}>
                    {ch.hasKey ? tt("Anahtarlar Bağlı") : tt("Anahtar Eksik")}
                  </StatusDot>
                </div>
                <div className="flex flex-wrap gap-3 text-[13px] text-fg-muted">
                  <span>{tt("Firma Botu:")}{" "}<strong className="text-fg">{botActive ? tt("Aktif") : tt("Pasif")}</strong></span>
                  <span>·</span>
                  <span>{ch.count}{" "}{tt("konuşma")}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {ch.hasKey ? (
                  <ButtonLink href={`/marka/gelen-kutusu?kanal=${ch.id}`} size="sm">
                    {ch.id === "WHATSAPP" ? tt("WhatsApp Kanalını Aç →") : tt("Instagram Kanalını Aç →")}
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/marka/kanallar" variant="secondary" size="sm">
                    {tt("Önce API Anahtarını Bağla →")}
                  </ButtonLink>
                )}
                {!botActive ? (
                  <ButtonLink href="/marka/asistanlar" variant="ghost" size="sm">
                    {tt("Botu Aç")}
                  </ButtonLink>
                ) : null}
              </div>
            </Card>
          ))}
        </div>

        <InfoNote>{tt("Instagram notları:")}{" "}{instagramInboxNotes.join(" ")}</InfoNote>
      </div>
    );
  }

  const channelReady = selectedChannel === "WHATSAPP" ? hasWaKey : hasIgKey;
  const filtered = list.filter((c) => c.channel === selectedChannel);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${selectedChannel === "WHATSAPP" ? "WhatsApp" : "Instagram"} ${tt("Bot ve Gelen Kutusu")}`}
        description={
          botActive
            ? tt("Firmanızın AI botu aktif: gelen mesajlar otomatik karşılanır ve yanıtlanır.")
            : tt("Firmanızın AI botu şu an pasif. Asistanlar sayfasından etkinleştirebilirsiniz.")
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/marka/gelen-kutusu" variant="secondary" size="sm">{tt("← Kanal Değiştir")}</ButtonLink>
            <ButtonLink href="/marka/asistanlar" variant="secondary" size="sm">{tt("Bot Ayarları")}</ButtonLink>
          </div>
        }
      />

      {!channelReady ? (
        <Card interactive={false} className="flex flex-col gap-3 border-amber-500/30 bg-amber-500/5">
          <CardTitle>{tt("Gerekli kanal anahtarları tanımlanmamış")}</CardTitle>
          <p className="text-sm text-fg-muted">
            {selectedChannel === "WHATSAPP"
              ? tt("WhatsApp erişim belirteci ve numara kimliği bağlandıktan sonra botunuz ve konuşmalar burada çalışır.")
              : tt("Instagram erişim belirteci ve hesap kimliği bağlandıktan sonra DM botunuz ve konuşmalar burada çalışır.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/marka/kanallar" size="sm">{tt("Anahtarları Bağla →")}</ButtonLink>
            <ButtonLink href="/marka/asistanlar" variant="secondary" size="sm">{tt("Botu Yapılandır")}</ButtonLink>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState message={tt("Bu kanalda henüz gelen mesaj yok. Mesaj geldiğinde firmanızın botu otomatik yanıtlayacaktır.")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((c) => {
            const min = minutesLeft(c.serviceWindowExpiresAt, now);
            const fep = isOpen(c.fepWindowExpiresAt, now);
            return (
              <li key={c.id}>
                <Link href={`/marka/gelen-kutusu/${c.id}`} className="block">
                  <Card className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{c.contact.name ?? c.contact.phoneE164 ?? c.contact.externalId}</span>
                      <span className="text-[13px] text-fg-muted">{c.channel}</span>
                    </div>
                    <p className="line-clamp-1 text-sm text-fg-muted">{c.messages[0]?.body ?? "—"}</p>
                    <div className="flex flex-wrap gap-4 text-[13px]">
                      <StatusDot tone={c.status === "awaiting_human" ? "critical" : c.status === "closed" ? "passive" : "active"}>
                        {statusLabels[c.status]}
                        {c.handoffReason ? ` · ${handoffReasonLabels[c.handoffReason as HandoffReason] ?? c.handoffReason}` : ""}
                      </StatusDot>
                      <span className={min != null && min > 0 && min <= 15 ? "text-critical" : "text-fg-muted"} aria-label={tt("Servis penceresi kalan süre")}>{tt("Pencere:")}{" "}{countdown(min)}
                      </span>
                      {fep ? <span className="text-fg">{tt("Reklam trafiği · 7 gün ücretsiz konuşma (kalan")}{" "}{countdown(minutesLeft(c.fepWindowExpiresAt, now))})</span> : null}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
