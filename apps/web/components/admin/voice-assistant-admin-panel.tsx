"use client";

import { useCallback, useEffect, useState } from "react";

export interface BrandOption {
  id: string;
  name: string;
}

type CostProfile = "eco" | "balanced" | "premium";
type Operator = "vodafone" | "turkcell" | "turk_telekom" | "voip_sip";
type VoiceTone = "warm" | "formal" | "energetic" | "calm";

interface AssistantSettings {
  enabled: boolean;
  businessName: string;
  costProfile: CostProfile;
  features: {
    knowledgeBaseEnabled: boolean;
    reservationsEnabled: boolean;
    staffNotesEnabled: boolean;
    callTransferEnabled: boolean;
    bargeInEnabled: boolean;
    costGuardEnabled: boolean;
  };
  conversation: {
    greetingMessage: string;
    maxResponseSentences: number;
    maxResponseTokens: number;
    silenceTimeoutMs: number;
    maxCallDurationSeconds: number;
  };
  voice: {
    provider: "elevenlabs" | "polly" | "mock";
    voiceId: string;
    modelId: string;
    tone: VoiceTone;
    latencyMode: "ultra_fast" | "balanced" | "high_quality";
    stability: number;
    similarityBoost: number;
    style: number;
    speed: number;
  };
  costLimits: {
    maxMonthlyBudgetUsd: number;
    autoSwitchToEcoAtPercent: number;
    maxSingleCallCostUsd: number;
  };
  staffNotifications: {
    transferPhoneNumber: string;
    webhookUrl: string;
  };
  telephony: {
    operator: Operator;
    personalMobileNumber: string;
    virtualForwardingNumber: string;
  };
  companyProfile: {
    sector: string;
    address: string;
    workingHours: string;
    servicesSummary: string;
  };
}

interface CostReport {
  totalCalls: number;
  totalCostUsd: number;
  budgetUsd: number;
}

interface CallRecord {
  callId: string;
  channel: string;
  callerPhone: string;
  startedAt: string;
  durationSeconds: number;
  status: string;
  estimatedCostUsd: number;
  extractedDetails?: {
    callerName?: string;
    intent?: string;
    urgency?: "normal" | "high";
    importantNotes: string[];
  };
  transcript: Array<{ speaker: string; text: string; timestamp: string }>;
}

interface ReservationRecord {
  id: string;
  confirmationCode: string;
  customerName: string;
  phone: string;
  date: string;
  time: string;
  partySize: number;
}

interface StaffNoteRecord {
  id: string;
  callerName: string;
  callerPhone: string;
  category: string;
  urgency: string;
  summary: string;
}

interface KnowledgeDoc {
  filename: string;
  chunkCount: number;
}

type TabKey =
  | "telephony"
  | "settings"
  | "knowledge"
  | "calls"
  | "records"
  | "simulator";

const API_BASE = "/api/admin/voice-assistant";

const OPERATOR_LABELS: Record<Operator, string> = {
  vodafone: "Vodafone",
  turkcell: "Turkcell",
  turk_telekom: "Türk Telekom",
  voip_sip: "VoIP / SIP (Netgsm, Bulutfon, Kobikom)",
};

export function VoiceAssistantAdminPanel({
  brands,
  initialBrandId,
}: {
  brands?: BrandOption[];
  initialBrandId?: string;
}) {
  const brandList =
    brands && brands.length > 0
      ? brands
      : [{ id: "default", name: "NordVow Genel" }];
  const [brandId, setBrandId] = useState(
    initialBrandId || brandList[0]?.id || "default",
  );
  const selectedBrand = brandList.find((b) => b.id === brandId);

  const [tab, setTab] = useState<TabKey>("telephony");
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [costs, setCosts] = useState<CostReport | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [notes, setNotes] = useState<StaffNoteRecord[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);

  const [docFilename, setDocFilename] = useState("");
  const [docContent, setDocContent] = useState("");

  const [simSessionId, setSimSessionId] = useState<string | undefined>();
  const [simInput, setSimInput] = useState("");
  const [simMessages, setSimMessages] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const notify = (msg: string) => {
    setErrorMsg(null);
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const brandQuery = `brandId=${encodeURIComponent(brandId)}&brandName=${encodeURIComponent(selectedBrand?.name || "")}`;

  const loadAll = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/settings?${brandQuery}`, { cache: "no-store" }),
        fetch(`${API_BASE}/metrics/costs?${brandQuery}`, { cache: "no-store" }),
      ]);
      if (!sRes.ok) {
        const err = await sRes.json().catch(() => ({}));
        setErrorMsg(err.error || "Sesli asistan ayarları yüklenemedi.");
        return;
      }
      setSettings(await sRes.json());
      if (cRes.ok) setCosts(await cRes.json());
      setErrorMsg(null);
    } catch {
      setErrorMsg("Sesli asistan servisine bağlanılamadı.");
    }
  }, [brandQuery]);

  useEffect(() => {
    setSimSessionId(undefined);
    setSimMessages([]);
    setSelectedCall(null);
    void loadAll();
  }, [loadAll]);

  const loadCalls = async () => {
    const res = await fetch(`${API_BASE}/calls?${brandQuery}`, {
      cache: "no-store",
    });
    if (res.ok) setCalls((await res.json()).calls || []);
  };

  const loadRecords = async () => {
    const [rRes, nRes] = await Promise.all([
      fetch(`${API_BASE}/reservations?${brandQuery}`, { cache: "no-store" }),
      fetch(`${API_BASE}/notes?${brandQuery}`, { cache: "no-store" }),
    ]);
    if (rRes.ok) setReservations((await rRes.json()).reservations || []);
    if (nRes.ok) setNotes((await nRes.json()).notes || []);
  };

  const loadDocs = async () => {
    const res = await fetch(`${API_BASE}/knowledge?${brandQuery}`, {
      cache: "no-store",
    });
    if (res.ok) setDocs((await res.json()).documents || []);
  };

  const handleTabChange = (next: TabKey) => {
    setTab(next);
    if (next === "calls") void loadCalls();
    if (next === "records") void loadRecords();
    if (next === "knowledge") void loadDocs();
  };

  const patchSettings = async (patch: Record<string, unknown>, msg: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings?${brandQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, brandId }),
      });
      if (!res.ok) {
        setErrorMsg("Ayarlar kaydedilemedi.");
        return;
      }
      setSettings(await res.json());
      notify(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDoc = async () => {
    if (!docFilename.trim() || !docContent.trim()) return;
    const res = await fetch(`${API_BASE}/knowledge?${brandQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandId,
        filename: docFilename.trim(),
        content: docContent.trim(),
      }),
    });
    if (res.ok) {
      setDocFilename("");
      setDocContent("");
      await loadDocs();
      notify("Belge bilgi bankasına eklendi.");
    }
  };

  const handleSendSim = async () => {
    const text = simInput.trim();
    if (!text) return;
    setSimInput("");
    setSimMessages((prev) => [...prev, { role: "user", text }]);

    const res = await fetch(`${API_BASE}/simulate/chat?${brandQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandId,
        sessionId: simSessionId,
        message: text,
        callerPhone: settings?.telephony.personalMobileNumber || "05348987073",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setSimSessionId(data.sessionId);
      setSimMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.reply },
      ]);
      void loadAll();
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard?.writeText(text);
    notify(`Kopyalandı: ${text}`);
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
        {errorMsg || "Sesli asistan ayarları yükleniyor..."}
      </div>
    );
  }

  const virtualNum = (
    settings.telephony.virtualForwardingNumber || "0850XXXXXXX"
  ).replace(/\s+/g, "");
  const personalClean = settings.telephony.personalMobileNumber
    .replace(/\s+/g, "")
    .replace(/^0/, "");
  const transferClean =
    settings.staffNotifications.transferPhoneNumber.replace(/\s+/g, "");
  const hasLoopRisk =
    Boolean(personalClean) &&
    Boolean(transferClean) &&
    transferClean.endsWith(personalClean);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "telephony", label: "Numara & Yönlendirme" },
    { key: "settings", label: "Ses Tonu, Hız & Maliyet" },
    { key: "knowledge", label: "Firma Bilgisi & Belgeler" },
    { key: "calls", label: "Çağrı Kayıtları & Detaylar" },
    { key: "records", label: "Rezervasyon & Notlar" },
    { key: "simulator", label: "Canlı Test" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Marka Seçici & Durum Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {brandList.length > 1 && (
            <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              Marka:
              <select
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs font-semibold text-fg"
              >
                {brandList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() =>
              void patchSettings(
                { enabled: !settings.enabled },
                settings.enabled
                  ? "Marka için sesli asistan pasife alındı."
                  : "Marka için sesli asistan aktif edildi.",
              )
            }
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              settings.enabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-red-500/40 bg-red-500/10 text-red-500"
            }`}
          >
            {settings.enabled ? "Asistan Açık" : "Asistan Kapalı"}
          </button>

          <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg">
            Mod: {settings.costProfile}
          </span>
          {costs && (
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg-muted">
              Aylık Maliyet: ${costs.totalCostUsd} / ${costs.budgetUsd} (
              {costs.totalCalls} çağrı)
            </span>
          )}
        </div>
        {statusMsg && (
          <span className="text-xs font-medium text-emerald-500">
            {statusMsg}
          </span>
        )}
        {errorMsg && (
          <span className="text-xs font-medium text-red-500">{errorMsg}</span>
        )}
      </div>

      {/* Sekmeler */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => handleTabChange(t.key)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-fg text-bg"
                : "text-fg-muted hover:bg-surface hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 1. NUMARA & YÖNLENDİRME */}
      {tab === "telephony" && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">
              Operatör & Numara Ayarları
            </h3>
            <label className="text-xs text-fg-muted">
              Hattınızın Operatörü
              <select
                value={settings.telephony.operator}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    telephony: {
                      ...settings.telephony,
                      operator: e.target.value as Operator,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              >
                {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABELS[op]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-fg-muted">
              İşletme / Cep Numaranız
              <input
                type="text"
                value={settings.telephony.personalMobileNumber}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    telephony: {
                      ...settings.telephony,
                      personalMobileNumber: e.target.value,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs text-fg-muted">
              Yönlendirilecek Sanal / SIP Numarası (0850 / 0212 / AWS Connect)
              <input
                type="text"
                placeholder="0850XXXXXXX"
                value={settings.telephony.virtualForwardingNumber}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    telephony: {
                      ...settings.telephony,
                      virtualForwardingNumber: e.target.value,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs text-fg-muted">
              Canlı Görevli Aktarım Numarası
              <input
                type="text"
                value={settings.staffNotifications.transferPhoneNumber}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    staffNotifications: {
                      ...settings.staffNotifications,
                      transferPhoneNumber: e.target.value,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs text-fg-muted">
              Görevli Bildirim Webhook URL (Slack / CRM / n8n)
              <input
                type="text"
                placeholder="https://..."
                value={settings.staffNotifications.webhookUrl}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    staffNotifications: {
                      ...settings.staffNotifications,
                      webhookUrl: e.target.value,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            {hasLoopRisk && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-500">
                Uyarı: Canlı aktarım numarası ile yönlendirilen numara aynı. Her
                zaman yönlendirme (*21*) açıkken çağrı döngüye girebilir.
              </div>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void patchSettings(
                  {
                    telephony: settings.telephony,
                    staffNotifications: settings.staffNotifications,
                  },
                  "Numara ve yönlendirme ayarları kaydedildi.",
                )
              }
              className="mt-2 w-fit rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              Numara Ayarlarını Kaydet
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">
              {OPERATOR_LABELS[settings.telephony.operator]} — Tek Adımda Bağlantı
            </h3>
            {settings.telephony.operator !== "voip_sip" ? (
              <>
                <p className="text-xs text-fg-muted">
                  Turkcell, Vodafone ve Türk Telekom hatlarında aynı standart GSM
                  yönlendirme kodları çalışır. Mobilden doğrudan{" "}
                  <strong>Ara</strong> butonuna dokunabilirsiniz:
                </p>
                {[
                  {
                    label: "Tüm Aramaları Asistana Yönlendir",
                    code: `*21*${virtualNum}#`,
                  },
                  {
                    label: "Cevap Vermeyince Asistana Yönlendir",
                    code: `*61*${virtualNum}#`,
                  },
                  {
                    label: "Meşgulken Asistana Yönlendir",
                    code: `*67*${virtualNum}#`,
                  },
                  { label: "Tüm Yönlendirmeleri İptal Et", code: "##002#" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col gap-1">
                    <span className="text-xs text-fg-muted">{item.label}</span>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg">
                      <span>{item.code}</span>
                      <div className="flex gap-1.5">
                        <a
                          href={`tel:${encodeURIComponent(item.code)}`}
                          className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-500 hover:bg-emerald-500/10"
                        >
                          Ara
                        </a>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(item.code)}
                          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface"
                        >
                          Kopyala
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="flex flex-col gap-2 text-xs text-fg-muted">
                <p>
                  Netgsm, Bulutfon veya Kobikom panelinizde gelen çağrı webhook
                  adresini aşağıdaki NordVow uç noktasına yönlendirin:
                </p>
                <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 font-mono text-fg">
                  <span>
                    https://nordvow.com/api/webhooks/voice-assistant/inbound
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        "https://nordvow.com/api/webhooks/voice-assistant/inbound",
                      )
                    }
                    className="rounded border border-border px-2 py-0.5 text-[11px]"
                  >
                    Kopyala
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. SES TONU, HIZ & MALİYET */}
      {tab === "settings" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-fg">
                Dinleme, Cevap Süresi & Karşılama
              </h3>
              <label className="text-xs text-fg-muted">
                Asistan / İşletme Adı
                <input
                  type="text"
                  value={settings.businessName}
                  onChange={(e) =>
                    setSettings({ ...settings, businessName: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>
              <label className="text-xs text-fg-muted">
                Karşılama Mesajı
                <textarea
                  value={settings.conversation.greetingMessage}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      conversation: {
                        ...settings.conversation,
                        greetingMessage: e.target.value,
                      },
                    })
                  }
                  className="mt-1 min-h-20 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>
              <label className="text-xs text-fg-muted">
                Dinleme Duraksama Süresi (ms — 600ms doğal ve hızlı)
                <input
                  type="number"
                  min={300}
                  max={2500}
                  step={50}
                  value={settings.conversation.silenceTimeoutMs}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      conversation: {
                        ...settings.conversation,
                        silenceTimeoutMs: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-fg-muted">
                  Maks. Cümle (1–4)
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={settings.conversation.maxResponseSentences}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        conversation: {
                          ...settings.conversation,
                          maxResponseSentences: Number(e.target.value),
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Maks. Süre (sn)
                  <input
                    type="number"
                    min={30}
                    max={1800}
                    value={settings.conversation.maxCallDurationSeconds}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        conversation: {
                          ...settings.conversation,
                          maxCallDurationSeconds: Number(e.target.value),
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-fg">
                Ses Tonu, Gerçekçilik & Maliyet
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-fg-muted">
                  Konuşma Tonu
                  <select
                    value={settings.voice.tone}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: {
                          ...settings.voice,
                          tone: e.target.value as VoiceTone,
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                  >
                    <option value="warm">Sıcakkanlı & Samimi</option>
                    <option value="formal">Kurumsal & Resmi</option>
                    <option value="energetic">Enerjik & Hızlı</option>
                    <option value="calm">Sakin & Güven Veren</option>
                  </select>
                </label>
                <label className="text-xs text-fg-muted">
                  Cevap Hızı Modu
                  <select
                    value={settings.voice.latencyMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: {
                          ...settings.voice,
                          latencyMode: e.target.value as
                            | "ultra_fast"
                            | "balanced"
                            | "high_quality",
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                  >
                    <option value="ultra_fast">Ultra Hızlı (~400ms)</option>
                    <option value="balanced">Dengeli (~700ms)</option>
                    <option value="high_quality">Yüksek Doğallık</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-fg-muted">
                  Konuşma Hızı ({settings.voice.speed}x)
                  <input
                    type="range"
                    min={0.75}
                    max={1.25}
                    step={0.05}
                    value={settings.voice.speed}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: {
                          ...settings.voice,
                          speed: Number(e.target.value),
                        },
                      })
                    }
                    className="mt-2 w-full"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Tonlama / Duygu ({settings.voice.style})
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.voice.style}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: {
                          ...settings.voice,
                          style: Number(e.target.value),
                        },
                      })
                    }
                    className="mt-2 w-full"
                  />
                </label>
              </div>
              <label className="text-xs text-fg-muted">
                Maliyet Profili
                <select
                  value={settings.costProfile}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      costProfile: e.target.value as CostProfile,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                >
                  <option value="balanced">
                    Balanced (ElevenLabs Flash v2.5 + Düşük Maliyet)
                  </option>
                  <option value="eco">Eco (En Düşük Maliyet / Polly)</option>
                  <option value="premium">
                    Premium (Multilingual v2 Yüksek Kalite)
                  </option>
                </select>
              </label>
              <label className="text-xs text-fg-muted">
                Aylık Bütçe Limiti (USD)
                <input
                  type="number"
                  min={1}
                  value={settings.costLimits.maxMonthlyBudgetUsd}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      costLimits: {
                        ...settings.costLimits,
                        maxMonthlyBudgetUsd: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h3 className="mb-3 text-base font-semibold text-fg">
              Özellik Anahtarları
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["knowledgeBaseEnabled", "Belge / Firma Bilgisi Soru-Cevap"],
                  ["reservationsEnabled", "Rezervasyon & Randevu Alma"],
                  ["staffNotesEnabled", "Önemli Detay & Görevli Notu Çıkarma"],
                  ["callTransferEnabled", "Canlı Görevliye Aktarım"],
                  ["bargeInEnabled", "Söz Kesme (Arayan Konuşunca Dinle)"],
                  ["costGuardEnabled", "Otomatik Maliyet Koruma"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-fg"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={settings.features[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        features: {
                          ...settings.features,
                          [key]: e.target.checked,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void patchSettings(
                  {
                    businessName: settings.businessName,
                    costProfile: settings.costProfile,
                    conversation: settings.conversation,
                    costLimits: settings.costLimits,
                    voice: settings.voice,
                    features: settings.features,
                  },
                  "Ses tonu, hız ve maliyet ayarları kaydedildi.",
                )
              }
              className="mt-4 rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              Ayarları Kaydet
            </button>
          </div>
        </div>
      )}

      {/* 3. FİRMA BİLGİLERİ & BELGELER */}
      {tab === "knowledge" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">
              Firma Bilgileri (AI Otomatik İndeksler)
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-fg-muted">
                Sektör
                <input
                  type="text"
                  placeholder="Örn: Güzellik Merkezi / Klinik / Restoran"
                  value={settings.companyProfile.sector}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      companyProfile: {
                        ...settings.companyProfile,
                        sector: e.target.value,
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>
              <label className="text-xs text-fg-muted">
                Çalışma Saatleri
                <input
                  type="text"
                  value={settings.companyProfile.workingHours}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      companyProfile: {
                        ...settings.companyProfile,
                        workingHours: e.target.value,
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>
            </div>
            <label className="text-xs text-fg-muted">
              Adres & Yol Tarifi
              <input
                type="text"
                value={settings.companyProfile.address}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    companyProfile: {
                      ...settings.companyProfile,
                      address: e.target.value,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs text-fg-muted">
              Hizmetler, Fiyatlar ve Önemli Kurallar
              <textarea
                value={settings.companyProfile.servicesSummary}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    companyProfile: {
                      ...settings.companyProfile,
                      servicesSummary: e.target.value,
                    },
                  })
                }
                className="mt-1 min-h-24 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void patchSettings(
                  { companyProfile: settings.companyProfile },
                  "Firma bilgileri kaydedildi ve AI bilgi bankasına işlendi.",
                ).then(() => loadDocs())
              }
              className="w-fit rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              Firma Bilgilerini Kaydet & İşle
            </button>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-fg">
                Ek Soru-Cevap / Belge Yükle
              </h3>
              <input
                type="text"
                placeholder="Dosya adı (ör. sikca-sorulanlar.md)"
                value={docFilename}
                onChange={(e) => setDocFilename(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
              <textarea
                placeholder={"# SSS\nSoru: ...\nCevap: ..."}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                className="min-h-36 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
              <button
                type="button"
                onClick={() => void handleUploadDoc()}
                className="w-fit rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg"
              >
                Belgeyi Kaydet & İndeksle
              </button>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-3 text-base font-semibold text-fg">
                İşlenmiş Bilgi Bankası Belgeleri
              </h3>
              <ul className="flex flex-col gap-2 text-sm text-fg-muted">
                {docs.map((d) => (
                  <li
                    key={d.filename}
                    className="rounded-lg border border-border bg-bg px-3 py-2"
                  >
                    <strong className="text-fg">{d.filename}</strong> (
                    {d.chunkCount} parça)
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 4. ÇAĞRI KAYITLARI & ÖNEMLİ DETAYLAR */}
      {tab === "calls" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-fg">
                Çağrı Kayıtları ve Çıkarılan Detaylar
              </h3>
              <button
                type="button"
                onClick={() => void loadCalls()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg"
              >
                Yenile
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-fg-muted">
                    <th className="py-2 pr-3">Tarih</th>
                    <th className="py-2 pr-3">Arayan</th>
                    <th className="py-2 pr-3">Niyet / Aciliyet</th>
                    <th className="py-2 pr-3">Süre</th>
                    <th className="py-2 pr-3">Maliyet</th>
                    <th className="py-2">Döküm & Detay</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-fg-muted">
                        Bu marka için henüz çağrı kaydı yok.
                      </td>
                    </tr>
                  ) : (
                    calls.map((c) => (
                      <tr
                        key={c.callId}
                        className="border-b border-border/60 text-fg"
                      >
                        <td className="py-2 pr-3">
                          {new Date(c.startedAt).toLocaleString("tr-TR")}
                        </td>
                        <td className="py-2 pr-3">
                          {c.extractedDetails?.callerName
                            ? `${c.extractedDetails.callerName} (${c.callerPhone})`
                            : c.callerPhone}
                        </td>
                        <td className="py-2 pr-3">
                          {c.extractedDetails?.intent || "genel"}{" "}
                          {c.extractedDetails?.urgency === "high" && (
                            <span className="ml-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">
                              ACİL
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{c.durationSeconds} sn</td>
                        <td className="py-2 pr-3">${c.estimatedCostUsd}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCall(c)}
                            className="rounded border border-border px-2 py-1 hover:bg-bg"
                          >
                            Gör ({c.transcript.length})
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedCall && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-5">
                <h4 className="mb-3 text-sm font-semibold text-fg">
                  Çağrıdan Çıkarılan Önemli Detaylar
                </h4>
                <div className="flex flex-col gap-2 text-xs text-fg-muted">
                  <div>
                    <strong className="text-fg">Arayan:</strong>{" "}
                    {selectedCall.extractedDetails?.callerName || "Belirtilmedi"}{" "}
                    ({selectedCall.callerPhone})
                  </div>
                  <div>
                    <strong className="text-fg">Niyet:</strong>{" "}
                    {selectedCall.extractedDetails?.intent || "genel"}
                  </div>
                  <div>
                    <strong className="text-fg">Önemli Notlar:</strong>
                    <ul className="mt-1 list-disc pl-4">
                      {(
                        selectedCall.extractedDetails?.importantNotes || []
                      ).map((n, idx) => (
                        <li key={idx}>{n}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface p-5">
                <h4 className="mb-3 text-sm font-semibold text-fg">
                  Konuşma Dökümü
                </h4>
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3 text-xs">
                  {selectedCall.transcript.map((t, i) => (
                    <div key={i}>
                      <span className="font-semibold text-fg">
                        {t.speaker === "caller"
                          ? "Arayan"
                          : t.speaker === "assistant"
                            ? "Asistan"
                            : "Sistem"}
                        :{" "}
                      </span>
                      <span className="text-fg-muted">{t.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. REZERVASYON & NOTLAR */}
      {tab === "records" && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <h3 className="mb-3 text-base font-semibold text-fg">
              Alınan Rezervasyonlar
            </h3>
            <div className="flex flex-col gap-2 text-xs">
              {reservations.length === 0 ? (
                <p className="text-fg-muted">Kayıt yok.</p>
              ) : (
                reservations.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-border bg-bg p-3"
                  >
                    <div className="font-semibold text-fg">
                      {r.confirmationCode} — {r.customerName} ({r.phone})
                    </div>
                    <div className="text-fg-muted">
                      {r.date} {r.time} · {r.partySize} kişi
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <h3 className="mb-3 text-base font-semibold text-fg">
              Görevlilere Aktarılan Notlar
            </h3>
            <div className="flex flex-col gap-2 text-xs">
              {notes.length === 0 ? (
                <p className="text-fg-muted">Not yok.</p>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-lg border border-border bg-bg p-3"
                  >
                    <div className="font-semibold text-fg">
                      {n.callerName} ({n.callerPhone}) · {n.category}
                    </div>
                    <div className="text-fg-muted">{n.summary}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. CANLI TEST */}
      {tab === "simulator" && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <h3 className="text-base font-semibold text-fg">
            Asistan Simülatörü ({selectedBrand?.name})
          </h3>
          <div className="flex h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-bg p-3 text-sm">
            {simMessages.length === 0 ? (
              <p className="text-xs text-fg-muted">
                Örnek: &quot;Merhaba, adım Ahmet. Yarın 19:30 için 2 kişilik
                rezervasyon yapmak istiyorum.&quot;
              </p>
            ) : (
              simMessages.map((m, idx) => (
                <div key={idx}>
                  <strong className="text-fg">
                    {m.role === "user" ? "Siz" : "Asistan"}:{" "}
                  </strong>
                  <span className="text-fg-muted">{m.text}</span>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={simInput}
              onChange={(e) => setSimInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSendSim();
              }}
              placeholder="Mesajınızı yazın..."
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
            />
            <button
              type="button"
              onClick={() => void handleSendSim()}
              className="rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg"
            >
              Gönder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
