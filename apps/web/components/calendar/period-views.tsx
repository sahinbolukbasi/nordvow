import { getTT } from "@/lib/i18n/tt-server";
import Link from "next/link";
import type { CalendarCard, CalendarRow } from "@/components/calendar/week-calendar";
import { PlatformIcon } from "@/components/platform-icon";
import { monthName } from "@/lib/calendar";
import { cn } from "@/lib/cn";
import { fmtDayLabel } from "@/lib/time";

type Card = CalendarCard & { influencerName: string };
const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function flatten(rows: CalendarRow[]): Card[] {
  return rows.flatMap((r) => r.cards.map((c) => ({ ...c, influencerName: r.name }))).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
}
const tone = (c: CalendarCard) =>
  c.overdue || c.violation ? "border-critical/60 bg-critical/10" : c.locked ? "border-line bg-glass opacity-70" : "border-neon-pink/40 bg-neon-pink/10";

/** Gün görünümü: saatlik (00:00–23:00) zaman çizelgesi. */
export async function DayView({ rows, emptyText }: { rows: CalendarRow[]; emptyText: string }) {
  const tt = await getTT();
  const cards = flatten(rows);
  const byHour = new Map<number, Card[]>();
  for (const c of cards) {
    const h = Number.parseInt(c.time.slice(0, 2), 10);
    const hour = Number.isFinite(h) && h >= 0 && h <= 23 ? h : 12;
    byHour.set(hour, [...(byHour.get(hour) ?? []), c]);
  }
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex flex-col gap-3">
      {cards.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-4 text-center text-sm text-fg-passive">{emptyText}</p>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-line bg-glass">
        {hours.map((hour) => {
          const slotLabel = `${String(hour).padStart(2, "0")}:00`;
          const items = byHour.get(hour) ?? [];
          return (
            <div key={hour} className="grid grid-cols-[72px_1fr] border-b border-line last:border-b-0">
              <div className="flex items-start justify-end border-r border-line bg-surface/50 px-3 py-2.5 text-[12px] font-medium tabular-nums text-fg-muted">
                {slotLabel}
              </div>
              <div className={cn("flex flex-col gap-2 px-3 py-2", items.length === 0 ? "min-h-10" : "min-h-14")}>
                {items.map((c) => (
                  <Link
                    key={c.id}
                    href={c.href}
                    className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-standard hover:border-line-strong", tone(c))}
                  >
                    <span className="text-[13px] font-semibold tabular-nums">{c.time}</span>
                    <PlatformIcon platform={c.platform} size={16} title={c.platformLabel} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-fg">
                        {c.influencerName} · {c.contentLabel}
                      </span>
                      <span className="truncate text-[12px] text-fg-muted">{c.campaignName}</span>
                    </span>
                    <span className="text-[12px] text-fg-muted">
                      {c.statusLabel}
                      {c.overdue ? tt(" · gecikti") : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ay görünümü: pazartesiden başlayan ızgara, günde en fazla 3 kart + "n daha". */
export async function MonthView({ days, rows, month, today, dayHref, labelBy = "influencer" }: { days: string[]; rows: CalendarRow[]; month: number; today: string; dayHref: (d: string) => string; labelBy?: "influencer" | "campaign" }) {
  const tt = await getTT();
  const byDay = new Map<string, Card[]>();
  for (const c of flatten(rows)) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="grid grid-cols-7 border-b border-line bg-surface text-[12px] text-fg-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = Number(d.slice(5, 7)) === month;
          const items = byDay.get(d) ?? [];
          return (
            <div key={d} className={cn("min-h-28 border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-surface/40 opacity-50")}>
              <Link
                href={dayHref(d)}
                aria-label={`${fmtDayLabel(d)}: ${items.length} paylaşım`}
                className={cn("mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] tabular-nums hover:bg-surface-hover", d === today && "bg-neon-pink font-semibold text-black")}
              >
                {Number(d.slice(8))}
              </Link>
              <ul className="flex flex-col gap-1">
                {items.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <Link href={c.href} className={cn("flex items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px]", tone(c))} title={`${c.time} · ${c.influencerName} · ${c.campaignName}`}>
                      <PlatformIcon platform={c.platform} size={10} />
                      <span className="tabular-nums">{c.time}</span>
                      <span className="truncate">{labelBy === "campaign" ? c.campaignName : c.influencerName}</span>
                    </Link>
                  </li>
                ))}
                {items.length > 3 ? (
                  <li>
                    <Link href={dayHref(d)} className="px-1.5 text-[11px] text-fg-muted hover:text-fg">
                      +{items.length - 3}{" "}{tt("daha")}</Link>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Yıl görünümü: 12 mini ay, günler paylaşım yoğunluğuna göre renklenir. */
export async function YearView({ year, rows, today, dayHref, monthHref }: { year: number; rows: CalendarRow[]; today: string; dayHref: (d: string) => string; monthHref: (m: number) => string }) {
  const tt = await getTT();
  const count = new Map<string, number>();
  for (const c of flatten(rows)) count.set(c.day, (count.get(c.day) ?? 0) + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const first = new Date(Date.UTC(year, m - 1, 1));
        const offset = (first.getUTCDay() + 6) % 7;
        const len = new Date(Date.UTC(year, m, 0)).getUTCDate();
        const total = Array.from({ length: len }, (_, k) => count.get(`${year}-${pad(m)}-${pad(k + 1)}`) ?? 0).reduce((s, n) => s + n, 0);
        return (
          <section key={m} className="rounded-2xl border border-line bg-glass p-4">
            <Link href={monthHref(m)} className="mb-3 flex items-center justify-between text-sm font-medium hover:text-neon-pink">
              {monthName(m)}
              <span className="text-[12px] font-normal text-fg-muted tabular-nums">{total}{" "}{tt("paylaşım")}</span>
            </Link>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-fg-passive">
                  {w[0]}
                </span>
              ))}
              {Array.from({ length: offset }, (_, k) => (
                <span key={`e${k}`} />
              ))}
              {Array.from({ length: len }, (_, k) => {
                const d = `${year}-${pad(m)}-${pad(k + 1)}`;
                const n = count.get(d) ?? 0;
                return (
                  <Link
                    key={d}
                    href={dayHref(d)}
                    aria-label={`${fmtDayLabel(d)}: ${n} paylaşım`}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md tabular-nums transition-standard hover:ring-1 hover:ring-neon-pink",
                      n === 0 ? "text-fg-passive" : n === 1 ? "bg-neon-pink/25 text-fg" : n <= 3 ? "bg-neon-pink/50 text-fg" : "bg-neon-pink text-black",
                      d === today && "ring-1 ring-neon-cyan",
                    )}
                  >
                    {k + 1}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
