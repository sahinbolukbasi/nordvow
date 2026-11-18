"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { buttonClass, Button } from "@/components/ui/form";
import { CampaignDeleteButton } from "@/components/campaign/campaign-hub";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

export type CampaignTabId = "ozet" | "influencerlar" | "icerikler" | "satis" | "teslimat" | "uyum";

const TABS: { id: CampaignTabId; label: string }[] = [
  { id: "ozet", label: "Özet" },
  { id: "influencerlar", label: "Influencer'lar" },
  { id: "icerikler", label: "İçerikler" },
  { id: "satis", label: "Satış ve kodlar" },
  { id: "teslimat", label: "Teslimat" },
  { id: "uyum", label: "Uyum" },
];

export function BrandCampaignActions({
  campaignId,
  campaignName,
  basePath,
  shareUrlBase,
  isSelfManaged,
  isClosed,
  isDraft,
}: {
  campaignId: string;
  campaignName: string;
  basePath: string;
  shareUrlBase: string;
  isSelfManaged: boolean;
  isClosed: boolean;
  isDraft: boolean;
}) {
  const tt = useTT();
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedSections, setSelectedSections] = useState<string[]>(["kpi", "tablo", "galeri", "uyum"]);

  const toggleSection = (key: string) => {
    setSelectedSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const shareHref = `${shareUrlBase}&bolumler=${selectedSections.join(",")}`;

  const copyLink = async () => {
    const full = typeof window !== "undefined" ? `${window.location.origin}${shareHref}` : shareHref;
    await navigator.clipboard?.writeText(full).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
        {tt("Raporu paylaş")}
      </Button>

      {!isDraft ? (
        <a href={`/api/raporlar/kampanya/${campaignId}/pdf`} download className={buttonClass("primary", "sm")}>
          {tt("Dışa aktar (PDF)")}
        </a>
      ) : null}

      <div className="relative">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={menuOpen}
          aria-label={tt("Diğer kampanya işlemleri")}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </Button>
        {menuOpen ? (
          <div className="absolute right-0 z-30 mt-2 flex w-60 flex-col gap-1 rounded-2xl border border-border bg-surface p-2 shadow-xl">
            {isSelfManaged && !isClosed ? (
              <>
                <Link
                  href={`${basePath}/kurulum`}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover"
                >
                  {tt("Influencer & Görev Kurulumu")}
                </Link>
                <Link
                  href={`${basePath}/olustur?adim=ozet`}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover"
                >
                  {tt("Kampanya Sihirbazı")}
                </Link>
              </>
            ) : null}
            <a
              href={`/api/raporlar/kampanya/tiktok?campaignId=${campaignId}&format=csv`}
              onClick={() => setMenuOpen(false)}
              className="rounded-xl px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover"
            >
              {tt("TikTok Raporunu İndir (CSV)")}
            </a>
            <div className="my-1 border-t border-border" />
            <CampaignDeleteButton campaignId={campaignId} campaignName={campaignName} />
          </div>
        ) : null}
      </div>

      {shareOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-report-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 id="share-report-title" className="text-base font-semibold text-fg">
                  {tt("Paylaşılabilir Canlı Rapor")}
                </h3>
                <p className="text-xs text-fg-muted">
                  {tt("Giriş gerektirmez; kampanya verisi güncellendikçe link de canlı güncellenir (30 gün geçerli).")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
                aria-label={tt("Kapat")}
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-fg-muted">{tt("Raporda görünecek bölümler")}</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "kpi", label: "KPI Kartları" },
                  { id: "tablo", label: "Influencer Tablosu" },
                  { id: "uyum", label: "23/A Uyum Kontrolü" },
                ].map((sec) => {
                  const active = selectedSections.includes(sec.id);
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => toggleSection(sec.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-standard",
                        active ? "border-fg bg-fg text-bg" : "border-border bg-bg text-fg-muted",
                      )}
                    >
                      {tt(sec.label)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2">
              <input
                type="text"
                readOnly
                value={shareHref}
                className="w-full bg-transparent text-xs text-fg-muted outline-none"
              />
              <Button type="button" size="sm" variant="primary" onClick={copyLink}>
                {copied ? tt("Kopyalandı") : tt("Kopyala")}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Link href={shareHref} target="_blank" className={buttonClass("secondary", "sm")}>
                {tt("Önizle →")}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BrandCampaignTabs({
  badges,
  ozet,
  influencerlar,
  icerikler,
  satis,
  teslimat,
  uyum,
}: {
  badges?: Partial<Record<CampaignTabId, number>>;
  ozet: ReactNode;
  influencerlar: ReactNode;
  icerikler: ReactNode;
  satis: ReactNode;
  teslimat: ReactNode;
  uyum: ReactNode;
}) {
  const tt = useTT();
  const [active, setActive] = useState<CampaignTabId>("ozet");

  const panels: Record<CampaignTabId, ReactNode> = {
    ozet,
    influencerlar,
    icerikler,
    satis,
    teslimat,
    uyum,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3" role="tablist">
        {TABS.map((t) => {
          const isOn = active === t.id;
          const count = badges?.[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isOn}
              onClick={() => setActive(t.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-medium transition-standard",
                isOn
                  ? "bg-fg text-bg"
                  : "border border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {tt(t.label)}
              {count != null && count > 0 ? (
                <span className="ml-1.5 tabular-nums opacity-75">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div>{panels[active]}</div>
    </div>
  );
}

