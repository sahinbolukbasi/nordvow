import Link from "next/link";
import type { DurumBandiBilgi } from "@/lib/iletisim/context";
import { cn } from "@/lib/cn";

/**
 * Tüm İletişim sekmelerinde en üstte yer alan tek durum bandı.
 * En ciddi tek sorunu gösterir; sorun yoksa render edilmez.
 */
export function IletisimDurumBandi({ banner }: { banner: DurumBandiBilgi }) {
  if (!banner) return null;
  const isCritical = banner.tone === "critical";
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-[13px]",
        isCritical
          ? "border-red-500/40 bg-red-500/10 text-red-200"
          : "border-amber-500/40 bg-amber-500/10 text-amber-200",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>{isCritical ? "⚠️" : "⚡"}</span>
        <span className="font-medium">{banner.message}</span>
      </div>
      <Link
        href={banner.actionHref}
        className={cn(
          "rounded-full px-3.5 py-1 text-xs font-semibold transition",
          isCritical
            ? "bg-red-500 text-white hover:bg-red-400"
            : "bg-amber-400 text-black hover:bg-amber-300",
        )}
      >
        {banner.actionLabel}
      </Link>
    </div>
  );
}

