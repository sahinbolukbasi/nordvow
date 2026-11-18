"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import jsQR from "jsqr";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

export type TicketRow = {
  id: string;
  code: string;
  holderName: string;
  status: "GECERLI" | "KULLANILDI" | "IPTAL";
  checkedInAt: string | null;
};

type ScanBanner =
  | { kind: "ok"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "err"; text: string }
  | null;

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function TicketScannerPanel({
  eventId,
  initialTickets,
  capacity,
}: {
  eventId: string;
  initialTickets: TicketRow[];
  capacity?: number | null;
}) {
  const tt = useTT();
  const [tickets, setTickets] = useState<TicketRow[]>(initialTickets);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [banner, setBanner] = useState<ScanBanner>(null);
  const [manualCode, setManualCode] = useState("");
  const [busyCode, setBusyCode] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newHolder, setNewHolder] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const [filter, setFilter] = useState<"ALL" | "GELDİ" | "BEKLİYOR">("ALL");
  const [query, setQuery] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const scanningLockRef = useRef(false);

  useEffect(() => {
    setTickets(initialTickets);
  }, [initialTickets]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  }, []);

  const submitCheckIn = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || scanningLockRef.current) return;
      scanningLockRef.current = true;
      setBusyCode(true);
      try {
        const res = await fetch("/api/bilet/check-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "checkIn", code, eventId }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          alreadyUsed?: boolean;
          error?: string;
          ticket?: TicketRow;
        };
        if (!res.ok || !data.ok || !data.ticket) {
          setBanner({ kind: "err", text: data.error ?? tt("Bilet doğrulanamadı.") });
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([80, 60, 80]);
          return;
        }
        const updated = data.ticket;
        setTickets((prev) => {
          const exists = prev.some((t) => t.id === updated.id);
          return exists ? prev.map((t) => (t.id === updated.id ? updated : t)) : [updated, ...prev];
        });
        if (data.alreadyUsed) {
          setBanner({ kind: "warn", text: `${tt("Zaten giriş yapılmış")}: ${updated.holderName} (${updated.code})` });
        } else {
          setBanner({ kind: "ok", text: `${tt("Geldi olarak işaretlendi")}: ${updated.holderName}` });
        }
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(120);
      } catch {
        setBanner({ kind: "err", text: tt("Bağlantı hatası, tekrar deneyin.") });
      } finally {
        setBusyCode(false);
        scanningLockRef.current = false;
      }
    },
    [eventId, tt],
  );

  useEffect(() => {
    if (!cameraOn) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      setCameraError(null);
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(tt("Bu tarayıcıda kamera erişimi desteklenmiyor."));
        setCameraOn(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
        const detector = BD ? new BD({ formats: ["qr_code"] }) : null;

        const tick = async () => {
          if (!active) return;
          const video = videoRef.current;
          if (video && video.readyState >= 2 && video.videoWidth > 0) {
            let detected: string | null = null;
            if (detector) {
              try {
                const hits = await detector.detect(video);
                detected = hits[0]?.rawValue ?? null;
              } catch {
                // jsQR fallback
              }
            }
            if (!detected && canvasRef.current) {
              const canvas = canvasRef.current;
              const w = Math.min(video.videoWidth, 640);
              const h = Math.round((video.videoHeight / video.videoWidth) * w);
              if (w > 0 && h > 0) {
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, w, h);
                  const img = ctx.getImageData(0, 0, w, h);
                  const qr = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
                  detected = qr?.data ?? null;
                }
              }
            }

            if (detected) {
              const now = Date.now();
              if (detected !== lastScanRef.current.code || now - lastScanRef.current.at > 2600) {
                lastScanRef.current = { code: detected, at: now };
                await submitCheckIn(detected);
              }
            }
          }
          if (active) timer = setTimeout(tick, 180);
        };
        timer = setTimeout(tick, 250);
      } catch {
        if (active) {
          setCameraError(tt("Kamera izni verilmedi veya cihazda kamera bulunamadı."));
          setCameraOn(false);
        }
      }
    };

    void start();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }
    };
  }, [cameraOn, submitCheckIn, tt]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolder.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/bilet/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "quickAdd", eventId, holderName: newHolder.trim(), guestEmail: newEmail.trim() || undefined }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; ticket?: TicketRow };
      if (!res.ok || !data.ok || !data.ticket) {
        setBanner({ kind: "err", text: data.error ?? tt("Bilet eklenemedi.") });
        return;
      }
      setTickets((prev) => [data.ticket!, ...prev]);
      setNewHolder("");
      setNewEmail("");
      setShowAdd(false);
      setBanner({ kind: "ok", text: `${tt("Bilet eklendi")}: ${data.ticket.holderName} (${data.ticket.code})` });
    } catch {
      setBanner({ kind: "err", text: tt("Bilet eklenirken bağlantı hatası.") });
    } finally {
      setAdding(false);
    }
  };

  const handleUndo = async (ticketId: string) => {
    try {
      const res = await fetch("/api/bilet/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "undo", eventId, ticketId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; ticket?: TicketRow };
      if (!res.ok || !data.ok || !data.ticket) {
        setBanner({ kind: "err", text: data.error ?? tt("Geri alınamadı.") });
        return;
      }
      setTickets((prev) => prev.map((t) => (t.id === data.ticket!.id ? data.ticket! : t)));
      setBanner({ kind: "warn", text: `${tt("Giriş geri alındı")}: ${data.ticket.holderName}` });
    } catch {
      setBanner({ kind: "err", text: tt("İşlem başarısız.") });
    }
  };

  const liveTickets = useMemo(() => tickets.filter((t) => t.status !== "IPTAL"), [tickets]);
  const arrivedCount = useMemo(() => liveTickets.filter((t) => t.status === "KULLANILDI").length, [liveTickets]);
  const waitingCount = liveTickets.length - arrivedCount;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return tickets.filter((t) => {
      if (filter === "GELDİ" && t.status !== "KULLANILDI") return false;
      if (filter === "BEKLİYOR" && t.status !== "GECERLI") return false;
      if (q) {
        const hay = `${t.holderName} ${t.code}`.toLocaleLowerCase("tr");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, filter, query]);

  return (
    <div className="flex flex-col gap-5">
      {/* Üst mobil aksiyon çubuğu */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-fg">{tt("Mobil Bilet & QR Giriş Yönetimi")}</h3>
            <p className="text-[12px] text-fg-muted">
              {arrivedCount}/{liveTickets.length} {tt("katılımcı giriş yaptı")}
              {capacity ? ` · ${tt("Kapasite")}: ${liveTickets.length}/${capacity}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-bg px-4 text-[13px] font-medium text-fg hover:border-line-strong"
            >
              {showAdd ? tt("Kapat") : `+ ${tt("Bilet ekle")}`}
            </button>
            <a
              href={`/api/etkinlik/${eventId}/csv`}
              className="inline-flex h-10 items-center rounded-full border border-line bg-bg px-4 text-[13px] font-medium text-fg hover:border-line-strong"
            >
              {tt("CSV indir")}
            </a>
            <button
              type="button"
              onClick={() => (cameraOn ? stopCamera() : setCameraOn(true))}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13px] font-semibold transition-standard",
                cameraOn ? "bg-red-500 text-white hover:bg-red-600" : "bg-fg text-bg hover:opacity-90",
              )}
            >
              <span>{cameraOn ? tt("Kamerayı Kapat") : tt("Kamerayı Aç & QR Okut")}</span>
            </button>
          </div>
        </div>

        {/* Hızlı bilet ekleme formu */}
        {showAdd ? (
          <form onSubmit={handleQuickAdd} className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-bg p-3.5 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="text"
              required
              minLength={2}
              value={newHolder}
              onChange={(e) => setNewHolder(e.target.value)}
              placeholder={tt("Katılımcı Ad Soyad *")}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
            />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={tt("E-posta (opsiyonel)")}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
            />
            <button
              type="submit"
              disabled={adding}
              className="h-10 rounded-lg bg-fg px-4 text-[13px] font-semibold text-bg hover:opacity-90 disabled:opacity-50"
            >
              {adding ? tt("Ekleniyor...") : tt("Bilet Oluştur")}
            </button>
          </form>
        ) : null}

        {/* Canlı kamera QR okuma alanı */}
        {cameraOn ? (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="h-72 w-full object-cover sm:h-80" />
            <canvas ref={canvasRef} className="hidden" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]" />
            </div>
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
              {tt("QR kodu karenin içine tutun — okutulunca otomatik 'Geldi' işaretlenir")}
            </span>
          </div>
        ) : null}

        {cameraError ? (
          <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
            {cameraError}
          </p>
        ) : null}

        {banner ? (
          <div
            role="status"
            className={cn(
              "rounded-xl border px-3.5 py-2.5 text-[13px] font-medium",
              banner.kind === "ok" && "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
              banner.kind === "warn" && "border-amber-500/40 bg-amber-500/15 text-amber-300",
              banner.kind === "err" && "border-red-500/40 bg-red-500/15 text-red-300",
            )}
          >
            {banner.text}
          </div>
        ) : null}

        {/* Manuel kod girişi */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualCode.trim()) {
              void submitCheckIn(manualCode);
              setManualCode("");
            }
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={tt("Manuel bilet kodu girin (ör. TKT-XXXXXXXXXX)")}
            className="h-10 flex-1 rounded-xl border border-line bg-bg px-3.5 font-mono text-[13px] uppercase text-fg placeholder:font-sans placeholder:normal-case placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          <button
            type="submit"
            disabled={busyCode || !manualCode.trim()}
            className="h-10 rounded-xl border border-line bg-surface-hover px-4 text-[13px] font-medium text-fg hover:border-line-strong disabled:opacity-50"
          >
            {tt("Kodu Onayla")}
          </button>
        </form>
      </div>

      {/* Aşağısındaki katılımcı & bilet listesi */}
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-label={tt("Bilet listesi")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "ALL", label: `${tt("Tümü")} (${tickets.length})` },
                { id: "GELDİ", label: `${tt("Geldi")} (${arrivedCount})` },
                { id: "BEKLİYOR", label: `${tt("Bekleniyor")} (${waitingCount})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px] font-medium transition-standard",
                  filter === f.id ? "bg-fg text-bg" : "border border-line text-fg-muted hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt("İsim veya kod ara...")}
            className="h-9 w-full rounded-full border border-line bg-bg px-3.5 text-[13px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none sm:w-56"
          />
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-fg-muted">
            {tt("Gösterilecek bilet bulunamadı.")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg">
            {visible.map((t) => {
              const arrived = t.status === "KULLANILDI";
              const cancelled = t.status === "IPTAL";
              return (
                <li key={t.id} className="flex flex-col gap-2.5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                        arrived ? "bg-emerald-500/20 text-emerald-400" : "bg-surface-hover text-fg",
                      )}
                      aria-hidden
                    >
                      {arrived ? "✓" : t.holderName.slice(0, 1).toLocaleUpperCase("tr")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{t.holderName}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                        <span className="font-mono">{t.code}</span>
                        {arrived && t.checkedInAt ? (
                          <span>· {new Date(t.checkedInAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        arrived
                          ? "bg-emerald-500/20 text-emerald-400"
                          : cancelled
                            ? "bg-red-500/20 text-red-400"
                            : "bg-amber-500/15 text-amber-300",
                      )}
                    >
                      {arrived ? tt("Geldi") : cancelled ? tt("İptal") : tt("Bekleniyor")}
                    </span>
                    {!cancelled && !arrived ? (
                      <button
                        type="button"
                        onClick={() => void submitCheckIn(t.code)}
                        className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                      >
                        {tt("Geldi İşaretle")}
                      </button>
                    ) : null}
                    {arrived ? (
                      <button
                        type="button"
                        onClick={() => void handleUndo(t.id)}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:border-line-strong hover:text-fg"
                      >
                        {tt("Geri Al")}
                      </button>
                    ) : null}
                    <Link
                      href={`/bilet/${t.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg hover:border-line-strong"
                    >
                      {tt("Bilet ↗")}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
