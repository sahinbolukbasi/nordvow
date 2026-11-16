"use client";

import { startTransition, useActionState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { Field, Input } from "@/components/ui/form";
import { idleState } from "@/lib/action-state";
import { requestPasswordResetAction } from "@/lib/actions/password-reset";

const inputCls = "h-12 rounded-xl border-line bg-glass-strong text-[15px] focus:border-neon-pink/60";

export function ForgotPasswordForm() {
  const tt = useTT();
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, idleState);

  return (
    <form
      aria-label={tt("Şifre sıfırlama talebi")}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <Field label={tt("E-posta")}>
        {(p) => (
          <Input
            {...p}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={tt("ad@sirket.com")}
            className={inputCls}
          />
        )}
      </Field>

      {state.error ? (
        <p role="alert" className="text-[13px] text-critical">
          {tt(state.error)}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[13px] text-fg">
          {tt(state.message)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="group relative inline-flex h-12 w-full items-center justify-center overflow-hidden rounded-xl text-[15px] font-medium text-black transition-transform duration-300 hover:scale-[1.01] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neon-pink"
      >
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#ff2bd6,#9d4dff,#00e5ff,#a3ff12,#ff2bd6)] bg-[length:300%_100%] animate-gradient-x" />
        <span className="relative">{pending ? tt("Gönderiliyor…") : tt("Sıfırlama bağlantısı gönder →")}</span>
      </button>
    </form>
  );
}
