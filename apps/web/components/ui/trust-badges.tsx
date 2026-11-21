import type { Compliance23AStatus } from "@infulancer/core/domain/compliance-23a";
import { cn } from "@/lib/cn";

export type MetricOrigin = "API" | "KOD" | "TAHMIN" | "BEYAN" | "MARKA" | "SISTEM";

const ORIGIN_META: Record<MetricOrigin, { label: string; tip: string; cls: string }> = {
  API: {
    label: "API",
    tip: "Resmî platform API verisi",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  KOD: {
    label: "Kod / UTM",
    tip: "Kupon kodu veya UTM bağlantı ölçümü",
    cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  MARKA: {
    label: "Marka",
    tip: "Marka / sözleşme finansal kaydı",
    cls: "border-border bg-surface-muted text-fg-muted",
  },
  BEYAN: {
    label: "Beyan",
    tip: "İçerik üreticisinin kendi beyanı",
    cls: "border-border bg-surface-muted text-fg-muted",
  },
  TAHMIN: {
    label: "Tahmin",
    tip: "Doğrudan ölçüm yerine model tahmini",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  SISTEM: {
    label: "Sistem",
    tip: "Otomatik metin / kural kontrolü",
    cls: "border-border bg-surface-muted text-fg-muted",
  },
};

export function KaynakRozeti({
  source,
  tooltip,
  className,
}: {
  source: MetricOrigin;
  tooltip?: string;
  className?: string;
}) {
  const m = ORIGIN_META[source];
  return (
    <span
      title={tooltip ?? m.tip}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide",
        m.cls,
        className,
      )}
    >
      {m.label}
    </span>
  );
}

export function BosDurum({
  neden,
  alt,
  className,
}: {
  neden: string;
  alt?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-sm font-medium text-fg-muted">—</span>
      <span className="text-[11px] leading-snug text-fg-passive">{neden}</span>
      {alt ? <span className="text-[11px] text-fg-passive">{alt}</span> : null}
    </div>
  );
}

const TRUST_META: Record<"YUKSEK" | "ORTA" | "DUSUK", { label: string; cls: string }> = {
  YUKSEK: {
    label: "Yüksek güven",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  ORTA: {
    label: "Orta güven",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  DUSUK: {
    label: "Düşük güven",
    cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

export function GuvenRozeti({
  level,
  className,
}: {
  level: "YUKSEK" | "ORTA" | "DUSUK";
  className?: string;
}) {
  const m = TRUST_META[level];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", m.cls, className)}>
      {m.label}
    </span>
  );
}

const C23A_META: Record<Compliance23AStatus, { label: string; cls: string }> = {
  UYUMLU: {
    label: "23/A Uyumlu",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  EKSIK: {
    label: "23/A Eksik",
    cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  SUPHELI: {
    label: "23/A Şüpheli",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  BEKLIYOR: {
    label: "Yayın bekleniyor",
    cls: "border-border bg-surface-muted text-fg-muted",
  },
};

export function Uyumluluk23ARozeti({
  status,
  reason,
  className,
}: {
  status: Compliance23AStatus;
  reason?: string;
  className?: string;
}) {
  const m = C23A_META[status];
  return (
    <span
      title={reason}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", m.cls, className)}
    >
      {m.label}
    </span>
  );
}

