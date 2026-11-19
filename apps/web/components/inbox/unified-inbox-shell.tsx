"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { uploadFile } from "@/lib/creative-upload";
import {
  formatRemainingWindow,
  type InboxChannelType,
  type MessagingWindowState,
} from "@infulancer/core/inbox/messaging-window";
import {
  interpolateCannedResponse,
  searchCannedResponses,
  type CannedResponseItem,
  type InboxUiStatus,
} from "@infulancer/core/inbox/rules";

type Priority = "low" | "medium" | "high" | "urgent";

type ConversationSummary = {
  id: string;
  displayId: number;
  channel: InboxChannelType;
  status: InboxUiStatus;
  priority: Priority | null;
  snoozedUntil: string | null;
  assigneeId: string | null;
  teamId: string | null;
  campaignId: string | null;
  tags: string[];
  unreadCount: number;
  lastActivityAt: string;
  lastIncomingAt: string | null;
  waitingSince: string | null;
  lastMessagePreview: string;
  windowState: MessagingWindowState;
  contact: {
    id: string;
    name: string;
    username: string | null;
    phoneE164: string | null;
    externalId: string;
    blocked: boolean;
    followerCount: number | null;
    isUserFollowBusiness: boolean;
    isVerifiedUser: boolean;
  };
};

type MessageItem = {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  body: string;
  templateId?: string | null;
  mediaUrl?: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  createdAt: string;
  fromAi?: boolean;
  aiAssisted?: boolean;
  humanAgentTag?: boolean;
  sentByAutomation?: boolean;
  externalError?: string | null;
  senderName?: string | null;
  attachments?: { id: string; kind: string; url: string; name: string }[];
};

type PrivateNoteItem = {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  mentions: string[];
  createdAt: string;
};

type ActivityItem = {
  id: string;
  text: string;
  createdAt: string;
};

type TemplateItem = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
};

type ConversationDetailResponse = {
  conversation: {
    id: string;
    displayId: number;
    channel: InboxChannelType;
    status: InboxUiStatus;
    priority: Priority | null;
    snoozedUntil: string | null;
    assigneeId: string | null;
    teamId: string | null;
    campaignId: string | null;
    tags: string[];
    unreadCount: number;
    firstReplyAt: string | null;
    waitingSince: string | null;
    lastIncomingAt: string | null;
    windowState: MessagingWindowState;
    notes: PrivateNoteItem[];
    activities: ActivityItem[];
    messages: MessageItem[];
  };
  contact: {
    id: string;
    name: string;
    username: string | null;
    phoneE164: string | null;
    email: string | null;
    externalId: string;
    followerCount: number | null;
    isUserFollowBusiness: boolean;
    isVerifiedUser: boolean;
    notes: string;
    customFields: Record<string, string>;
    blocked: boolean;
    consent: {
      state: "GRANTED" | "WITHDRAWN";
      source: string;
      note?: string;
      updatedAt: string;
    } | null;
    matchedCreator: {
      id: string;
      name: string;
      handle: string;
      category: string;
      followers: number;
    } | null;
    previousConversations: {
      id: string;
      displayId: number;
      channel: string;
      status: string;
      createdAt: string;
    }[];
  };
  templates: TemplateItem[];
};

type WorkspaceSettings = {
  tenantId: string;
  brandVoice: {
    tone: "samimi" | "kurumsal";
    address: "sen" | "siz";
    useEmoji: boolean;
    signature: string;
  };
  aiSuggestionsEnabled: boolean;
  retentionMonths: number;
  enterToSend: boolean;
  reopenOnNewMessage: boolean;
  humanAgentEnabled: boolean;
  cannedResponses: CannedResponseItem[];
  labels: { id: string; name: string; color: string }[];
  teams: { id: string; name: string; memberIds: string[] }[];
};

type AgentOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type ChannelItem = {
  id: string;
  provider: "INSTAGRAM" | "WHATSAPP";
  status: string;
  displayName: string;
  connectedAt: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
};

export type TenantOption = {
  id: string;
  name: string;
  kind: "Marka" | "Creator" | "Ajans";
};

function relativeTimeTr(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "şimdi";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa`;
  const days = Math.floor(hours / 24);
  return `${days} g`;
}

const STATUS_LABELS: Record<InboxUiStatus, string> = {
  open: "Açık",
  pending: "Beklemede",
  snoozed: "Ertelendi",
  resolved: "Çözüldü",
};

const PRIORITY_LABELS: Record<Priority, { label: string; color: string }> = {
  low: { label: "Düşük", color: "text-zinc-400 border-zinc-500/30" },
  medium: { label: "Orta", color: "text-cyan-300 border-cyan-500/40" },
  high: { label: "Yüksek", color: "text-amber-300 border-amber-500/40" },
  urgent: { label: "Acil", color: "text-red-300 border-red-500/40" },
};

export function UnifiedInboxShell({
  initialTenantId,
  tenantOptions = [],
  actorName,
}: {
  initialTenantId: string;
  tenantOptions?: TenantOption[];
  actorName: string;
}) {
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [tab, setTab] = useState<"mine" | "unassigned" | "all">("all");
  const [statusFilter, setStatusFilter] = useState<InboxUiStatus | "all">("open");
  const [channelFilter, setChannelFilter] = useState<InboxChannelType | "ALL">("ALL");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"last_activity" | "waiting_longest">("last_activity");
  const [searchQuery, setSearchQuery] = useState("");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [counts, setCounts] = useState({ mine: 0, unassigned: 0, all: 0, unreadTotal: 0 });
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [checkedConvIds, setCheckedConvIds] = useState<string[]>([]);

  // Composer state
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [composerText, setComposerText] = useState("");
  const [aiAssistedDraft, setAiAssistedDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{ id: string; kind: string; url: string; name: string }[]>([]);

  // AI suggestions
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{ text: string; tone: "kisa" | "detayli" | "resmi" }[]>([]);

  // Popovers & Modals
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateParam1, setTemplateParam1] = useState("");
  const [templateParam2, setTemplateParam2] = useState("");

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"channels" | "canned" | "labels" | "general">("channels");
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [igAuthorizeUrl, setIgAuthorizeUrl] = useState<string | null>(null);

  // Channel connection form state
  const [igCode, setIgCode] = useState("");
  const [igPageId, setIgPageId] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [igUsername, setIgUsername] = useState("");
  const [waCode, setWaCode] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waDisplayPhone, setWaDisplayPhone] = useState("");
  const [waPin, setWaPin] = useState("123456");

  // New canned response & label forms
  const [newShortCode, setNewShortCode] = useState("");
  const [newCannedContent, setNewCannedContent] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#06B6D4");

  // Contact panel state
  const [showMobileContact, setShowMobileContact] = useState(false);
  const [contactNotesDraft, setContactNotesDraft] = useState("");
  const [consentSourceDraft, setConsentSourceDraft] = useState("Kişi WhatsApp'tan yazarak bilgilendirme talep etti");
  const [consentNoteDraft, setConsentNoteDraft] = useState("");
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const notify = useCallback((tone: "ok" | "warn" | "error", text: string) => {
    setToast({ tone, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchList = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        tenantId,
        tab,
        status: statusFilter,
        channel: channelFilter,
        sort: sortBy,
      });
      if (labelFilter) qs.set("label", labelFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());

      const res = await fetch(`/api/inbox/conversations?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Konuşmalar alınamadı.");
      const list = (data.conversations ?? []) as ConversationSummary[];
      setConversations(list);
      setCounts(data.counts ?? { mine: 0, unassigned: 0, all: 0, unreadTotal: 0 });
      setSettings(data.settings ?? null);
      setAgents(data.agents ?? []);
      setSelectedConvId((cur) => {
        if (cur && list.some((c) => c.id === cur)) return cur;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Liste yüklenemedi.");
    } finally {
      setLoadingList(false);
    }
  }, [tenantId, tab, statusFilter, channelFilter, labelFilter, sortBy, searchQuery, notify]);

  const fetchDetail = useCallback(
    async (convId: string) => {
      setLoadingDetail(true);
      try {
        const res = await fetch(
          `/api/inbox/conversations/${encodeURIComponent(convId)}?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Konuşma detayı alınamadı.");
        const d = data as ConversationDetailResponse;
        setDetail(d);
        setContactNotesDraft(d.contact.notes ?? "");
        setAiSuggestions([]);

        // Okunmamış mesaj varsa okundu işaretle
        if (d.conversation.unreadCount > 0) {
          void fetch(
            `/api/inbox/conversations/${encodeURIComponent(convId)}?tenantId=${encodeURIComponent(tenantId)}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ markRead: true }),
            },
          );
        }
      } catch (err) {
        notify("error", err instanceof Error ? err.message : "Detay yüklenemedi.");
      } finally {
        setLoadingDetail(false);
      }
    },
    [tenantId, notify],
  );

  useEffect(() => {
    setLoadingList(true);
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (selectedConvId) {
      void fetchDetail(selectedConvId);
    } else {
      setDetail(null);
    }
  }, [selectedConvId, fetchDetail]);

  // Document title unread counter
  useEffect(() => {
    const base = "Mesaj Kutusu · NordVow";
    document.title = counts.unreadTotal > 0 ? `(${counts.unreadTotal}) ${base}` : base;
  }, [counts.unreadTotal]);

  // Real-time SSE connection (/api/inbox/stream)
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/inbox/stream?tenantId=${encodeURIComponent(tenantId)}`);
      const onRefresh = () => {
        void fetchList();
        if (selectedConvId) void fetchDetail(selectedConvId);
      };
      es.addEventListener("message.created", onRefresh);
      es.addEventListener("message.updated", onRefresh);
      es.addEventListener("conversation.updated", onRefresh);
    } catch {
      // Fallback polling if SSE unavailable
    }
    return () => {
      es?.close();
    };
  }, [tenantId, selectedConvId, fetchList, fetchDetail]);

  // Keyboard shortcuts (disabled inside INPUT/TEXTAREA/SELECT)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutsModal((s) => !s);
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const idx = conversations.findIndex((c) => c.id === selectedConvId);
        const next = conversations[idx + 1];
        if (next) setSelectedConvId(next.id);
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const idx = conversations.findIndex((c) => c.id === selectedConvId);
        const prev = conversations[idx - 1];
        if (prev) setSelectedConvId(prev.id);
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setComposerMode("reply");
        composerInputRef.current?.focus();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setComposerMode("note");
        composerInputRef.current?.focus();
        return;
      }
      if ((e.key === "e" || e.key === "E") && detail) {
        e.preventDefault();
        const nextStatus: InboxUiStatus = detail.conversation.status === "resolved" ? "open" : "resolved";
        void patchConversation({ status: nextStatus });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Canned response slash (`/`) search
  const cannedMatches = useMemo(() => {
    if (!composerText.startsWith("/") || !settings) return [];
    const firstToken = composerText.slice(1).split(/\s/)[0] ?? "";
    return searchCannedResponses(settings.cannedResponses, firstToken).slice(0, 6);
  }, [composerText, settings]);

  const applyCannedItem = (item: CannedResponseItem) => {
    const interpolated = interpolateCannedResponse(item.content, {
      kisiAd: detail?.contact.name,
      temsilciAd: actorName,
      markaAd: tenantOptions.find((t) => t.id === tenantId)?.name ?? "NordVow",
    });
    setComposerText(interpolated);
    composerInputRef.current?.focus();
  };

  const patchConversation = async (patch: Record<string, unknown>) => {
    if (!selectedConvId) return;
    try {
      const res = await fetch(
        `/api/inbox/conversations/${encodeURIComponent(selectedConvId)}?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Güncellenemedi.");
      setDetail(data as ConversationDetailResponse);
      void fetchList();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Konuşma güncellenemedi.");
    }
  };

  const handleBulkUpdate = async (patch: { status?: InboxUiStatus; assigneeId?: string | null; addLabel?: string }) => {
    if (checkedConvIds.length === 0) return;
    try {
      const res = await fetch(`/api/inbox/conversations?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: checkedConvIds, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Toplu işlem başarısız.");
      setCheckedConvIds([]);
      notify("ok", `${checkedConvIds.length} konuşma güncellendi.`);
      void fetchList();
      if (selectedConvId) void fetchDetail(selectedConvId);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Toplu işlem hatası.");
    }
  };

  const handleSend = async () => {
    if (!detail || sending) return;
    const text = composerText.trim();
    if (!text && pendingAttachments.length === 0) return;

    setSending(true);
    try {
      const res = await fetch(
        `/api/inbox/conversations/${encodeURIComponent(detail.conversation.id)}/messages?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: composerMode === "note" ? "note" : pendingAttachments.length > 0 ? "attachment" : "text",
            content: text,
            attachments: pendingAttachments,
            aiAssisted: aiAssistedDraft,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Mesaj gönderilemedi.");
      setComposerText("");
      setPendingAttachments([]);
      setAiAssistedDraft(false);
      setAiSuggestions([]);
      await fetchDetail(detail.conversation.id);
      void fetchList();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Gönderim başarısız.");
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async () => {
    if (!detail || !selectedTemplateId) return;
    const tmpl = detail.templates.find((t) => t.id === selectedTemplateId || t.name === selectedTemplateId);
    if (!tmpl) return;
    const preview = tmpl.body
      .replace("{{1}}", templateParam1 || detail.contact.name)
      .replace("{{2}}", templateParam2 || "Talebiniz incelendi");

    setSending(true);
    try {
      const res = await fetch(
        `/api/inbox/conversations/${encodeURIComponent(detail.conversation.id)}/messages?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "template",
            template: {
              id: tmpl.id,
              name: tmpl.name,
              language: tmpl.language,
              params: [templateParam1 || detail.contact.name, templateParam2 || "Talebiniz incelendi"],
              bodyPreview: preview,
            },
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Şablon gönderilemedi.");
      setShowTemplateModal(false);
      setTemplateParam1("");
      setTemplateParam2("");
      await fetchDetail(detail.conversation.id);
      void fetchList();
      notify("ok", "Onaylı WhatsApp şablonu gönderildi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Şablon gönderim hatası.");
    } finally {
      setSending(false);
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    try {
      const res = await fetch(
        `/api/inbox/messages/${encodeURIComponent(messageId)}/retry?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tekrar denenemedi.");
      if (selectedConvId) await fetchDetail(selectedConvId);
      notify("ok", "Mesaj yeniden gönderildi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Tekrar deneme başarısız.");
    }
  };

  const handleRequestAiSuggestions = async () => {
    if (!detail) return;
    setAiLoading(true);
    try {
      const res = await fetch(
        `/api/inbox/conversations/${encodeURIComponent(detail.conversation.id)}/ai-suggest?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI önerisi alınamadı.");
      setAiSuggestions(data.suggestions ?? []);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "AI önerisi hatası.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAttachmentUpload = async (file: File) => {
    setUploadingFile(true);
    try {
      const uploaded = await uploadFile(file, { name: file.name, mime: file.type });
      setPendingAttachments((prev) => [
        ...prev,
        {
          id: uploaded.id,
          kind: uploaded.kind,
          url: `/api/creative/file/${encodeURIComponent(uploaded.id)}`,
          name: file.name,
        },
      ]);
      notify("ok", `${file.name} eklendi.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Dosya yüklenemedi.");
    } finally {
      setUploadingFile(false);
    }
  };

  const openSettingsAndLoadChannels = async () => {
    setShowSettingsModal(true);
    try {
      const res = await fetch(`/api/inbox/channels?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setChannels(data.channels ?? []);
        setIgAuthorizeUrl(data.igAuthorizeUrl ?? null);
      }
    } catch {
      // ignore
    }
  };

  const saveContactPatch = async (patch: Record<string, unknown>, successMsg = "Kişi bilgileri kaydedildi.") => {
    if (!detail) return;
    try {
      const res = await fetch(
        `/api/inbox/contacts/${encodeURIComponent(detail.contact.id)}?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kişi güncellenemedi.");
      await fetchDetail(detail.conversation.id);
      notify("ok", successMsg);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Kişi güncellenemedi.");
    }
  };

  const handleExportContactKvkk = async () => {
    if (!detail) return;
    try {
      const res = await fetch(
        `/api/inbox/contacts/${encodeURIComponent(detail.contact.id)}?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Dışa aktarılamadı.");
      const blob = new Blob([JSON.stringify(data.exported, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kvkk_kisi_${detail.contact.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify("ok", "Kişi verileri JSON olarak indirildi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "KVKK dışa aktarım hatası.");
    }
  };

  const handleDeleteContactKvkk = async () => {
    if (!detail) return;
    if (!window.confirm(`${detail.contact.name} kişisini ve tüm mesaj geçmişini KVKK kapsamında kalıcı olarak silmek istediğinize emin misiniz?`)) {
      return;
    }
    try {
      const res = await fetch(
        `/api/inbox/contacts/${encodeURIComponent(detail.contact.id)}?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Silinemedi.");
      setSelectedConvId(null);
      setDetail(null);
      await fetchList();
      notify("ok", "Kişi ve konuşmaları KVKK kapsamında kalıcı olarak silindi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Silme hatası.");
    }
  };

  const windowState = detail?.conversation.windowState;
  const isReplyLocked =
    composerMode === "reply" && windowState !== undefined && !windowState.canFreeform;

  // Combine messages, private notes and activities chronologically
  const timelineItems = useMemo(() => {
    if (!detail) return [];
    const items: (
      | { kind: "message"; ts: string; data: MessageItem }
      | { kind: "note"; ts: string; data: PrivateNoteItem }
      | { kind: "activity"; ts: string; data: ActivityItem }
    )[] = [
        ...detail.conversation.messages.map((m) => ({ kind: "message" as const, ts: m.createdAt, data: m })),
        ...detail.conversation.notes.map((n) => ({ kind: "note" as const, ts: n.createdAt, data: n })),
        ...detail.conversation.activities.map((a) => ({ kind: "activity" as const, ts: a.createdAt, data: a })),
      ];
    items.sort((a, b) => a.ts.localeCompare(b.ts));
    return items;
  }, [detail]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-surface text-fg"
          : "flex min-h-[760px] flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg"
      }
    >
      {/* Sadeleştirilmiş Üst Başlık & Tek Merkez Geçişi */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line bg-bg/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 text-xs">
            <span className="rounded-lg bg-fg px-3 py-1 font-semibold text-bg">
              Mesaj Kutusu
            </span>
            <Link
              href="/dashboard/iletisim?sekme=otomasyon"
              className="rounded-lg px-3 py-1 font-medium text-fg-muted transition hover:text-fg"
            >
              DM Otomasyonu
            </Link>
          </div>

          {tenantOptions.length > 1 ? (
            <select
              aria-label="Çalışma Alanı Seç"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs text-fg"
            >
              {tenantOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind} · {t.name}
                </option>
              ))}
            </select>
          ) : null}

          {/* Sekmeler: Benim / Atanmamış / Tümü */}
          <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 text-xs">
            {(
              [
                { id: "mine", label: "Benim", count: counts.mine },
                { id: "unassigned", label: "Atanmamış", count: counts.unassigned },
                { id: "all", label: "Tümü", count: counts.all },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${tab === t.id ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
                  }`}
              >
                <span>{t.label}</span>
                <span className="rounded-full bg-black/15 px-1.5 text-[10px] tabular-nums">{t.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ara… (Ctrl+K)"
            className="h-8 w-44 rounded-lg border border-line bg-bg px-3 text-xs text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void openSettingsAndLoadChannels()}
            className="h-8 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg hover:border-fg/40"
          >
            Kanallar & Ayarlar
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="h-8 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg hover:border-fg/40"
          >
            {isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
          </button>
        </div>
      </header>

      {/* Bildirim Toast */}
      {toast ? (
        <div
          role="status"
          className={`border-b px-4 py-1.5 text-xs font-medium ${toast.tone === "error"
              ? "border-red-500/30 bg-red-500/15 text-red-500"
              : toast.tone === "warn"
                ? "border-amber-500/30 bg-amber-500/15 text-amber-600"
                : "border-emerald-500/30 bg-emerald-500/15 text-emerald-600"
            }`}
        >
          {toast.text}
        </div>
      ) : null}

      {/* Ana 3 Sütunlu Gövde */}
      <div className="grid min-h-[680px] flex-1 grid-cols-1 lg:grid-cols-[340px_1fr_310px]">
        {/* 1. SÜTUN: Konuşma Listesi & Filtreler */}
        <aside className="flex flex-col border-b border-line bg-bg/30 lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-2 gap-1.5 border-b border-line p-2.5 text-xs">
            <select
              aria-label="Durum Filtresi"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InboxUiStatus | "all")}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg"
            >
              <option value="open">Durum: Açık</option>
              <option value="pending">Durum: Beklemede</option>
              <option value="snoozed">Durum: Ertelendi</option>
              <option value="resolved">Durum: Çözüldü</option>
              <option value="all">Durum: Tümü</option>
            </select>

            <select
              aria-label="Kanal Filtresi"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as InboxChannelType | "ALL")}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg"
            >
              <option value="ALL">Kanal: Tümü</option>
              <option value="INSTAGRAM">Instagram DM</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>

            <select
              aria-label="Etiket Filtresi"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg"
            >
              <option value="">Etiket: Tümü</option>
              {settings?.labels.map((l) => (
                <option key={l.id} value={l.name}>
                  #{l.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Sıralama"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "last_activity" | "waiting_longest")}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg"
            >
              <option value="last_activity">Sırala: Son etkinlik</option>
              <option value="waiting_longest">Sırala: En uzun bekleyen</option>
            </select>
          </div>

          {/* Çoklu Seçim Toplu İşlem Çubuğu (Asla mesaj göndermez) */}
          {checkedConvIds.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-line bg-amber-500/10 px-3 py-1.5 text-[11px]">
              <span className="font-semibold text-fg">{checkedConvIds.length} seçili</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleBulkUpdate({ status: "resolved" })}
                  className="rounded border border-line bg-surface px-2 py-0.5 font-medium hover:border-fg/40"
                >
                  Çözüldü
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkUpdate({ addLabel: "işbirliği" })}
                  className="rounded border border-line bg-surface px-2 py-0.5 font-medium hover:border-fg/40"
                >
                  #işbirliği
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedConvIds([])}
                  className="px-1.5 text-fg-muted hover:text-fg"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : null}

          {/* Konuşma Listesi */}
          <ul role="listbox" aria-label="Konuşma listesi" className="flex max-h-[600px] flex-1 flex-col divide-y divide-line overflow-y-auto">
            {loadingList ? (
              <li className="p-6 text-center text-xs text-fg-muted">Konuşmalar yükleniyor…</li>
            ) : conversations.length === 0 ? (
              <li className="flex flex-col items-center gap-2 p-8 text-center text-xs text-fg-muted">
                <p>Bu filtreyle eşleşen konuşma yok.</p>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setChannelFilter("ALL");
                    setLabelFilter("");
                    setSearchQuery("");
                  }}
                  className="rounded-lg border border-line px-3 py-1 text-fg hover:border-fg/40"
                >
                  Filtreleri temizle
                </button>
              </li>
            ) : (
              conversations.map((c) => {
                const active = c.id === selectedConvId;
                const checked = checkedConvIds.includes(c.id);
                return (
                  <li
                    key={c.id}
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedConvId(c.id)}
                    className={`flex cursor-pointer items-start gap-2.5 px-3 py-3 transition ${active ? "bg-fg/10" : "hover:bg-surface-hover"
                      }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`#${c.displayId} seç`}
                      checked={checked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        setCheckedConvIds((prev) =>
                          e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                        );
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${c.channel === "INSTAGRAM"
                                ? "bg-gradient-to-r from-pink-500 to-purple-600"
                                : "bg-emerald-600"
                              }`}
                          >
                            {c.channel === "INSTAGRAM" ? "IG" : "WA"}
                          </span>
                          <span className="truncate text-xs font-semibold text-fg">{c.contact.name}</span>
                          <span className="shrink-0 text-[10px] text-fg-passive">#{c.displayId}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {c.windowState.closingSoon && c.windowState.canFreeform ? (
                            <span title="Yanıt penceresi 2 saatten az kaldı" className="text-xs">
                              ⏳
                            </span>
                          ) : null}
                          <span className="text-[10px] tabular-nums text-fg-passive">
                            {relativeTimeTr(c.lastActivityAt)}
                          </span>
                        </div>
                      </div>

                      <p className="mt-1 truncate text-xs text-fg-muted">{c.lastMessagePreview}</p>

                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                        <div className="flex flex-wrap items-center gap-1">
                          {c.tags.map((tag) => {
                            const lbl = settings?.labels.find((l) => l.name === tag);
                            return (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-fg-muted"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: lbl?.color ?? "#06B6D4" }}
                                />
                                {tag}
                              </span>
                            );
                          })}
                          {c.priority ? (
                            <span
                              className={`rounded border px-1 py-0.5 text-[9px] font-semibold ${PRIORITY_LABELS[c.priority].color
                                }`}
                            >
                              {PRIORITY_LABELS[c.priority].label}
                            </span>
                          ) : null}
                        </div>

                        {c.unreadCount > 0 ? (
                          <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">
                            {c.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        {/* 2. SÜTUN: Konuşma Detayı & Mesaj Akışı & Yazma Alanı */}
        <section className="flex flex-col bg-surface">
          {!detail ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-fg-muted">
              <p className="font-semibold text-fg">Henüz seçili konuşma yok</p>
              <p className="max-w-sm text-xs">
                Soldaki listeden bir Instagram DM veya WhatsApp konuşması seçerek mesaj geçmişini ve 24 saatlik yanıt penceresini yönetebilirsiniz.
              </p>
            </div>
          ) : (
            <>
              {/* Konuşma Üst Barı */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${detail.conversation.channel === "INSTAGRAM"
                        ? "bg-gradient-to-r from-pink-500 to-purple-600"
                        : "bg-emerald-600"
                      }`}
                  >
                    {detail.conversation.channel}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-fg">{detail.contact.name}</span>
                      <span className="text-xs text-fg-passive">#{detail.conversation.displayId}</span>
                    </div>
                    <p className="text-[11px] text-fg-muted">
                      {detail.contact.username ? `@${detail.contact.username}` : detail.contact.phoneE164}
                    </p>
                  </div>
                </div>

                {/* Durum, Erteleme, Atama, Öncelik, Etiket */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      void patchConversation({
                        status: detail.conversation.status === "resolved" ? "open" : "resolved",
                      })
                    }
                    className={`h-8 rounded-xl px-3 font-semibold transition ${detail.conversation.status === "resolved"
                        ? "border border-line bg-surface text-fg"
                        : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                      }`}
                  >
                    {detail.conversation.status === "resolved" ? "Yeniden Aç" : "✓ Çözüldü olarak işaretle"}
                  </button>

                  <select
                    aria-label="Durum veya Ertele"
                    value={detail.conversation.status}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "snooze_1h") {
                        void patchConversation({
                          status: "snoozed",
                          snoozedUntil: new Date(Date.now() + 3600_000).toISOString(),
                        });
                      } else if (val === "snooze_tomorrow") {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        d.setHours(9, 0, 0, 0);
                        void patchConversation({ status: "snoozed", snoozedUntil: d.toISOString() });
                      } else {
                        void patchConversation({ status: val });
                      }
                    }}
                    className="h-8 rounded-xl border border-line bg-bg px-2 text-xs text-fg"
                  >
                    <option value="open">Açık</option>
                    <option value="pending">Beklemede</option>
                    <option value="snoozed">Ertelendi</option>
                    <option value="resolved">Çözüldü</option>
                    <option value="snooze_1h">⏰ Ertele: 1 saat</option>
                    <option value="snooze_tomorrow">⏰ Ertele: Yarın 09:00</option>
                  </select>

                  <select
                    aria-label="Temsilci Ata"
                    value={detail.conversation.assigneeId ?? ""}
                    onChange={(e) => void patchConversation({ assigneeId: e.target.value || null })}
                    className="h-8 rounded-xl border border-line bg-bg px-2 text-xs text-fg"
                  >
                    <option value="">Atanan: Yok</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        Atanan: {a.name}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Öncelik"
                    value={detail.conversation.priority ?? ""}
                    onChange={(e) => void patchConversation({ priority: e.target.value || null })}
                    className="h-8 rounded-xl border border-line bg-bg px-2 text-xs text-fg"
                  >
                    <option value="">Öncelik: Normal</option>
                    <option value="low">Düşük</option>
                    <option value="medium">Orta</option>
                    <option value="high">Yüksek</option>
                    <option value="urgent">Acil</option>
                  </select>

                  <select
                    aria-label="Etiket Ekle"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void patchConversation({ addLabel: e.target.value });
                    }}
                    className="h-8 rounded-xl border border-line bg-bg px-2 text-xs text-fg"
                  >
                    <option value="">+ Etiket</option>
                    {settings?.labels.map((l) => (
                      <option key={l.id} value={l.name}>
                        #{l.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowMobileContact((v) => !v)}
                    className="h-8 rounded-xl border border-line px-2.5 text-xs lg:hidden"
                  >
                    Kişi Profili
                  </button>
                </div>
              </div>

              {/* Etiket Rozetleri Şeridi */}
              {detail.conversation.tags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-bg/30 px-4 py-1.5">
                  {detail.conversation.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-fg"
                    >
                      #{tag}
                      <button
                        type="button"
                        aria-label={`${tag} etiketini kaldır`}
                        onClick={() => void patchConversation({ removeLabel: tag })}
                        className="text-fg-muted hover:text-fg"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Mesaj & Not & Aktivite Akışı */}
              <div
                aria-live="polite"
                className="flex max-h-[410px] flex-1 flex-col gap-2.5 overflow-y-auto bg-bg/20 p-4"
              >
                {loadingDetail ? (
                  <p className="py-4 text-center text-xs text-fg-muted">Mesajlar yükleniyor…</p>
                ) : null}

                {timelineItems.map((item) => {
                  if (item.kind === "activity") {
                    return (
                      <div key={item.data.id} className="my-1 flex justify-center">
                        <span className="rounded-full border border-line bg-surface px-3 py-0.5 text-[11px] text-fg-muted">
                          {item.data.text} · {relativeTimeTr(item.data.createdAt)}
                        </span>
                      </div>
                    );
                  }
                  if (item.kind === "note") {
                    return (
                      <div
                        key={item.data.id}
                        className="self-stretch rounded-xl border border-amber-400/50 bg-amber-500/15 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] font-semibold text-amber-500">
                          <span>🟨 Dahili Not · Sadece ekip görür ({item.data.authorName})</span>
                          <span>{relativeTimeTr(item.data.createdAt)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-fg">{item.data.content}</p>
                      </div>
                    );
                  }

                  const m = item.data;
                  const isOut = m.direction === "OUTGOING";
                  return (
                    <div
                      key={m.id}
                      className={`flex max-w-[82%] flex-col ${isOut ? "self-end items-end" : "self-start items-start"}`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${isOut
                            ? "bg-fg text-bg"
                            : "border border-line bg-surface text-fg"
                          }`}
                      >
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        {m.mediaUrl ? (
                          <a
                            href={m.mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 inline-block underline"
                          >
                            📎 Medya Ekini Aç
                          </a>
                        ) : null}
                        {m.attachments?.map((att) => (
                          <a
                            key={att.id}
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 block underline"
                          >
                            📎 {att.name}
                          </a>
                        ))}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-passive">
                        {isOut && m.senderName ? <span>{m.senderName} ·</span> : null}
                        <span>{new Date(m.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                        {m.aiAssisted ? (
                          <span className="rounded bg-purple-500/15 px-1 text-purple-400" title="Sadece ekip görür">
                            ✨ AI taslağı
                          </span>
                        ) : null}
                        {m.humanAgentTag ? (
                          <span className="rounded bg-indigo-500/15 px-1 text-indigo-400">HUMAN_AGENT</span>
                        ) : null}
                        {m.sentByAutomation ? (
                          <span className="rounded bg-cyan-500/15 px-1 text-cyan-400">Otomasyon</span>
                        ) : null}
                        {isOut ? (
                          <span>
                            {m.status === "read" ? (
                              <strong className="text-cyan-400" title="Okundu">
                                ✓✓
                              </strong>
                            ) : m.status === "delivered" ? (
                              <span title="İletildi">✓✓</span>
                            ) : m.status === "failed" ? (
                              <span className="text-red-400">
                                ! Gönderilemedi {m.externalError ? `(${m.externalError})` : ""}{" "}
                                <button
                                  type="button"
                                  onClick={() => void handleRetryMessage(m.id)}
                                  className="underline hover:text-red-300"
                                >
                                  Tekrar dene
                                </button>
                              </span>
                            ) : (
                              <span title="Gönderildi">✓</span>
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 24 Saat Mesajlaşma Penceresi Bandı */}
              {windowState ? (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-1.5 text-xs ${windowState.reason === "open"
                      ? windowState.closingSoon
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-emerald-500/10 text-emerald-500"
                      : windowState.reason === "human_agent"
                        ? "bg-indigo-500/15 text-indigo-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                >
                  <span>
                    {windowState.reason === "open"
                      ? windowState.closingSoon
                        ? `⏳ Pencere ${formatRemainingWindow(windowState.remainingMinutes)} sonra kapanacak`
                        : `🟢 Yanıt penceresi açık · ${formatRemainingWindow(windowState.remainingMinutes)} kaldı`
                      : windowState.reason === "human_agent"
                        ? `🧑‍💻 İnsan yanıtı olarak gönderilecek (7 gün HUMAN_AGENT kuralı · ${formatRemainingWindow(windowState.remainingMinutes)} kaldı)`
                        : detail.conversation.channel === "WHATSAPP"
                          ? "🔴 24 saatlik pencere kapandı. Sadece onaylı şablon gönderebilirsin."
                          : "🔴 24 saatlik pencere kapandı. Kişi tekrar yazınca yanıt verebilirsin."}
                  </span>

                  {detail.conversation.channel === "WHATSAPP" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTemplateId(detail.templates[0]?.id ?? "");
                        setShowTemplateModal(true);
                      }}
                      className="rounded-lg bg-fg px-2.5 py-1 text-[11px] font-semibold text-bg hover:opacity-90"
                    >
                      📋 Şablon Seç
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* AI Yanıt Önerisi Kartları (İnsan Onaylı) */}
              {aiSuggestions.length > 0 ? (
                <div className="border-t border-line bg-purple-500/5 px-4 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-purple-400">
                      ✨ AI Yanıt Taslakları — Göndermeden önce kontrol edin (otomatik gönderilmez)
                    </span>
                    <button
                      type="button"
                      onClick={() => setAiSuggestions([])}
                      className="text-fg-muted hover:text-fg"
                    >
                      Kapat ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {aiSuggestions.map((s, idx) => (
                      <div key={idx} className="flex flex-col justify-between gap-2 rounded-xl border border-line bg-surface p-2.5 text-xs">
                        <div>
                          <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-purple-400">
                            {s.tone}
                          </span>
                          <p className="mt-1.5 text-fg">{s.text}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setComposerMode("reply");
                            setComposerText(s.text);
                            setAiAssistedDraft(true);
                            composerInputRef.current?.focus();
                          }}
                          className="self-end rounded-lg bg-fg px-2.5 py-1 text-[11px] font-semibold text-bg hover:opacity-90"
                        >
                          Kullan
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Hazır Yanıtlar `/` Açılır Listesi */}
              {cannedMatches.length > 0 ? (
                <div className="border-t border-line bg-surface px-4 py-2">
                  <p className="mb-1 text-[10px] font-semibold text-fg-muted">HAZIR YANITLAR (Seçmek için tıklayın):</p>
                  <div className="flex flex-col gap-1">
                    {cannedMatches.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => applyCannedItem(item)}
                        className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-left text-xs hover:bg-bg"
                      >
                        <span>
                          <strong className="text-cyan-400">/{item.shortCode}</strong> — {item.content.slice(0, 85)}
                        </span>
                        <span className="text-[10px] text-fg-passive">Puan: {item.score}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Yazma Alanı (Composer: Yanıtla | Dahili Not) */}
              <div className="flex flex-col gap-2 border-t border-line bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setComposerMode("reply")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${composerMode === "reply" ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
                        }`}
                    >
                      Yanıtla
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposerMode("note")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${composerMode === "note"
                          ? "bg-amber-400 text-slate-950"
                          : "text-fg-muted hover:text-fg"
                        }`}
                    >
                      🟨 Dahili Not
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {settings?.aiSuggestionsEnabled !== false ? (
                      <button
                        type="button"
                        disabled={aiLoading}
                        onClick={() => void handleRequestAiSuggestions()}
                        className="rounded-xl border border-purple-400/40 bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-400 hover:bg-purple-500/20 disabled:opacity-50"
                      >
                        {aiLoading ? "Öneri hazırlanıyor…" : "✨ Yanıt öner"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {pendingAttachments.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {pendingAttachments.map((att) => (
                      <span
                        key={att.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2 py-1 text-[11px]"
                      >
                        📎 {att.name}
                        <button
                          type="button"
                          onClick={() => setPendingAttachments((p) => p.filter((x) => x.id !== att.id))}
                          className="text-fg-muted hover:text-fg"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <textarea
                  ref={composerInputRef}
                  rows={3}
                  disabled={isReplyLocked}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      (settings?.enterToSend ?? true) &&
                      !isReplyLocked
                    ) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    isReplyLocked
                      ? "24 saatlik yanıt penceresi kapalı. WhatsApp için yukarıdan onaylı şablon seçebilirsiniz."
                      : composerMode === "note"
                        ? "Sadece ekip görür. (@ ile ekip üyesinden bahsedebilirsiniz)…"
                        : "Mesajınızı yazın… (Hazır yanıtlar için / yazın)"
                  }
                  className={`w-full rounded-xl border p-2.5 text-xs focus:outline-none disabled:opacity-50 ${composerMode === "note"
                      ? "border-amber-400/50 bg-amber-500/10 text-fg"
                      : "border-line bg-bg text-fg"
                    }`}
                />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {["😊", "👍", "✨", "🙏", "🎉"].map((em) => (
                      <button
                        key={em}
                        type="button"
                        disabled={isReplyLocked}
                        onClick={() => setComposerText((t) => `${t}${em}`)}
                        className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-bg disabled:opacity-40"
                      >
                        {em}
                      </button>
                    ))}
                    <label className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-xs text-fg-muted hover:text-fg">
                      {uploadingFile ? "Yükleniyor…" : "📎 Dosya"}
                      <input
                        type="file"
                        accept="image/*,video/*,application/pdf"
                        className="hidden"
                        disabled={isReplyLocked || uploadingFile}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleAttachmentUpload(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    disabled={sending || isReplyLocked || (!composerText.trim() && pendingAttachments.length === 0)}
                    onClick={() => void handleSend()}
                    className={`h-8 rounded-xl px-4 text-xs font-bold transition disabled:opacity-40 ${composerMode === "note"
                        ? "bg-amber-400 text-slate-950"
                        : "bg-fg text-bg hover:opacity-90"
                      }`}
                  >
                    {sending ? "Gönderiliyor…" : composerMode === "note" ? "Notu Kaydet ⏎" : "Gönder ⏎"}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* 3. SÜTUN: Kişi Profili, NordVow Creator Eşleşmesi, İletişim Onayı (Opt-in) & KVKK */}
        <aside
          className={`${showMobileContact ? "flex" : "hidden lg:flex"
            } flex-col gap-3 border-t border-line bg-bg/30 p-3.5 text-xs lg:border-l lg:border-t-0`}
        >
          {!detail ? (
            <p className="py-8 text-center text-fg-muted">Kişi detayları için bir konuşma seçin.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-fg">{detail.contact.name}</span>
                  {detail.contact.isVerifiedUser ? (
                    <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                      ✓ Doğrulanmış
                    </span>
                  ) : null}
                </div>
                {detail.contact.username ? (
                  <p className="text-fg-muted">@{detail.contact.username}</p>
                ) : null}
                {detail.contact.phoneE164 ? (
                  <p className="text-fg-muted">{detail.contact.phoneE164}</p>
                ) : null}
                {detail.contact.followerCount !== null ? (
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-fg-muted">
                    <span>
                      <strong className="text-fg">
                        {detail.contact.followerCount.toLocaleString("tr-TR")}
                      </strong>{" "}
                      takipçi
                    </span>
                    {detail.contact.isUserFollowBusiness ? (
                      <span className="text-emerald-500">· Sizi takip ediyor ✓</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* NordVow Creator Eşleşmesi */}
              <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3">
                <span className="font-semibold text-fg">NordVow Creator Eşleşmesi</span>
                {detail.contact.matchedCreator ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                    <p className="font-semibold text-emerald-400">
                      ✓ {detail.contact.matchedCreator.name} (@{detail.contact.matchedCreator.handle})
                    </p>
                    <p className="text-[11px] text-fg-muted">
                      {detail.contact.matchedCreator.category} ·{" "}
                      {detail.contact.matchedCreator.followers.toLocaleString("tr-TR")} takipçi
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-fg-muted">
                    Bu kişiyle otomatik eşleşen kayıtlı NordVow creator profili bulunamadı.
                  </p>
                )}
              </div>

              {/* İletişim Onayı (Opt-in / Opt-out) Kartı */}
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fg">İletişim Onayı (Opt-in)</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${detail.contact.consent?.state === "GRANTED"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : detail.contact.consent?.state === "WITHDRAWN"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-zinc-500/20 text-fg-muted"
                      }`}
                  >
                    {detail.contact.consent?.state === "GRANTED"
                      ? "Onay Var"
                      : detail.contact.consent?.state === "WITHDRAWN"
                        ? "Geri Çekildi"
                        : "Onay Yok"}
                  </span>
                </div>
                {detail.contact.consent ? (
                  <p className="text-[11px] text-fg-muted">
                    Kaynak: {detail.contact.consent.source} (
                    {new Date(detail.contact.consent.updatedAt).toLocaleDateString("tr-TR")})
                  </p>
                ) : null}
                <input
                  value={consentSourceDraft}
                  onChange={(e) => setConsentSourceDraft(e.target.value)}
                  placeholder="Belgeli onay kaynağı..."
                  className="h-7 rounded-lg border border-line bg-bg px-2 text-[11px]"
                />
                <input
                  value={consentNoteDraft}
                  onChange={(e) => setConsentNoteDraft(e.target.value)}
                  placeholder="Kanıt / not (zorunlu)..."
                  className="h-7 rounded-lg border border-line bg-bg px-2 text-[11px]"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void saveContactPatch(
                        {
                          consent: {
                            state: "GRANTED",
                            source: consentSourceDraft,
                            note: consentNoteDraft,
                          },
                        },
                        "Belgeli iletişim onayı kaydedildi.",
                      )
                    }
                    className="flex-1 rounded-lg bg-emerald-500 py-1 text-[11px] font-semibold text-slate-950"
                  >
                    Onay Kaydet
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void saveContactPatch(
                        {
                          consent: {
                            state: "WITHDRAWN",
                            source: "Temsilci tarafından geri çekildi",
                            note: consentNoteDraft,
                          },
                        },
                        "İletişim onayı geri çekildi.",
                      )
                    }
                    className="rounded-lg border border-line px-2 py-1 text-[11px] text-fg-muted hover:text-fg"
                  >
                    Geri Çek
                  </button>
                </div>
              </div>

              {/* Kişi Notları */}
              <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3">
                <span className="font-semibold text-fg">Kişi Notları</span>
                <textarea
                  rows={3}
                  value={contactNotesDraft}
                  onChange={(e) => setContactNotesDraft(e.target.value)}
                  placeholder="Kişi hakkında kalıcı ekip notu…"
                  className="rounded-lg border border-line bg-bg p-2 text-xs text-fg"
                />
                <button
                  type="button"
                  onClick={() => void saveContactPatch({ notes: contactNotesDraft })}
                  className="self-end rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium hover:border-fg/40"
                >
                  Notu Kaydet
                </button>
              </div>

              {/* KVKK & Engelleme İşlemleri */}
              <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3">
                <span className="font-semibold text-fg">KVKK & Güvenlik</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleExportContactKvkk()}
                    className="flex-1 rounded-lg border border-line py-1.5 text-[11px] font-medium hover:border-fg/40"
                  >
                    Verilerini Dışa Aktar
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void saveContactPatch(
                        { blocked: !detail.contact.blocked },
                        detail.contact.blocked ? "Kişi engeli kaldırıldı." : "Kişi engellendi.",
                      )
                    }
                    className="rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-[11px] text-amber-500"
                  >
                    {detail.contact.blocked ? "Engeli Kaldır" : "Engelle"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteContactKvkk()}
                  className="mt-1 rounded-lg border border-red-500/40 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/10"
                >
                  KVKK Kapsamında Verilerini Sil
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* WhatsApp Onaylı Şablon Seçici Modal */}
      {showTemplateModal && detail ? (
        <ModalDialog title="Onaylı WhatsApp Şablonu Gönder (UTILITY)" onClose={() => setShowTemplateModal(false)}>
          <div className="flex flex-col gap-3 text-xs">
            {detail.contact.consent?.state !== "GRANTED" ? (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-red-400">
                Bu kişinin iletişim onayı (opt-in) yok veya geri çekilmiş. Pencere dışında mesaj gönderebilmek için önce sağ panelden belgeli iletişim onayı eklemelisiniz.
              </div>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Onaylı Şablon (MARKETING şablonları kapalıdır)</span>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="h-9 rounded-lg border border-line bg-bg px-2 text-fg"
              >
                {detail.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language} · {t.category.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Parametre {"{{1}}"} (Kişi Adı)</span>
              <input
                value={templateParam1}
                onChange={(e) => setTemplateParam1(e.target.value)}
                placeholder={detail.contact.name}
                className="h-8 rounded-lg border border-line bg-bg px-2.5 text-fg"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Parametre {"{{2}}"} (Bilgilendirme Özeti)</span>
              <input
                value={templateParam2}
                onChange={(e) => setTemplateParam2(e.target.value)}
                placeholder="Örn: Teklifiniz onaylandı, panelden inceleyebilirsiniz"
                className="h-8 rounded-lg border border-line bg-bg px-2.5 text-fg"
              />
            </label>

            <button
              type="button"
              disabled={sending || detail.contact.consent?.state !== "GRANTED"}
              onClick={() => void handleSendTemplate()}
              className="h-9 rounded-xl bg-emerald-500 font-bold text-slate-950 disabled:opacity-40"
            >
              {sending ? "Gönderiliyor…" : "Tekil Konuşmaya Şablon Gönder"}
            </button>
          </div>
        </ModalDialog>
      ) : null}

      {/* Ayarlar & Kanallar & Hazır Yanıtlar Modal */}
      {showSettingsModal && settings ? (
        <ModalDialog title="Mesaj Kutusu Ayarları & Kanallar" onClose={() => setShowSettingsModal(false)}>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex gap-1 border-b border-line pb-2">
              {(
                [
                  { id: "channels", label: "Kanallar (IG/WA)" },
                  { id: "canned", label: "Hazır Yanıtlar" },
                  { id: "labels", label: "Etiketler" },
                  { id: "general", label: "AI & Saklama" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSettingsTab(t.id)}
                  className={`rounded-lg px-2.5 py-1 font-semibold ${settingsTab === t.id ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {settingsTab === "channels" ? (
              <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
                <div>
                  <p className="font-semibold text-fg">Bağlı Kanallar</p>
                  {channels.length === 0 ? (
                    <p className="mt-1 text-[11px] text-fg-muted">Henüz bağlı kanal yok.</p>
                  ) : (
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {channels.map((ch) => (
                        <li
                          key={ch.id}
                          className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2"
                        >
                          <div>
                            <p className="font-semibold text-fg">
                              {ch.provider} · {ch.displayName}
                            </p>
                            <p className="text-[10px] text-fg-muted">Durum: {ch.status}</p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await fetch(
                                `/api/inbox/channels?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(ch.id)}`,
                                { method: "DELETE" },
                              );
                              void openSettingsAndLoadChannels();
                              notify("ok", "Kanal bağlantısı kesildi.");
                            }}
                            className="rounded-lg border border-red-500/40 px-2 py-1 text-[10px] text-red-400"
                          >
                            Bağlantıyı Kes
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Instagram OAuth Bağlantı Kartı */}
                <div className="rounded-xl border border-line bg-bg p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-fg">Instagram Profesyonel Hesap Bağla</span>
                    {igAuthorizeUrl ? (
                      <a
                        href={igAuthorizeUrl}
                        className="rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-2.5 py-1 text-[11px] font-bold text-white"
                      >
                        Instagram OAuth Başlat →
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <input
                      value={igCode}
                      onChange={(e) => setIgCode(e.target.value)}
                      placeholder="OAuth Code"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                    <input
                      value={igUsername}
                      onChange={(e) => setIgUsername(e.target.value)}
                      placeholder="@kullaniciadi"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                    <input
                      value={igPageId}
                      onChange={(e) => setIgPageId(e.target.value)}
                      placeholder="Facebook Page ID (Sayısal)"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                    <input
                      value={igUserId}
                      onChange={(e) => setIgUserId(e.target.value)}
                      placeholder="IG User ID (Sayısal)"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await fetch(`/api/inbox/channels?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          action: "connect_instagram",
                          code: igCode,
                          pageId: igPageId,
                          igUserId,
                          igUsername,
                        }),
                      });
                      const d = await res.json();
                      if (!res.ok) {
                        notify("error", d.error ?? "Instagram bağlanamadı.");
                        return;
                      }
                      notify("ok", "Instagram kanalı şifreli olarak bağlandı.");
                      void openSettingsAndLoadChannels();
                    }}
                    className="mt-2 w-full rounded-lg bg-fg py-1.5 font-semibold text-bg"
                  >
                    Instagram Hesabını Kaydet
                  </button>
                </div>

                {/* WhatsApp Embedded Signup v4 Kartı */}
                <div className="rounded-xl border border-line bg-bg p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-fg">WhatsApp Business (Embedded Signup v4)</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/inbox/channels?tenantId=${encodeURIComponent(tenantId)}`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ action: "sync_templates" }),
                        });
                        notify("ok", "Onaylı WhatsApp şablonları senkronlandı.");
                      }}
                      className="rounded border border-line px-2 py-0.5 text-[10px] hover:border-fg/40"
                    >
                      ↻ Şablonları Yenile
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <input
                      value={waCode}
                      onChange={(e) => setWaCode(e.target.value)}
                      placeholder="Embedded Signup Code"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                    <input
                      value={waDisplayPhone}
                      onChange={(e) => setWaDisplayPhone(e.target.value)}
                      placeholder="+90 532 ..."
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                    <input
                      value={waWabaId}
                      onChange={(e) => setWaWabaId(e.target.value)}
                      placeholder="WABA ID (Sayısal)"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                    <input
                      value={waPhoneId}
                      onChange={(e) => setWaPhoneId(e.target.value)}
                      placeholder="Phone Number ID (Sayısal)"
                      className="h-8 rounded border border-line bg-surface px-2"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await fetch(`/api/inbox/channels?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          action: "connect_whatsapp",
                          code: waCode,
                          wabaId: waWabaId,
                          phoneNumberId: waPhoneId,
                          displayNumber: waDisplayPhone,
                          pin: waPin,
                        }),
                      });
                      const d = await res.json();
                      if (!res.ok) {
                        notify("error", d.error ?? "WhatsApp bağlanamadı.");
                        return;
                      }
                      notify("ok", "WhatsApp Business numarası bağlandı.");
                      void openSettingsAndLoadChannels();
                    }}
                    className="mt-2 w-full rounded-lg bg-emerald-500 py-1.5 font-bold text-slate-950"
                  >
                    WhatsApp Numarasını Bağla
                  </button>
                </div>
              </div>
            ) : null}

            {settingsTab === "canned" ? (
              <div className="flex flex-col gap-2.5">
                <p className="text-[11px] text-fg-muted">
                  Yazma alanında <code>/kısakod</code> yazarak hazır yanıtları çağırabilirsiniz. Değişkenler:{" "}
                  <code>{"{{kisi.ad}}"}</code>, <code>{"{{temsilci.ad}}"}</code>, <code>{"{{marka.ad}}"}</code>.
                </p>
                <div className="flex gap-1.5">
                  <input
                    value={newShortCode}
                    onChange={(e) => setNewShortCode(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
                    placeholder="kısakod"
                    className="h-8 w-28 rounded border border-line bg-bg px-2"
                  />
                  <input
                    value={newCannedContent}
                    onChange={(e) => setNewCannedContent(e.target.value)}
                    placeholder="Yanıt metni…"
                    className="h-8 flex-1 rounded border border-line bg-bg px-2"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newShortCode || !newCannedContent) return;
                      const nextList = [
                        ...settings.cannedResponses.filter((c) => c.shortCode !== newShortCode),
                        { id: `cr_${Date.now()}`, shortCode: newShortCode, content: newCannedContent },
                      ];
                      const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ cannedResponses: nextList }),
                      });
                      const d = await res.json();
                      if (res.ok) {
                        setSettings(d.settings);
                        setNewShortCode("");
                        setNewCannedContent("");
                        notify("ok", "Hazır yanıt eklendi.");
                      }
                    }}
                    className="rounded-lg bg-fg px-3 font-semibold text-bg"
                  >
                    Ekle
                  </button>
                </div>
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {settings.cannedResponses.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5"
                    >
                      <span className="truncate">
                        <strong className="text-cyan-400">/{c.shortCode}</strong>: {c.content}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const nextList = settings.cannedResponses.filter((x) => x.id !== c.id);
                          const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
                            method: "PUT",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ cannedResponses: nextList }),
                          });
                          const d = await res.json();
                          if (res.ok) setSettings(d.settings);
                        }}
                        className="text-red-400 hover:underline"
                      >
                        Sil
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {settingsTab === "labels" ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex gap-1.5">
                  <input
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value.toLowerCase())}
                    placeholder="etiket-adi"
                    className="h-8 flex-1 rounded border border-line bg-bg px-2"
                  />
                  <input
                    type="color"
                    value={newLabelColor}
                    onChange={(e) => setNewLabelColor(e.target.value)}
                    className="h-8 w-12 rounded border border-line bg-bg"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newLabelName.trim()) return;
                      const nextLabels = [
                        ...settings.labels,
                        { id: `lbl_${Date.now()}`, name: newLabelName.trim(), color: newLabelColor },
                      ];
                      const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ labels: nextLabels }),
                      });
                      const d = await res.json();
                      if (res.ok) {
                        setSettings(d.settings);
                        setNewLabelName("");
                      }
                    }}
                    className="rounded-lg bg-fg px-3 font-semibold text-bg"
                  >
                    Ekle
                  </button>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {settings.labels.map((l) => (
                    <li
                      key={l.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                      <span>{l.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {settingsTab === "general" ? (
              <div className="flex flex-col gap-3">
                <label className="flex items-center justify-between">
                  <span>AWS Bedrock AI Yanıt Önerileri (İnsan Onaylı)</span>
                  <input
                    type="checkbox"
                    checked={settings.aiSuggestionsEnabled}
                    onChange={async (e) => {
                      const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ aiSuggestionsEnabled: e.target.checked }),
                      });
                      const d = await res.json();
                      if (res.ok) setSettings(d.settings);
                    }}
                  />
                </label>

                <label className="flex items-center justify-between">
                  <span>Çözülmüş konuşmaya yeni mesaj gelince yeniden aç</span>
                  <input
                    type="checkbox"
                    checked={settings.reopenOnNewMessage}
                    onChange={async (e) => {
                      const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ reopenOnNewMessage: e.target.checked }),
                      });
                      const d = await res.json();
                      if (res.ok) setSettings(d.settings);
                    }}
                  />
                </label>

                <label className="flex items-center justify-between">
                  <span>KVKK Saklama Süresi (Ay)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.retentionMonths}
                    onChange={async (e) => {
                      const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ retentionMonths: Number(e.target.value) || 24 }),
                      });
                      const d = await res.json();
                      if (res.ok) setSettings(d.settings);
                    }}
                    className="h-8 w-20 rounded border border-line bg-bg px-2 text-right"
                  />
                </label>
              </div>
            ) : null}
          </div>
        </ModalDialog>
      ) : null}

      {/* Klavye Kısayolları Modal (?) */}
      {showShortcutsModal ? (
        <ModalDialog title="Mesaj Kutusu Klavye Kısayolları" onClose={() => setShowShortcutsModal(false)}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ["J / K", "Sonraki / Önceki konuşma"],
              ["R", "Yanıtla kutusuna odaklan"],
              ["N", "Dahili Not moduna geç"],
              ["E", "Çözüldü / Yeniden Aç"],
              ["/", "Hazır yanıt ara (yazma kutusunda)"],
              ["Ctrl/Cmd + K", "Arama kutusuna odaklan"],
              ["?", "Kısayol listesini aç/kapat"],
            ].map(([k, desc]) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-line bg-bg px-2.5 py-1.5">
                <span className="text-fg-muted">{desc}</span>
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg">
                  {k}
                </kbd>
              </div>
            ))}
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

function ModalDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 text-fg shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-bg hover:text-fg"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

