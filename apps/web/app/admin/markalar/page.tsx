import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { DataTable } from "@/components/ui/data-table";
import { BrandDeleteButton, BrandToggleActiveButton } from "@/components/forms/brand-forms";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader, Stagger } from "@/components/ui/layout";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Markalar" };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const tt = await getTT();
  await requireActor("ADMIN");
  const { durum } = await searchParams;
  const statusTab = durum === "pasif" ? "pasif" : durum === "tumu" ? "tumu" : "aktif";
  const where = statusTab === "pasif" ? { isActive: false } : statusTab === "tumu" ? {} : { isActive: true };
  const [brands, activeCount, inactiveCount] = await Promise.all([
    prisma.brand.findMany({
      where,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        category: true,
        contactName: true,
        contactEmail: true,
        competitorBrandIds: true,
        _count: { select: { campaigns: true, users: true } },
      },
    }),
    prisma.brand.count({ where: { isActive: true } }),
    prisma.brand.count({ where: { isActive: false } }),
  ]);
  return (
    <Stagger className="flex flex-col gap-8">
      <PageHeader title={tt("Markalar")} description={tt("Vergi, sözleşme ve rakip bilgileri; marka kullanıcıları.")} actions={<ButtonLink href="/admin/markalar/yeni">{tt("Yeni marka")}</ButtonLink>} />
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={tt("Marka durumu")}>
        {(
          [
            ["aktif", `Aktif (${activeCount})`],
            ["pasif", `Pasif (${inactiveCount})`],
            ["tumu", `Tümü (${activeCount + inactiveCount})`],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/admin/markalar?durum=${key}`}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-standard ${
              statusTab === key
                ? "border-fg bg-fg text-bg"
                : "border-border text-fg-muted hover:border-fg/40 hover:text-fg"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <DataTable
        caption={tt("Markalar")}
        emptyText={tt("Henüz marka yok.")}
        initialSort={{ key: "name", dir: "asc" }}
        columns={[
          { key: "name", header: "Marka", sortable: true },
          { key: "category", header: "Kategori", sortable: true },
          { key: "contact", header: "Yetkili" },
          { key: "competitors", header: "Rakip", align: "right", sortable: true },
          { key: "campaigns", header: "Kampanya", align: "right", sortable: true },
          { key: "users", header: "Kullanıcı", align: "right", sortable: true },
          { key: "manage", header: "Yönetim" },
        ]}
        rows={brands.map((b) => ({
          id: b.id,
          cells: {
            name: {
              display: (
                <Link href={`/admin/markalar/${b.id}`} className="inline-flex flex-wrap items-center gap-1.5 text-fg hover:underline">
                  <span>{b.name}</span>
                  {!b.isActive ? (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      {tt("Pasif")}
                    </span>
                  ) : null}
                </Link>
              ),
              sort: b.name,
            },
            category: { display: b.category, sort: b.category },
            contact: (
              <span className="flex flex-col">
                <span>{b.contactName}</span>
                <span className="text-[12px] text-fg-passive">{b.contactEmail}</span>
              </span>
            ),
            competitors: { display: b.competitorBrandIds.length, sort: b.competitorBrandIds.length },
            campaigns: { display: b._count.campaigns, sort: b._count.campaigns },
            users: { display: b._count.users, sort: b._count.users },
            manage: {
              display: (
                <div className="flex flex-wrap items-center gap-1">
                  <BrandToggleActiveButton brandId={b.id} name={b.name} isActive={b.isActive} />
                  <BrandDeleteButton brandId={b.id} name={b.name} />
                </div>
              ),
            },
          },
          label: b.name,
          actions: [
            { label: "Profil ve geçmiş", href: `/admin/markalar/${b.id}`, icon: "open" },
            { label: "Yeni kampanya", href: `/admin/kampanyalar/yeni?marka=${b.id}`, icon: "plus" },
            { label: "Düzenle", href: `/admin/markalar/${b.id}/duzenle`, icon: "edit" },
          ],
        }))}
      />
    </Stagger>
  );
}
