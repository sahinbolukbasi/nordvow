"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTT } from "@/lib/i18n/tt-client";
import { Button } from "@/components/ui/form";
import { syncInfluencerForBrandAction } from "@/lib/actions/social-sync";

export function SyncInfluencerButton({ influencerId, size = "sm" }: { influencerId: string; size?: "sm" | "md" }) {
  const tt = useTT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const onSync = () =>
    start(async () => {
      setStatus(null);
      const r = await syncInfluencerForBrandAction(influencerId);
      setStatus({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" size={size} disabled={pending} onClick={onSync}>
        {pending ? tt("Çekiliyor…") : tt("Anlık verileri yenile (IG/YT/TT)")}
      </Button>
      {status ? (
        <span className={`text-[11px] ${status.ok ? "text-emerald-600" : "text-critical"}`}>{status.text}</span>
      ) : null}
    </div>
  );
}

