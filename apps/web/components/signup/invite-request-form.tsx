"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { submitInviteRequestAction } from "@/lib/actions/invites";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

export function InviteRequestForm() {
  const tt = useTT();
  const [role, setRole] = useState<"INFLUENCER" | "BRAND">("INFLUENCER");
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 px-6 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.22)]">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-fg">{tt("Başvurunuz alındı")}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-fg-muted">
            {tt("Bilgileriniz ekibimize ulaştı. Değerlendirme tamamlandığında e-posta veya telefon üzerinden size geri dönüş sağlayacağız.")}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line-strong bg-glass-strong px-5 text-sm font-medium text-fg transition hover:bg-glass"
          >
            {tt("Ana sayfaya dön")}
          </Link>
          <Link
            href="/kayit"
            className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm text-fg-muted transition hover:text-fg"
          >
            {tt("Davet kodu gir")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ActionForm
      action={submitInviteRequestAction}
      submitLabel={tt("Başvuruyu gönder →")}
      aria-label={tt("Davet başvurusu formu")}
      onSuccess={() => setSubmitted(true)}
    >
      <input type="hidden" name="role" value={role} />

      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">{tt("Başvuru türü")}</span>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-glass p-1">
          {[
            { id: "INFLUENCER" as const, label: tt("İçerik üreticisi") },
            { id: "BRAND" as const, label: tt("Marka / Ajans") },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRole(opt.id)}
              className={cn(
                "h-9 rounded-lg text-sm font-medium transition",
                role === opt.id
                  ? "bg-glass-strong text-fg shadow-sm ring-1 ring-line-strong"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={tt("Ad soyad")}>
          {(p) => <Input {...p} name="name" required minLength={2} maxLength={100} autoComplete="name" placeholder={tt("Adınız Soyadınız")} />}
        </Field>
        <Field label={tt("Telefon")}>
          {(p) => <Input {...p} name="phone" type="tel" required autoComplete="tel" placeholder="+90 5__ ___ __ __" />}
        </Field>
        <Field label={tt("E-posta")}>
          {(p) => <Input {...p} name="email" type="email" required autoComplete="email" placeholder="ornek@alanadi.com" />}
        </Field>
        {role === "BRAND" ? (
          <Field label={tt("Marka / şirket adı")}>
            {(p) => <Input {...p} name="companyName" required autoComplete="organization" placeholder={tt("Marka adı")} />}
          </Field>
        ) : (
          <Field label={tt("Instagram")}>
            {(p) => <Input {...p} name="instagram" placeholder="@kullanici" />}
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {role === "BRAND" ? (
          <Field label={tt("Instagram (opsiyonel)")}>
            {(p) => <Input {...p} name="instagram" placeholder="@marka" />}
          </Field>
        ) : null}
        <Field label={tt("TikTok (opsiyonel)")}>
          {(p) => <Input {...p} name="tiktok" placeholder="@kullanici" />}
        </Field>
        <Field label={tt("YouTube (opsiyonel)")}>
          {(p) => <Input {...p} name="youtube" placeholder="@kanal" />}
        </Field>
      </div>

      <Field label={tt("Eklemek istedikleriniz (opsiyonel)")}>
        {(p) => (
          <Textarea
            {...p}
            name="note"
            rows={2}
            maxLength={600}
            placeholder={role === "BRAND" ? tt("Kampanya hedefleriniz veya web siteniz…") : tt("İçerik alanlarınız veya portfolyo linkiniz…")}
          />
        )}
      </Field>
    </ActionForm>
  );
}
