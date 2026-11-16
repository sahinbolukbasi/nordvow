"use client";

import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { Field, Input } from "@/components/ui/form";
import { resetPasswordAction } from "@/lib/actions/password-reset";

const inputCls = "h-12 rounded-xl border-line bg-glass-strong pr-12 text-[15px] focus:border-neon-pink/60";

export function ResetPasswordForm({ token }: { token: string }) {
  const tt = useTT();
  const [show, setShow] = useState(false);

  return (
    <ActionForm action={resetPasswordAction} submitLabel={tt("Şifreyi güncelle ve girişe dön →")} aria-label={tt("Yeni şifre belirle")}>
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
    </ActionForm>
  );
}

