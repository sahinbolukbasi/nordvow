import type { AdminAiAnalytics } from "@infulancer/core/creative/ai-analytics";
import { Card, CardTitle } from "@/components/ui/card";

const usd = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const num = new Intl.NumberFormat("tr-TR");
const tryFmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });

export function AiUsageAnalyticsView({ data }: { data: AdminAiAnalytics }) {
  const maxProviderReq = Math.max(1, ...data.byProvider.map((p) => p.requests));
  const maxDailyReq = Math.max(1, ...data.daily.map((d) => d.requests));

  return (
    <div className="flex flex-col gap-5">
      {/* Özet KPI Kartları */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-[12px] text-fg-muted">Toplam AI İsteği</span>
          <span className="text-2xl font-bold tabular-nums text-fg">{num.format(data.totalRequests)}</span>
          <span className="text-[11px] text-fg-passive">Creative + LLM + Video Pipeline</span>
        </Card>
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-[12px] text-fg-muted">LLM Token Kullanımı</span>
          <span className="text-2xl font-bold tabular-nums text-fg">{num.format(data.totalTokens)}</span>
          <span className="text-[11px] text-fg-passive">AWS Bedrock girdi + çıktı token</span>
        </Card>
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-[12px] text-fg-muted">Harcanan Net Kredi</span>
          <span className="text-2xl font-bold tabular-nums text-fg">{tryFmt.format(data.totalCreditsSpentTry)}</span>
          <span className="text-[11px] text-fg-passive">İadeler düşülmüş net tahsilat</span>
        </Card>
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-[12px] text-fg-muted">Tahmini Sağlayıcı Maliyeti</span>
          <span className="text-2xl font-bold tabular-nums text-fg">{usd.format(data.totalCostUsd)}</span>
          <span className="text-[11px] text-fg-passive">fal.ai + Bedrock + Video Pipeline</span>
        </Card>
      </div>

      {/* Sağlayıcı Bazlı Dağılım & 14 Günlük Trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>Sağlayıcı Bazlı Kullanım & Maliyet</CardTitle>
          {data.byProvider.length === 0 ? (
            <p className="text-[13px] text-fg-muted">Henüz kaydedilmiş AI kullanımı yok.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.byProvider.map((p) => {
                const pct = Math.max(6, Math.round((p.requests / maxProviderReq) * 100));
                return (
                  <li key={p.provider} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-semibold uppercase text-fg">{p.provider}</span>
                      <span className="tabular-nums text-fg-muted">
                        {num.format(p.requests)} istek{p.tokens > 0 ? ` · ${num.format(p.tokens)} token` : ""} · {usd.format(p.costUsd)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-fg" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>Son 14 Günlük Kullanım Grafiği</CardTitle>
          <div className="flex h-36 items-end gap-1.5 pt-2">
            {data.daily.map((d) => {
              const hPct = d.requests > 0 ? Math.max(10, Math.round((d.requests / maxDailyReq) * 100)) : 3;
              return (
                <div key={d.day} className="group flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.requests} istek (${usd.format(d.costUsd)})`}>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-t-md transition-all ${d.requests > 0 ? "bg-fg" : "bg-line"}`}
                      style={{ height: `${hPct}%` }}
                    />
                  </div>
                  <span className="text-[9px] tabular-nums text-fg-passive">{d.day.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Model Bazlı Özet Tablosu */}
      {data.byModel.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>En Çok Kullanılan Modeller</CardTitle>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-surface text-left text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Sağlayıcı</th>
                  <th className="px-3 py-2 font-medium">İstek</th>
                  <th className="px-3 py-2 font-medium">Başarılı / Hata</th>
                  <th className="px-3 py-2 font-medium">Tahmini Maliyet</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((m) => (
                  <tr key={m.modelKey} className="border-t border-line">
                    <td className="px-3 py-2 font-medium text-fg">{m.modelKey}</td>
                    <td className="px-3 py-2 uppercase text-fg-muted">{m.provider}</td>
                    <td className="px-3 py-2 tabular-nums">{num.format(m.requests)}</td>
                    <td className="px-3 py-2 tabular-nums text-fg-muted">{m.completed} / {m.failed}</td>
                    <td className="px-3 py-2 tabular-nums">{usd.format(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

