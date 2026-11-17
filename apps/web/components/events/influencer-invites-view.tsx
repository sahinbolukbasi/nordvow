"use client";

import { useState } from "react";
import Link from "next/link";
import { useTT } from "@/lib/i18n/tt-client";
import { AttendanceToggle } from "@/components/events/event-forms";
import { DateBadge, Pill, type PillTone } from "@/components/luma/primitives";
import { Button } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

export type InviteCardItem = {
  id: string;
  status: string;
  statusLabel: string;
  statusTone: PillTone;
  canRespond: boolean;
  eventId: string;
  eventTitle: string;
  eventStatus: string;
  startsAtIso: string;
  dateRangeLabel: string;
  organizerLabel: string;
  venueLabel: string;
  coverSrc: string | null;
  ticketId: string | null;
};

export type CouponCardItem = {
  id: string;
  title: string;
  brandName: string;
  kindLabel: string;
  valueLabel: string;
  statusLabel: string;
  statusTone: PillTone;
  accent: string;
  logoSrc: string | null;
  validLabel: string;
  expired: boolean;
};

type PreviewState = {
  kind: "ticket" | "coupon";
  id: string;
  title: string;
  subtitle: string;
  url: string;
  pdfUrl: string;
};

export function InfluencerInvitesView({
  defaultTab,
  upcoming,
  past,
  coupons,
}: {
  defaultTab?: string;
  upcoming: InviteCardItem[];
  past: InviteCardItem[];
  coupons: CouponCardItem[];
}) {
  const tt = useTT();
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const renderEvents = (items: InviteCardItem[], emptyText: string) =>
    items.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-muted">{tt(emptyText)}</p>
    ) : (
      <ol className="flex flex-col gap-3">
        {items.map((inv) => {
          const selected = preview?.kind === "ticket" && preview.id === inv.ticketId;
          return (
            <li
              key={inv.id}
              className={cn(
                "flex flex-col gap-4 rounded-2xl border bg-surface p-4 transition-standard sm:flex-row sm:items-start",
                selected ? "border-fg" : "border-line",
              )}
            >
              <DateBadge date={new Date(inv.startsAtIso)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={inv.statusTone}>{tt(inv.statusLabel)}</Pill>
                  {inv.eventStatus === "IPTAL" ? <Pill tone="red">{tt("Etkinlik iptal")}</Pill> : null}
                </div>
                <Link
                  href={`/etkinlik/${inv.eventId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[17px] font-semibold leading-snug text-fg underline-offset-4 hover:underline"
                >
                  {inv.eventTitle}
                </Link>
                <span className="text-[13px] text-fg-muted">{inv.dateRangeLabel}</span>
                <span className="truncate text-[13px] text-fg-muted">
                  {inv.organizerLabel}
                  {inv.venueLabel ? ` · ${inv.venueLabel}` : ""}
                </span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {inv.canRespond ? <AttendanceToggle inviteId={inv.id} current={inv.status} /> : null}
                  {inv.ticketId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({
                          kind: "ticket",
                          id: inv.ticketId!,
                          title: inv.eventTitle,
                          subtitle: inv.dateRangeLabel,
                          url: `/bilet/${inv.ticketId}`,
                          pdfUrl: `/api/bilet/${inv.ticketId}/pdf`,
                        })
                      }
                      className="inline-flex h-8 items-center rounded-full bg-fg px-3 text-[13px] font-medium text-bg transition-standard hover:opacity-90"
                    >
                      {tt("Biletimi göster")}
                    </button>
                  ) : null}
                  <Link
                    href={`/etkinlik/${inv.eventId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-medium text-fg-muted hover:text-fg"
                  >
                    {tt("Etkinlik sitesi ↗")}
                  </Link>
                  {inv.ticketId ? (
                    <a href={`/api/etkinlik/${inv.eventId}/ics`} className="text-[13px] text-fg-muted hover:text-fg">
                      {tt("Takvime ekle")}
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="hidden h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-line sm:block">
                {inv.coverSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={inv.coverSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-[linear-gradient(135deg,var(--color-neon-violet),var(--color-neon-pink))] opacity-80" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );

  const renderCoupons = () =>
    coupons.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-muted">
        {tt("Henüz size gönderilmiş kupon yok.")}
      </p>
    ) : (
      <ul className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", !preview && "lg:grid-cols-3")}>
        {coupons.map((c) => {
          const selected = preview?.kind === "coupon" && preview.id === c.id;
          return (
            <li key={c.id}>
              <div
                className={cn(
                  "flex h-full flex-col overflow-hidden rounded-2xl border bg-surface transition-standard",
                  selected ? "border-fg" : "border-line hover:border-line-strong",
                )}
              >
                <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: c.accent }}>
                  <div className="flex items-center gap-2">
                    {c.logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logoSrc} alt="" className="h-6 w-6 rounded-md bg-white/15 object-cover" />
                    ) : null}
                    <span className="text-[13px] font-medium">{c.brandName}</span>
                  </div>
                  <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] font-medium">{tt(c.kindLabel)}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[20px] font-semibold tracking-tight text-fg">{c.valueLabel}</span>
                    <Pill tone={c.expired ? "gray" : c.statusTone}>{c.expired ? tt("Süresi doldu") : tt(c.statusLabel)}</Pill>
                  </div>
                  <p className="font-medium text-fg">{c.title}</p>
                  <p className="text-[12px] text-fg-muted">{c.validLabel}</p>
                  <div className="mt-auto pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={selected ? "primary" : "secondary"}
                      onClick={() =>
                        setPreview({
                          kind: "coupon",
                          id: c.id,
                          title: c.title,
                          subtitle: `${c.brandName} · ${c.valueLabel}`,
                          url: `/kupon/${c.id}`,
                          pdfUrl: `/api/kupon/${c.id}/pdf`,
                        })
                      }
                    >
                      {tt("Kuponu göster")}
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className={cn("grid grid-cols-1 gap-6", preview && "lg:grid-cols-[minmax(0,1fr)_420px]")}>
      <div className="min-w-0">
        <Tabs
          key={defaultTab ?? "yaklasan"}
          label={tt("Davetlerim")}
          defaultTab={defaultTab}
          tabs={[
            { id: "yaklasan", label: `Yaklaşan (${upcoming.length})`, content: renderEvents(upcoming, "Yaklaşan etkinlik davetiniz yok.") },
            { id: "gecmis", label: `Geçmiş (${past.length})`, content: renderEvents(past, "Geçmiş etkinlik yok.") },
            { id: "kupon", label: `Kuponlar (${coupons.length})`, content: renderCoupons() },
          ]}
        />
      </div>

      {preview ? (
        <aside
          aria-label={preview.kind === "ticket" ? tt("Bilet önizlemesi") : tt("Kupon önizlemesi")}
          className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-20 lg:self-start"
        >
          <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
            <div className="min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                {preview.kind === "ticket" ? tt("Biletim") : tt("Kuponum")}
              </span>
              <h2 className="truncate text-[16px] font-semibold text-fg">{preview.title}</h2>
              <p className="truncate text-[12px] text-fg-muted">{preview.subtitle}</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)} aria-label={tt("Paneli kapat")}>
              ✕
            </Button>
          </div>

          <iframe
            key={preview.url}
            src={preview.url}
            title={preview.title}
            loading="lazy"
            className="h-[460px] w-full rounded-xl border border-line bg-bg sm:h-[540px]"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/wallet/apple/${preview.kind}/${preview.id}`}
                className="inline-flex h-8 items-center rounded-full bg-black px-3 text-[12px] font-medium text-white ring-1 ring-white/20 hover:ring-white/40"
              >
                {tt("Apple Wallet")}
              </a>
              <a
                href={preview.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[12px] font-medium text-fg hover:border-line-strong"
              >
                {tt("PDF İndir")}
              </a>
            </div>
            <Link
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center rounded-full bg-fg px-3 text-[12px] font-medium text-bg hover:opacity-90"
            >
              {tt("Tam ekranda aç ↗")}
            </Link>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

