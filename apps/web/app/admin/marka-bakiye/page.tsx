import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { formatKurus } from "@infulancer/core/domain/labels";
import { decideBrandTopupAction } from "@/lib/actions/brand-wallet";
import { PageHeader } from "@/components/ui/layout";
import { requireAdmin } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Marka bakiye talepleri" };
export const dynamic = "force-dynamic";

export default async function BrandWalletAdminPage() {
  await requireAdmin();
  const requests = await prisma.walletTopupRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { brand: { select: { name: true } } },
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Marka bakiye talepleri" description="Banka/EFT taleplerini onaylayın veya reddedin." />
      <div className="flex flex-col gap-3">
        {requests.map((request) => (
          <div key={request.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">{request.brand.name} · {formatKurus(request.amountKurus)}</p>
              <p className="text-sm text-fg-muted">{request.method}{request.reference ? ` · ${request.reference}` : ""}{request.note ? ` · ${request.note}` : ""}</p>
              <p className="text-xs text-fg-passive">{request.status}</p>
            </div>
            {request.status === "PENDING" ? (
              <div className="flex gap-2">
                <form action={async () => { await decideBrandTopupAction(request.id, true); }}><button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Onayla</button></form>
                <form action={async () => { await decideBrandTopupAction(request.id, false); }}><button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white">Reddet</button></form>
              </div>
            ) : null}
          </div>
        ))}
        {!requests.length ? <p className="text-sm text-fg-muted">Bekleyen marka bakiye talebi yok.</p> : null}
      </div>
    </div>
  );
}
