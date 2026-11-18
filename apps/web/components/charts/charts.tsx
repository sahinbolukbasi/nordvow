/**
 * Elle yazılmış SVG grafikler (sunucuda render edilir, bağımlılık yok).
 * Renk yok: çizgi ve çubuklar metin rengi tonlarıyla çizilir.
 */

export type ChartPoint = { label: string; value: number };

const W = 480;
const H = 160;
const PAD = { top: 14, right: 14, bottom: 26, left: 56 };
const intFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

function bounds(values: number[]) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  return { min, max: max === min ? min + 1 : max };
}

function shouldShowTick(idx: number, total: number): boolean {
  if (total <= 7) return true;
  const step = Math.ceil(total / 6);
  return idx === 0 || idx === total - 1 || idx % step === 0;
}

/** Çizgi grafik: x ekseninde seyreltilmiş etiketler, y'de ayırt edilebilir min/max kılavuzu. */
export function LineChart({ points, format, label }: { points: ChartPoint[]; format: (v: number) => string; label: string }) {
  if (points.length < 2) return <p className="text-[13px] text-fg-passive">Grafik için en az iki ölçüm gerekir.</p>;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  const min = lo - span * 0.1;
  const max = hi + span * 0.1;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * iw;
  const y = (v: number) => PAD.top + ih - ((v - min) / (max - min)) * ih;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  // İki uç aynı kısa metne yuvarlanıyorsa (ör. 225,5 bin / 225,5 bin) tam sayı göster.
  const sameFormatted = format(hi) === format(lo) && hi !== lo;
  const fmtY = (v: number) => (sameFormatted ? intFmt.format(Math.round(v)) : format(v));

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-fg" role="img" aria-label={`${label}: ${points.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
        {[hi, lo].map((v, idx) => (
          <g key={`${v}-${idx}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeDasharray="2 4" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--color-fg-passive)">
              {fmtY(v)}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={x(i)} cy={y(p.value)} r={2.5} fill="currentColor">
              <title>{`${p.label}: ${fmtY(p.value)}`}</title>
            </circle>
            {shouldShowTick(i, points.length) ? (
              <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-fg-passive)">
                {p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}

/** Dikey çubuk grafik (pozitif ve negatif değerleri destekler). */
export function BarChart({ bars, format, label }: { bars: ChartPoint[]; format: (v: number) => string; label: string }) {
  if (bars.length === 0) return <p className="text-[13px] text-fg-passive">Henüz ölçüm yok.</p>;
  const { min, max } = bounds(bars.map((b) => b.value));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / bars.length;
  const bw = Math.min(32, slot * 0.6);
  const y = (v: number) => PAD.top + ih - ((v - min) / (max - min)) * ih;
  const zeroY = y(0);

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}: ${bars.map((b) => `${b.label} ${format(b.value)}`).join(", ")}`}>
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="var(--color-border)" />
        <text x={PAD.left - 8} y={y(max) + 4} textAnchor="end" fontSize={10} fill="var(--color-fg-passive)">
          {format(max)}
        </text>
        {min < 0 ? (
          <text x={PAD.left - 8} y={y(min) + 4} textAnchor="end" fontSize={10} fill="var(--color-fg-passive)">
            {format(min)}
          </text>
        ) : null}
        {bars.map((b, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const isNeg = b.value < 0;
          const top = isNeg ? zeroY : y(b.value);
          const height = Math.max(Math.abs(y(b.value) - zeroY), 1.5);
          return (
            <g key={`${b.label}-${i}`}>
              <rect
                x={cx - bw / 2}
                y={top}
                width={bw}
                height={height}
                rx={2}
                fill={isNeg ? "var(--color-critical, #e11d48)" : "var(--color-fg-muted)"}
              >
                <title>{`${b.label}: ${format(b.value)}`}</title>
              </rect>
              {shouldShowTick(i, bars.length) ? (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-fg-passive)">
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
