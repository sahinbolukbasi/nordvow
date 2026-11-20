"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { KurulumAdimi } from "@/lib/iletisim/context";

const DISMISS_KEY = "nv_iletisim_checklist_hidden";

/**
 * Gelen Kutusu üstünde 4 adımlı ilk kurulum kontrol listesi.
 * 4/4 tamamlanınca otomatik gizlenir; Ayarlar'dan tekrar açılabilir.
 */
export function KurulumListesi({ steps, forceShow = false }: { steps: KurulumAdimi[]; forceShow?: boolean }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (forceShow) {
      setHidden(false);
      return;
    }
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") setHidden(true);
    } catch {
      // ignore
    }
  }, [forceShow]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  if (!forceShow && (completed >= total || hidden)) return null;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <section
      aria-label="İlk kurulum adımları"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-fg">Kurulum</span>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-bg">
            <div className="h-full rounded-full bg-fg transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-medium tabular-nums text-fg-muted">
            {completed} / {total}
          </span>
        </div>
        {!forceShow ? (
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {
                // ignore
              }
            }}
            className="text-[11px] text-fg-muted hover:text-fg"
          >
            Gizle
          </button>
        ) : null}
      </div>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li
            key={step.key}
            className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg/60 px-3 py-2 text-xs"
          >
            <span className={step.done ? "text-fg-muted line-through" : "font-medium text-fg"}>
              {step.done ? "✓" : "○"} {i + 1}. {step.label}
            </span>
            {!step.done ? (
              <Link href={step.href} className="shrink-0 font-semibold text-fg hover:underline">
                {step.cta}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Ayarlar ekranından kurulum kontrol listesini yeniden görünür yapar. */
export function KurulumListesiniAcButonu() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.removeItem(DISMISS_KEY);
        } catch {
          // ignore
        }
        setDone(true);
      }}
      className="w-fit rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-fg hover:border-fg"
    >
      {done ? "✓ Gelen Kutusu'nda tekrar gösterilecek" : "İlk kurulum kontrol listesini tekrar göster"}
    </button>
  );
}

