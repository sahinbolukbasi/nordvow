import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedDmCampaignReport } from "@infulancer/core/dm-automation/store";

export const metadata: Metadata = {
  title: "DM Otomasyonu Kampanya Raporu · NordVow",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function SharedDmReportPage({
  params,
}: {
  params: Promise<{ shareSlug: string }>;
}) {
  const { shareSlug } = await params;
  const report = await getSharedDmCampaignReport(shareSlug);
  if (!report) notFound();

  return (
    <div className="min-h-dvh bg-bg px-4 py-10 text-fg">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-2xl border border-line bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-neon-cyan">
                NordVow · Paylaşılan Kampanya Raporu (Salt Okunur)
              </p>
              <h1 className="mt-1 text-2xl font-bold">{report.campaignName}</h1>
            </div>
            <span className="rounded-full border border-line bg-bg px-3 py-1 text-xs font-medium text-fg-muted">
              Durum: {report.status}
            </span>
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            KVKK uyumu gereği paylaşılan rapor yalnızca toplu istatistikleri içerir; yorum metni veya kullanıcı adı yer almaz.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-xs text-fg-muted">Eşleşen Yorum</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{report.funnel.triggers}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-xs text-fg-muted">Gönderilen DM</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-400">
              {report.funnel.sent}
            </div>
            <div className="mt-1 text-xs text-fg-muted">
              Başarı: %{report.funnel.deliveryRatePercent}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-xs text-fg-muted">Benzersiz Tıklama</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-neon-cyan">
              {report.funnel.uniqueClicks}
            </div>
            <div className="mt-1 text-xs text-fg-muted">CTR: %{report.funnel.ctrPercent}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-xs text-fg-muted">Kupon Kullanımı</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-neon-pink">
              {report.funnel.couponRedeemed}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold">Link Performansı</h2>
          {report.links.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Bu kampanyada takip edilen buton linki yok.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs text-fg-muted">
                  <tr>
                    <th className="py-2 pr-4">Buton / Etiket</th>
                    <th className="py-2 pr-4">Toplam Tıklama</th>
                    <th className="py-2">Benzersiz Tıklama</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.links.map((l, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pr-4 font-medium">{l.label ?? "Bağlantı"}</td>
                      <td className="py-2 pr-4 tabular-nums">{l.clicks}</td>
                      <td className="py-2 tabular-nums">{l.uniqueClicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

