"use client";
import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Select } from "@/components/ui/form";
import { Card, CardTitle } from "@/components/ui/card";
import { setBrandDefaultModeAction } from "@/lib/actions/execution-mode";
import { cn } from "@/lib/cn";

export type AgencyOption = { id: string; name: string; email: string };

/**
 * Markanın kampanya çalışma şekli ve ajans seçimi (Profil ayarları içinde).
 * SELF = manuel olarak kendiniz yürütürsünüz; AJANS = sistemdeki bir ajansla çalışırsınız.
 */
export function DefaultModeCard({
  mode: initialMode,
  agencies = [],
  selectedAgencyId,
}: {
  mode: "SELF" | "AJANS";
  agencies?: AgencyOption[];
  selectedAgencyId?: string | null;
}) {
  const tt = useTT();
  const [mode, setMode] = useState<"SELF" | "AJANS">(initialMode);
  const [agencyId, setAgencyId] = useState<string>(selectedAgencyId ?? "");

  return (
    <Card interactive={false} className="flex flex-col gap-4">
      <div>
        <CardTitle>{tt("Kampanya çalışma şekli ve ajans seçimi")}</CardTitle>
        <p className="mt-1 text-sm text-fg-muted">
          {tt("Yeni kampanyalarınızı kendi yönetiminizle (manuel) yürütebilir veya sistemdeki bir ajansı seçerek süreci ajansla ilerletebilirsiniz.")}
        </p>
      </div>
      <ActionForm action={setBrandDefaultModeAction} submitLabel={tt("Çalışma şeklini kaydet")} submitSize="sm" aria-label={tt("Kampanya çalışma şekli")}>
        <input type="hidden" name="mode" value={mode} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("SELF")}
            aria-pressed={mode === "SELF"}
            className={cn(
              "rounded-2xl border p-4 text-left transition-standard",
              mode === "SELF" ? "border-fg bg-fg/[0.05]" : "border-line hover:border-fg/40",
            )}
          >
            <span className="block text-sm font-medium text-fg">{tt("Manuel ilerle (Kendim yönet)")}</span>
            <span className="mt-1 block text-[12px] text-fg-muted">
              {tt("Influencer'ları kendiniz keşfeder, teklif gönderir ve kampanyaları doğrudan yayına alırsınız.")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("AJANS")}
            aria-pressed={mode === "AJANS"}
            className={cn(
              "rounded-2xl border p-4 text-left transition-standard",
              mode === "AJANS" ? "border-fg bg-fg/[0.05]" : "border-line hover:border-fg/40",
            )}
          >
            <span className="block text-sm font-medium text-fg">{tt("Ajans ile çalış")}</span>
            <span className="mt-1 block text-[12px] text-fg-muted">
              {tt("Brief'i hazırlarsınız; seçtiğiniz ajans influencer ataması, bütçe ve yayın kontrolünü yürütür.")}
            </span>
          </button>
        </div>
        {mode === "AJANS" ? (
          <Field label={tt("Çalışılacak ajans")} hint={agencies.length ? tt("Sistemde aktif ajanslardan birini seçin.") : tt("Varsayılan platform ajansı ile çalışacaksınız.")}>
            {(p) => (
              <Select {...p} name="preferredAgencyUserId" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">{tt("Platform Ajansı (Varsayılan)")}</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.email})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </ActionForm>
    </Card>
  );
}
