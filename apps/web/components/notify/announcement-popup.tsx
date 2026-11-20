"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { XIcon } from "@/components/icons";

export type SystemPopup = {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  audience: string;
  targetEmail?: string | null;
  createdAt: string;
};

export function AnnouncementPopup({ items, userId }: { items: SystemPopup[]; userId: string }) {
  const [active, setActive] = useState<SystemPopup | null>(null);

  useEffect(() => {
    if (!items.length) return;
    try {
      const key = `nordvow.popups.seen.${userId}`;
      const seen = new Set<string>(JSON.parse(localStorage.getItem(key) || "[]"));
      const next = items.find((i) => !seen.has(i.id));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- istemci deposundan ilk okunmamış duyuru
      if (next) setActive(next);
    } catch {
      /* depolama kapalı */
    }
  }, [items, userId]);

  if (!active) return null;

  const dismiss = () => {
    try {
      const key = `nordvow.popups.seen.${userId}`;
      const seen: string[] = JSON.parse(localStorage.getItem(key) || "[]");
      if (!seen.includes(active.id)) seen.push(active.id);
      localStorage.setItem(key, JSON.stringify(seen.slice(-50)));
    } catch {
      /* yok say */
    }
    setActive(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="relative flex w-full max-w-md flex-col gap-4 rounded-3xl border border-line bg-surface p-6 shadow-2xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Kapat"
          className="absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <XIcon size={14} />
        </button>
        <div className="flex flex-col gap-1 pr-6">
          <span className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Duyuru</span>
          <h2 className="text-lg font-semibold text-fg">{active.title}</h2>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{active.message}</p>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {active.link ? (
            <Link
              href={active.link}
              onClick={dismiss}
              className="rounded-full border border-line px-4 py-2 text-[13px] font-medium text-fg hover:border-line-strong"
            >
              İncele →
            </Link>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full bg-fg px-5 py-2 text-[13px] font-semibold text-bg hover:opacity-90"
          >
            Anladım
          </button>
        </div>
      </div>
    </div>
  );
}

