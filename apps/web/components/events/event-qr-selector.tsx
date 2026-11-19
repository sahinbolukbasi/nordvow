"use client";
import { useRouter } from "next/navigation";
import { useTT } from "@/lib/i18n/tt-client";

export type QrEventOption = {
  id: string;
  title: string;
  dateLabel: string;
  statusLabel: string;
};

export function EventQrSelector({
  basePath,
  selectedId,
  events,
}: {
  basePath: string;
  selectedId: string;
  events: QrEventOption[];
}) {
  const router = useRouter();
  const tt = useTT();

  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor="qr-event-select" className="text-[13px] font-medium text-fg">
        {tt("Etkinlik seçin")}
      </label>
      <select
        id="qr-event-select"
        value={selectedId}
        onChange={(e) => router.push(`${basePath}?etkinlik=${encodeURIComponent(e.target.value)}`)}
        className="h-10 w-full rounded-xl border border-line bg-bg px-3 text-[13px] text-fg focus:border-fg focus:outline-none sm:max-w-md"
      >
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.title} · {ev.dateLabel} ({ev.statusLabel})
          </option>
        ))}
      </select>
    </div>
  );
}

