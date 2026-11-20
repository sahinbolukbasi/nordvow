"use client";
import { useState } from "react";
import { CopilotChat } from "@/components/copilot/copilot-chat";
import type { CopilotWelcome } from "@/lib/copilot";
import { cn } from "@/lib/cn";

export function CopilotHomeShell({ welcome, brandName }: { welcome: CopilotWelcome; brandName: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      aria-label={`${brandName} Asistan`}
      className={cn(
        "relative overflow-hidden rounded-3xl border border-line bg-surface transition-all duration-200",
        expanded ? "min-h-[78dvh] shadow-xl" : "",
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-neon-pink/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-neon-cyan/15 blur-3xl" />
      <div className="relative">
        <CopilotChat
          welcome={welcome}
          expanded={expanded}
          onToggleExpand={() => setExpanded((v) => !v)}
        />
      </div>
    </section>
  );
}
