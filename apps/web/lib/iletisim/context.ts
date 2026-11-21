import { prisma } from "@infulancer/core/db";
import { listDmCampaignsWithSummary } from "@infulancer/core/dm-automation/store";
import { loadDmAutomationPageContext } from "@/lib/dm-automation-page";

export type DurumBandiBilgi =
  | {
      tone: "critical" | "warn";
      message: string;
      actionLabel: string;
      actionHref: string;
    }
  | null;

export type KurulumAdimi = {
  key: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
};

/**
 * Seçili marka/hesap için İletişim Merkezi bağlamını yükler.
 * Tüm sayaçlar seçili `tenantId` ile birebir sınırlıdır (markalar arası karışım olmaz).
 */
export async function loadIletisimContext(requestedMarka?: string) {
  const base = await loadDmAutomationPageContext();
  const { actor, tenantOptions } = base;
  const isAdmin = actor.role === "ADMIN" || actor.role === "AGENCY";
  const isBrand = actor.role === "BRAND" && !!actor.brandId;

  // Marka kullanıcısı yalnızca kendi markasını görebilir; admin marka parametresi ile geçebilir.
  const activeTenantId = isBrand
    ? actor.brandId!
    : isAdmin && requestedMarka && tenantOptions.some((t) => t.id === requestedMarka)
      ? requestedMarka
      : base.initialTenantId;

  const activeTenant = tenantOptions.find((t) => t.id === activeTenantId) ?? null;

  const [
    awaitingHuman,
    igConn,
    waNum,
    templates,
    dmSummary,
    assistantConfigs,
    knowledgeCount,
  ] = await Promise.all([
    prisma.conversation.count({ where: { tenantId: activeTenantId, status: "awaiting_human" } }).catch(() => 0),
    prisma.channelConnection
      .findFirst({ where: { tenantId: activeTenantId, provider: "INSTAGRAM" }, orderBy: { createdAt: "desc" } })
      .catch(() => null),
    prisma.whatsAppNumber.findUnique({ where: { tenantId: activeTenantId } }).catch(() => null),
    prisma.messageTemplate.findMany({ where: { tenantId: activeTenantId }, orderBy: { name: "asc" } }).catch(() => []),
    listDmCampaignsWithSummary(activeTenantId).catch(() => null),
    prisma.agentConfig.findMany({ where: { tenantId: activeTenantId } }).catch(() => []),
    prisma.knowledgeSource.count({ where: { tenantId: activeTenantId, type: { not: "message" } } }).catch(() => 0),
  ]);

  const igConnected = igConn?.status === "ACTIVE";
  const igRevoked = igConn?.status === "REVOKED";
  const waConnected = Boolean(waNum);
  const activeAutomationsCount = (dmSummary?.campaigns ?? []).filter((c) => c.status === "ACTIVE").length;
  const totalAutomationsCount = (dmSummary?.campaigns ?? []).length;
  const assistantConfiguredAndOn = assistantConfigs.some((a) => a.enabled);

  const markaQs = isAdmin && activeTenantId ? `?marka=${encodeURIComponent(activeTenantId)}` : "";

  // En ciddi TEK durumu belirle: 1) Kopmuş Instagram -> 2) Duraklatılmış/düşük kalite şablon
  let banner: DurumBandiBilgi = null;
  if (igRevoked) {
    banner = {
      tone: "critical",
      message: "Instagram bağlantınız koptu, otomasyonlar duruyor.",
      actionLabel: "Yeniden bağla",
      actionHref: `/dashboard/iletisim/ayarlar/kanallar${markaQs}`,
    };
  } else {
    const troubledTpl = templates.find((t) => t.status === "PAUSED" || t.quality === "LOW");
    if (troubledTpl) {
      banner = {
        tone: "warn",
        message: `WhatsApp şablonu "${troubledTpl.name}" duraklatıldı veya kalitesi düştü.`,
        actionLabel: "İncele",
        actionHref: `/dashboard/iletisim/ayarlar/sablonlar${markaQs}`,
      };
    }
  }

  const checklist: KurulumAdimi[] = [
    {
      key: "instagram",
      label: "Instagram'ı bağla",
      done: igConnected,
      href: `/dashboard/iletisim/ayarlar/kanallar${markaQs}`,
      cta: "Bağla →",
    },
    {
      key: "whatsapp",
      label: "WhatsApp'ı bağla",
      done: waConnected,
      href: `/dashboard/iletisim/ayarlar/kanallar${markaQs}`,
      cta: "Bağla →",
    },
    {
      key: "otomasyon",
      label: "İlk otomasyonunu kur",
      done: totalAutomationsCount > 0,
      href: `/dashboard/iletisim/otomasyonlar?tur=yorum-dm${isAdmin && activeTenantId ? `&marka=${encodeURIComponent(activeTenantId)}` : ""}`,
      cta: "Kur →",
    },
    {
      key: "asistan",
      label: "Asistanı bilgi tabanınla eğit",
      done: assistantConfiguredAndOn && knowledgeCount > 0,
      href: `/dashboard/iletisim/otomasyonlar?tur=asistan${isAdmin && activeTenantId ? `&marka=${encodeURIComponent(activeTenantId)}` : ""}`,
      cta: "Başla →",
    },
  ];

  // Marka kullanıcısına yalnızca kendi markası verilir (26 çalışma alanı listesi gizlenir).
  const visibleTenantOptions = isAdmin
    ? tenantOptions
    : tenantOptions.filter((t) => t.id === activeTenantId);

  return {
    ...base,
    isAdmin,
    isBrand,
    activeTenantId,
    activeTenantName: activeTenant?.name ?? "Nordvow",
    visibleTenantOptions,
    awaitingHuman,
    igConnected,
    igRevoked,
    waConnected,
    activeAutomationsCount,
    assistantConfiguredAndOn,
    banner,
    checklist,
    markaQs,
  };
}

