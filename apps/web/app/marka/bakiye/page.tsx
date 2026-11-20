import type { Metadata } from "next";
import { requireActor } from "@/lib/auth-guard";
import { getBrandWalletSummary, listBrandWalletEntries } from "@infulancer/core/finance/brand-wallet";
import { prisma } from "@infulancer/core/db";
import { formatKurus } from "@infulancer/core/domain/labels";
import { createWalletEntryInvoiceAction, requestBrandTopupAction } from "@/lib/actions/brand-wallet";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Marka bakiyesi" };
export const dynamic = "force-dynamic";

export default async function BrandWalletPage() {
  const actor = await requireActor("BRAND");
  if (!actor.brandId) return null;
  const [summary, entries, requests] = await Promise.all([
    getBrandWalletSummary(actor.brandId),
    listBrandWalletEntries(actor.brandId, 50),
    prisma.walletTopupRequest.findMany({ where: { brandId: actor.brandId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Marka bakiyesi" description="Creative Studio, influencer ödemeleri ve kargo harcamaları ortak bakiyeden düşer." />
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-sm text-fg-muted">Kullanılabilir bakiye</p>
        <p className="mt-1 text-3xl font-semibold">{formatKurus(summary.balanceKurus)}</p>
        <p className="mt-2 text-sm text-fg-muted">Bloke tutar: {formatKurus(summary.blockedKurus)}</p>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <span>Creative Studio: {formatKurus(summary.spendingKurus.CREATIVE_USAGE)}</span>
          <span>Influencer: {formatKurus(summary.spendingKurus.INFLUENCER_PAYMENT)}</span>
          <span>Kargo: {formatKurus(summary.spendingKurus.SHIPPING)}</span>
        </div>
      </section>
      <form action={async (formData) => { await requestBrandTopupAction({ ok: false }, formData); }} className="grid gap-3 rounded-2xl border border-line bg-surface p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 text-base font-semibold">Bakiye yükleme talebi</h2>
        <input name="amount" required placeholder="Tutar (TL)" className="h-10 rounded-lg border border-line bg-bg px-3" />
        <select name="method" className="h-10 rounded-lg border border-line bg-bg px-3">
          <option value="EFT_HAVALE">EFT / Havale</option>
          <option value="KART">Kart</option>
          <option value="DIGER">Diğer</option>
        </select>
        <input name="reference" placeholder="Dekont / işlem referansı" className="h-10 rounded-lg border border-line bg-bg px-3" />
        <input name="note" placeholder="Not" className="h-10 rounded-lg border border-line bg-bg px-3" />
        <button className="h-10 rounded-lg bg-fg px-4 text-sm font-semibold text-bg md:col-span-2">Talep oluştur</button>
      </form>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold">Bakiye hareketleri</h2>
        <div className="flex flex-col divide-y divide-line">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-3 text-sm">
              <span>{entry.note ?? entry.type}</span>
              <span className="flex items-center gap-3">
                <span className={entry.direction === "CREDIT" ? "text-emerald-500" : "text-red-400"}>
                  {entry.direction === "CREDIT" ? "+" : "-"}{formatKurus(entry.amountKurus)}
                </span>
                {entry.invoice ? <a className="text-xs underline" href={`/api/fatura/kayit/${entry.invoice.id}?download=1`}>Fatura</a> : (
                  <form action={async () => { await createWalletEntryInvoiceAction(entry.id); }}>
                    <button className="text-xs underline">Fatura oluştur</button>
                  </form>
                )}
              </span>
            </div>
          ))}
          {!entries.length ? <p className="text-sm text-fg-muted">Henüz hareket yok.</p> : null}
        </div>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold">Yükleme talepleri</h2>
        <div className="flex flex-col gap-2 text-sm">
          {requests.map((request) => <div key={request.id} className="flex justify-between"><span>{formatKurus(request.amountKurus)}</span><span>{request.status}</span></div>)}
          {!requests.length ? <p className="text-sm text-fg-muted">Henüz talep yok.</p> : null}
        </div>
      </section>
    </div>
  );
}
