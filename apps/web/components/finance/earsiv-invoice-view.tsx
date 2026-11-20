"use client";

import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";

export interface EArsivInvoiceViewProps {
  campaignId: string;
  defaultHtml?: string;
  warnings?: string[];
  invoiceNo?: string;
  children: React.ReactNode;
}

export function EArsivInvoiceView({
  campaignId,
  defaultHtml,
  warnings = [],
  invoiceNo,
  children,
}: EArsivInvoiceViewProps) {
  const tt = useTT();
  const [tab, setTab] = useState<"summary" | "earsiv">("summary");

  const downloadHtmlUrl = `/api/fatura/${campaignId}?format=html&download=1`;
  const viewHtmlUrl = `/api/fatura/${campaignId}?format=html`;
  const jsonUrl = `/api/fatura/${campaignId}?format=json`;

  return (
    <div className="flex flex-col gap-4">
      {/* Tab Switcher & Top Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 print:hidden">
        <div className="inline-flex rounded-xl bg-surface-raised p-1 text-[13px] font-medium text-fg-muted">
          <button
            type="button"
            onClick={() => setTab("summary")}
            className={`rounded-lg px-3.5 py-1.5 transition-colors ${
              tab === "summary"
                ? "bg-surface font-semibold text-fg shadow-sm"
                : "hover:text-fg"
            }`}
          >
            {tt("Kampanya Fatura Özeti")}
          </button>
          <button
            type="button"
            onClick={() => setTab("earsiv")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-colors ${
              tab === "earsiv"
                ? "bg-surface font-semibold text-fg shadow-sm"
                : "hover:text-fg"
            }`}
          >
            <span>{tt("Resmi e-Arşiv Taslağı")}</span>
            <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              GİB
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === "earsiv" ? (
            <>
              <a
                href={viewHtmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-[12px] font-medium text-fg hover:bg-surface-raised"
              >
                {tt("Yeni Sekmede Aç")}
              </a>
              <a
                href={downloadHtmlUrl}
                download
                className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-[12px] font-medium text-fg hover:bg-surface-raised"
              >
                {tt("e-Arşiv HTML İndir")}
              </a>
              <a
                href={jsonUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-[12px] font-medium text-fg hover:bg-surface-raised"
              >
                {tt("JSON Taslak")}
              </a>
              <button
                type="button"
                onClick={() => {
                  const iframe = document.getElementById("earsiv-iframe") as HTMLIFrameElement | null;
                  if (iframe?.contentWindow) {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                  } else {
                    window.print();
                  }
                }}
                className="inline-flex h-9 items-center rounded-lg bg-fg px-3.5 text-[12px] font-semibold text-bg hover:opacity-90"
              >
                {tt("Yazdır / PDF")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center rounded-lg bg-fg px-4 text-[13px] font-semibold text-bg hover:opacity-90"
            >
              {tt("Yazdır")}
            </button>
          )}
        </div>
      </div>

      {/* Warnings Banner if any */}
      {warnings.length > 0 && tab === "earsiv" ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-[12px] text-amber-300">
          <p className="font-semibold text-amber-200">{tt("Mevzuat & Doğrulama Notları")}:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-300/90">
            {warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Tab Content */}
      {tab === "summary" ? (
        children
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-[12px] text-fg-muted">
            <p>
              {tt("GİB e-Arşiv UBL-TR 1.2 standartlarına uygun önizleme")} · {invoiceNo}
            </p>
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
              {tt("VUK & KDV Uyumlu")}
            </span>
          </div>

          <div className="relative mx-auto w-full max-w-[850px] overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <iframe
              id="earsiv-iframe"
              src={viewHtmlUrl}
              srcDoc={defaultHtml}
              title="Resmi e-Arşiv Fatura Taslağı"
              className="h-[1050px] w-full border-0 bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}
