"use client";

import { useActionState, useTransition } from "react";
import { idleState } from "@/lib/action-state";
import { updateInviteRequestStatusAction, type InviteRequestRecord } from "@/lib/actions/invites";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

const LABELS: Record<InviteRequestRecord["status"], string> = {
  NEW: "Yeni",
  CONTACTED: "Geri dönüş yapıldı",
  INVITED: "Davet gönderildi",
  ARCHIVED: "Arşiv",
};

export function InviteRequestStatusButtons({ id, current }: { id: string; current: InviteRequestRecord["status"] }) {
  const tt = useTT();
  const [state, action] = useActionState(updateInviteRequestStatusAction, idleState);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(["NEW", "CONTACTED", "INVITED", "ARCHIVED"] as const).map((st) => (
        <button
          key={st}
          type="button"
          disabled={pending || current === st}
          onClick={() => {
            const fd = new FormData();
            fd.set("id", id);
            fd.set("status", st);
            start(() => action(fd));
          }}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-[12px] transition disabled:cursor-default",
            current === st
              ? "border-neon-pink/50 bg-neon-pink/15 text-fg font-medium"
              : "border-line bg-glass text-fg-muted hover:border-line-strong hover:text-fg",
          )}
        >
          {tt(LABELS[st])}
        </button>
      ))}
      {!state.ok && state.error ? <span className="text-[12px] text-critical">{state.error}</span> : null}
    </div>
  );
}

