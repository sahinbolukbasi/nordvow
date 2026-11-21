"use client";

import { startTransition, useActionState, useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { Field, Input } from "@/components/ui/form";
import { idleState } from "@/lib/action-state";
import { resetPasswordAction } from "@/lib/actions/password-reset";

const inputCls = "h-12 rounded-xl border-line bg-glass-strong pr-12 text-[15px] focus:border-neon-pink/60";

export function ResetPasswordForm({ token }: { token: string }) {
  const tt = useTT();
  const [state, formAction, pending] = useActionState(resetPasswordAction, idleState);
  const [show, setShow] = useState(false);

  return (
    <form
      aria-label={tt("Yeni şifre belirle")}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <input type="hidden" name="token" value={token} />
      <Field label={tt("Yeni şifre")}>
        {(p) => (
          <div className="relative">
            <Input
              {...p}
              name="password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              placeholder={tt("En az 8 karakter")}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? tt("Şifreyi gizle") : tt("Şifreyi göster")}
              className="absolute top-1/2 right-2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              {show ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
        )}
      </Field>
      <Field label={tt("Yeni şifre (tekrar)")}>
        {(p) => (
          <Input
            {...p}
            name="confirmPassword"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            placeholder={tt("Şifreyi tekrar girin")}
            className="h-12 rounded-xl border-line bg-glass-strong text-[15px] focus:border-neon-pink/60"
          />
        )}
      </Field>

      {state.error ? (
        <p role="alert" className="text-[13px] text-critical">
          {tt(state.error)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="group relative inline-flex h-12 w-full items-center justify-center overflow-hidden rounded-xl text-[15px] font-medium text-black transition-transform duration-300 hover:scale-[1.01] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neon-pink"
      >
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#ff2bd6,#9d4dff,#00e5ff,#a3ff12,#ff2bd6)] bg-[length:300%_100%] animate-gradient-x" />
        <span className="relative">{pending ? tt("Güncelleniyor…") : tt("Şifreyi güncelle ve girişe dön →")}</span>
      </button>
    </form>
  );
}
