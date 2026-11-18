"use client";

import { useCallback, useEffect, useState } from "react";

type CostProfile = "eco" | "balanced" | "premium";

interface AssistantSettings {
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
    stability: number;
    similarityBoost: number;
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
    personalMobileNumber: string;
    virtualForwardingNumber: string;
  };
}

interface CostReport {
  totalCalls: number;
  totalCostUsd: number;
  budgetUsd: number;
  budgetUsedPercent: number;
}

interface CallRecord {
  callId: string;
  channel: string;
  callerPhone: string;
  startedAt: string;
  durationSeconds: number;
  status: string;
  estimatedCostUsd: number;
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
  summary: string;
}

interface KnowledgeDoc {
  filename: string;
  chunkCount: number;
}

type TabKey =
  | "telephony"
  | "settings"
  | "calls"
  | "records"
  | "knowledge"
  | "simulator";

const API_BASE = "/api/admin/voice-assistant";

export function VoiceAssistantAdminPanel() {
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

  const loadAll = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/settings`, { cache: "no-store" }),
        fetch(`${API_BASE}/metrics/costs`, { cache: "no-store" }),
      ]);
      if (!sRes.ok) {
        const err = await sRes.json().catch(() => ({}));
        setErrorMsg(
          err.error || "Sesli asistan servisine bağlanılamadı (port 4100)."
        );
        return;
      }
      setSettings(await sRes.json());
      if (cRes.ok) setCosts(await cRes.json());
      setErrorMsg(null);
    } catch {
      setErrorMsg("Sesli asistan servisine bağlanılamadı.");
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadCalls = async () => {
    const res = await fetch(`${API_BASE}/calls`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setCalls(data.calls || []);
    }
  };

  const loadRecords = async () => {
    const [rRes, nRes] = await Promise.all([
      fetch(`${API_BASE}/reservations`, { cache: "no-store" }),
      fetch(`${API_BASE}/notes`, { cache: "no-store" }),
    ]);
    if (rRes.ok) setReservations((await rRes.json()).reservations || []);
    if (nRes.ok) setNotes((await nRes.json()).notes || []);
  };

  const loadDocs = async () => {
    const res = await fetch(`${API_BASE}/knowledge`, { cache: "no-store" });
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
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
    const res = await fetch(`${API_BASE}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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

    const res = await fetch(`${API_BASE}/simulate/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        {errorMsg ? (
          <div className="flex flex-col gap-3">
            <p className="text-red-500 font-medium">{errorMsg}</p>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="w-fit rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg"
            >
              Tekrar Dene
            </button>
          </div>
        ) : (
          "Sesli asistan ayarları yükleniyor..."
        )}
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
    { key: "settings", label: "Asistan & Maliyet" },
    { key: "calls", label: "Çağrı Kayıtları" },
    { key: "records", label: "Rezervasyon & Notlar" },
    { key: "knowledge", label: "Belgeler (SSS)" },
    { key: "simulator", label: "Canlı Test" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Üst Durum Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-500">
            Servis Aktif
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 font-medium text-fg">
            Maliyet Profili: {settings.costProfile}
          </span>
          {costs && (
            <span className="rounded-full border border-border px-2.5 py-1 font-medium text-fg-muted">
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
              Telefon & Yönlendirme Ayarları
            </h3>
            <label className="text-xs text-fg-muted">
              Kendi Vodafone / Cep Numaranız
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
              Sanal / SIP Yönlendirme Numarası (0850 / 0212)
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
                Uyarı: Canlı aktarım numarası ile kendi numaranız aynı. Her zaman
                yönlendirme (*21*) açıkken çağrı döngüye girebilir.
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
                  "Numara ve yönlendirme ayarları kaydedildi."
                )
              }
              className="mt-2 w-fit rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              Numara Ayarlarını Kaydet
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">
              Vodafone GSM Yönlendirme Kodları
            </h3>
            <p className="text-xs text-fg-muted">
              Sanal numaranızı kaydettikten sonra telefonunuzdan aşağıdaki
              kodları tuşlayarak çağrıları asistana yönlendirebilirsiniz:
            </p>
            {[
              { label: "Tüm Aramaları Yönlendir", code: `*21*${virtualNum}#` },
              {
                label: "Cevapsız Kalınca Yönlendir",
                code: `*61*${virtualNum}#`,
              },
              { label: "Meşgulken Yönlendir", code: `*67*${virtualNum}#` },
              { label: "Yönlendirmeyi İptal Et", code: "##002#" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-xs text-fg-muted">{item.label}</span>
                <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg">
                  <span>{item.code}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(item.code)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface"
                  >
                    Kopyala
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. ASİSTAN & MALİYET AYARLARI */}
      {tab === "settings" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-fg">
                Konuşma & Karşılama
              </h3>
              <label className="text-xs text-fg-muted">
                İşletme Adı
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
                Maksimum Cevap Cümle Sayısı
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
                Maksimum Çağrı Süresi (Saniye)
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

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-fg">
                Maliyet Profili & Ses
              </h3>
              <label className="text-xs text-fg-muted">
                Maliyet / Kalite Modu
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
              <label className="text-xs text-fg-muted">
                Ses Sağlayıcısı
                <select
                  value={settings.voice.provider}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      voice: {
                        ...settings.voice,
                        provider: e.target.value as
                          | "elevenlabs"
                          | "polly"
                          | "mock",
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
                >
                  <option value="elevenlabs">ElevenLabs (Gerçekçi Türkçe)</option>
                  <option value="polly">Amazon Polly (Ekonomik)</option>
                  <option value="mock">Mock (Test)</option>
                </select>
              </label>
              <label className="text-xs text-fg-muted">
                ElevenLabs Voice ID
                <input
                  type="text"
                  value={settings.voice.voiceId}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      voice: { ...settings.voice, voiceId: e.target.value },
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
                  ["knowledgeBaseEnabled", "Belge / SSS Soru-Cevap"],
                  ["reservationsEnabled", "Rezervasyon Alma"],
                  ["staffNotesEnabled", "Görevlilere Not Aktarma"],
                  ["callTransferEnabled", "Canlı Görevliye Aktarım"],
                  ["bargeInEnabled", "Söz Kesme (Barge-in)"],
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
                  "Tüm asistan ve maliyet ayarları kaydedildi."
                )
              }
              className="mt-4 rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              Tüm Ayarları Kaydet
            </button>
          </div>
        </div>
      )}

      {/* 3. ÇAĞRI KAYITLARI */}
      {tab === "calls" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-fg">
                Çağrı Kayıtları
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
                    <th className="py-2 pr-3">Kanal</th>
                    <th className="py-2 pr-3">Arayan</th>
                    <th className="py-2 pr-3">Süre</th>
                    <th className="py-2 pr-3">Durum</th>
                    <th className="py-2 pr-3">Maliyet</th>
                    <th className="py-2">Döküm</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-4 text-fg-muted">
                        Henüz çağrı kaydı bulunmuyor.
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
                        <td className="py-2 pr-3">{c.channel}</td>
                        <td className="py-2 pr-3">{c.callerPhone}</td>
                        <td className="py-2 pr-3">{c.durationSeconds} sn</td>
                        <td className="py-2 pr-3">{c.status}</td>
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
            <div className="rounded-xl border border-border bg-surface p-5">
              <h4 className="mb-3 text-sm font-semibold text-fg">
                Konuşma Dökümü ({selectedCall.callerPhone})
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
          )}
        </div>
      )}

      {/* 4. REZERVASYON & NOTLAR */}
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

      {/* 5. BELGELER */}
      {tab === "knowledge" && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">
              Yeni Soru-Cevap / Belge Ekle
            </h3>
            <input
              type="text"
              placeholder="Dosya adı (ör. fiyatlar.md)"
              value={docFilename}
              onChange={(e) => setDocFilename(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
            />
            <textarea
              placeholder={"# Hizmetler\nSoru: ...\nCevap: ..."}
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              className="min-h-36 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
            />
            <button
              type="button"
              onClick={() => void handleUploadDoc()}
              className="w-fit rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-bg"
            >
              Belgeyi Kaydet
            </button>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <h3 className="mb-3 text-base font-semibold text-fg">
              Yüklü Belgeler
            </h3>
            <ul className="flex flex-col gap-2 text-sm text-fg-muted">
              {docs.map((d) => (
                <li
                  key={d.filename}
                  className="rounded-lg border border-border bg-bg px-3 py-2"
                >
                  <strong className="text-fg">{d.filename}</strong> (
                  {d.chunkCount} bölüm)
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 6. CANLI TEST */}
      {tab === "simulator" && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <h3 className="text-base font-semibold text-fg">
            Asistan Simülatörü (Telefon Bağlamadan Test Edin)
          </h3>
          <div className="flex h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-bg p-3 text-sm">
            {simMessages.length === 0 ? (
              <p className="text-xs text-fg-muted">
                Örnek: &quot;Saat kaça kadar açıksınız?&quot; veya &quot;Yarın
                19:30 için 2 kişilik rezervasyon yapmak istiyorum.&quot;
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

