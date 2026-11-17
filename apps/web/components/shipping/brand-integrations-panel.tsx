"use client";

import { useActionState, useState, useTransition } from "react";
import { idleState } from "@/lib/action-state";
import {
  saveBrandShippingIntegrationAction,
  testBrandShippingIntegrationAction,
} from "@/lib/actions/shipping";
import { Button, Field, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import type { ShippingProvider } from "@infulancer/core/enums";
import type { SenderAddress } from "@infulancer/core/shipping/types";

export type BrandIntegrationRow = {
  id: string;
  provider: ShippingProvider;
  label: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  hasApiSecret: boolean;
  customerCode: string | null;
  isActive: boolean;
  defaultSenderAddressId: string | null;
  senderAddress: SenderAddress | null;
  lastTestedAt: Date | string | null;
  lastTestOk: boolean | null;
};

function IntegrationCard({ item }: { item: BrandIntegrationRow }) {
  const [state, action, pending] = useActionState(
    saveBrandShippingIntegrationAction,
    idleState,
  );
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs: number;
  } | null>(null);
  const [expanded, setExpanded] = useState(item.isActive || item.hasApiKey);
  const isManual = item.provider === "CUSTOM_MANUAL";
  const isNavlungo = item.provider === "NAVLUNGO";

  const onTest = () => {
    startTest(async () => {
      const res = await testBrandShippingIntegrationAction(item.provider);
      setTestResult(res);
    });
  };

  return (
    <Card interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-fg">{item.label}</h3>
            <span
              className={
                item.isActive
                  ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  : "rounded-full bg-fg/10 px-2.5 py-0.5 text-[11px] font-medium text-fg-muted"
              }
            >
              {item.isActive ? "Aktif" : "Pasif"}
            </span>
            {item.lastTestOk === true ? (
              <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                Bağlantı Doğrulandı
              </span>
            ) : null}
          </div>
          <p className="text-[12px] text-fg-muted">
            {isManual
              ? "Kargo anlaşmanız yoksa kendi kargonuzla gönderip takip numarasını manuel girebilirsiniz."
              : isNavlungo
                ? "Navlungo Domestic v2.1 API ile tek entegrasyon üzerinden tüm anlaşmalı kargolarla barkod oluşturun."
                : "Tek tıkla kargo barkodu oluşturma ve otomatik teslimat takibi."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onTest} disabled={testing}>
            {testing ? "Test ediliyor…" : "Bağlantıyı Test Et"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Gizle" : "Yapılandır"}
          </Button>
        </div>
      </div>

      {testResult ? (
        <div
          className={
            testResult.ok
              ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300"
              : "rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-300"
          }
        >
          {testResult.message} ({testResult.latencyMs} ms)
        </div>
      ) : null}

      {expanded ? (
        <form action={action} className="flex flex-col gap-4 border-t border-line pt-4">
          <input type="hidden" name="provider" value={item.provider} />
          <label className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={item.isActive}
              className="h-4 w-4 rounded border-line"
            />
            Bu kargo yöntemini aktif et
          </label>

          {!isManual ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={isNavlungo ? "Carrier ID (Varsayılan: 1)" : "Müşteri Kodu (Customer Code)"}>
                {(p) => (
                  <Input
                    {...p}
                    name="customerCode"
                    defaultValue={item.customerCode ?? (isNavlungo ? "1" : "")}
                    placeholder={isNavlungo ? "Örn: 1" : "Örn: 10293847"}
                  />
                )}
              </Field>
              <Field label={isNavlungo ? "API Kullanıcı Adı (E-posta) / Bearer Token" : "API Anahtarı (Şifreli)"}>
                {(p) => (
                  <Input
                    {...p}
                    name="apiKey"
                    type={isNavlungo ? "text" : "password"}
                    defaultValue={item.maskedApiKey ?? ""}
                    placeholder={isNavlungo ? "api@marka.com veya Bearer Token" : "API Key girin"}
                  />
                )}
              </Field>
              <Field label={isNavlungo ? "API Şifresi (Token kullanıyorsanız boş bırakın)" : "API Secret (Şifreli)"}>
                {(p) => (
                  <Input
                    {...p}
                    name="apiSecret"
                    type="password"
                    defaultValue={item.hasApiSecret ? "••••••••" : ""}
                    placeholder={isNavlungo ? "Navlungo API şifresi" : "API Secret girin"}
                  />
                )}
              </Field>
              {isNavlungo ? (
                <Field label="Navlungo Gönderici Adres ID (addressId - Opsiyonel)" className="sm:col-span-3">
                  {(p) => (
                    <Input
                      {...p}
                      name="defaultSenderAddressId"
                      defaultValue={item.defaultSenderAddressId ?? ""}
                      placeholder="Boş bırakılırsa aşağıdaki çıkış adresi Navlungo adres defterine otomatik kaydedilir"
                    />
                  )}
                </Field>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Varsayılan Gönderici Adı">
              {(p) => (
                <Input
                  {...p}
                  name="senderName"
                  defaultValue={item.senderAddress?.senderName ?? ""}
                  placeholder="Marka Lojistik Deposu"
                />
              )}
            </Field>
            <Field label="Gönderici Telefon">
              {(p) => (
                <Input
                  {...p}
                  name="senderPhone"
                  defaultValue={item.senderAddress?.senderPhone ?? ""}
                  placeholder="0212 000 00 00"
                />
              )}
            </Field>
            <Field label="İl">
              {(p) => (
                <Input
                  {...p}
                  name="city"
                  defaultValue={item.senderAddress?.city ?? ""}
                  placeholder="İstanbul"
                />
              )}
            </Field>
            <Field label="İlçe">
              {(p) => (
                <Input
                  {...p}
                  name="district"
                  defaultValue={item.senderAddress?.district ?? ""}
                  placeholder="Şişli"
                />
              )}
            </Field>
            <Field label="Çıkış Adresi" className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  name="addressLine"
                  defaultValue={item.senderAddress?.addressLine ?? ""}
                  placeholder="Depo / Ofis açık adresi"
                />
              )}
            </Field>
          </div>

          {state.message ? (
            <p
              className={
                state.ok
                  ? "text-[13px] text-emerald-600 dark:text-emerald-400"
                  : "text-[13px] text-rose-600 dark:text-rose-400"
              }
            >
              {state.message}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Ayarları Kaydet"}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

export function BrandShippingIntegrationsPanel({
  items,
}: {
  items: BrandIntegrationRow[];
}) {
  const byProvider = new Map(items.map((i) => [i.provider, i]));
  const orderedProviders: { provider: ShippingProvider; label: string }[] = [
    { provider: "NAVLUNGO", label: "Navlungo (Domestic v2.1)" },
    { provider: "CUSTOM_MANUAL", label: "Platform Dışı / Manuel Takip" },
    { provider: "YURTICI", label: "Yurtiçi Kargo" },
    { provider: "ARAS", label: "Aras Kargo" },
    { provider: "MNG", label: "MNG Kargo" },
    { provider: "UPS", label: "UPS Türkiye" },
    { provider: "HEPSIJET", label: "HepsiJET" },
    { provider: "KOLAY_GELSIN", label: "Kolay Gelsin" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {orderedProviders.map(({ provider, label }) => {
        const existing = byProvider.get(provider) ?? {
          id: `new-${provider}`,
          provider,
          label,
          hasApiKey: false,
          maskedApiKey: null,
          hasApiSecret: false,
          customerCode: null,
          isActive: provider === "CUSTOM_MANUAL",
          defaultSenderAddressId: null,
          senderAddress: null,
          lastTestedAt: null,
          lastTestOk: null,
        };
        return <IntegrationCard key={provider} item={existing} />;
      })}
    </div>
  );
}
