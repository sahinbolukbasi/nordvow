"use client";
import { useEffect, useState } from "react";
import { CopilotChat } from "@/components/copilot/copilot-chat";
import type { CopilotWelcome } from "@/lib/copilot";
import { cn } from "@/lib/cn";

export function CopilotHomeShell({ welcome, brandName }: { welcome: CopilotWelcome; brandName: string }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const toggleBtn = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-label={expanded ? "Asistanı küçült" : "Asistanı büyüt"}
      title={expanded ? "Küçült (Esc)" : "Büyüt"}
      className="absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/90 px-3 py-1.5 text-[12px] font-medium text-fg backdrop-blur transition-standard hover:border-line-strong hover:bg-surface-hover"
    >
      {expanded ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
          </svg>
          Küçült
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
          Büyüt
        </>
      )}
    </button>
  );

  if (expanded) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${brandName} Asistan`}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) setExpanded(false);
        }}
      >
        <section className="relative flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
          {toggleBtn}
          <div className="min-h-0 flex-1 overflow-y-auto pt-2">
            <CopilotChat welcome={welcome} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <section aria-label={`${brandName} Asistan`} className="relative overflow-hidden rounded-3xl border border-line bg-surface">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-neon-pink/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-neon-cyan/15 blur-3xl" />
      {toggleBtn}
      <div className={cn("relative")}>
        <CopilotChat welcome={welcome} />
      </div>
    </section>
  );
}

