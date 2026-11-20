import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { formatKurus } from "@infulancer/core/domain/labels";
import { listBrandPaymentNotices } from "@infulancer/core/finance/brand-payments";
import { BrandPaymentAction } from "@/components/finance/brand-payments-client";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader, Stagger } from "@/components/ui/layout";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusDot } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import { requireActor } from "@/lib/auth-guard";
import { getTT } from "@/lib/i18n/tt-server";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Ödemeler & Faturalar" };
export const dynamic = "force-dynamic";

function fmtAmount(kurus: number, currency: string) {
  if (!currency || currency === "TRY") return formatKurus(kurus);
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(kurus / 100);
}

const methodLabels: Record<string, string> = {
  EFT_HAVALE: "EFT / Havale",
  KART: "Kredi / Banka Kartı",
  DIGER: "Diğer",
};

export default async function BrandPaymentsPage() {
  const tt = await getTT();
  const actor = await requireActor("BRAND");

  const [brand, campaigns, notices] = await Promise.all([
    prisma.brand.findUnique({
      where: { id: actor.brandId! },
      select: {
        id: true,
        name: true,
        taxOffice: true,
        taxNumber: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
      },
    }),
    prisma.campaign.findMany({
      where: { brandId: actor.brandId!, status: { not: "IPTAL" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        budgetKurus: true,
        brandTotalFeeKurus: true,
        currency: true,
        startsAt: true,
        endsAt: true,
        closedAt: true,
        brandPaymentReceivedAt: true,
        assignments: {
          where: { contractStatus: { not: "RED" } },
          select: { id: true },
        },
      },
    }),
    listBrandPaymentNotices(actor.brandId!),
  ]);

  if (!brand) notFound();

  const unpaid = campaigns.filter((c) => !c.brandPaymentReceivedAt);
  const paid = campaigns.filter((c) => !!c.brandPaymentReceivedAt);

  const unpaidTotal = unpaid.reduce((s, c) => s + Number(c.brandTotalFeeKurus), 0);
  const paidTotal = paid.reduce((s, c) => s + Number(c.brandTotalFeeKurus), 0);

  const noticeByCampaign = new Map<string, (typeof notices)[number]>();
  for (const n of notices) {
    if (!noticeByCampaign.has(n.campaignId)) noticeByCampaign.set(n.campaignId, n);
  }

  const unpaidTab = (
    <DataTable
      caption={tt("Ödenecek kampanya ücretleri")}
      emptyText={tt("Ödenmesi gereken bekleyen kampanya faturanız bulunmuyor.")}
      columns={[
        { key: "campaign", header: "Kampanya", sortable: true },
        { key: "period", header: "Dönem", sortable: true },
        { key: "status", header: "Durum", sortable: true },
        { key: "fee", header: "Ödenecek tutar", align: "right", sortable: true },
        { key: "invoice", header: "Fatura" },
        { key: "action", header: "Ödeme", align: "right" },
      ]}
      rows={unpaid.map((c) => {
        const fee = Number(c.brandTotalFeeKurus);
        const amountLabel = fmtAmount(fee, c.currency);
        const lastNotice = noticeByCampaign.get(c.id);
        return {
          id: c.id,
          label: c.name,
          cells: {
            campaign: {
              display: (
                <div className="flex flex-col">
                  <Link href={`/marka/kampanyalar/${c.id}`} className="font-medium text-fg hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-[11px] text-fg-passive">
                    {c.assignments.length} {tt("influencer ataması")}
                  </span>
                </div>
              ),
              sort: c.name,
            },
            period: {
              display: `${fmtDate(c.startsAt)} – ${fmtDate(c.endsAt)}`,
              sort: c.startsAt.getTime(),
            },
            status: {
              display: lastNotice ? (
                <StatusDot tone="muted">
                  {tt("Bildirildi")} ({fmtDate(new Date(lastNotice.createdAt))})
                </StatusDot>
              ) : c.status === "KAPANDI" ? (
                <StatusDot tone="critical">{tt("Ödeme bekliyor")}</StatusDot>
              ) : c.status === "TASLAK" ? (
                <StatusDot tone="muted">{tt("Taslak")}</StatusDot>
              ) : (
                <StatusDot tone="muted">{tt("Kampanya aktif")}</StatusDot>
              ),
              sort: lastNotice ? 1 : c.status === "KAPANDI" ? 0 : 2,
            },
            fee: {
              display: <span className="font-semibold text-fg">{amountLabel}</span>,
              sort: fee,
            },
            invoice: {
              display: (
                <Link
                  href={`/marka/odemeler/fatura/${c.id}`}
                  className="inline-flex h-8 items-center rounded-[8px] border border-border px-2.5 text-[12px] font-medium text-fg hover:border-border-strong"
                >
                  {tt("Fatura Görüntüle")}
                </Link>
              ),
            },
            action: {
              display: (
                <BrandPaymentAction
                  campaignId={c.id}
                  campaignName={c.name}
                  amountLabel={amountLabel}
                  hasNotice={!!lastNotice}
                />
              ),
            },
          },
        };
      })}
    />
  );

  const historyTab = (
    <div className="flex flex-col gap-6">
      <DataTable
        caption={tt("Ödenmiş kampanya faturaları")}
        emptyText={tt("Henüz tamamlanmış kampanya ödemeniz yok.")}
        columns={[
          { key: "campaign", header: "Kampanya", sortable: true },
          { key: "fee", header: "Ödenen tutar", align: "right", sortable: true },
          { key: "paidAt", header: "Ödeme tarihi", sortable: true },
          { key: "status", header: "Durum" },
          { key: "invoice", header: "Fatura", align: "right" },
        ]}
        rows={paid.map((c) => {
          const fee = Number(c.brandTotalFeeKurus);
          return {
            id: c.id,
            label: c.name,
            cells: {
              campaign: {
                display: (
                  <Link href={`/marka/kampanyalar/${c.id}`} className="font-medium text-fg hover:underline">
                    {c.name}
                  </Link>
                ),
                sort: c.name,
              },
              fee: { display: fmtAmount(fee, c.currency), sort: fee },
              paidAt: {
                display: c.brandPaymentReceivedAt ? fmtDate(c.brandPaymentReceivedAt) : "—",
                sort: c.brandPaymentReceivedAt?.getTime() ?? 0,
              },
              status: { display: <StatusDot tone="active">{tt("Ödendi")}</StatusDot> },
              invoice: {
                display: (
                  <Link
                    href={`/marka/odemeler/fatura/${c.id}`}
                    className="inline-flex h-8 items-center rounded-[8px] border border-border px-2.5 text-[12px] font-medium text-fg hover:border-border-strong"
                  >
                    {tt("Fatura Görüntüle")}
                  </Link>
                ),
              },
            },
          };
        })}
      />

      {notices.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Gönderilen Ödeme Bildirimleri")}</CardTitle>
          <DataTable
            caption={tt("Ödeme bildirimleri")}
            emptyText={tt("Bildirim yok.")}
            columns={[
              { key: "date", header: "Tarih", sortable: true },
              { key: "campaign", header: "Kampanya", sortable: true },
              { key: "method", header: "Yöntem" },
              { key: "reference", header: "Dekont / Referans" },
              { key: "amount", header: "Tutar", align: "right" },
            ]}
            rows={notices.map((n) => ({
              id: n.id,
              cells: {
                date: { display: fmtDateTime(new Date(n.createdAt)), sort: new Date(n.createdAt).getTime() },
                campaign: { display: n.campaignName, sort: n.campaignName },
                method: { display: tt(methodLabels[n.method] ?? n.method) },
                reference: {
                  display: (
                    <div className="flex flex-col">
                      <span className="font-mono text-[12px]">{n.reference}</span>
                      {n.note ? <span className="text-[11px] text-fg-passive">{n.note}</span> : null}
                    </div>
                  ),
                },
                amount: { display: fmtAmount(n.amountKurus, n.currency), sort: n.amountKurus },
              },
            }))}
          />
        </Card>
      ) : null}
    </div>
  );

  const billingTab = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Marka Fatura Bilgileri")}</CardTitle>
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
          <dt className="text-fg-muted">{tt("Ünvan")}</dt>
          <dd className="font-medium text-fg">{brand.name}</dd>
          <dt className="text-fg-muted">{tt("Vergi Dairesi")}</dt>
          <dd className="text-fg">{brand.taxOffice || "—"}</dd>
          <dt className="text-fg-muted">{tt("Vergi No")}</dt>
          <dd className="font-mono text-fg">{brand.taxNumber || "—"}</dd>
          <dt className="text-fg-muted">{tt("Yetkili")}</dt>
          <dd className="text-fg">{brand.contactName || "—"}</dd>
          <dt className="text-fg-muted">{tt("E-posta")}</dt>
          <dd className="text-fg">{brand.contactEmail || "—"}</dd>
          <dt className="text-fg-muted">{tt("Telefon")}</dt>
          <dd className="text-fg">{brand.contactPhone || "—"}</dd>
        </dl>
      </Card>
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Ödeme & Faturalandırma Süreci")}</CardTitle>
        <ul className="flex list-disc flex-col gap-2 pl-4 text-[13px] text-fg-muted">
          <li>{tt("Bu ekran üzerinden oluşturduğunuz kampanyaların toplam ücretlerini ve faturalarını görüntüleyebilirsiniz.")}</li>
          <li>{tt("Ödeme yaptıktan sonra \"Ödeme Yap / Bildir\" butonundan dekont veya işlem referans numaranızı iletebilirsiniz.")}</li>
          <li>{tt("Finans ekibi ödemeyi onayladığında kampanya faturanız \"Ödendi\" durumuna geçer.")}</li>
        </ul>
      </Card>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tt("Ödemeler & Faturalar")}
        description={tt("Oluşturduğunuz kampanyaların ödenecek ücretlerini ve faturalarını yönetin.")}
      />

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={tt("Ödenecek Toplam")}
          value={unpaidTotal}
          format="currency-kurus"
          hint={`${unpaid.length} ${tt("kampanya")}`}
        />
        <MetricCard
          label={tt("Ödenen Toplam")}
          value={paidTotal}
          format="currency-kurus"
          hint={`${paid.length} ${tt("kampanya")}`}
        />
        <MetricCard label={tt("Bekleyen Fatura")} value={unpaid.length} />
        <MetricCard label={tt("Ödenen Fatura")} value={paid.length} />
      </Stagger>

      <Tabs
        label={tt("Ödeme ve fatura sekmeleri")}
        defaultTab="odenecek"
        tabs={[
          { id: "odenecek", label: `${tt("Ödenecekler")} (${unpaid.length})`, content: unpaidTab },
          { id: "gecmis", label: `${tt("Ödeme Geçmişi & Faturalar")} (${paid.length})`, content: historyTab },
          { id: "bilgiler", label: tt("Fatura Bilgileri"), content: billingTab },
        ]}
      />
    </div>
  );
}
