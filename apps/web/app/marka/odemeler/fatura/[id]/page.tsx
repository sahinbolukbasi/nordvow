import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { formatKurus } from "@infulancer/core/domain/labels";
import { PrintInvoiceButton } from "@/components/finance/brand-payments-client";
import { requireActor } from "@/lib/auth-guard";
import { BRAND_NAME } from "@/lib/brand";
import { getTT } from "@/lib/i18n/tt-server";
import { fmtDate } from "@/lib/time";

export const metadata: Metadata = { title: "Kampanya Faturası" };
export const dynamic = "force-dynamic";

function fmtAmount(kurus: number, currency: string) {
  if (!currency || currency === "TRY") return formatKurus(kurus);
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(kurus / 100);
}

export default async function BrandCampaignInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, brandId: actor.brandId!, status: { not: "IPTAL" } },
    include: {
      brand: true,
      assignments: {
        where: { contractStatus: { not: "RED" } },
        include: { influencer: { select: { name: true } } },
      },
    },
  });

  if (!campaign) notFound();

  const totalFee = Number(campaign.brandTotalFeeKurus);
  const budget = Number(campaign.budgetKurus);
  const invoiceNo = `INV-${campaign.id.slice(-8).toUpperCase()}`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/marka/odemeler" className="text-[13px] font-medium text-fg-muted hover:text-fg">
          ← {tt("Ödemeler & Faturalar")}
        </Link>
        <PrintInvoiceButton />
      </div>

      <div className="flex flex-col gap-6 rounded-2xl border border-line bg-surface p-6 sm:p-8 print:border-0 print:bg-white print:text-black">
        <header className="flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-start">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-fg-muted">{BRAND_NAME}</p>
            <h1 className="mt-1 text-[22px] font-bold text-fg">{tt("Kampanya Fatura Özeti")}</h1>
            <p className="mt-1 font-mono text-[13px] text-fg-muted">{invoiceNo}</p>
          </div>
          <div className="text-left sm:text-right">
            <span
              className={
                campaign.brandPaymentReceivedAt
                  ? "inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-[12px] font-semibold text-emerald-400"
                  : "inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-[12px] font-semibold text-amber-300"
              }
            >
              {campaign.brandPaymentReceivedAt ? tt("Ödendi") : tt("Ödeme Bekleniyor")}
            </span>
            <p className="mt-2 text-[12px] text-fg-muted">
              {tt("Düzenleme")}: {fmtDate(campaign.createdAt)}
            </p>
            {campaign.brandPaymentReceivedAt ? (
              <p className="text-[12px] text-fg-muted">
                {tt("Ödeme Tarihi")}: {fmtDate(campaign.brandPaymentReceivedAt)}
              </p>
            ) : null}
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{tt("Fatura Edilen Marka")}</h2>
            <p className="mt-1 font-semibold text-fg">{campaign.brand.name}</p>
            <p className="text-[13px] text-fg-muted">
              {tt("Vergi Dairesi")}: {campaign.brand.taxOffice} · {tt("VKN")}: {campaign.brand.taxNumber}
            </p>
            <p className="text-[13px] text-fg-muted">{campaign.brand.contactEmail}</p>
          </div>
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{tt("Kampanya Detayı")}</h2>
            <p className="mt-1 font-semibold text-fg">{campaign.name}</p>
            <p className="text-[13px] text-fg-muted">
              {fmtDate(campaign.startsAt)} – {fmtDate(campaign.endsAt)}
            </p>
            <p className="text-[13px] text-fg-muted">
              {campaign.assignments.length} {tt("influencer ataması")}
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-bg text-[11px] uppercase text-fg-muted">
              <tr>
                <th className="px-4 py-2.5">{tt("Kalem")}</th>
                <th className="px-4 py-2.5 text-right">{tt("Tutar")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-4 py-3 text-fg">
                  {campaign.name} — {tt("Kampanya Bütçesi")}
                </td>
                <td className="px-4 py-3 text-right font-mono text-fg">{fmtAmount(budget, campaign.currency)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-fg">{tt("Toplam Ödenecek Marka Bedeli")}</td>
                <td className="px-4 py-3 text-right font-mono text-[15px] font-bold text-fg">
                  {fmtAmount(totalFee, campaign.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

