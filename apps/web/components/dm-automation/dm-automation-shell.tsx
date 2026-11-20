"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { etiketle } from "@/lib/iletisim/etiketler";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { matchKeyword, type KeywordMatchMode } from "@infulancer/core/dm-automation/matcher";

const DEFAULT_DM_FOOTER =
  "Bu mesajı yorumundaki talebin üzerine gönderdik. Bir daha mesaj almak istemezsen DUR yaz.";
import type { TenantOption } from "@/components/inbox/unified-inbox-shell";

type AccountItem = {
  id: string;
  tenantId: string;
  igUserId: string;
  username: string;
  status: "CONNECTED" | "REAUTH_REQUIRED" | "WEBHOOK_MISSING" | "REVOKED";
  authMode?: "OWN_OAUTH" | "PLATFORM_SYNCED" | "DEMO";
  autoLinked?: boolean;
  scopes: string[];
  webhookSubscribed: boolean;
  tokenExpiresAt: string | null;
  breakerOpenUntil: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  hourlyUsed?: number;
  hourlyCap?: number;
};

type MediaItem = {
  id: string;
  caption: string | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";
  mediaProductType: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string;
};

type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED" | "ACCOUNT_ISSUE";
type TriggerMode = "SPECIFIC_POST" | "NEXT_REEL" | "ANY_POST";
type RepeatPolicy = "NEVER" | "DAILY" | "ALWAYS";

type CampaignSummary = {
  id: string;
  igAccountId: string;
  igUserId: string;
  name: string;
  status: CampaignStatus;
  triggerMode: TriggerMode;
  mediaId: string | null;
  mediaPermalink: string | null;
  mediaThumbUrl: string | null;
  mediaCaption: string | null;
  pendingNextReel: boolean;
  dmTriggerEnabled: boolean;
  keywords: string[];
  matchMode: KeywordMatchMode;
  dmText: string;
  dmFooter: string;
  buttons: { label: string; url: string; trackedLinkId: string; slug: string }[];
  openingDmEnabled: boolean;
  openingDmText: string | null;
  openingDmButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplies: string[];
  couponId: string | null;
  couponCode: string | null;
  repeatPolicy: RepeatPolicy;
  sendCap: number | null;
  sentCount: number;
  startsAt: string | null;
  endsAt: string | null;
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  createdAt: string;
  metrics24h: {
    triggers: number;
    sent: number;
    queued: number;
    clicks: number;
    uniqueClicks: number;
    ctrPercent: number;
  };
};

type LogItem = {
  id: string;
  source: string;
  recipientIgsid: string;
  recipientUsername: string | null;
  triggerText: string | null;
  matchedKeyword: string | null;
  status: string;
  dmSentAt: string | null;
  publicReplyText: string | null;
  publicReplySentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type StatsResponse = {
  campaign: CampaignSummary;
  funnel: {
    triggers: number;
    sent: number;
    uniqueClicks: number;
    totalClicks: number;
    couponRedeemed: number;
    deliveryRatePercent: number;
    ctrPercent: number;
  };
  counts: { sent: number; pending: number; failed: number; skipped: number };
  hourlySeries: { hourLabel: string; triggers: number; sent: number; clicks: number }[];
  reasonBreakdown: { status: string; label: string; count: number }[];
  linkStats: { id: string; slug: string; label: string | null; destination: string; clicks: number; uniqueClicks: number }[];
};

type OptOutItem = {
  igAccountId: string;
  igsid: string;
  username?: string | null;
  keyword: string;
  createdAt: string;
};

type CouponOption = {
  id: string;
  title: string;
  sharedCode: string | null;
  valueType: string;
  value: number;
};

const STATUS_BADGES: Record<CampaignStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "Aktif", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  PAUSED: { label: "Duraklatıldı", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  DRAFT: { label: "Taslak", cls: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" },
  ENDED: { label: "Bitti", cls: "border-zinc-500/30 bg-zinc-600/20 text-zinc-400" },
  ACCOUNT_ISSUE: { label: "Hesap sorunu", cls: "border-red-500/40 bg-red-500/15 text-red-300" },
};

const LOG_BADGES: Record<string, string> = {
  SENT: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  PENDING: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  FAILED: "border-red-500/30 bg-red-500/10 text-red-300",
  UNCONFIRMED: "border-orange-500/30 bg-orange-500/10 text-orange-300",
};

function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DmAutomationShell({
  initialTenantId,
  tenantOptions = [],
  initialView = "list",
  initialCampaignId = null,
  featureAllowed = true,
  canAdminExport = true,
}: {
  initialTenantId: string;
  tenantOptions?: TenantOption[];
  initialView?: "list" | "new" | "detail" | "opt-outs";
  initialCampaignId?: string | null;
  featureAllowed?: boolean;
  canAdminExport?: boolean;
}) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [view, setView] = useState<"list" | "new" | "detail" | "opt-outs">(initialView);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(initialCampaignId);
  const [statusTab, setStatusTab] = useState<CampaignStatus | "ALL">("ALL");

  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [availableCoupons, setAvailableCoupons] = useState<CouponOption[]>([]);
  const [quota, setQuota] = useState({ tier: "pro", monthlyDmLimit: 10_000, activeCampaignLimit: 20, igAccountLimit: 3 });
  const [monthlyUsed, setMonthlyUsed] = useState(0);
  const [hourlyCap, setHourlyCap] = useState(700);
  const [hourlyUsed, setHourlyUsed] = useState(0);
  const [queueStatus, setQueueStatus] = useState<{ queuedCount: number; estimate: { minutes: number; formattedTr: string } }>({
    queuedCount: 0,
    estimate: { minutes: 0, formattedTr: "0 dk" },
  });
  const [workerHealthy, setWorkerHealthy] = useState(true);
  const [igAuthorizeUrl, setIgAuthorizeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  // Hesap bağlama modalı
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectIgUserId, setConnectIgUserId] = useState("");
  const [connectIgUsername, setConnectIgUsername] = useState("");
  const [connectAccountType, setConnectAccountType] = useState<"CREATOR" | "BUSINESS" | "PERSONAL">("CREATOR");
  const [connectCode, setConnectCode] = useState("");

  // Detay state
  const [detailTab, setDetailTab] = useState<"summary" | "logs" | "links" | "settings">("summary");
  const [detailStats, setDetailStats] = useState<StatsResponse | null>(null);
  const [detailLogs, setDetailLogs] = useState<LogItem[]>([]);
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});
  const [logFilterStatus, setLogFilterStatus] = useState<string>("ALL");
  const [logSearch, setLogSearch] = useState("");
  const [simCommentText, setSimCommentText] = useState("KOD");
  const [simUsername, setSimUsername] = useState("ornek.creator");

  // Opt-out state
  const [optOuts, setOptOuts] = useState<OptOutItem[]>([]);

  // Sihirbaz state (7 adım)
  const [wizardStep, setWizardStep] = useState(1);
  const [wAccountId, setWAccountId] = useState("");
  const [wName, setWName] = useState("Yeni Reel DM Otomasyonu");
  const [wTriggerMode, setWTriggerMode] = useState<TriggerMode>("SPECIFIC_POST");
  const [wMediaList, setWMediaList] = useState<MediaItem[]>([]);
  const [wSelectedMedia, setWSelectedMedia] = useState<MediaItem | null>(null);
  const [wDmTrigger, setWDmTrigger] = useState(false);
  const [wKeywordInput, setWKeywordInput] = useState("");
  const [wKeywords, setWKeywords] = useState<string[]>(["KOD"]);
  const [wMatchMode, setWMatchMode] = useState<KeywordMatchMode>("WHOLE_WORD");
  const [wTestInput, setWTestInput] = useState("KOD lütfen");
  const [wDmText, setWDmText] = useState(
    "Merhaba @{username}, istediğin indirim kodun: {kupon}\n\nHemen kullanmak için butona dokunabilirsin: {link}",
  );
  const [wDmFooter, setWDmFooter] = useState(DEFAULT_DM_FOOTER);
  const [wButtons, setWButtons] = useState<{ label: string; url: string }[]>([
    { label: "Kodu Kullan", url: "https://nordvow.com/kampanya" },
  ]);
  const [wCouponId, setWCouponId] = useState("");
  const [wCouponCode, setWCouponCode] = useState("NORDVOW25");
  const [wOpeningDmEnabled, setWOpeningDmEnabled] = useState(false);
  const [wOpeningDmText, setWOpeningDmText] = useState("Merhaba! Kodunu göndermem için aşağıdaki butona dokunabilirsin.");
  const [wOpeningDmBtnLabel, setWOpeningDmBtnLabel] = useState("Kodu göster");
  const [wPublicReplyEnabled, setWPublicReplyEnabled] = useState(true);
  const [wPublicReplies, setWPublicReplies] = useState<string[]>([
    "DM'den gönderdik.",
    "Mesaj kutunu kontrol edebilirsin.",
    "Kodun DM olarak iletildi.",
  ]);
  const [wPublicReplyDraft, setWPublicReplyDraft] = useState("");
  const [wRepeatPolicy, setWRepeatPolicy] = useState<RepeatPolicy>("DAILY");
  const [wSendCap, setWSendCap] = useState("");
  const [wStartsAt, setWStartsAt] = useState("");
  const [wEndsAt, setWEndsAt] = useState("");
  const [wAck1, setWAck1] = useState(false);
  const [wAck2, setWAck2] = useState(false);
  const [wAck3, setWAck3] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [hasBreakerOpen, setHasBreakerOpen] = useState(false);

  const notify = useCallback((tone: "ok" | "warn" | "error", text: string) => {
    setToast({ tone, text });
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchOverview = useCallback(async () => {
    if (!featureAllowed) {
      setLoading(false);
      return;
    }
    try {
      const [campRes, accRes] = await Promise.all([
        fetch(`/api/dm-automation/campaigns?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" }),
        fetch(`/api/dm-automation/accounts?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" }),
      ]);
      const campData = await campRes.json();
      const accData = await accRes.json();
      if (!campRes.ok) throw new Error(campData?.error?.message ?? "Kampanyalar alınamadı.");
      setCampaigns(campData.campaigns ?? []);
      setAvailableCoupons(campData.availableCoupons ?? []);
      if (campData.quota) setQuota(campData.quota);
      setMonthlyUsed(campData.monthlyUsed ?? 0);
      setHourlyCap(campData.hourlyCap ?? 700);
      setHourlyUsed(campData.hourlyUsed ?? 0);
      if (campData.queueStatus) setQueueStatus(campData.queueStatus);
      if (campData.workerHealth) setWorkerHealthy(Boolean(campData.workerHealth.healthy));

      if (accRes.ok) {
        const list = (accData.accounts ?? []) as AccountItem[];
        const nowTs = Date.now();
        setAccounts(list);
        setHasBreakerOpen(list.some((a) => Boolean(a.breakerOpenUntil && new Date(a.breakerOpenUntil).getTime() > nowTs)));
        setIgAuthorizeUrl(accData.igAuthorizeUrl ?? null);
        // Marka veya influencer'ın bağlı Instagram hesabını her zaman otomatik seç (tenant değişiminde eski ID kalmasın).
        const preferred = list.find((a) => a.status === "CONNECTED") ?? list[0];
        if (preferred && !list.some((a) => a.id === wAccountId)) {
          setWAccountId(preferred.id);
        }
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Veriler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, featureAllowed, notify, wAccountId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchOverview();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchOverview]);

  // Instagram Business Login OAuth dönüşünde (?code=...&state=...) kullanıcının kendi hesabını otomatik bağla.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code")?.trim();
    const state = params.get("state")?.trim();
    if (!code) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dm-automation/accounts?tenantId=${encodeURIComponent(tenantId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, ...(state ? { state } : {}) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Instagram yetkilendirmesi tamamlanamadı.");
        if (!cancelled) {
          const cleanUrl = `${window.location.pathname}`;
          window.history.replaceState({}, "", cleanUrl);
          await fetchOverview();
          notify("ok", `@${data.account.username} kendi Instagram hesabınızla bağlandı. DM'ler doğrudan hesabınızdan gönderilecek.`);
        }
      } catch (err) {
        if (!cancelled) {
          notify("error", err instanceof Error ? err.message : "Instagram OAuth bağlantısı başarısız.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, fetchOverview, notify]);

  const fetchMedia = useCallback(
    async (accId: string) => {
      if (!accId) return;
      try {
        const res = await fetch(
          `/api/dm-automation/accounts/${encodeURIComponent(accId)}/media?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (res.ok) {
          const items = (data.items ?? []) as MediaItem[];
          setWMediaList(items);
          if (!wSelectedMedia && items[0]) setWSelectedMedia(items[0]);
        }
      } catch {
        // ignore
      }
    },
    [tenantId, wSelectedMedia],
  );

  useEffect(() => {
    if (view !== "new" || !wAccountId) return;
    const timer = setTimeout(() => {
      void fetchMedia(wAccountId);
    }, 0);
    return () => clearTimeout(timer);
  }, [view, wAccountId, fetchMedia]);

  const fetchCampaignDetail = useCallback(
    async (campaignId: string) => {
      try {
        const qs = new URLSearchParams({ tenantId, status: logFilterStatus });
        if (logSearch.trim()) qs.set("q", logSearch.trim());
        const [stRes, lgRes] = await Promise.all([
          fetch(`/api/dm-automation/campaigns/${encodeURIComponent(campaignId)}/stats?tenantId=${encodeURIComponent(tenantId)}`, {
            cache: "no-store",
          }),
          fetch(`/api/dm-automation/campaigns/${encodeURIComponent(campaignId)}/logs?${qs.toString()}`, {
            cache: "no-store",
          }),
        ]);
        const stData = await stRes.json();
        const lgData = await lgRes.json();
        if (stRes.ok) setDetailStats(stData);
        if (lgRes.ok) {
          setDetailLogs(lgData.logs ?? []);
          setStatusLabels(lgData.statusLabels ?? {});
        }
      } catch (err) {
        notify("error", err instanceof Error ? err.message : "Detay alınamadı.");
      }
    },
    [tenantId, logFilterStatus, logSearch, notify],
  );

  useEffect(() => {
    if (view !== "detail" || !selectedCampaignId) return;
    const timer = setTimeout(() => {
      void fetchCampaignDetail(selectedCampaignId);
    }, 0);
    return () => clearTimeout(timer);
  }, [view, selectedCampaignId, fetchCampaignDetail]);

  // Kampanya detayı SSE canlı dinleme
  useEffect(() => {
    if (view !== "detail" || !selectedCampaignId) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(
        `/api/dm-automation/campaigns/${encodeURIComponent(selectedCampaignId)}/stream?tenantId=${encodeURIComponent(tenantId)}`,
      );
      const refresh = () => {
        void fetchCampaignDetail(selectedCampaignId);
        void fetchOverview();
      };
      es.addEventListener("log.updated", refresh);
      es.addEventListener("campaign.updated", refresh);
      es.addEventListener("click.recorded", refresh);
    } catch {
      // ignore
    }
    return () => {
      es?.close();
    };
  }, [view, selectedCampaignId, tenantId, fetchCampaignDetail, fetchOverview]);

  const fetchOptOuts = useCallback(async () => {
    try {
      const res = await fetch(`/api/dm-automation/opt-outs?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setOptOuts(data.optOuts ?? []);
    } catch {
      // ignore
    }
  }, [tenantId]);

  useEffect(() => {
    if (view !== "opt-outs") return;
    const timer = setTimeout(() => {
      void fetchOptOuts();
    }, 0);
    return () => clearTimeout(timer);
  }, [view, fetchOptOuts]);

  const liveMatchPreview = useMemo(() => {
    return matchKeyword(wTestInput, wKeywords, wMatchMode);
  }, [wTestInput, wKeywords, wMatchMode]);

  const renderedDmPreview = useMemo(() => {
    const firstLink = wButtons[0]?.url ? "https://nordvow.com/r/ornek123" : "";
    const body = wDmText
      .replace(/\{username\}/gi, "ayse.style")
      .replace(/\{link\}/gi, firstLink)
      .replace(/\{kupon\}/gi, wCouponCode || "NORDVOW25");
    return `${body}\n\n${wDmFooter}`.trim();
  }, [wDmText, wDmFooter, wButtons, wCouponCode]);

  const primaryAccount = accounts[0] ?? null;
  const hasAccountIssue = accounts.some((a) => a.status === "REAUTH_REQUIRED" || a.status === "WEBHOOK_MISSING");

  const filteredCampaigns = useMemo(() => {
    if (statusTab === "ALL") return campaigns;
    return campaigns.filter((c) => c.status === statusTab);
  }, [campaigns, statusTab]);

  const tabCounts = useMemo(
    () => ({
      ACTIVE: campaigns.filter((c) => c.status === "ACTIVE").length,
      PAUSED: campaigns.filter((c) => c.status === "PAUSED").length,
      DRAFT: campaigns.filter((c) => c.status === "DRAFT").length,
      ENDED: campaigns.filter((c) => c.status === "ENDED").length,
      ALL: campaigns.length,
    }),
    [campaigns],
  );

  const handleConnectAccount = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/dm-automation/accounts?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          igUserId: connectIgUserId || undefined,
          igUsername: connectIgUsername || undefined,
          accountType: connectAccountType,
          code: connectCode || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Hesap bağlanamadı.");
      setShowConnectModal(false);
      setConnectIgUserId("");
      setConnectIgUsername("");
      setConnectCode("");
      await fetchOverview();
      notify("ok", `@${data.account.username} hesabı DM Otomasyonu için bağlandı.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Bağlantı hatası.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCampaign = async (activateImmediately: boolean) => {
    if (activateImmediately && (!wAck1 || !wAck2 || !wAck3)) {
      notify("warn", "Kampanyayı başlatmak için tüm uyum onay kutularını işaretleyin.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/dm-automation/campaigns?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          igAccountId: wAccountId || primaryAccount?.id,
          name: wName,
          triggerMode: wTriggerMode,
          mediaId: wTriggerMode === "SPECIFIC_POST" ? wSelectedMedia?.id ?? null : null,
          mediaPermalink: wTriggerMode === "SPECIFIC_POST" ? wSelectedMedia?.permalink ?? null : null,
          mediaThumbUrl: wTriggerMode === "SPECIFIC_POST" ? wSelectedMedia?.thumbnailUrl ?? null : null,
          mediaCaption: wTriggerMode === "SPECIFIC_POST" ? wSelectedMedia?.caption ?? null : null,
          dmTriggerEnabled: wDmTrigger,
          keywords: wKeywords,
          matchMode: wMatchMode,
          dmText: wDmText,
          dmFooter: wDmFooter,
          buttons: wButtons.filter((b) => b.label.trim() && b.url.trim()),
          openingDmEnabled: wOpeningDmEnabled,
          openingDmText: wOpeningDmText,
          openingDmButtonLabel: wOpeningDmBtnLabel,
          publicReplyEnabled: wPublicReplyEnabled,
          publicReplies: wPublicReplies,
          couponId: wCouponId || null,
          couponCode: wCouponCode || null,
          repeatPolicy: wRepeatPolicy,
          sendCap: wSendCap ? Number(wSendCap) : null,
          startsAt: wStartsAt ? new Date(wStartsAt).toISOString() : null,
          endsAt: wEndsAt ? new Date(wEndsAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Otomasyon oluşturulamadı.");

      const createdId = data.campaign.id as string;
      if (activateImmediately) {
        const actRes = await fetch(
          `/api/dm-automation/campaigns/${encodeURIComponent(createdId)}/activate?tenantId=${encodeURIComponent(tenantId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              instructionAck: wAck1,
              adDisclosureAck: wAck2,
              contentMatchAck: wAck3,
            }),
          },
        );
        const actData = await actRes.json();
        if (!actRes.ok) throw new Error(actData?.error?.message ?? "Aktifleştirme başarısız.");
      }

      await fetchOverview();
      setSelectedCampaignId(createdId);
      setView("detail");
      notify("ok", activateImmediately ? "Otomasyon başlatıldı!" : "Taslak olarak kaydedildi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Kaydetme hatası.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleCampaignStatus = async (camp: CampaignSummary) => {
    try {
      const endpoint = camp.status === "ACTIVE" ? "pause" : "activate";
      const res = await fetch(
        `/api/dm-automation/campaigns/${encodeURIComponent(camp.id)}/${endpoint}?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body:
            endpoint === "activate"
              ? JSON.stringify({ instructionAck: true, adDisclosureAck: true, contentMatchAck: true })
              : "{}",
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Durum değiştirilemedi.");
      await fetchOverview();
      if (view === "detail" && selectedCampaignId === camp.id) {
        await fetchCampaignDetail(camp.id);
      }
      notify("ok", endpoint === "pause" ? "Otomasyon duraklatıldı." : "Otomasyon aktifleştirildi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "İşlem hatası.");
    }
  };

  const handleSimulateComment = async () => {
    if (!selectedCampaignId || !simCommentText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/dm-automation/campaigns/${encodeURIComponent(selectedCampaignId)}/test-match?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: simCommentText,
            username: simUsername,
            simulateWebhook: true,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Simülasyon başarısız.");
      await fetchCampaignDetail(selectedCampaignId);
      await fetchOverview();
      if (data.simulated?.status === "SENT") {
        notify("ok", `Eşleşti (${data.keyword}) ve örnek Private Reply DM gönderildi!`);
      } else if (data.matched) {
        notify("warn", `Eşleşti (${data.keyword}) — Sonuç: ${data.simulated?.status ?? "Kampanya aktif değil"}`);
      } else {
        notify("warn", "Yorum anahtar kelimelerle eşleşmedi.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Simülasyon hatası.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!featureAllowed) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-bold text-fg">DM Otomasyonu</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Bu özellik yakında açılacak veya çalışma alanınızın mevcut planına dahil değil. Yetki almak için yöneticinizle iletişime geçebilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 space-y-4 overflow-y-auto bg-canvas p-4 sm:p-6"
          : "space-y-4"
      }
    >
      {toast ? (
        <div
          role="status"
          className={`fixed right-5 bottom-5 z-50 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur ${toast.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
              : toast.tone === "warn"
                ? "border-amber-500/40 bg-amber-950/90 text-amber-200"
                : "border-red-500/40 bg-red-950/90 text-red-200"
            }`}
        >
          {toast.text}
        </div>
      ) : null}

      {/* Sadeleştirilmiş Üst Başlık & Tek Merkez Geçişi */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-xl border border-line bg-bg p-0.5 text-xs">
            <Link
              href="/dashboard/iletisim?sekme=mesajlar"
              className="rounded-lg px-3 py-1.5 font-medium text-fg-muted transition hover:text-fg"
            >
              Mesaj Kutusu
            </Link>
            <span className="rounded-lg bg-fg px-3 py-1.5 font-semibold text-bg">
              DM Otomasyonu
            </span>
          </div>
          {tenantOptions.length > 1 ? (
            <select
              aria-label="Çalışma Alanı"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="h-8 rounded-lg border border-line bg-bg px-2.5 text-xs text-fg"
            >
              {tenantOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind} · {t.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view !== "list" ? (
            <button
              type="button"
              onClick={() => {
                setView("list");
                setSelectedCampaignId(null);
                router.push("/dashboard/dm-otomasyonu");
              }}
              className="h-8 rounded-lg border border-line bg-bg px-3 text-xs font-medium text-fg hover:bg-surface-hover"
            >
              Liste
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setShowConnectModal(true)}
            className="h-8 rounded-lg border border-line bg-bg px-3 text-xs font-medium text-fg hover:bg-surface-hover"
          >
            Hesap Bağla
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="h-8 rounded-lg border border-line bg-bg px-3 text-xs font-medium text-fg hover:bg-surface-hover"
          >
            {isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
          </button>

          <button
            type="button"
            onClick={() => {
              setWizardStep(1);
              setView("new");
            }}
            className="h-8 rounded-lg bg-fg px-3.5 text-xs font-semibold text-bg transition hover:opacity-90"
          >
            + Yeni Otomasyon
          </button>
        </div>
      </header>

      {/* Hesap Durum & Kota Çubuğu */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/80 px-5 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">Hesap:</span>
            <span className="font-semibold text-fg">
              {primaryAccount ? `@${primaryAccount.username}` : "Bağlı hesap yok"}
            </span>
            {primaryAccount && primaryAccount.status === "CONNECTED" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                ● Bağlı
              </span>
            ) : null}
            {primaryAccount?.authMode === "OWN_OAUTH" ? (
              <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                Kendi hesabınla DM gönderimi aktif
              </span>
            ) : primaryAccount ? (
              <span className="inline-flex items-center rounded-full border border-line bg-bg px-2 py-0.5 text-[11px] text-fg-muted">
                Otomatik bağlı hesap
              </span>
            ) : null}
            {primaryAccount?.authMode !== "OWN_OAUTH" ? (
              igAuthorizeUrl ? (
                <a
                  href={igAuthorizeUrl}
                  className="inline-flex items-center gap-1 rounded-lg bg-neon-pink px-2.5 py-1 text-[11px] font-semibold text-white transition hover:opacity-90"
                >
                  Kendi hesabınla DM gönder ↗
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-neon-pink/50 bg-neon-pink/15 px-2.5 py-1 text-[11px] font-semibold text-fg transition hover:bg-neon-pink/25"
                >
                  Kendi hesabınla DM gönder
                </button>
              )
            ) : null}
          </div>
          <div className="text-fg-muted">
            Bu saat: <strong className="text-fg tabular-nums">{hourlyUsed} / {hourlyCap}</strong>
          </div>
          <div className="text-fg-muted">
            Bu ay: <strong className="text-fg tabular-nums">{monthlyUsed.toLocaleString("tr-TR")} / {quota.monthlyDmLimit.toLocaleString("tr-TR")}</strong>
          </div>
        </div>
        <div className="flex items-center gap-3 text-fg-muted">
          <span>
            Worker:{" "}
            <strong className={workerHealthy ? "text-emerald-300" : "text-amber-300"}>
              {workerHealthy ? "Sağlıklı" : "Gecikmeli"}
            </strong>
          </span>
          {primaryAccount?.lastWebhookAt ? (
            <span>Son olay: {formatShortDate(primaryAccount.lastWebhookAt)}</span>
          ) : null}
        </div>
      </section>

      {/* Uyarı Bantları */}
      {hasAccountIssue ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>Instagram bağlantısı yenilenmeli. Otomasyonlar duraklatıldı.</span>
          <button
            type="button"
            onClick={() => setShowConnectModal(true)}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Yeniden bağla
          </button>
        </div>
      ) : null}

      {hasBreakerOpen ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Instagram geçici olarak yavaşlattı. Mesajlar sırada, 15 dk sonra otomatik devam edecek.
        </div>
      ) : null}

      {queueStatus.queuedCount > 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Instagram saatte en fazla {hourlyCap} özel yanıta izin veriyor.{" "}
          <strong>{queueStatus.queuedCount.toLocaleString("tr-TR")} kişi sırada</strong>, tahmini bitiş{" "}
          <strong>{queueStatus.estimate.formattedTr}</strong>. Kimse atlanmayacak.
        </div>
      ) : null}

      {/* GÖRÜNÜM 1: LİSTE */}
      {view === "list" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface p-1 text-xs">
              {(
                [
                  { id: "ALL", label: "Tümü", count: tabCounts.ALL },
                  { id: "ACTIVE", label: "Aktif", count: tabCounts.ACTIVE },
                  { id: "PAUSED", label: "Duraklatıldı", count: tabCounts.PAUSED },
                  { id: "DRAFT", label: "Taslak", count: tabCounts.DRAFT },
                  { id: "ENDED", label: "Biten", count: tabCounts.ENDED },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStatusTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${statusTab === t.id ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
                    }`}
                >
                  <span>{t.label}</span>
                  <span className="rounded-full bg-black/15 px-1.5 text-[10px] tabular-nums">{t.count}</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-fg-muted">
              Otomasyonlar yükleniyor…
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
              <h2 className="text-lg font-semibold text-fg">İlk otomasyonunu oluştur</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm text-fg-muted">
                Takipçilerin yoruma bir kelime yazsın, kupon kodu ya da link DM&apos;lerine gelsin.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {accounts.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowConnectModal(true)}
                    className="rounded-xl border border-line bg-bg px-4 py-2 text-xs font-semibold text-fg"
                  >
                    Instagram hesabını bağla
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setView("new")}
                  className="rounded-xl bg-fg px-4 py-2 text-xs font-semibold text-bg"
                >
                  + Yeni otomasyon
                </button>
              </div>
              <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
                {[
                  ["1. Gönderini seç", "Belirli bir Reel, sonraki Reel veya tüm gönderiler."],
                  ["2. Anahtar kelimeyi belirle", "Türkçe karakter, büyük-küçük harf ve emoji fark etmez."],
                  ["3. DM'ini yaz", "Kupon kodu, takip linki ve isteğe bağlı herkese açık yorum yanıtı."],
                ].map(([title, desc]) => (
                  <div key={title} className="rounded-xl border border-line bg-bg/60 p-3.5">
                    <div className="text-xs font-semibold text-fg">{title}</div>
                    <div className="mt-1 text-xs text-fg-muted">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCampaigns.map((camp) => {
                const badge = STATUS_BADGES[camp.status];
                return (
                  <div
                    key={camp.id}
                    className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 transition hover:border-border-strong"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-lg border border-line bg-bg px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                          {camp.triggerMode === "SPECIFIC_POST"
                            ? "Belirli Gönderi / Reel"
                            : camp.triggerMode === "NEXT_REEL"
                              ? camp.pendingNextReel
                                ? "Sonraki Reel (Bekliyor)"
                                : "Sonraki Reel (Bağlandı)"
                              : "Tüm Gönderiler"}
                        </span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>

                      <h3 className="mt-3 text-base font-semibold text-fg">{camp.name}</h3>
                      {camp.mediaCaption ? (
                        <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{camp.mediaCaption}</p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {camp.matchMode === "ANY_COMMENT" ? (
                          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                            Her yorum
                          </span>
                        ) : (
                          camp.keywords.map((kw) => (
                            <span
                              key={kw}
                              className="rounded-md border border-line bg-bg px-2 py-0.5 text-[11px] font-medium text-fg"
                            >
                              {kw}
                            </span>
                          ))
                        )}
                        {camp.couponCode ? (
                          <span className="rounded-md border border-neon-pink/30 bg-neon-pink/10 px-2 py-0.5 text-[11px] font-medium text-neon-pink">
                            Kupon: {camp.couponCode}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-5 space-y-3 border-t border-line pt-3.5">
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="rounded-lg bg-bg/70 p-2">
                          <div className="text-[10px] text-fg-muted">24s Tetik</div>
                          <div className="font-bold tabular-nums text-fg">{camp.metrics24h.triggers}</div>
                        </div>
                        <div className="rounded-lg bg-bg/70 p-2">
                          <div className="text-[10px] text-fg-muted">Gönderildi</div>
                          <div className="font-bold tabular-nums text-emerald-300">{camp.metrics24h.sent}</div>
                        </div>
                        <div className="rounded-lg bg-bg/70 p-2">
                          <div className="text-[10px] text-fg-muted">Tık</div>
                          <div className="font-bold tabular-nums text-neon-cyan">{camp.metrics24h.uniqueClicks}</div>
                        </div>
                        <div className="rounded-lg bg-bg/70 p-2">
                          <div className="text-[10px] text-fg-muted">Tıklama oranı</div>
                          <div className="font-bold tabular-nums text-fg">%{camp.metrics24h.ctrPercent}</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCampaignId(camp.id);
                            setDetailTab("summary");
                            setView("detail");
                          }}
                          className="flex-1 rounded-xl border border-line bg-bg py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
                        >
                          Detay &amp; Kayıtlar
                        </button>
                        {camp.status === "ACTIVE" || camp.status === "PAUSED" ? (
                          <button
                            type="button"
                            onClick={() => void handleToggleCampaignStatus(camp)}
                            className="rounded-xl border border-line bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
                          >
                            {camp.status === "ACTIVE" ? "Duraklat" : "Başlat"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Instagram Kuralları Kutusu */}
          <div className="rounded-2xl border border-line bg-surface/60 p-4 text-xs text-fg-muted">
            <strong className="text-fg">Instagram kuralları:</strong> Her yoruma yalnızca 1 özel mesaj gönderilir, yorumdan sonraki 7 gün içinde. Saatte en fazla {hourlyCap} mesaj gider; fazlası sırada bekler. Takip şartı ve tekrar mesaj yoktur.
          </div>
        </div>
      ) : null}

      {/* GÖRÜNÜM 2: YENİ OTOMASYON SİHİRBAZI (7 ADIM + CANLI ÖNİZLEME) */}
      {view === "new" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5 rounded-2xl border border-line bg-surface p-6">
            {/* Adım Çubuğu (3 adım) */}
            <div className="flex flex-wrap gap-1.5 border-b border-line pb-4">
              {[
                [1, "1. Gönderi & kelime"],
                [2, "2. Mesaj & kupon"],
                [3, "3. Kontrol & başlat"],
              ].map(([num, label]) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setWizardStep(Number(num))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${wizardStep === num ? "bg-fg text-bg" : "bg-bg text-fg-muted hover:text-fg"
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {wizardStep === 1 ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">1. Kampanya Adı ve Instagram Hesabı</h2>
                <div>
                  <label className="block text-xs font-medium text-fg-muted">Otomasyon Adı</label>
                  <input
                    value={wName}
                    onChange={(e) => setWName(e.target.value)}
                    placeholder="Örn: Sonbahar İndirim Kodu Reel"
                    className="mt-1.5 h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg-muted">Instagram Profesyonel Hesabı</label>
                  {accounts.length === 0 ? (
                    <div className="mt-2 rounded-xl border border-dashed border-line p-4 text-xs text-fg-muted">
                      Bağlı hesap yok.{" "}
                      <button
                        type="button"
                        onClick={() => setShowConnectModal(true)}
                        className="font-semibold text-neon-cyan underline"
                      >
                        Hemen bağla
                      </button>
                    </div>
                  ) : (
                    <select
                      value={wAccountId || primaryAccount?.id || ""}
                      onChange={(e) => setWAccountId(e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm text-fg"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          @{a.username} ({a.status === "CONNECTED" ? "Bağlı" : a.status})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ) : null}

            {wizardStep === 1 ? (
              <div className="space-y-4 border-t border-line pt-4">
                <h2 className="text-base font-semibold">Tetikleyici Gönderi veya Reel Seç</h2>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {(
                    [
                      ["SPECIFIC_POST", "Belirli bir gönderi veya reel", "Seçtiğin tek gönderiye gelen yorumlara yanıt verir."],
                      ["NEXT_REEL", "Bir sonraki reel'im", "Bu kuraldan sonra yayınlayacağın ilk Reel'e otomatik bağlanır."],
                      ["ANY_POST", "Tüm gönderilerim", "Hesaptaki tüm gönderilerde eşleşen her yoruma DM gider."],
                    ] as const
                  ).map(([mode, title, desc]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setWTriggerMode(mode)}
                      className={`rounded-xl border p-3 text-left transition ${wTriggerMode === mode
                          ? "border-neon-cyan bg-neon-cyan/10 text-fg"
                          : "border-line bg-bg text-fg-muted hover:text-fg"
                        }`}
                    >
                      <div className="text-xs font-semibold">{title}</div>
                      <div className="mt-1 text-[11px] opacity-80">{desc}</div>
                    </button>
                  ))}
                </div>

                {wTriggerMode === "ANY_POST" ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                    Uyarı: Bu hesaptaki tüm gönderilerde eşleşen her yoruma DM gider.
                  </div>
                ) : null}

                {wTriggerMode === "SPECIFIC_POST" ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {wMediaList.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setWSelectedMedia(m)}
                        className={`rounded-xl border p-3 text-left transition ${wSelectedMedia?.id === m.id
                            ? "border-neon-pink bg-neon-pink/10"
                            : "border-line bg-bg hover:bg-surface-hover"
                          }`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="rounded bg-surface px-1.5 py-0.5 font-medium text-fg">
                            {m.mediaProductType === "REELS" ? "Reel" : "Gönderi"}
                          </span>
                          <span className="text-fg-muted">{formatShortDate(m.timestamp)}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs text-fg">{m.caption ?? "(Açıklama yok)"}</p>
                      </button>
                    ))}
                  </div>
                ) : null}

                <label className="flex items-center gap-2.5 rounded-xl border border-line bg-bg p-3 text-xs">
                  <input
                    type="checkbox"
                    checked={wDmTrigger}
                    onChange={(e) => setWDmTrigger(e.target.checked)}
                  />
                  <span>DM&apos;den anahtar kelime yazanlara da gönder (24 saat penceresi içinde)</span>
                </label>
              </div>
            ) : null}

            {wizardStep === 1 ? (
              <div className="space-y-4 border-t border-line pt-4">
                <h2 className="text-base font-semibold">Anahtar Kelimeler ve Canlı Eşleşme Testi</h2>
                <p className="text-xs text-fg-muted">
                  Büyük-küçük harf, Türkçe karakter ve emoji fark etmez: &apos;İndirim&apos;, &apos;indirim&apos;, &apos;INDIRIM 🔥&apos; aynı sayılır.
                </p>

                <div className="flex gap-2">
                  <input
                    value={wKeywordInput}
                    onChange={(e) => setWKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && wKeywordInput.trim()) {
                        e.preventDefault();
                        if (!wKeywords.includes(wKeywordInput.trim()) && wKeywords.length < 20) {
                          setWKeywords([...wKeywords, wKeywordInput.trim()]);
                        }
                        setWKeywordInput("");
                      }
                    }}
                    placeholder="Kelime yazıp Enter'a basın (en fazla 20)"
                    className="h-10 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (wKeywordInput.trim() && !wKeywords.includes(wKeywordInput.trim()) && wKeywords.length < 20) {
                        setWKeywords([...wKeywords, wKeywordInput.trim()]);
                        setWKeywordInput("");
                      }
                    }}
                    className="rounded-xl border border-line bg-bg px-4 text-xs font-medium text-fg"
                  >
                    Ekle
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {wKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs font-medium"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => setWKeywords(wKeywords.filter((k) => k !== kw))}
                        className="text-fg-muted hover:text-red-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["WHOLE_WORD", "Tam kelime (önerilen)"],
                      ["CONTAINS", "Yorum içinde geçiyorsa"],
                      ["ANY_COMMENT", "Her yorum"],
                    ] as const
                  ).map(([m, lbl]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setWMatchMode(m)}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium ${wMatchMode === m ? "border-neon-cyan bg-neon-cyan/10 text-fg" : "border-line bg-bg text-fg-muted"
                        }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {wMatchMode === "ANY_COMMENT" && wTriggerMode === "ANY_POST" ? (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                    Dikkat: &quot;Tüm gönderiler&quot; ve &quot;Her yorum&quot; modları birlikte seçildi. Saatlik 700 limiti hızla dolabilir.
                  </div>
                ) : null}

                {/* Canlı Eşleşme Test Kutusu */}
                <div className="rounded-xl border border-line bg-bg/70 p-4">
                  <div className="text-xs font-semibold text-fg">Canlı Eşleşme Testi</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={wTestInput}
                      onChange={(e) => setWTestInput(e.target.value)}
                      placeholder="Örnek bir yorum yaz ve dene"
                      className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-fg"
                    />
                    <span
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${liveMatchPreview.matched
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-zinc-500/15 text-fg-muted"
                        }`}
                    >
                      {liveMatchPreview.matched ? `Eşleşir ✓ (${liveMatchPreview.matchedKeyword})` : "Eşleşmez"}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">2. Mesaj İçeriği, Link Butonları ve Kupon</h2>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-fg-muted">
                      Kullanabileceğin alanlar: {"{username}"}, {"{link}"}, {"{kupon}"}
                    </span>
                    <span className={wDmText.length > 640 ? "text-red-400" : "text-fg-muted"}>
                      {wDmText.length} / 640
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    {["{username}", "{link}", "{kupon}"].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setWDmText((prev) => `${prev} ${chip}`)}
                        className="rounded-md border border-line bg-bg px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={4}
                    value={wDmText}
                    onChange={(e) => setWDmText(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-bg p-3 text-sm text-fg"
                  />
                </div>

                {/* Kupon Bağlama */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-fg-muted">NordVow Kuponu Bağla (Opsiyonel)</label>
                    <select
                      value={wCouponId}
                      onChange={(e) => {
                        setWCouponId(e.target.value);
                        const found = availableCoupons.find((c) => c.id === e.target.value);
                        if (found?.sharedCode) setWCouponCode(found.sharedCode);
                      }}
                      className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs text-fg"
                    >
                      <option value="">Manuel kod kullan</option>
                      {availableCoupons.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} {c.sharedCode ? `(${c.sharedCode})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-fg-muted">Kupon Kodu ({"{kupon}"})</label>
                    <input
                      value={wCouponCode}
                      onChange={(e) => setWCouponCode(e.target.value)}
                      placeholder="Örn: NORDVOW25"
                      className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs text-fg"
                    />
                  </div>
                </div>

                {/* Butonlar (0-3) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-fg-muted">Link Butonları (en fazla 3 · otomatik UTM eklenir)</span>
                    {wButtons.length < 3 ? (
                      <button
                        type="button"
                        onClick={() => setWButtons([...wButtons, { label: "Fırsatı Gör", url: "https://nordvow.com" }])}
                        className="text-xs font-semibold text-neon-cyan"
                      >
                        + Buton ekle
                      </button>
                    ) : null}
                  </div>
                  {wButtons.map((b, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                      <input
                        value={b.label}
                        maxLength={20}
                        onChange={(e) => {
                          const next = [...wButtons];
                          next[i] = { ...b, label: e.target.value };
                          setWButtons(next);
                        }}
                        placeholder="Etiket (≤20 krk)"
                        className="h-9 rounded-lg border border-line bg-bg px-2.5 text-xs text-fg"
                      />
                      <input
                        value={b.url}
                        onChange={(e) => {
                          const next = [...wButtons];
                          next[i] = { ...b, url: e.target.value };
                          setWButtons(next);
                        }}
                        placeholder="https://..."
                        className="h-9 rounded-lg border border-line bg-bg px-2.5 text-xs text-fg"
                      />
                      <button
                        type="button"
                        onClick={() => setWButtons(wButtons.filter((_, idx) => idx !== i))}
                        className="rounded-lg border border-line px-2.5 text-xs text-fg-muted hover:text-red-400"
                      >
                        Sil
                      </button>
                    </div>
                  ))}
                </div>

                {/* Postback Açılış Mesajı (Faz 2) */}
                <div className="rounded-xl border border-line bg-bg/60 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={wOpeningDmEnabled}
                      onChange={(e) => setWOpeningDmEnabled(e.target.checked)}
                    />
                    <span>Önce &quot;Kodu göster&quot; butonlu açılış mesajı gönder (kişi dokununca asıl DM gider)</span>
                  </label>
                  {wOpeningDmEnabled ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={wOpeningDmText}
                        onChange={(e) => setWOpeningDmText(e.target.value)}
                        placeholder="Açılış mesajı"
                        className="h-9 rounded-lg border border-line bg-surface px-2.5 text-xs"
                      />
                      <input
                        value={wOpeningDmBtnLabel}
                        maxLength={20}
                        onChange={(e) => setWOpeningDmBtnLabel(e.target.value)}
                        placeholder="Buton yazısı (≤20)"
                        className="h-9 rounded-lg border border-line bg-surface px-2.5 text-xs"
                      />
                    </div>
                  ) : null}
                </div>

                {/* Zorunlu Alt Bilgi Satırı */}
                <div>
                  <label className="block text-xs font-medium text-fg-muted">
                    Bilgilendirme satırı (zorunlu · &quot;DUR&quot; kelimesini içermeli)
                  </label>
                  <input
                    value={wDmFooter}
                    onChange={(e) => setWDmFooter(e.target.value)}
                    className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs text-fg"
                  />
                </div>
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div className="space-y-4 border-t border-line pt-4">
                <h2 className="text-base font-semibold">Yoruma Herkese Açık Yanıt</h2>
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={wPublicReplyEnabled}
                    onChange={(e) => setWPublicReplyEnabled(e.target.checked)}
                  />
                  <span>DM gönderdikten sonra yorumun altına herkese açık yanıt bırak</span>
                </label>
                <p className="text-xs text-fg-muted">
                  Birkaç farklı yanıt ekle, sırayla rastgele kullanılır. Herkese açık yanıtlar yorumun altında görünür, kişisel bilgi yazma.
                </p>

                {wPublicReplyEnabled ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={wPublicReplyDraft}
                        onChange={(e) => setWPublicReplyDraft(e.target.value)}
                        placeholder="Yeni yanıt varyasyonu ekle…"
                        className="h-9 flex-1 rounded-xl border border-line bg-bg px-3 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (wPublicReplyDraft.trim()) {
                            setWPublicReplies([...wPublicReplies, wPublicReplyDraft.trim()]);
                            setWPublicReplyDraft("");
                          }
                        }}
                        className="rounded-xl border border-line bg-bg px-3 text-xs font-medium"
                      >
                        Ekle
                      </button>
                    </div>
                    {wPublicReplies.map((r, i) => (
                      <div key={i} className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2 text-xs">
                        <span>{r}</span>
                        <button
                          type="button"
                          onClick={() => setWPublicReplies(wPublicReplies.filter((_, idx) => idx !== i))}
                          className="text-fg-muted hover:text-red-400"
                        >
                          Sil
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {wizardStep === 3 ? (
              <details className="rounded-xl border border-line bg-bg/40 p-4">
                <summary className="cursor-pointer text-xs font-semibold text-fg">
                  Gelişmiş sınırlar ve zamanlama (kişi başına 1 kez, saatlik 700, bitiş tarihi)
                </summary>
                <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-fg-muted">Başlangıç Tarihi (Opsiyonel)</label>
                    <input
                      type="datetime-local"
                      value={wStartsAt}
                      onChange={(e) => setWStartsAt(e.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-fg-muted">Bitiş Tarihi (Opsiyonel)</label>
                    <input
                      type="datetime-local"
                      value={wEndsAt}
                      onChange={(e) => setWEndsAt(e.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-fg-muted">Toplam Gönderim Tavanı (Örn: Kupon Stoğu 500)</label>
                    <input
                      type="number"
                      min={1}
                      value={wSendCap}
                      onChange={(e) => setWSendCap(e.target.value)}
                      placeholder="Sınırsız"
                      className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-fg-muted">Aynı Kişiye Tekrar Gönder</label>
                    <select
                      value={wRepeatPolicy}
                      onChange={(e) => setWRepeatPolicy(e.target.value as RepeatPolicy)}
                      className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-xs"
                    >
                      <option value="DAILY">24 saatte bir (önerilen)</option>
                      <option value="NEVER">Asla (kampanya boyu 1 kez)</option>
                      <option value="ALWAYS">Her yorumda</option>
                    </select>
                  </div>
                </div>
                </div>
              </details>
            ) : null}

            {wizardStep === 3 ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">3. Kontrol ve Yayınla</h2>
                <div className="rounded-xl border border-line bg-bg/60 p-4 text-xs space-y-1.5">
                  <div><strong>Otomasyon:</strong> {wName}</div>
                  <div><strong>Tetikleyici:</strong> {etiketle(wTriggerMode)} ({wKeywords.join(", ") || "Her yorum"})</div>
                  <div><strong>Kupon:</strong> {wCouponCode || "Yok"} · <strong>Buton:</strong> {wButtons.length} adet</div>
                </div>

                <div className="space-y-2 rounded-xl border border-line bg-bg/50 p-4 text-xs">
                  <div className="font-semibold text-fg">Uyum Kontrol Listesi (Zorunlu)</div>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={wAck1} onChange={(e) => setWAck1(e.target.checked)} className="mt-0.5" />
                    <span>Gönderimde talimat açıkça yazıyor (ör. &quot;Kodu DM ile almak için KOD yaz&quot;)</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={wAck2} onChange={(e) => setWAck2(e.target.checked)} className="mt-0.5" />
                    <span>İşbirliği ise #reklam ibaresi gönderide var</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={wAck3} onChange={(e) => setWAck3(e.target.checked)} className="mt-0.5" />
                    <span>DM içeriği, gönderide vaat ettiğimle aynı</span>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleCreateCampaign(true)}
                    className="rounded-xl bg-fg px-5 py-2.5 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {submitting ? "Başlatılıyor…" : "Kampanyayı başlat"}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleCreateCampaign(false)}
                    className="rounded-xl border border-line bg-bg px-4 py-2.5 text-xs font-medium text-fg"
                  >
                    Taslak olarak kaydet
                  </button>
                </div>
              </div>
            ) : null}

            {/* Adım Navigasyonu */}
            <div className="flex items-center justify-between border-t border-line pt-4">
              <button
                type="button"
                disabled={wizardStep <= 1}
                onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                className="rounded-xl border border-line bg-bg px-3.5 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                ← Önceki
              </button>
              <button
                type="button"
                disabled={wizardStep >= 3}
                onClick={() => setWizardStep((s) => Math.min(3, s + 1))}
                className="rounded-xl bg-fg px-4 py-1.5 text-xs font-semibold text-bg disabled:opacity-40"
              >
                Sonraki →
              </button>
            </div>
          </div>

          {/* Sağ Canlı Önizleme (PreviewPhone) */}
          <aside className="rounded-3xl border border-line bg-bg p-4 shadow-xl">
            <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Canlı Instagram Önizleme
            </div>
            <div className="mt-3 space-y-3 rounded-2xl border border-line bg-surface p-3.5 text-xs">
              <div className="border-b border-line pb-2.5">
                <div className="font-semibold text-fg">@{primaryAccount?.username ?? "nordvow.creator"}</div>
                <p className="mt-1 text-[11px] text-fg-muted">
                  {wSelectedMedia?.caption ?? "Yoruma anahtar kelimeyi yaz, detaylar DM'ine gelsin ✨"}
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="rounded-lg bg-bg/70 p-2">
                  <span className="font-semibold">@ayse.style</span>{" "}
                  <span>{wTestInput || wKeywords[0] || "KOD"}</span>
                </div>
                {wPublicReplyEnabled && wPublicReplies[0] ? (
                  <div className="ml-5 rounded-lg border border-line bg-bg/40 p-2 text-[11px] text-fg-muted">
                    <span className="font-semibold text-fg">@{primaryAccount?.username ?? "nordvow.creator"}</span>{" "}
                    {wPublicReplies[0]}
                  </div>
                ) : null}
              </div>

              <div className="border-t border-line pt-3">
                <div className="text-[10px] font-semibold uppercase text-neon-cyan">Giden DM Balonu</div>
                <div className="mt-1.5 whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-line bg-bg p-3 text-xs leading-relaxed text-fg">
                  {wOpeningDmEnabled ? wOpeningDmText : renderedDmPreview}
                </div>
                {wOpeningDmEnabled ? (
                  <div className="mt-1.5 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 py-1.5 text-center text-xs font-semibold text-neon-cyan">
                    {wOpeningDmBtnLabel || "Kodu göster"}
                  </div>
                ) : (
                  wButtons.map((b, i) => (
                    <div
                      key={i}
                      className="mt-1.5 rounded-xl border border-line bg-bg py-1.5 text-center text-xs font-semibold text-neon-cyan"
                    >
                      {b.label || "Bağlantı"}
                    </div>
                  ))
                )}
              </div>
              <p className="text-[10px] text-fg-muted">
                Not: Seni takip etmeyenlerde mesaj &apos;İstekler&apos; klasörüne düşer.
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      {/* GÖRÜNÜM 3: KAMPANYA DETAYI */}
      {view === "detail" && detailStats ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-fg">{detailStats.campaign.name}</h2>
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGES[detailStats.campaign.status].cls}`}>
                  {STATUS_BADGES[detailStats.campaign.status].label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-fg-muted">
                <span>Kelimeler: {detailStats.campaign.keywords.join(", ") || "Her yorum"}</span>
                {detailStats.campaign.mediaPermalink ? (
                  <a
                    href={detailStats.campaign.mediaPermalink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neon-cyan underline"
                  >
                    Gönderiyi aç ↗
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {detailStats.campaign.status === "ENDED" ? (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch(
                      `/api/dm-automation/campaigns/${encodeURIComponent(detailStats.campaign.id)}/duplicate?tenantId=${encodeURIComponent(tenantId)}`,
                      { method: "POST" },
                    );
                    const data = await res.json();
                    if (res.ok) {
                      await fetchOverview();
                      setSelectedCampaignId(data.campaign.id);
                      notify("ok", "Otomasyon çoğaltıldı.");
                    }
                  }}
                  className="rounded-xl bg-fg px-3.5 py-2 text-xs font-semibold text-bg"
                >
                  Çoğalt
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleToggleCampaignStatus(detailStats.campaign)}
                className="rounded-xl border border-line bg-bg px-3.5 py-2 text-xs font-medium text-fg"
              >
                {detailStats.campaign.status === "ACTIVE"
                  ? "Duraklat"
                  : detailStats.campaign.status === "ENDED"
                    ? "Yeniden başlat"
                    : "Başlat"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const method = detailStats.campaign.reportShareEnabled ? "DELETE" : "POST";
                  const res = await fetch(
                    `/api/dm-automation/campaigns/${encodeURIComponent(detailStats.campaign.id)}/share?tenantId=${encodeURIComponent(tenantId)}`,
                    { method },
                  );
                  const data = await res.json();
                  if (res.ok) {
                    await fetchCampaignDetail(detailStats.campaign.id);
                    notify(
                      "ok",
                      data.reportShareEnabled
                        ? `Paylaşım linki açıldı: /rapor/dm/${data.reportShareSlug}`
                        : "Paylaşım linki kapatıldı.",
                    );
                  }
                }}
                className="rounded-xl border border-line bg-bg px-3.5 py-2 text-xs font-medium text-fg"
              >
                {detailStats.campaign.reportShareEnabled ? "Paylaşımı Kapat" : "Marka Raporu Paylaş"}
              </button>
              {canAdminExport ? (
                <a
                  href={`/api/dm-automation/campaigns/${encodeURIComponent(detailStats.campaign.id)}/logs.csv?tenantId=${encodeURIComponent(tenantId)}`}
                  className="rounded-xl border border-line bg-bg px-3.5 py-2 text-xs font-medium text-fg"
                >
                  CSV İndir
                </a>
              ) : null}
            </div>
          </div>

          {detailStats.campaign.reportShareEnabled && detailStats.campaign.reportShareSlug ? (
            <div className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 px-4 py-2.5 text-xs text-neon-cyan">
              Paylaşılabilir salt-okuma rapor adresi:{" "}
              <a
                href={`/rapor/dm/${detailStats.campaign.reportShareSlug}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                /rapor/dm/{detailStats.campaign.reportShareSlug}
              </a>{" "}
              (kişisel veri içermez)
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface p-1 text-xs">
            {(
              [
                ["summary", "Özet & Huni"],
                ["logs", `Kayıtlar (${detailLogs.length})`],
                ["links", `Linkler (${detailStats.linkStats.length})`],
                ["settings", "Ayarlar"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setDetailTab(t)}
                className={`rounded-lg px-3.5 py-1.5 font-medium ${detailTab === t ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          {detailTab === "summary" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {/* Huni */}
              <div className="rounded-2xl border border-line bg-surface p-5 space-y-4">
                <h3 className="text-sm font-semibold">Dönüşüm Hunisi</h3>
                {[
                  { label: "Eşleşen Yorum", val: detailStats.funnel.triggers, pct: 100, bar: "bg-zinc-400" },
                  {
                    label: "DM Gönderildi",
                    val: detailStats.funnel.sent,
                    pct: detailStats.funnel.deliveryRatePercent,
                    bar: "bg-emerald-400",
                  },
                  {
                    label: "Benzersiz Tıklama",
                    val: detailStats.funnel.uniqueClicks,
                    pct: detailStats.funnel.ctrPercent,
                    bar: "bg-neon-cyan",
                  },
                  {
                    label: "Kupon Kullanımı",
                    val: detailStats.funnel.couponRedeemed,
                    pct:
                      detailStats.funnel.triggers > 0
                        ? Math.round((detailStats.funnel.couponRedeemed / detailStats.funnel.triggers) * 100)
                        : 0,
                    bar: "bg-neon-pink",
                  },
                ].map((step) => (
                  <div key={step.label} className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-fg-muted">{step.label}</span>
                      <span className="font-semibold tabular-nums">
                        {step.val} (%{step.pct})
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-bg">
                      <div className={`h-full rounded-full ${step.bar}`} style={{ width: `${Math.min(100, Math.max(2, step.pct))}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Atlanma Nedenleri + 24s Grafik */}
              <div className="rounded-2xl border border-line bg-surface p-5 space-y-4">
                <h3 className="text-sm font-semibold">Son 24 Saat Akışı</h3>
                <div className="flex h-32 items-end gap-1 pt-2">
                  {detailStats.hourlySeries.map((h) => {
                    const max = Math.max(1, ...detailStats.hourlySeries.map((x) => x.triggers));
                    const heightPct = Math.round((h.triggers / max) * 100);
                    return (
                      <div key={h.hourLabel} title={`${h.hourLabel}: ${h.triggers} tetik, ${h.sent} gönd.`} className="flex flex-1 flex-col items-center gap-1">
                        <div className="flex h-24 w-full items-end">
                          <div className="w-full rounded-t bg-neon-cyan/70" style={{ height: `${Math.max(4, heightPct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-line pt-3">
                  <div className="text-xs font-semibold">Atlanma &amp; Hata Nedenleri</div>
                  {detailStats.reasonBreakdown.length === 0 ? (
                    <p className="mt-1 text-xs text-fg-muted">Atlanan veya başarısız kayıt yok.</p>
                  ) : (
                    <div className="mt-2 space-y-1 text-xs">
                      {detailStats.reasonBreakdown.map((r) => (
                        <div key={r.status} className="flex justify-between text-fg-muted">
                          <span>{r.label}</span>
                          <span className="font-semibold text-fg tabular-nums">{r.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {detailTab === "logs" ? (
            <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
              {/* Canlı Test Yorumu Simülatörü */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg/70 p-3">
                <span className="text-xs font-semibold text-fg">Test Yorumu Simüle Et:</span>
                <input
                  value={simUsername}
                  onChange={(e) => setSimUsername(e.target.value)}
                  placeholder="@kullanici"
                  className="h-8 w-36 rounded-lg border border-line bg-surface px-2.5 text-xs"
                />
                <input
                  value={simCommentText}
                  onChange={(e) => setSimCommentText(e.target.value)}
                  placeholder="Yorum metni (ör. KOD)"
                  className="h-8 flex-1 rounded-lg border border-line bg-surface px-2.5 text-xs"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSimulateComment()}
                  className="h-8 rounded-lg bg-fg px-3 text-xs font-semibold text-bg disabled:opacity-50"
                >
                  Yorum Gönder &amp; Test Et
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="@kullanıcı veya yorum ara…"
                  className="h-9 flex-1 rounded-xl border border-line bg-bg px-3 text-xs"
                />
                <select
                  value={logFilterStatus}
                  onChange={(e) => setLogFilterStatus(e.target.value)}
                  className="h-9 rounded-xl border border-line bg-bg px-3 text-xs"
                >
                  <option value="ALL">Tüm durumlar</option>
                  <option value="SENT">Gönderildi</option>
                  <option value="PENDING">Sırada</option>
                  <option value="FAILED">Başarısız</option>
                  <option value="UNCONFIRMED">Belirsiz</option>
                  <option value="SKIPPED_DUPLICATE_RECIPIENT">24s tekrar atlandı</option>
                  <option value="SKIPPED_OPTED_OUT">DUR yazdı</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line text-fg-muted">
                    <tr>
                      <th className="py-2 pr-3">Zaman</th>
                      <th className="py-2 pr-3">Kullanıcı</th>
                      <th className="py-2 pr-3">Yorum</th>
                      <th className="py-2 pr-3">Kelime</th>
                      <th className="py-2 pr-3">Durum</th>
                      <th className="py-2 pr-3">Açık Yanıt</th>
                      <th className="py-2">Kaynak</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {detailLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-fg-muted">{formatShortDate(l.createdAt)}</td>
                        <td className="py-2.5 pr-3 font-medium">
                          {l.recipientUsername ? `@${l.recipientUsername}` : l.recipientIgsid}
                        </td>
                        <td className="py-2.5 pr-3 max-w-[220px] truncate text-fg-muted">
                          {l.triggerText ?? "[90 gün sonra maskelendi]"}
                        </td>
                        <td className="py-2.5 pr-3">{l.matchedKeyword ?? "—"}</td>
                        <td className="py-2.5 pr-3" title={l.errorMessage ?? statusLabels[l.status]}>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${LOG_BADGES[l.status] ?? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
                              }`}
                          >
                            {statusLabels[l.status] ?? l.status}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-fg-muted">{l.publicReplySentAt ? l.publicReplyText ?? "✓" : "—"}</td>
                        <td className="py-2.5 text-fg-muted">{l.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {detailTab === "links" ? (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line text-fg-muted">
                  <tr>
                    <th className="py-2 pr-3">Buton</th>
                    <th className="py-2 pr-3">Kısa Takip Linki</th>
                    <th className="py-2 pr-3">Hedef (UTM&apos;li)</th>
                    <th className="py-2 pr-3">Toplam</th>
                    <th className="py-2">Benzersiz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detailStats.linkStats.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-3 font-semibold">{l.label ?? "Bağlantı"}</td>
                      <td className="py-2.5 pr-3 text-neon-cyan">/r/{l.slug}</td>
                      <td className="py-2.5 pr-3 max-w-[260px] truncate text-fg-muted">{l.destination}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{l.clicks}</td>
                      <td className="py-2.5 tabular-nums font-semibold">{l.uniqueClicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {detailTab === "settings" ? (
            <div className="rounded-2xl border border-line bg-surface p-5 space-y-4 text-xs">
              <div><strong>DM Metni:</strong> {detailStats.campaign.dmText}</div>
              <div><strong>Zorunlu Alt Bilgi:</strong> {detailStats.campaign.dmFooter}</div>
              <div><strong>Tekrar Politikası:</strong> {etiketle(detailStats.campaign.repeatPolicy)}</div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch(
                      `/api/dm-automation/campaigns/${encodeURIComponent(detailStats.campaign.id)}/duplicate?tenantId=${encodeURIComponent(tenantId)}`,
                      { method: "POST" },
                    );
                    const data = await res.json();
                    if (res.ok) {
                      await fetchOverview();
                      setSelectedCampaignId(data.campaign.id);
                      notify("ok", "Otomasyon çoğaltıldı.");
                    }
                  }}
                  className="rounded-xl border border-line bg-bg px-3.5 py-2 font-medium"
                >
                  Çoğalt
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("Bu otomasyonu silmek istediğinize emin misiniz?")) return;
                    const res = await fetch(
                      `/api/dm-automation/campaigns/${encodeURIComponent(detailStats.campaign.id)}?tenantId=${encodeURIComponent(tenantId)}`,
                      { method: "DELETE" },
                    );
                    if (res.ok) {
                      await fetchOverview();
                      setSelectedCampaignId(null);
                      setView("list");
                      notify("ok", "Otomasyon silindi.");
                    }
                  }}
                  className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 font-medium text-red-300"
                >
                  Otomasyonu Sil
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* GÖRÜNÜM 4: ABONELİKTEN ÇIKANLAR */}
      {view === "opt-outs" ? (
        <div className="rounded-2xl border border-line bg-surface p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Abonelikten Çıkanlar (Opt-Out)</h2>
            <p className="mt-1 text-xs text-fg-muted">
              DUR, İPTAL veya STOP yazan kişilere bu hesaptan bir daha otomatik mesaj gitmez.
            </p>
          </div>
          {optOuts.length === 0 ? (
            <p className="text-xs text-fg-muted">Henüz abonelikten çıkan kişi yok.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line text-fg-muted">
                <tr>
                  <th className="py-2 pr-3">IGSID / Kullanıcı</th>
                  <th className="py-2 pr-3">Kelime</th>
                  <th className="py-2 pr-3">Tarih</th>
                  <th className="py-2">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {optOuts.map((o) => (
                  <tr key={`${o.igAccountId}:${o.igsid}`}>
                    <td className="py-2.5 pr-3 font-medium">{o.username ? `@${o.username}` : o.igsid}</td>
                    <td className="py-2.5 pr-3">{o.keyword}</td>
                    <td className="py-2.5 pr-3 text-fg-muted">{formatShortDate(o.createdAt)}</td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch(
                            `/api/dm-automation/opt-outs?tenantId=${encodeURIComponent(tenantId)}&accountId=${encodeURIComponent(o.igAccountId)}&igsid=${encodeURIComponent(o.igsid)}`,
                            { method: "DELETE" },
                          );
                          await fetchOptOuts();
                          notify("ok", "Kişi opt-out listesinden kaldırıldı.");
                        }}
                        className="rounded-lg border border-line px-2.5 py-1 text-fg-muted hover:text-fg"
                      >
                        Listeden Kaldır
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {/* INSTAGRAM HESAP BAĞLAMA MODALI */}
      {showConnectModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Instagram Profesyonel Hesap Bağlantısı</h2>
              <button type="button" onClick={() => setShowConnectModal(false)} className="text-fg-muted hover:text-fg">
                ✕
              </button>
            </div>
            <p className="text-xs text-fg-muted">
              Mesaj Kutusu ile ortak Instagram bağlantısı kullanılır. Yalnızca profesyonel (İşletme / İçerik üretici) hesaplar desteklenir.
            </p>

            {igAuthorizeUrl ? (
              <a
                href={igAuthorizeUrl}
                className="block w-full rounded-xl bg-fg py-3 text-center text-xs font-semibold text-bg transition hover:opacity-90"
              >
                Instagram ile Tek Tıkla Bağlan
              </a>
            ) : (
              <div className="rounded-xl border border-line bg-bg p-3 text-xs text-fg-muted">
                Otomatik Instagram girişi için Meta Uygulama anahtarları (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET) AWS Secrets Manager üzerinden aktif edildiğinde tek tıkla bağlanabilirsiniz.
              </div>
            )}

            <details className="rounded-xl border border-line bg-bg/60 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
                Gelişmiş / Manuel Hesap Bağlantısı
              </summary>
              <div className="mt-3 space-y-2.5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={connectIgUserId}
                    onChange={(e) => setConnectIgUserId(e.target.value)}
                    placeholder="IG User ID (ör. 17841400999)"
                    className="h-9 rounded-lg border border-line bg-surface px-2.5"
                  />
                  <input
                    value={connectIgUsername}
                    onChange={(e) => setConnectIgUsername(e.target.value)}
                    placeholder="Kullanıcı adı (@marka)"
                    className="h-9 rounded-lg border border-line bg-surface px-2.5"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={connectAccountType}
                    onChange={(e) => setConnectAccountType(e.target.value as "CREATOR" | "BUSINESS" | "PERSONAL")}
                    className="h-9 rounded-lg border border-line bg-surface px-2.5"
                  >
                    <option value="CREATOR">İçerik Üretici (Creator)</option>
                    <option value="BUSINESS">İşletme (Business)</option>
                    <option value="PERSONAL">Kişisel Hesap (Desteklenmez)</option>
                  </select>
                  <input
                    value={connectCode}
                    onChange={(e) => setConnectCode(e.target.value)}
                    placeholder="OAuth Kodu (opsiyonel)"
                    className="h-9 rounded-lg border border-line bg-surface px-2.5"
                  />
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleConnectAccount()}
                  className="w-full rounded-xl bg-fg py-2 font-semibold text-bg disabled:opacity-50"
                >
                  Kaydet ve Bağla
                </button>
              </div>
            </details>

            {accounts.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">Bağlı Hesaplar</div>
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold">@{a.username}</span>{" "}
                      <span className="text-fg-muted">({a.status})</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(
                          `/api/dm-automation/accounts?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(a.id)}`,
                          { method: "DELETE" },
                        );
                        await fetchOverview();
                        notify("ok", `@${a.username} bağlantısı kesildi.`);
                      }}
                      className="text-red-400 hover:underline"
                    >
                      Bağlantıyı kes
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
