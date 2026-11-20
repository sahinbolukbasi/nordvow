"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, ResetIcon, XIcon } from "@/components/icons";
import { ReelCard } from "@/components/landing/reel-card";
import { Button, Input, Select, Textarea } from "@/components/ui/form";
import { resetLandingAction, saveLandingAction } from "@/lib/actions/landing";
import type { LandingContent, LandingCreatorItem, LandingReferenceItem, LandingVideoItem } from "@/lib/landing-store";
import { mediaSrc } from "@/lib/media";
import { cn } from "@/lib/cn";

type Tab = "videos" | "references" | "creators";
const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-fg-muted transition-standard hover:bg-surface-hover hover:text-fg disabled:opacity-30";

function MediaUploadInline({
  kind,
  label,
  onUploaded,
}: {
  kind: "image" | "video";
  label: string;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accept = kind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/jpeg,image/png,image/webp";
  const maxBytes = kind === "video" ? 50 * 1024 * 1024 : 8 * 1024 * 1024;

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      if (file.size > maxBytes) {
        throw new Error(kind === "video" ? "Video en fazla 50 MB olabilir." : "Görsel en fazla 8 MB olabilir.");
      }
      const pres = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mime: file.type, size: file.size }),
      });
      const pj = await pres.json();
      if (!pres.ok) throw new Error(pj.error ?? "Yükleme hazırlığı başarısız.");
      const put = await fetch(pj.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!put.ok) throw new Error("Dosya yüklenemedi.");
      const conf = await fetch("/api/media", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: pj.key }),
      });
      const cj = await conf.json();
      if (!conf.ok) throw new Error(cj.error ?? "Doğrulanamadı.");
      const url = mediaSrc(cj.key);
      if (url) onUploaded(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Yükleme hatası.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-bg px-3 text-xs font-medium text-fg transition-standard hover:border-fg disabled:opacity-50"
      >
        {busy ? "Yükleniyor…" : label}
      </button>
      {err ? <span className="text-[11px] text-critical">{err}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </div>
  );
}

function L({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-label text-fg-muted", className)}>
      {label}
      {children}
      {hint ? <span className="text-[12px] font-normal normal-case text-fg-passive">{hint}</span> : null}
    </label>
  );
}

function RowTools({ i, n, onMove, onRemove, label }: { i: number; n: number; onMove: (d: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={iconBtn} onClick={() => onMove(-1)} disabled={i === 0} aria-label={`${label}: yukarı taşı`} title="Yukarı">
        <ArrowUpIcon size={16} />
      </button>
      <button type="button" className={iconBtn} onClick={() => onMove(1)} disabled={i === n - 1} aria-label={`${label}: aşağı taşı`} title="Aşağı">
        <ArrowDownIcon size={16} />
      </button>
      <button type="button" className={iconBtn} onClick={onRemove} aria-label={`${label}: sil`} title="Sil">
        <XIcon size={16} />
      </button>
    </div>
  );
}

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Tanıtım sayfası içerik editörü: video/reklam kartları, referanslar ve kayan içerik üreticileri. */
export function LandingEditor({
  initial,
  autoCreators,
  tones,
  creatorTones,
}: {
  initial: LandingContent;
  autoCreators: LandingCreatorItem[];
  tones: readonly string[];
  creatorTones: readonly string[];
}) {
  const [data, setData] = useState(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [tab, setTab] = useState<Tab>("videos");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(data) !== savedSnapshot;

  const setVideo = (i: number, patch: Partial<LandingVideoItem>) => setData((d) => ({ ...d, videos: d.videos.map((v, k) => (k === i ? { ...v, ...patch } : v)) }));
  const setRef = (i: number, patch: Partial<LandingReferenceItem>) => setData((d) => ({ ...d, references: d.references.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));

  const save = () =>
    start(async () => {
      const res = await saveLandingAction(data);
      if (res.ok) {
        setSavedSnapshot(JSON.stringify(data));
        setMsg({ ok: true, text: "Kaydedildi. Ana sayfa güncellendi." });
      } else {
        setMsg({ ok: false, text: `${res.error}${res.path ? ` (alan: ${res.path})` : ""}` });
      }
    });
  const reset = () =>
    start(async () => {
      if (!window.confirm("Tüm tanıtım içeriği varsayılana dönsün mü? Bu işlem geri alınamaz.")) return;
      await resetLandingAction();
      window.location.reload();
    });

  const tabs: { id: Tab; label: string }[] = [
    { id: "videos", label: `Video / reklam kartları (${data.videos.length})` },
    { id: "references", label: `Referanslar (${data.references.length})` },
    {
      id: "creators",
      label: data.creatorsMode === "auto" ? `İçerik üreticisi şeridi (Otomatik · ${autoCreators.length})` : `İçerik üreticisi şeridi (${data.creators.length})`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-bg/90 py-3 backdrop-blur">
        <div role="tablist" aria-label="İçerik bölümleri" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("rounded-full border px-3 py-1 text-[13px] transition-standard", tab === t.id ? "border-fg text-fg" : "border-border text-fg-muted hover:text-fg")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span aria-live="polite" className={cn("ml-auto text-[13px]", msg?.ok === false ? "text-critical" : "text-fg-muted")}>
          {msg?.text ?? (dirty ? "Kaydedilmemiş değişiklik var." : "")}
        </span>
        <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
          <ResetIcon size={14} /> Varsayılan
        </Button>
        <a href="/?onizleme=1" target="_blank" rel="noopener noreferrer" className="text-[13px] text-fg-muted hover:text-fg">
          Ana sayfayı aç ↗
        </a>
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? "Kaydediliyor…" : "Kaydet ve yayınla"}
        </Button>
      </div>

      {tab === "videos" ? (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-fg-muted">
            Video adresi boşsa kart animasyonlu görünür. Dikey (9:16) MP4/WebM, sessiz ve kısa (≤15 sn, ≤8 MB) videolar önerilir. Reklam/işbirliği içeriklerinde &quot;Reklam&quot; etiketi açık kalmalı (md. 23/A).
          </p>
          {data.videos.map((v, i) => (
            <div key={i} className="grid grid-cols-1 gap-4 rounded-[12px] border border-border p-4 md:grid-cols-[160px_1fr]">
              <div className="w-[160px]">
                <ReelCard video={{ ...v, src: v.src || undefined, poster: v.poster || undefined, avatar: v.avatar || undefined }} />
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg">Kart {i + 1}</span>
                  <RowTools
                    i={i}
                    n={data.videos.length}
                    label={`Kart ${i + 1}`}
                    onMove={(d) => setData((x) => ({ ...x, videos: move(x.videos, i, d) }))}
                    onRemove={() => setData((x) => ({ ...x, videos: x.videos.filter((_, k) => k !== i) }))}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <L label="Video adresi (veya dosya yükle)" hint="MP4/WebM/MOV yükleyin veya https://… adresi girin" className="md:col-span-2">
                    <div className="flex flex-wrap items-start gap-2">
                      <Input value={v.src} onChange={(e) => setVideo(i, { src: e.target.value })} placeholder="https://cdn…/video.mp4" className="min-w-[200px] flex-1" />
                      <MediaUploadInline kind="video" label="Video yükle" onUploaded={(url) => setVideo(i, { src: url })} />
                    </div>
                  </L>
                  <L label="Kapak görseli (isteğe bağlı)">
                    <div className="flex items-start gap-2">
                      <Input value={v.poster} onChange={(e) => setVideo(i, { poster: e.target.value })} placeholder="https://…/kapak.jpg" className="flex-1" />
                      <MediaUploadInline kind="image" label="Kapak yükle" onUploaded={(url) => setVideo(i, { poster: url })} />
                    </div>
                  </L>
                  <L label="Üretici profil resmi (isteğe bağlı)">
                    <div className="flex items-start gap-2">
                      <Input value={v.avatar ?? ""} onChange={(e) => setVideo(i, { avatar: e.target.value })} placeholder="https://…/profil.jpg" className="flex-1" />
                      <MediaUploadInline kind="image" label="Fotoğraf yükle" onUploaded={(url) => setVideo(i, { avatar: url })} />
                    </div>
                  </L>
                  <L label="Platform">
                    <Select value={v.platform} onChange={(e) => setVideo(i, { platform: e.target.value as LandingVideoItem["platform"] })}>
                      <option>Instagram</option>
                      <option>TikTok</option>
                      <option>YouTube</option>
                    </Select>
                  </L>
                  <L label="Kullanıcı adı">
                    <Input value={v.handle} onChange={(e) => setVideo(i, { handle: e.target.value })} maxLength={40} />
                  </L>
                  <L label="Üretici tanımı">
                    <Input value={v.creator} onChange={(e) => setVideo(i, { creator: e.target.value })} maxLength={60} />
                  </L>
                  <L label="Açıklama" className="md:col-span-2">
                    <Input value={v.caption} onChange={(e) => setVideo(i, { caption: e.target.value })} maxLength={120} />
                  </L>
                  <L label="Sonuç (ör. 1,2M izlenme)">
                    <Input value={v.metric} onChange={(e) => setVideo(i, { metric: e.target.value })} maxLength={40} />
                  </L>
                  <L label="Renk (video yokken)">
                    <Select value={v.tone} onChange={(e) => setVideo(i, { tone: e.target.value as LandingVideoItem["tone"] })}>
                      {tones.map((t, k) => (
                        <option key={t} value={t}>
                          Degrade {k + 1}
                        </option>
                      ))}
                    </Select>
                  </L>
                  <label className="flex items-center gap-2 text-sm text-fg-muted md:col-span-2">
                    <input type="checkbox" checked={v.sponsored} onChange={(e) => setVideo(i, { sponsored: e.target.checked })} className="h-4 w-4 accent-[var(--color-fg)]" />
                    Reklam / işbirliği içeriği (&quot;Reklam&quot; etiketi göster)
                  </label>
                </div>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setData((d) => ({
                ...d,
                videos: [...d.videos, { src: "", poster: "", avatar: "", creator: "İçerik üreticisi", handle: "@kullanici", platform: "Instagram", caption: "Açıklama · #işbirliği", metric: "—", tone: tones[d.videos.length % tones.length] as LandingVideoItem["tone"], sponsored: true }],
              }))
            }
            disabled={data.videos.length >= 12}
          >
            <PlusIcon size={14} /> Kart ekle
          </Button>
        </div>
      ) : null}

      {tab === "references" ? (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-fg-muted">
            Gerçek müşteri referansını yalnız yazılı izinle yayınlayın. &quot;Örnek çalışma&quot; işaretli olanlar sitede bu etiketle görünür. Gizli olanlar sitede gösterilmez.
          </p>
          {data.references.map((r, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-[12px] border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-fg">
                  {r.brand || `Referans ${i + 1}`} {!r.visible ? <span className="text-fg-passive">· gizli</span> : null}
                </span>
                <RowTools
                  i={i}
                  n={data.references.length}
                  label={r.brand || `Referans ${i + 1}`}
                  onMove={(d) => setData((x) => ({ ...x, references: move(x.references, i, d) }))}
                  onRemove={() => setData((x) => ({ ...x, references: x.references.filter((_, k) => k !== i) }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <L label="Marka">
                  <Input value={r.brand} onChange={(e) => setRef(i, { brand: e.target.value })} maxLength={60} />
                </L>
                <L label="Sektör">
                  <Input value={r.sector} onChange={(e) => setRef(i, { sector: e.target.value })} maxLength={40} />
                </L>
                <L label="Logo adresi (isteğe bağlı)">
                  <div className="flex items-start gap-2">
                    <Input value={r.logo} onChange={(e) => setRef(i, { logo: e.target.value })} placeholder="https://…/logo.png" className="flex-1" />
                    <MediaUploadInline kind="image" label="Logo yükle" onUploaded={(url) => setRef(i, { logo: url })} />
                  </div>
                </L>
                <L label="Alıntı" className="md:col-span-2">
                  <Textarea value={r.quote} onChange={(e) => setRef(i, { quote: e.target.value })} rows={3} maxLength={300} />
                </L>
                <L label="Kişi / unvan">
                  <Input value={r.person} onChange={(e) => setRef(i, { person: e.target.value })} maxLength={60} />
                </L>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {[0, 1, 2].map((k) => {
                  const res = r.results[k] ?? { label: "", value: "" };
                  const update = (patch: Partial<{ label: string; value: string }>) => {
                    const results = [0, 1, 2].map((m) => (m === k ? { ...res, ...patch } : (r.results[m] ?? { label: "", value: "" })));
                    setRef(i, { results: results.filter((x, m) => m === 0 || x.label || x.value) });
                  };
                  return (
                    <div key={k} className="grid grid-cols-2 gap-2">
                      <L label={`Sonuç ${k + 1} adı`}>
                        <Input value={res.label} onChange={(e) => update({ label: e.target.value })} maxLength={24} />
                      </L>
                      <L label="Değer">
                        <Input value={res.value} onChange={(e) => update({ value: e.target.value })} maxLength={16} />
                      </L>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-6 text-sm text-fg-muted">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={r.sample} onChange={(e) => setRef(i, { sample: e.target.checked })} className="h-4 w-4 accent-[var(--color-fg)]" />
                  Örnek çalışma (gerçek müşteri değil)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={r.visible} onChange={(e) => setRef(i, { visible: e.target.checked })} className="h-4 w-4 accent-[var(--color-fg)]" />
                  Sitede göster
                </label>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setData((d) => ({
                ...d,
                references: [...d.references, { brand: "Yeni marka", sector: "Sektör", quote: "Alıntı", person: "Unvan", logo: "", results: [{ label: "Erişim", value: "—" }], sample: true, visible: false }],
              }))
            }
            disabled={data.references.length >= 12}
          >
            <PlusIcon size={14} /> Referans ekle
          </Button>
        </div>
      ) : null}

      {tab === "creators" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-surface/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setData((d) => ({ ...d, creatorsMode: "auto" }))}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-standard",
                  data.creatorsMode === "auto" ? "bg-fg text-bg" : "border border-border bg-bg text-fg-muted hover:text-fg",
                )}
              >
                Otomatik (İçerideki influencerlar)
              </button>
              <button
                type="button"
                onClick={() => setData((d) => ({ ...d, creatorsMode: "manual" }))}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-standard",
                  data.creatorsMode === "manual" ? "bg-fg text-bg" : "border border-border bg-bg text-fg-muted hover:text-fg",
                )}
              >
                Elle düzenleme
              </button>
            </div>
            {autoCreators.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() => setData((d) => ({ ...d, creatorsMode: "manual", creators: autoCreators }))}
              >
                {data.creatorsMode === "auto" ? "Listeyi elle düzenlemeye aktar" : "İçerideki influencerları çek"}
              </Button>
            ) : null}
          </div>

          {data.creatorsMode === "auto" ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-fg-muted">
                {autoCreators.length > 0
                  ? `Platformdaki aktif ve vitrini açık ${autoCreators.length} influencer takipçi sayısına göre otomatik çekiliyor. Yeni influencer eklendikçe tanıtım sayfası kendiliğinden güncellenir.`
                  : "Şu anda vitrini açık ve sosyal hesabı bağlı aktif influencer bulunamadı; bu nedenle kayıtlı/varsayılan liste gösterilir."}
              </p>
              {autoCreators.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {autoCreators.map((c, i) => (
                    <div key={`${c.handle}-${i}`} className="flex items-center gap-3 rounded-[12px] border border-border p-3">
                      {c.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element -- otomatik influencer avatarı
                        <img src={c.avatar} alt={c.handle} className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-line" />
                      ) : (
                        <span className={cn("h-10 w-10 shrink-0 rounded-full bg-gradient-to-br", c.tone)} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.handle}</div>
                        <div className="truncate text-[12px] text-fg-muted">
                          {[c.platform, c.niche, c.city].filter(Boolean).join(" · ")}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-passive">
                          <span>{c.followers} takipçi</span>
                          {c.engagement ? <span>· {c.engagement} etkileşim</span> : null}
                          {c.brand ? <span>· {c.brand}</span> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-fg-muted">Ana sayfada kayan içerik üreticisi şeridi. Gerçek hesapları yalnız izinleriyle ekleyin.</p>
              {data.creators.map((c, i) => (
                <div key={i} className="grid grid-cols-1 items-end gap-3 rounded-[12px] border border-border p-3 md:grid-cols-4">
                  <L label="Profil resmi" className="md:col-span-2">
                    <div className="flex items-center gap-2">
                      {c.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element -- editör avatar önizleme
                        <img src={c.avatar} alt={c.handle} className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-line" />
                      ) : (
                        <span className={cn("h-9 w-9 shrink-0 rounded-full bg-gradient-to-br", c.tone)} />
                      )}
                      <Input value={c.avatar ?? ""} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, avatar: e.target.value } : x)) }))} placeholder="https://… veya fotoğraf yükle" className="flex-1" />
                      <MediaUploadInline kind="image" label="Fotoğraf yükle" onUploaded={(url) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, avatar: url } : x)) }))} />
                    </div>
                  </L>
                  <L label="Kullanıcı adı">
                    <Input value={c.handle} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, handle: e.target.value } : x)) }))} maxLength={40} />
                  </L>
                  <L label="Alan">
                    <Input value={c.niche} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, niche: e.target.value } : x)) }))} maxLength={24} />
                  </L>
                  <L label="Takipçi">
                    <Input value={c.followers} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, followers: e.target.value } : x)) }))} maxLength={12} />
                  </L>
                  <L label="Platform">
                    <Select value={c.platform} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, platform: e.target.value as typeof c.platform } : x)) }))}>
                      <option>Instagram</option>
                      <option>TikTok</option>
                      <option>YouTube</option>
                    </Select>
                  </L>
                  <L label="Şehir">
                    <Input value={c.city} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, city: e.target.value } : x)) }))} maxLength={30} />
                  </L>
                  <L label="Etkileşim">
                    <Input value={c.engagement} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, engagement: e.target.value } : x)) }))} maxLength={10} placeholder="%6,5" />
                  </L>
                  <L label="Çalıştığı marka (izinliyse)">
                    <Input value={c.brand} onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, brand: e.target.value } : x)) }))} maxLength={40} />
                  </L>
                  <L label="Renk">
                    <Select
                      value={c.tone}
                      onChange={(e) => setData((d) => ({ ...d, creators: d.creators.map((x, k) => (k === i ? { ...x, tone: e.target.value as typeof c.tone } : x)) }))}
                    >
                      {creatorTones.map((t, k) => (
                        <option key={t} value={t}>
                          Renk {k + 1}
                        </option>
                      ))}
                    </Select>
                  </L>
                  <RowTools
                    i={i}
                    n={data.creators.length}
                    label={c.handle}
                    onMove={(d) => setData((x) => ({ ...x, creators: move(x.creators, i, d) }))}
                    onRemove={() => setData((x) => ({ ...x, creators: x.creators.filter((_, k) => k !== i) }))}
                  />
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() => setData((d) => ({ ...d, creators: [...d.creators, { handle: "@kullanici", niche: "Alan", followers: "—", avatar: "", platform: "Instagram", city: "", engagement: "", brand: "", tone: creatorTones[d.creators.length % creatorTones.length] as (typeof d.creators)[number]["tone"] }] }))}
                disabled={data.creators.length >= 30}
              >
                <PlusIcon size={14} /> Üretici ekle
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
