"use client";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { etiketle } from "@/lib/iletisim/etiketler";
import { VOICE_TTS_MODELS, VOICE_TTS_VOICES, type VoiceBusinessHours, type VoiceRoutingRule } from "@infulancer/core/voice/types";

type BrandOption = { id: string; name: string };
type DocRow = { id: string; fileName: string; sizeBytes: number; status: string; error: string | null; createdAt: string };
type FaqRow = { id: string; question: string; answer: string; active: boolean };
type CallRow = {
  id: string;
  callerPhone: string | null;
  calledPhone: string | null;
  durationSec: number;
  outcome: string;
  summary: string | null;
  transcript: { role: string; text: string; at: string }[] | null;
  recordingS3Key: string | null;
  createdAt: string;
};
type CallbackRow = { id: string; callerName: string | null; callerPhone: string; topic: string; status: string; createdAt: string };
type UnansweredRow = { callId: string; question: string; at: string };

type AssistantConfig = {
  connectPhoneNumber: string | null;
  assistantName: string;
  greetingText: string;
  ttsModelKey: string;
  ttsVoiceId: string;
  tone: string;
  businessHours: VoiceBusinessHours | null;
  routingRules: VoiceRoutingRule[] | null;
  blockedTopics: string | null;
  active: boolean;
};

const DEFAULT_BH: VoiceBusinessHours = {
  timezone: "Europe/Istanbul",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
  afterHoursMessage: "Şu anda mesai saatlerimiz dışındayız. Adınızı ve konunuzu bırakırsanız mesai başlangıcında sizi hemen arayalım.",
};

export function VoiceAssistantConsole({
  brands,
  initialBrandId,
}: {
  brands: BrandOption[];
  initialBrandId: string;
}) {
  const [brandId, setBrandId] = useState(initialBrandId);
  const [tab, setTab] = useState<"kb" | "settings" | "test" | "calls">("kb");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [faqs, setFaqs] = useState<FaqRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [unanswered, setUnanswered] = useState<UnansweredRow[]>([]);
  const [cfg, setCfg] = useState<AssistantConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  // SSS ekleme form
  const [faqQ, setFaqQ] = useState("");
  const [faqA, setFaqA] = useState("");

  // Test et
  const [testQ, setTestQ] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testRes, setTestRes] = useState<{
    replyText: string;
    intent: { intent: string; reason: string };
    sources: { title: string; content: string; score: number }[];
    audioUrl: string;
    provider: string;
  } | null>(null);
  const [listening, setListening] = useState(false);

  // Detay & SSS'e ekle
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<string | null>(null);
  const [promoteAnswer, setPromoteAnswer] = useState("");

  const loadAll = useCallback(async (bid: string) => {
    if (!bid) return;
    const [dRes, fRes, sRes, cRes] = await Promise.all([
      fetch(`/api/voice/docs?brandId=${encodeURIComponent(bid)}`, { cache: "no-store" }),
      fetch(`/api/voice/faqs?brandId=${encodeURIComponent(bid)}`, { cache: "no-store" }),
      fetch(`/api/voice/settings?brandId=${encodeURIComponent(bid)}`, { cache: "no-store" }),
      fetch(`/api/voice/calls?brandId=${encodeURIComponent(bid)}`, { cache: "no-store" }),
    ]);
    if (dRes.ok) setDocs(((await dRes.json()) as { docs: DocRow[] }).docs);
    if (fRes.ok) setFaqs(((await fRes.json()) as { faqs: FaqRow[] }).faqs);
    if (sRes.ok) setCfg(((await sRes.json()) as { config: AssistantConfig }).config);
    if (cRes.ok) {
      const cd = (await cRes.json()) as { calls: CallRow[]; callbacks: CallbackRow[]; unanswered: UnansweredRow[] };
      setCalls(cd.calls);
      setCallbacks(cd.callbacks);
      setUnanswered(cd.unanswered);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!brandId) return;
      const [dRes, fRes, sRes, cRes] = await Promise.all([
        fetch(`/api/voice/docs?brandId=${encodeURIComponent(brandId)}`, { cache: "no-store" }),
        fetch(`/api/voice/faqs?brandId=${encodeURIComponent(brandId)}`, { cache: "no-store" }),
        fetch(`/api/voice/settings?brandId=${encodeURIComponent(brandId)}`, { cache: "no-store" }),
        fetch(`/api/voice/calls?brandId=${encodeURIComponent(brandId)}`, { cache: "no-store" }),
      ]);
      if (cancelled) return;
      if (dRes.ok) setDocs(((await dRes.json()) as { docs: DocRow[] }).docs);
      if (fRes.ok) setFaqs(((await fRes.json()) as { faqs: FaqRow[] }).faqs);
      if (sRes.ok) setCfg(((await sRes.json()) as { config: AssistantConfig }).config);
      if (cRes.ok) {
        const cd = (await cRes.json()) as { calls: CallRow[]; callbacks: CallbackRow[]; unanswered: UnansweredRow[] };
        setCalls(cd.calls);
        setCallbacks(cd.callbacks);
        setUnanswered(cd.unanswered);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const uploadDocs = async (files: FileList, replaceDocId?: string) => {
    setErr(null);
    setMsg(null);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("brandId", brandId);
      fd.append("file", f);
      if (replaceDocId) fd.append("replaceDocId", replaceDocId);
      const res = await fetch("/api/voice/docs", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) setErr(j.error ?? `${f.name} yüklenemedi.`);
      else setMsg(`${f.name} bilgi bankasına eklendi ve işlendi.`);
    }
    await loadAll(brandId);
  };

  const deleteDoc = async (id: string) => {
    await fetch(`/api/voice/docs?id=${encodeURIComponent(id)}&brandId=${encodeURIComponent(brandId)}`, { method: "DELETE" });
    await loadAll(brandId);
  };

  const addFaq = async () => {
    if (!faqQ.trim() || !faqA.trim()) return;
    setErr(null);
    const res = await fetch("/api/voice/faqs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, question: faqQ.trim(), answer: faqA.trim() }),
    });
    if (res.ok) {
      setFaqQ("");
      setFaqA("");
      setMsg("SSS maddesi eklendi ve bilgi bankasına senkronize edildi.");
      await loadAll(brandId);
    }
  };

  const saveSettings = async () => {
    if (!cfg) return;
    setErr(null);
    setMsg(null);
    const res = await fetch("/api/voice/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...cfg, brandId }),
    });
    const j = await res.json();
    if (!res.ok) setErr(j.error ?? "Ayarlar kaydedilemedi.");
    else {
      setCfg(j.config);
      setMsg("Asistan ayarları kaydedildi ve karşılama sesi önbelleğe alındı.");
    }
  };

  const suggestGreeting = async () => {
    if (!cfg) return;
    const res = await fetch("/api/voice/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "suggest_greeting", brandId, tone: cfg.tone }),
    });
    if (res.ok) {
      const j = (await res.json()) as { greetingText: string };
      setCfg({ ...cfg, greetingText: j.greetingText });
    }
  };

  const previewVoice = async () => {
    if (!cfg) return;
    const res = await fetch("/api/voice/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "preview_voice",
        brandId,
        text: cfg.greetingText,
        ttsModelKey: cfg.ttsModelKey,
        ttsVoiceId: cfg.ttsVoiceId,
      }),
    });
    if (res.ok) {
      const j = (await res.json()) as { audioBase64: string; mime: string };
      const audio = new Audio(`data:${j.mime};base64,${j.audioBase64}`);
      void audio.play();
    }
  };

  const runTest = async (qText?: string) => {
    const q = (qText ?? testQ).trim();
    if (!q) return;
    setErr(null);
    setTestLoading(true);
    try {
      const res = await fetch("/api/voice/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, question: q, saveAsTestCall: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Test başarısız.");
      const audioUrl = `data:${j.mime};base64,${j.audioBase64}`;
      setTestRes({ replyText: j.replyText, intent: j.intent, sources: j.sources, audioUrl, provider: j.provider });
      void new Audio(audioUrl).play().catch(() => undefined);
      await loadAll(brandId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test hatası.");
    } finally {
      setTestLoading(false);
    }
  };

  const startMic = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void };
      webkitSpeechRecognition?: new () => { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void };
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setErr("Tarayıcınız mikrofonla ses tanımayı desteklemiyor; sorunuzu yazarak test edebilirsiniz.");
      return;
    }
    const rec = new SR();
    rec.lang = "tr-TR";
    setListening(true);
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript ?? "";
      if (t) {
        setTestQ(t);
        void runTest(t);
      }
    };
    rec.onend = () => setListening(false);
    rec.start();
  };

  const promoteFaq = async () => {
    if (!promoteTarget || !promoteAnswer.trim()) return;
    await fetch("/api/voice/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "promote_faq", brandId, question: promoteTarget, answer: promoteAnswer.trim() }),
    });
    setPromoteTarget(null);
    setPromoteAnswer("");
    setMsg("Soru SSS listesine eklendi.");
    await loadAll(brandId);
  };

  const rules = cfg?.routingRules ?? [];
  const bh = cfg?.businessHours ?? DEFAULT_BH;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          {brands.length > 1 ? (
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="h-9 rounded-xl border border-line bg-bg px-3 text-sm font-medium text-fg"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : null}
          <div className="flex flex-wrap gap-1 rounded-full border border-line bg-bg p-1">
            {(
              [
                { id: "kb", label: "Bilgi Bankası & SSS" },
                { id: "settings", label: "Asistan & Yönlendirme" },
                { id: "test", label: "Test Et (Sesli)" },
                { id: "calls", label: `Arama Kayıtları (${calls.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-standard",
                  tab === t.id ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {cfg?.connectPhoneNumber ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
            Hat: {cfg.connectPhoneNumber}
          </span>
        ) : (
          <span className="text-[12px] text-fg-muted">Amazon Connect numarası henüz atanmadı</span>
        )}
      </div>

      {err ? <p className="rounded-xl border border-critical/30 bg-red-500/10 px-3 py-2 text-[13px] text-critical">{err}</p> : null}
      {msg ? <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600 dark:text-emerald-400">{msg}</p> : null}

      {tab === "kb" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">Belgeler (.md, .pdf, .txt, .docx)</h2>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                if (e.dataTransfer.files?.length) void uploadDocs(e.dataTransfer.files);
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center transition-standard",
                drag ? "border-fg bg-fg/5" : "border-line bg-bg/40",
              )}
            >
              <p className="text-[13px] text-fg-muted">Belgeleri buraya sürükleyin veya seçin (yalnız bu markanın bilgi tabanına yüklenir)</p>
              <label className="cursor-pointer rounded-full bg-fg px-4 py-1.5 text-[12px] font-semibold text-bg hover:opacity-90">
                Belge Seç
                <input
                  type="file"
                  multiple
                  accept=".md,.pdf,.txt,.docx"
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files?.length) void uploadDocs(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{d.fileName}</p>
                    <p className="text-[11px] text-fg-muted">
                      {(d.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                      <span className={d.status === "ready" ? "text-emerald-600" : d.status === "error" ? "text-critical" : "text-amber-500"}>
                        {d.status === "ready" ? "Hazır" : d.status === "error" ? `Hata: ${d.error ?? ""}` : "İşleniyor"}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer text-[11px] text-fg-muted hover:text-fg">
                      Değiştir
                      <input
                        type="file"
                        accept=".md,.pdf,.txt,.docx"
                        className="sr-only"
                        onChange={(e) => {
                          if (e.target.files?.length) void uploadDocs(e.target.files, d.id);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => void deleteDoc(d.id)} className="text-[11px] text-critical hover:underline">
                      Sil
                    </button>
                  </div>
                </li>
              ))}
              {docs.length === 0 ? <li className="py-4 text-center text-[12px] text-fg-muted">Henüz belge yüklenmedi.</li> : null}
            </ul>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">SSS Editörü ({faqs.length})</h2>
            <input
              type="text"
              value={faqQ}
              onChange={(e) => setFaqQ(e.target.value)}
              placeholder="Soru (ör: Kargo ücreti ne kadar?)"
              className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
            />
            <textarea
              rows={2}
              value={faqA}
              onChange={(e) => setFaqA(e.target.value)}
              placeholder="Cevap (ör: Bin lira üzeri siparişlerde kargo ücretsizdir.)"
              className="rounded-xl border border-line bg-bg p-3 text-[13px] text-fg"
            />
            <button type="button" onClick={() => void addFaq()} className="self-start rounded-full bg-fg px-4 py-1.5 text-[12px] font-semibold text-bg">
              + SSS Ekle
            </button>
            <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto">
              {faqs.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-2 py-2.5 text-[12px]">
                  <div>
                    <p className="font-semibold text-fg">{f.question}</p>
                    <p className="text-fg-muted">{f.answer}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/voice/faqs?id=${encodeURIComponent(f.id)}&brandId=${encodeURIComponent(brandId)}`, { method: "DELETE" });
                      await loadAll(brandId);
                    }}
                    className="shrink-0 text-[11px] text-critical hover:underline"
                  >
                    Sil
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "settings" && cfg ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Asistan Adı
              <input
                type="text"
                value={cfg.assistantName}
                onChange={(e) => setCfg({ ...cfg, assistantName: e.target.value })}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Amazon Connect Numarası
              <input
                type="text"
                value={cfg.connectPhoneNumber ?? ""}
                onChange={(e) => setCfg({ ...cfg, connectPhoneNumber: e.target.value })}
                placeholder="+90850..."
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Konuşma Tonu
              <select
                value={cfg.tone}
                onChange={(e) => setCfg({ ...cfg, tone: e.target.value })}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              >
                <option value="samimi">Samimi & Sıcak</option>
                <option value="kurumsal">Kurumsal & Resmi</option>
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-fg-muted">Karşılama Metni (KVKK kayıt bilgisi dahil, S3 önbellekli)</span>
              <button type="button" onClick={() => void suggestGreeting()} className="text-[12px] font-medium text-fg underline">
                AI ile Otomatik Öner
              </button>
            </div>
            <textarea
              rows={2}
              value={cfg.greetingText}
              onChange={(e) => setCfg({ ...cfg, greetingText: e.target.value })}
              className="rounded-xl border border-line bg-bg p-3 text-[13px] text-fg"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              fal.ai TTS Modeli
              <select
                value={cfg.ttsModelKey}
                onChange={(e) => setCfg({ ...cfg, ttsModelKey: e.target.value })}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              >
                {VOICE_TTS_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Ses Seçimi
              <select
                value={cfg.ttsVoiceId}
                onChange={(e) => setCfg({ ...cfg, ttsVoiceId: e.target.value })}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              >
                {VOICE_TTS_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => void previewVoice()} className="h-9 rounded-xl border border-line bg-bg px-4 text-[12px] font-medium text-fg hover:border-fg/50">
                Sesi Önizle ▶
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Mesai Başlangıç
              <input
                type="time"
                value={bh.start}
                onChange={(e) => setCfg({ ...cfg, businessHours: { ...bh, start: e.target.value } })}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Mesai Bitiş
              <input
                type="time"
                value={bh.end}
                onChange={(e) => setCfg({ ...cfg, businessHours: { ...bh, end: e.target.value } })}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-fg">Yönlendirme Kuralları</span>
              <button
                type="button"
                onClick={() =>
                  setCfg({
                    ...cfg,
                    routingRules: [
                      ...rules,
                      { id: `r-${Date.now()}`, keyword: "satış", label: "Satış Ekibi", targetType: "external_number", targetValue: "+905550000000" },
                    ],
                  })
                }
                className="text-[12px] font-medium text-fg underline"
              >
                + Kural Ekle
              </button>
            </div>
            {rules.map((r, idx) => (
              <div key={r.id} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input
                  type="text"
                  value={r.keyword}
                  onChange={(e) => {
                    const next = [...rules];
                    next[idx] = { ...r, keyword: e.target.value };
                    setCfg({ ...cfg, routingRules: next });
                  }}
                  placeholder="Anahtar kelime (satış)"
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-[12px]"
                />
                <input
                  type="text"
                  value={r.label}
                  onChange={(e) => {
                    const next = [...rules];
                    next[idx] = { ...r, label: e.target.value };
                    setCfg({ ...cfg, routingRules: next });
                  }}
                  placeholder="Birim adı"
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-[12px]"
                />
                <select
                  value={r.targetType}
                  onChange={(e) => {
                    const next = [...rules];
                    next[idx] = { ...r, targetType: e.target.value as VoiceRoutingRule["targetType"] };
                    setCfg({ ...cfg, routingRules: next });
                  }}
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-[12px]"
                >
                  <option value="external_number">Harici Numara</option>
                  <option value="queue">Connect Kuyruk</option>
                  <option value="callback">Geri Dönüş Talebi</option>
                </select>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={r.targetValue}
                    onChange={(e) => {
                      const next = [...rules];
                      next[idx] = { ...r, targetValue: e.target.value };
                      setCfg({ ...cfg, routingRules: next });
                    }}
                    placeholder="+90... veya Queue ARN"
                    className="h-8 flex-1 rounded-lg border border-line bg-bg px-2 text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => setCfg({ ...cfg, routingRules: rules.filter((_, i) => i !== idx) })}
                    className="px-2 text-critical"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
            Cevaplanmayacak Konular
            <input
              type="text"
              value={cfg.blockedTopics ?? ""}
              onChange={(e) => setCfg({ ...cfg, blockedTopics: e.target.value })}
              placeholder="Örn: Rakip firma fiyatları, gizli şirket bilgileri"
              className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
            />
          </label>

          <button type="button" onClick={() => void saveSettings()} className="self-start rounded-full bg-fg px-5 py-2 text-[13px] font-semibold text-bg">
            Ayarları Kaydet
          </button>
        </div>
      ) : null}

      {tab === "test" ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-fg">Asistanı Canlı Test Et (Yazılı veya Mikrofonla)</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={testQ}
              onChange={(e) => setTestQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runTest();
              }}
              placeholder="Arayan gibi soru sorun (ör: Fiyatlarınız nedir veya satış ekibine bağlar mısın?)"
              className="h-10 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg"
            />
            <button type="button" onClick={startMic} className="h-10 rounded-xl border border-line bg-bg px-4 text-[13px] text-fg">
              {listening ? "Dinleniyor…" : "🎤 Mikrofon"}
            </button>
            <button
              type="button"
              disabled={testLoading || !testQ.trim()}
              onClick={() => void runTest()}
              className="h-10 rounded-xl bg-fg px-5 text-[13px] font-semibold text-bg disabled:opacity-40"
            >
              {testLoading ? "Yanıtlanıyor…" : "Sor & Dinle"}
            </button>
          </div>

          {testRes ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-fg-muted">
                  Niyet: <strong className="text-fg">{etiketle(testRes.intent.intent, testRes.intent.intent)}</strong> · Ses: {testRes.provider}
                </span>
                <audio src={testRes.audioUrl} controls className="h-8" />
              </div>
              <p className="text-sm text-fg">{testRes.replyText}</p>
              {testRes.sources.length > 0 ? (
                <div className="flex flex-col gap-1.5 border-t border-line pt-2">
                  <span className="text-[11px] font-semibold uppercase text-fg-muted">Kullanılan Kaynak Parçaları</span>
                  {testRes.sources.map((s, idx) => (
                    <div key={idx} className="rounded-lg border border-line bg-surface p-2 text-[12px]">
                      <span className="font-medium text-fg">{s.title}</span>
                      <p className="text-fg-muted">{s.content.slice(0, 220)}…</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "calls" ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">Arama Kayıtları ({calls.length})</h2>
            {calls.length === 0 ? (
              <p className="text-[13px] text-fg-muted">Henüz arama kaydı yok.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {calls.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 py-3 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium text-fg">{c.callerPhone || "Bilinmeyen"}</span>{" "}
                        <span className="text-fg-muted">· {c.durationSec} sn · {c.outcome}</span>
                        <p className="text-[12px] text-fg-muted">{c.summary}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedCallId(expandedCallId === c.id ? null : c.id)}
                        className="text-[12px] font-medium text-fg underline"
                      >
                        {expandedCallId === c.id ? "Gizle" : "Transkript"}
                      </button>
                    </div>
                    {expandedCallId === c.id && Array.isArray(c.transcript) ? (
                      <div className="flex flex-col gap-1 rounded-xl bg-bg p-3 text-[12px]">
                        {c.transcript.map((t, i) => (
                          <p key={i}>
                            <strong>{t.role === "caller" ? "Arayan:" : "Asistan:"}</strong> {t.text}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold text-fg">Cevaplanamayan Sorular ({unanswered.length})</h2>
              {unanswered.length === 0 ? (
                <p className="text-[12px] text-fg-muted">Cevaplanamayan soru bulunmuyor.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {unanswered.map((u, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg p-2.5 text-[12px]">
                      <span>{u.question}</span>
                      <button
                        type="button"
                        onClick={() => setPromoteTarget(u.question)}
                        className="shrink-0 rounded-full bg-fg px-3 py-1 text-[11px] font-semibold text-bg"
                      >
                        + SSS&apos;e Ekle
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {promoteTarget ? (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-bg p-3">
                  <p className="text-[12px] font-medium text-fg">Soru: {promoteTarget}</p>
                  <textarea
                    rows={2}
                    value={promoteAnswer}
                    onChange={(e) => setPromoteAnswer(e.target.value)}
                    placeholder="Bu sorunun resmi cevabını yazın…"
                    className="rounded-lg border border-line bg-surface p-2 text-[12px]"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void promoteFaq()} className="rounded-full bg-fg px-3 py-1 text-[11px] font-semibold text-bg">
                      Kaydet
                    </button>
                    <button type="button" onClick={() => setPromoteTarget(null)} className="text-[11px] text-fg-muted">
                      İptal
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold text-fg">Geri Dönüş Talepleri ({callbacks.length})</h2>
              {callbacks.length === 0 ? (
                <p className="text-[12px] text-fg-muted">Bekleyen geri dönüş talebi yok.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {callbacks.map((cb) => (
                    <li key={cb.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg p-2.5 text-[12px]">
                      <div>
                        <p className="font-medium text-fg">{cb.callerPhone} {cb.callerName ? `(${cb.callerName})` : ""}</p>
                        <p className="text-fg-muted">{cb.topic}</p>
                      </div>
                      <select
                        value={cb.status}
                        onChange={async (e) => {
                          await fetch("/api/voice/calls", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ action: "callback_status", brandId, callbackId: cb.id, status: e.target.value }),
                          });
                          await loadAll(brandId);
                        }}
                        className="h-7 rounded-lg border border-line bg-surface px-2 text-[11px]"
                      >
                        <option value="bekliyor">Bekliyor</option>
                        <option value="arandi">Arandı</option>
                        <option value="kapandi">Kapandı</option>
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

