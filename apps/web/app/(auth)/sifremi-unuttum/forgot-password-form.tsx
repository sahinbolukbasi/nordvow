"use client";

import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { requestPasswordResetAction } from "@/lib/actions/password-reset";

const inputCls = "h-12 rounded-xl border-line bg-glass-strong text-[15px] focus:border-neon-pink/60";

export function ForgotPasswordForm() {
  const tt = useTT();
  return (
    <ActionForm
      action={requestPasswordResetAction}
      submitLabel={tt("Sıfırlama bağlantısı gönder →")}
      resetOnSuccess
      aria-label={tt("Şifre sıfırlama talebi")}
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
    </ActionForm>
  );
}

