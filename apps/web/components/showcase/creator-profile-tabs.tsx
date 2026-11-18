"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

export type ProfileTabId = "kitle" | "performans" | "icerikler" | "markalar" | "uyum";

const TABS: { id: ProfileTabId; label: string }[] = [
  { id: "kitle", label: "Kitle ve Analiz" },
  { id: "performans", label: "Performans Skorları" },
  { id: "icerikler", label: "İçerikler ve Portfolyo" },
  { id: "markalar", label: "Markalar ve Fiyatlar" },
  { id: "uyum", label: "Uyum / 23-A" },
];

export function CreatorProfileTabs({
  kitle,
  performans,
  icerikler,
  markalar,
  uyum,
}: {
  kitle: ReactNode;
  performans: ReactNode;
  icerikler: ReactNode;
  markalar: ReactNode;
  uyum: ReactNode;
}) {
  const tt = useTT();
  const [active, setActive] = useState<ProfileTabId>("kitle");

  const panels: Record<ProfileTabId, ReactNode> = {
    kitle,
    performans,
    icerikler,
    markalar,
    uyum,
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3" role="tablist">
        {TABS.map((t) => {
          const isOn = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isOn}
              onClick={() => setActive(t.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-medium transition-standard",
                isOn
                  ? "bg-fg text-bg"
                  : "border border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {tt(t.label)}
            </button>
          );
        })}
      </div>

      <div>{panels[active]}</div>
    </div>
  );
}

