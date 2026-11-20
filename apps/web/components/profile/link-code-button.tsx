"use client";

import { useActionState } from "react";
import { issueBotCodeAction } from "@/lib/actions/bot";

/** Kodu yalnız bu yanıtta gösterir. Veritabanında hash durur. */
export function LinkCodeButton() {
  const [state, action, pending] = useActionState(issueBotCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button type="submit" disabled={pending} className="w-fit text-[13px] underline">
        {pending ? "Üretiliyor…" : "6 haneli bağlama kodu üret"}
      </button>
      {state && "code" in state ? <p className="font-mono text-2xl tracking-[0.3em]">{state.code}</p> : null}
      {state && "error" in state ? <p className="text-[13px] text-fg-muted">{state.error}</p> : null}
      <p className="text-[12px] text-fg-passive">Kod 15 dakika geçerlidir, bir kez kullanılır ve yeni kod eskisini düşürür.</p>
    </form>
  );
}
