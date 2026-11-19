"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { useEffect, useRef, useState } from "react";
import type { LandingVideo } from "@/lib/landing-content";
import { cn } from "@/lib/cn";

/**
 * Dikey (9:16) içerik kartı. Video varsa sessiz döngüde, yalnız ekrandayken oynar;
 * kullanıcı durdurup başlatabilir, "hareketi azalt" tercihinde otomatik başlamaz.
 * Video yoksa animasyonlu reel görünümü gösterilir.
 */
export function ReelCard({ video, className, delay = 0 }: { video: LandingVideo; className?: string; delay?: number }) {
  const tt = useTT();
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loadError = Boolean(video.src) && failedSrc === video.src;

  useEffect(() => {
    const el = ref.current;
    if (!el || !video.src) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const tryPlay = () => {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (e.isIntersecting && !userPaused) tryPlay();
        else {
          el.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.25, rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [userPaused, video.src]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      setUserPaused(false);
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      setUserPaused(true);
      el.pause();
      setPlaying(false);
    }
  };

  const showVideo = Boolean(video.src) && !loadError;

  return (
    <figure
      className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-[22px] border border-border bg-surface", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {showVideo ? (
        <video
          key={video.src}
          ref={ref}
          src={video.src}
          poster={video.poster}
          muted
          loop
          playsInline
          preload={video.poster ? "none" : "metadata"}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailedSrc(video.src ?? null)}
          aria-label={`${tt(video.creator)} içeriği: ${tt(video.caption)}`}
          className="absolute inset-0 h-full w-full cursor-pointer object-cover"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <div
            className={cn("absolute inset-[-20%] bg-gradient-to-br bg-[length:200%_200%] animate-reel-pan", video.tone)}
            style={{ animationDelay: `${delay}ms` }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.35),transparent_45%)]" />
          <div className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 animate-float" />
        </div>
      )}
      {/* Üst ilerleme çubuğu (story görünümü) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-3 top-3 h-0.5 overflow-hidden rounded-full bg-white/25">
        <div className="h-full origin-left bg-white animate-reel-progress" style={{ animationDelay: `${delay}ms` }} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 text-left text-white">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          {video.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- dinamik avatar
            <img src={video.avatar} alt={video.handle} loading="lazy" decoding="async" className="h-6 w-6 shrink-0 rounded-full border border-white/50 object-cover" />
          ) : (
            <span aria-hidden className="h-6 w-6 shrink-0 rounded-full border border-white/50 bg-white/20" />
          )}
          {video.handle}
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide">{video.platform}</span>
          {video.sponsored ? <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black">{tt("Reklam")}</span> : null}
        </span>
        <span className="text-[13px] leading-snug text-white/85">{tt(video.caption)}</span>
        <span className="text-[12px] font-semibold tabular-nums">{tt(video.metric)}</span>
      </figcaption>
      {showVideo ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? tt("Videoyu durdur") : tt("Videoyu oynat")}
          className="absolute top-6 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-standard hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5v14l12-7Z" />
            </svg>
          )}
        </button>
      ) : null}
    </figure>
  );
}
