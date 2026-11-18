"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";

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

type MainView = "setup" | "activity" | "simulator";
type SetupStep = 1 | 2 | 3 | 4;

const API_BASE = "/api/admin/voice-assistant";

const OPERATOR_LABELS: Record<Operator, string> = {
  vodafone: "Vodafone",
  turkcell: "Turkcell",
  turk_telekom: "Türk Telekom",
  voip_sip: "VoIP / SIP (Netgsm, Bulutfon, Kobikom)",
};

const TONE_LABELS: Record<VoiceTone, string> = {
  warm: "Sıcak & Samimi",
  formal: "Kurumsal & Resmi",
  energetic: "Enerjik & Dinamik",
  calm: "Sakin & Güven Verici",
};

export function VoiceAssistantAdminPanel({
  brands,
  initialBrandId,
}: {
  brands?: BrandOption[];
  initialBrandId?: string;
}) {
  const brandList =
    brands && brands.length > 0 ? brands : [{ id: "default", name: "NordVow Genel" }];
  const [brandId, setBrandId] = useState(initialBrandId || brandList[0]?.id || "default");
  const selectedBrand = brandList.find((b) => b.id === brandId);

  const [mainView, setMainView] = useState<MainView>("setup");
  const [step, setStep] = useState<SetupStep>(1);

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
  const [simMessages, setSimMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const notify = (msg: string) => {
    setErrorMsg(null);
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const brandQuery = `brandId=${encodeURIComponent(brandId)}&brandName=${encodeURIComponent(selectedBrand?.name || "")}`;

  const loadDocs = useCallback(async () => {
    const res = await fetch(`${API_BASE}/knowledge?${brandQuery}`, { cache: "no-store" });
    if (res.ok) setDocs((await res.json()).documents || []);
  }, [brandQuery]);

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
      void loadDocs();
    } catch {
      setErrorMsg("Sesli asistan servisine bağlanılamadı.");
    }
  }, [brandQuery, loadDocs]);

  useEffect(() => {
    setSimSessionId(undefined);
    setSimMessages([]);
    setSelectedCall(null);
    void loadAll();
  }, [loadAll]);

  const loadActivity = async () => {
    const [callsRes, rRes, nRes] = await Promise.all([
      fetch(`${API_BASE}/calls?${brandQuery}`, { cache: "no-store" }),
      fetch(`${API_BASE}/reservations?${brandQuery}`, { cache: "no-store" }),
      fetch(`${API_BASE}/notes?${brandQuery}`, { cache: "no-store" }),
    ]);
    if (callsRes.ok) setCalls((await callsRes.json()).calls || []);
    if (rRes.ok) setReservations((await rRes.json()).reservations || []);
    if (nRes.ok) setNotes((await nRes.json()).notes || []);
  };

  const handleViewChange = (next: MainView) => {
    setMainView(next);
    if (next === "activity") void loadActivity();
  };

  const patchSettings = async (patch: Record<string, unknown>, msg: string): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings?${brandQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, brandId }),
      });
      if (!res.ok) {
        setErrorMsg("Ayarlar kaydedilemedi.");
        return false;
      }
      setSettings(await res.json());
      notify(msg);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setDocFilename(file.name);
    setDocContent(text);
  };

  const handleUploadDoc = async () => {
    if (!docFilename.trim() || !docContent.trim()) return;
    setSaving(true);
    try {
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
      } else {
        setErrorMsg("Belge yüklenemedi.");
      }
    } finally {
      setSaving(false);
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
      setSimMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
      void loadAll();
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard?.writeText(text);
    notify(`Kopyalandı: ${text}`);
  };

  if (!settings) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-fg-muted">
        {errorMsg || "Sesli asistan ayarları yükleniyor..."}
      </div>
    );
  }

  // Kurulum adımlarının tamamlanma kontrolü
  const hasDocsOrProfile =
    docs.length > 0 ||
    settings.companyProfile.servicesSummary.trim().length > 10 ||
    settings.companyProfile.sector.trim().length > 1;

  const rawVirtual = (settings.telephony.virtualForwardingNumber || "").replace(/\s+/g, "");
  const virtualNum = rawVirtual || "0850XXXXXXX";
  const hasNumbers =
    settings.telephony.personalMobileNumber.trim().length >= 7 &&
    (settings.telephony.operator === "voip_sip" || rawVirtual.length >= 7);

  const hasVoiceConfigured =
    settings.businessName.trim().length > 0 &&
    settings.conversation.greetingMessage.trim().length > 0;

  const allReady = hasDocsOrProfile && hasNumbers && hasVoiceConfigured;

  const personalClean = settings.telephony.personalMobileNumber.replace(/\s+/g, "").replace(/^0/, "");
  const transferClean = settings.staffNotifications.transferPhoneNumber.replace(/\s+/g, "");
  const hasLoopRisk = Boolean(personalClean) && Boolean(transferClean) && transferClean.endsWith(personalClean);

  const forwardAllCode = `*21*${virtualNum}#`;

  const stepsMeta: Array<{ id: SetupStep; title: string; subtitle: string; done: boolean }> = [
    { id: 1, title: "1. Belgeler", subtitle: "Firma bilgisi ve SSS", done: hasDocsOrProfile },
    { id: 2, title: "2. Numara", subtitle: "Hat ve yönlendirme", done: hasNumbers },
    { id: 3, title: "3. Ses", subtitle: "Karşılama ve ton", done: hasVoiceConfigured },
    { id: 4, title: "4. Bağla", subtitle: "Tek tık yönlendirme", done: allReady && settings.enabled },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Üst Durum & Hızlı Bağlantı Şeridi */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {brandList.length > 1 ? (
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
          ) : null}

          <button
            type="button"
            onClick={() =>
              void patchSettings(
                { enabled: !settings.enabled },
                settings.enabled ? "Sesli asistan duraklatıldı." : "Sesli asistan aktif edildi.",
              )
            }
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              settings.enabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
            }`}
          >
            {settings.enabled ? "● Asistan Açık" : "○ Asistan Kapalı"}
          </button>

          {allReady && settings.enabled ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Numara arandığında asistana yönlendirmeye hazır
            </span>
          ) : (
            <span className="text-xs text-fg-muted">
              Hızlı kurulum için 3 adımı tamamlayın
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {costs ? (
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-fg-muted tabular-nums">
              {costs.totalCalls} çağrı · ${costs.totalCostUsd} / ${costs.budgetUsd}
            </span>
          ) : null}
          {statusMsg ? <span className="text-xs font-medium text-emerald-500">{statusMsg}</span> : null}
          {errorMsg ? <span className="text-xs font-medium text-rose-500">{errorMsg}</span> : null}
        </div>
      </div>

      {/* Sadeleştirilmiş Ana Sekmeler (3 Görünüm) */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {[
          { id: "setup" as const, label: "Hızlı Kurulum & Yönlendirme" },
          { id: "activity" as const, label: "Çağrı Kayıtları & Rezervasyonlar" },
          { id: "simulator" as const, label: "Canlı Test" },
        ].map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => handleViewChange(v.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              mainView === v.id ? "bg-fg text-bg" : "text-fg-muted hover:bg-surface hover:text-fg"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* GÖRÜNÜM 1: 4 ADIMLI HIZLI KURULUM */}
      {mainView === "setup" ? (
        <div className="flex flex-col gap-5">
          {/* Adım Çubuğu */}
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stepsMeta.map((s) => {
              const active = step === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStep(s.id)}
                    className={`flex w-full flex-col gap-0.5 rounded-2xl border p-3.5 text-left transition ${
                      active
                        ? "border-fg bg-fg text-bg"
                        : s.done
                          ? "border-emerald-500/40 bg-emerald-500/5 text-fg hover:border-emerald-500"
                          : "border-border bg-surface text-fg-muted hover:border-border-strong"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{s.title}</span>
                      <span className="text-xs">{s.done ? "✓" : "○"}</span>
                    </div>
                    <span className={`text-[11px] ${active ? "opacity-80" : "text-fg-passive"}`}>
                      {s.subtitle}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* ADIM 1: BELGELER & FİRMA BİLGİSİ */}
          {step === 1 ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
                <div>
                  <h3 className="text-base font-semibold text-fg">1. Firma Bilgileri</h3>
                  <p className="text-xs text-fg-muted">
                    Asistan arayan müşterilere bu bilgilerle cevap verir.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-fg-muted">
                    Sektör
                    <input
                      type="text"
                      placeholder="Örn: Klinik / Güzellik / Restoran"
                      value={settings.companyProfile.sector}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          companyProfile: { ...settings.companyProfile, sector: e.target.value },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                    />
                  </label>
                  <label className="text-xs text-fg-muted">
                    Çalışma Saatleri
                    <input
                      type="text"
                      placeholder="Örn: Hafta içi 09:00 - 19:00"
                      value={settings.companyProfile.workingHours}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          companyProfile: { ...settings.companyProfile, workingHours: e.target.value },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
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
                        companyProfile: { ...settings.companyProfile, address: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Hizmetler, Fiyatlar ve Kurallar (Detaylı)
                  <textarea
                    rows={4}
                    placeholder="Örn: Randevu saatleri, fiyat aralıkları, iptal kuralları..."
                    value={settings.companyProfile.servicesSummary}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        companyProfile: { ...settings.companyProfile, servicesSummary: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      const ok = await patchSettings(
                        { companyProfile: settings.companyProfile },
                        "Firma bilgileri kaydedildi ve indekslendi.",
                      );
                      if (ok) {
                        await loadDocs();
                        setStep(2);
                      }
                    }}
                    className="rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
                  >
                    Kaydet ve Numaraya Geç →
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
                <div>
                  <h3 className="text-base font-semibold text-fg">Detaylı Belge / SSS Yükle</h3>
                  <p className="text-xs text-fg-muted">
                    `.txt`, `.md`, `.csv` veya `.json` dosyası seçebilir ya da metin yapıştırabilirsiniz.
                  </p>
                </div>
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg/50 px-4 py-3 text-xs font-medium text-fg-muted hover:border-fg hover:text-fg">
                  <span>Dosya Seç (.txt, .md, .csv, .json)</span>
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.json,text/*"
                    onChange={(e) => void handleFileSelect(e)}
                    className="hidden"
                  />
                </label>
                <input
                  type="text"
                  placeholder="Belge adı (ör. fiyat-listesi.md)"
                  value={docFilename}
                  onChange={(e) => setDocFilename(e.target.value)}
                  className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
                <textarea
                  rows={4}
                  placeholder={"# Sıkça Sorulan Sorular\nSoru: ...\nCevap: ..."}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
                <button
                  type="button"
                  disabled={saving || !docFilename.trim() || !docContent.trim()}
                  onClick={() => void handleUploadDoc()}
                  className="w-fit rounded-xl border border-border bg-bg px-4 py-2 text-sm font-medium text-fg hover:bg-surface-hover disabled:opacity-50"
                >
                  Belgeyi Ekle
                </button>

                {docs.length > 0 ? (
                  <div className="mt-2 border-t border-border pt-3">
                    <span className="text-xs font-medium text-fg-muted">Yüklü Belgeler ({docs.length})</span>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {docs.map((d) => (
                        <li
                          key={d.filename}
                          className="rounded-full border border-border bg-bg px-3 py-1 text-xs text-fg"
                        >
                          {d.filename} <span className="text-fg-passive">({d.chunkCount} parça)</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ADIM 2: NUMARA & YÖNLENDİRME */}
          {step === 2 ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
              <div>
                <h3 className="text-base font-semibold text-fg">2. Telefon Numarası & Yönlendirme</h3>
                <p className="text-xs text-fg-muted">
                  Arayanların ulaşacağı işletme numaranızı ve çağrıların aktarılacağı asistan hattını girin.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-fg-muted">
                  Hat Operatörü
                  <select
                    value={settings.telephony.operator}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        telephony: { ...settings.telephony, operator: e.target.value as Operator },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  >
                    {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-fg-muted">
                  İşletme / Cep Numaranız (Müşterinin Aradığı Numara)
                  <input
                    type="text"
                    placeholder="05XX XXX XX XX"
                    value={settings.telephony.personalMobileNumber}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        telephony: { ...settings.telephony, personalMobileNumber: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>

                <label className="text-xs text-fg-muted">
                  Asistan Yönlendirme Numarası (0850 / 0212 / Santral)
                  <input
                    type="text"
                    placeholder="0850XXXXXXX"
                    value={settings.telephony.virtualForwardingNumber}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        telephony: { ...settings.telephony, virtualForwardingNumber: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>

                <label className="text-xs text-fg-muted">
                  Canlı Görevliye Aktarım Numarası (İsteğe Bağlı)
                  <input
                    type="text"
                    placeholder="Asistan çözemezse aktarılacak numara"
                    value={settings.staffNotifications.transferPhoneNumber}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        staffNotifications: { ...settings.staffNotifications, transferPhoneNumber: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>
              </div>

              {hasLoopRisk ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-300">
                  Uyarı: Canlı aktarım numarası işletme numaranızla aynı. `*21*` yönlendirmesi açıkken çağrı döngüye girebilir.
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-fg-muted hover:text-fg"
                >
                  ← Belgeler
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    const ok = await patchSettings(
                      { telephony: settings.telephony, staffNotifications: settings.staffNotifications },
                      "Numara ayarları kaydedildi.",
                    );
                    if (ok) setStep(3);
                  }}
                  className="rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
                >
                  Kaydet ve Ses Ayarlarına Geç →
                </button>
              </div>
            </div>
          ) : null}

          {/* ADIM 3: SES & KARŞILAMA AYARLARI */}
          {step === 3 ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
              <div>
                <h3 className="text-base font-semibold text-fg">3. Ses & Karşılama Ayarları</h3>
                <p className="text-xs text-fg-muted">
                  Arayan kişi asistanı duyduğunda ilk duyacağı karşılama ve ses tonunu belirleyin.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-fg-muted">
                  Asistan / İşletme Adı
                  <input
                    type="text"
                    value={settings.businessName}
                    onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                </label>

                <label className="text-xs text-fg-muted">
                  Ses Tonu
                  <select
                    value={settings.voice.tone}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: { ...settings.voice, tone: e.target.value as VoiceTone },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  >
                    {(Object.keys(TONE_LABELS) as VoiceTone[]).map((t) => (
                      <option key={t} value={t}>
                        {TONE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="text-xs text-fg-muted">
                İlk Karşılama Cümlesi
                <textarea
                  rows={2}
                  value={settings.conversation.greetingMessage}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      conversation: { ...settings.conversation, greetingMessage: e.target.value },
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-fg-muted">
                  Konuşma Hızı ({settings.voice.speed.toFixed(2)}x)
                  <input
                    type="range"
                    min={0.75}
                    max={1.25}
                    step={0.05}
                    value={settings.voice.speed}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: { ...settings.voice, speed: Number(e.target.value) },
                      })
                    }
                    className="mt-2 w-full"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Gecikme / Kalite Modu
                  <select
                    value={settings.voice.latencyMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        voice: {
                          ...settings.voice,
                          latencyMode: e.target.value as AssistantSettings["voice"]["latencyMode"],
                        },
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  >
                    <option value="ultra_fast">Ultra Hızlı (Önerilen)</option>
                    <option value="balanced">Dengeli</option>
                    <option value="high_quality">Yüksek Kalite</option>
                  </select>
                </label>
              </div>

              {/* Gelişmiş Teknik Ayarlar (Gizli Akordeon) */}
              <details className="rounded-xl border border-border bg-bg/40 p-3">
                <summary className="cursor-pointer text-xs font-medium text-fg-muted">
                  Gelişmiş Teknik Ayarlar (Maliyet profili, dinleme süresi, webhook)
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-fg-muted">
                    Maliyet Profili
                    <select
                      value={settings.costProfile}
                      onChange={(e) => setSettings({ ...settings, costProfile: e.target.value as CostProfile })}
                      className="mt-1 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-fg"
                    >
                      <option value="eco">Eco (En Düşük Maliyet)</option>
                      <option value="balanced">Dengeli</option>
                      <option value="premium">Premium</option>
                    </select>
                  </label>
                  <label className="text-xs text-fg-muted">
                    Dinleme Duraksama (ms)
                    <input
                      type="number"
                      min={300}
                      max={2500}
                      step={50}
                      value={settings.conversation.silenceTimeoutMs}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          conversation: { ...settings.conversation, silenceTimeoutMs: Number(e.target.value) },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-fg"
                    />
                  </label>
                  <label className="text-xs text-fg-muted">
                    Webhook URL
                    <input
                      type="text"
                      placeholder="https://..."
                      value={settings.staffNotifications.webhookUrl}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          staffNotifications: { ...settings.staffNotifications, webhookUrl: e.target.value },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-fg"
                    />
                  </label>
                </div>
              </details>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-fg-muted hover:text-fg"
                >
                  ← Numara
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    const ok = await patchSettings(
                      {
                        enabled: true,
                        businessName: settings.businessName,
                        costProfile: settings.costProfile,
                        conversation: settings.conversation,
                        voice: settings.voice,
                        staffNotifications: settings.staffNotifications,
                      },
                      "Ses ayarları kaydedildi ve asistan aktifleştirildi.",
                    );
                    if (ok) setStep(4);
                  }}
                  className="rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
                >
                  Kaydet ve Hızlı Bağlantıya Geç →
                </button>
              </div>
            </div>
          ) : null}

          {/* ADIM 4: TEK TIK HIZLI BAĞLANTI */}
          {step === 4 ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-4 rounded-2xl border border-emerald-500/30 bg-surface p-5">
                <div>
                  <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    Hızlı Bağlantı
                  </span>
                  <h3 className="mt-2 text-lg font-semibold text-fg">
                    Numara Arandığı An Sesli Asistana Yönlendir
                  </h3>
                  <p className="mt-1 text-xs text-fg-muted">
                    Hiç teknik ayarla uğraşmadan aşağıdaki butona dokunarak ({OPERATOR_LABELS[settings.telephony.operator]}) hattınızı doğrudan asistana bağlayın.
                  </p>
                </div>

                {settings.telephony.operator !== "voip_sip" ? (
                  <div className="flex flex-col gap-3">
                    <a
                      href={`tel:${encodeURIComponent(forwardAllCode)}`}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-500"
                    >
                      Tek Tıkla Aramaları Asistana Bağla ({forwardAllCode})
                    </a>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        { label: "Sadece Cevap Vermeyince", code: `*61*${virtualNum}#` },
                        { label: "Sadece Meşgulken", code: `*67*${virtualNum}#` },
                      ].map((item) => (
                        <div key={item.code} className="flex items-center justify-between rounded-xl border border-border bg-bg px-3 py-2 text-xs">
                          <span className="text-fg-muted">{item.label}</span>
                          <div className="flex gap-1.5">
                            <a
                              href={`tel:${encodeURIComponent(item.code)}`}
                              className="rounded-lg border border-emerald-500/40 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400"
                            >
                              Ara
                            </a>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(item.code)}
                              className="rounded-lg border border-border px-2 py-0.5 text-fg-muted hover:text-fg"
                            >
                              Kopyala
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-border bg-bg/50 px-3 py-2 text-xs">
                      <span className="text-fg-muted">Yönlendirmeyi kapatmak için:</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span>##002#</span>
                        <a href="tel:%23%23002%23" className="underline">
                          İptal Et
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg p-3 text-xs">
                    <span className="text-fg-muted">VoIP / SIP Gelen Çağrı Webhook Adresi:</span>
                    <div className="flex items-center justify-between gap-2 font-mono text-fg">
                      <span className="truncate">https://nordvow.com/api/webhooks/voice-assistant/inbound</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard("https://nordvow.com/api/webhooks/voice-assistant/inbound")}
                        className="shrink-0 rounded-lg border border-border px-2.5 py-1"
                      >
                        Kopyala
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Hızlı Canlı Test */}
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
                <h3 className="text-base font-semibold text-fg">Hemen Test Et</h3>
                <p className="text-xs text-fg-muted">
                  Yüklediğiniz belgeler ve ses ayarlarıyla asistanın nasıl cevap verdiğini deneyin.
                </p>
                <div className="flex min-h-40 max-h-60 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-bg p-3 text-xs">
                  {simMessages.length === 0 ? (
                    <span className="text-fg-passive">Örn: &ldquo;Merhaba, yarın saat 14:00 için bilgi alabilir miyim?&rdquo;</span>
                  ) : (
                    simMessages.map((m, i) => (
                      <div
                        key={i}
                        className={`max-w-[85%] rounded-xl px-3 py-2 ${
                          m.role === "user" ? "self-end bg-fg text-bg" : "self-start border border-border bg-surface text-fg"
                        }`}
                      >
                        {m.text}
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
                    placeholder="Müşteri gibi bir soru yazın..."
                    className="flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendSim()}
                    className="rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg"
                  >
                    Gönder
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* GÖRÜNÜM 2: ÇAĞRI KAYITLARI & REZERVASYONLAR */}
      {mainView === "activity" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">Son Çağrılar ({calls.length})</h3>
            {calls.length === 0 ? (
              <p className="text-sm text-fg-passive">Henüz çağrı kaydı yok.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {calls.map((c) => (
                  <li key={c.callId}>
                    <button
                      type="button"
                      onClick={() => setSelectedCall(c)}
                      className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm hover:opacity-80"
                    >
                      <div>
                        <span className="font-medium text-fg">{c.extractedDetails?.callerName || c.callerPhone}</span>
                        <span className="block text-xs text-fg-muted">
                          {c.extractedDetails?.intent || c.status} · {c.durationSeconds} sn
                        </span>
                      </div>
                      <span className="text-xs text-fg-passive">{new Date(c.startedAt).toLocaleString("tr-TR")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedCall ? (
              <div className="mt-2 rounded-xl border border-border bg-bg p-3 text-xs">
                <span className="font-semibold text-fg">Konuşma Dökümü</span>
                <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                  {selectedCall.transcript.map((t, idx) => (
                    <p key={idx} className="text-fg-muted">
                      <strong className="text-fg">{t.speaker}:</strong> {t.text}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
            <div>
              <h3 className="text-base font-semibold text-fg">Rezervasyonlar ({reservations.length})</h3>
              {reservations.length === 0 ? (
                <p className="mt-1 text-sm text-fg-passive">Henüz rezervasyon yok.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {reservations.map((r) => (
                    <li key={r.id} className="flex justify-between py-2">
                      <span>
                        <strong>{r.customerName}</strong> ({r.partySize} kişi)
                      </span>
                      <span className="text-xs text-fg-muted">
                        {r.date} {r.time} · #{r.confirmationCode}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="text-base font-semibold text-fg">Görevli Notları ({notes.length})</h3>
              {notes.length === 0 ? (
                <p className="mt-1 text-sm text-fg-passive">Henüz not yok.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {notes.map((n) => (
                    <li key={n.id} className="py-2">
                      <span className="font-medium">{n.callerName || n.callerPhone}</span>
                      <p className="text-xs text-fg-muted">{n.summary}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* GÖRÜNÜM 3: CANLI TEST */}
      {mainView === "simulator" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <h3 className="text-base font-semibold text-fg">Sesli Asistan Canlı Test</h3>
          <div className="flex min-h-64 max-h-96 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-bg p-4 text-sm">
            {simMessages.length === 0 ? (
              <span className="text-fg-passive">Asistanı test etmek için aşağıya bir mesaj yazın...</span>
            ) : (
              simMessages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    m.role === "user" ? "self-end bg-fg text-bg" : "self-start border border-border bg-surface text-fg"
                  }`}
                >
                  {m.text}
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
              placeholder="Arayan müşteri gibi yazın..."
              className="flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
            />
            <button
              type="button"
              onClick={() => void handleSendSim()}
              className="rounded-xl bg-fg px-5 py-2 text-sm font-semibold text-bg"
            >
              Gönder
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
