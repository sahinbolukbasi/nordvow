import type { Metadata } from "next";
import Link from "next/link";
import { getTT } from "@/lib/i18n/tt-server";
import { prisma } from "@infulancer/core/db";
import { getConfig } from "@infulancer/core/config/store";
import { AGENCY_TENANT } from "@infulancer/core/creative/tenant";
import { currencyOf } from "@infulancer/core/i18n/regions";
import { requireAdmin } from "@/lib/auth-guard";
import { fmtDateTime } from "@/lib/time";
import { fmtTl } from "@/lib/creative-models";
import { SearchIcon } from "@/components/icons";
import { DataTable } from "@/components/ui/data-table";
import { ButtonLink, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { FilterTabs, Pill, StatStrip, type PillTone } from "@/components/luma/primitives";
import { CreditRowManager, StarterCreditsForm } from "@/components/admin/credit-management";

export const metadata: Metadata = { title: "Kredi yönetimi" };
export const dynamic = "force-dynamic";

type AccountKind = "ALL" | "BRAND" | "INFLUENCER" | "AGENCY";

const FILTERS: { id: string; kind: AccountKind; label: string }[] = [
  { id: "tumu", kind: "ALL", label: "Tümü" },
  { id: "markalar", kind: "BRAND", label: "Markalar" },
  { id: "influencerlar", kind: "INFLUENCER", label: "Influencerlar" },
  { id: "ajans", kind: "AGENCY", label: "Ajans" },
];

const KIND_LABEL: Record<Exclude<AccountKind, "ALL">, string> = {
  BRAND: "Marka",
  INFLUENCER: "Influencer",
  AGENCY: "Ajans",
};

const KIND_TONE: Record<Exclude<AccountKind, "ALL">, PillTone> = {
  BRAND: "violet",
  INFLUENCER: "green",
  AGENCY: "gray",
};

export default async function CreditsManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string; q?: string }>;
}) {
  const tt = await getTT();
  await requireAdmin();
  const sp = await searchParams;
  const activeFilter = FILTERS.find((f) => f.id === sp.tur) ?? FILTERS[0]!;
  const q = sp.q?.trim().slice(0, 80) || "";

  const [starterCreditsTry, brands, influencers, accounts, users] = await Promise.all([
    getConfig("creative.starterCreditsTry"),
    prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, country: true, contactEmail: true } }),
    prisma.influencer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, country: true } }),
    prisma.creditAccount.findMany(),
    prisma.user.findMany({
      where: { OR: [{ brandId: { not: null } }, { influencerId: { not: null } }] },
      select: { email: true, brandId: true, influencerId: true },
    }),
  ]);

  const accountByTenant = new Map(accounts.map((a) => [a.tenantId, a]));
  const emailsByTenant = new Map<string, string[]>();
  for (const u of users) {
    const tid = u.brandId ?? u.influencerId;
    if (!tid) continue;
    const list = emailsByTenant.get(tid) ?? [];
    list.push(u.email);
    emailsByTenant.set(tid, list);
  }

  type RowItem = {
    tenantId: string;
    name: string;
    kind: Exclude<AccountKind, "ALL">;
    emails: string[];
    href?: string;
    currency: string;
    balance: number;
    held: number;
    available: number;
    hasAccount: boolean;
    updatedAt: Date | null;
  };

  const agencyAcc = accountByTenant.get(AGENCY_TENANT);
  const allRows: RowItem[] = [
    {
      tenantId: AGENCY_TENANT,
      name: "Ajans Stüdyosu",
      kind: "AGENCY",
      emails: [],
      currency: agencyAcc?.currency ?? "TRY",
      balance: Number(agencyAcc?.balanceCredits ?? 0),
      held: Number(agencyAcc?.heldCredits ?? 0),
      available: Number(agencyAcc?.balanceCredits ?? 0) - Number(agencyAcc?.heldCredits ?? 0),
      hasAccount: !!agencyAcc,
      updatedAt: agencyAcc?.updatedAt ?? null,
    },
    ...brands.map((b): RowItem => {
      const acc = accountByTenant.get(b.id);
      const balance = Number(acc?.balanceCredits ?? 0);
      const held = Number(acc?.heldCredits ?? 0);
      return {
        tenantId: b.id,
        name: b.name,
        kind: "BRAND",
        emails: emailsByTenant.get(b.id) ?? (b.contactEmail ? [b.contactEmail] : []),
        href: `/admin/markalar/${b.id}`,
        currency: acc?.currency ?? currencyOf(b.country),
        balance,
        held,
        available: balance - held,
        hasAccount: !!acc,
        updatedAt: acc?.updatedAt ?? null,
      };
    }),
    ...influencers.map((i): RowItem => {
      const acc = accountByTenant.get(i.id);
      const balance = Number(acc?.balanceCredits ?? 0);
      const held = Number(acc?.heldCredits ?? 0);
      return {
        tenantId: i.id,
        name: i.name,
        kind: "INFLUENCER",
        emails: emailsByTenant.get(i.id) ?? [],
        href: `/admin/influencerlar/${i.id}`,
        currency: acc?.currency ?? currencyOf(i.country),
        balance,
        held,
        available: balance - held,
        hasAccount: !!acc,
        updatedAt: acc?.updatedAt ?? null,
      };
    }),
  ];

  const counts: Record<string, number> = {
    tumu: allRows.length,
    markalar: allRows.filter((r) => r.kind === "BRAND").length,
    influencerlar: allRows.filter((r) => r.kind === "INFLUENCER").length,
    ajans: allRows.filter((r) => r.kind === "AGENCY").length,
  };

  const qLower = q.toLocaleLowerCase("tr");
  const filtered = allRows.filter((r) => {
    if (activeFilter.kind !== "ALL" && r.kind !== activeFilter.kind) return false;
    if (!qLower) return true;
    return (
      r.name.toLocaleLowerCase("tr").includes(qLower) ||
      r.emails.some((e) => e.toLocaleLowerCase("tr").includes(qLower))
    );
  });

  const tryRows = allRows.filter((r) => r.currency === "TRY");
  const totalTryBalance = tryRows.reduce((s, r) => s + r.balance, 0);
  const totalTryHeld = tryRows.reduce((s, r) => s + r.held, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tt("Kredi yönetimi")}
        description={tt("Yeni gelen kullanıcılara verilen hoş geldin kredisini ayarlayın ve tüm hesapların kredilerini tablodan yönetin.")}
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/admin/kullanicilar" variant="secondary">
              {tt("Kullanıcılar")}
            </ButtonLink>
            <ButtonLink href="/admin/bakiye-talepleri" variant="secondary">
              {tt("Bakiye talepleri")}
            </ButtonLink>
          </div>
        }
      />

      <StatStrip
        stats={[
          { label: "Toplam hesap", value: String(allRows.length) },
          { label: "Açılmış kredi hesabı", value: String(allRows.filter((r) => r.hasAccount).length) },
          { label: "Toplam bakiye (TRY)", value: fmtTl(totalTryBalance) },
          { label: "Blokede (TRY)", value: fmtTl(totalTryHeld) },
          { label: "Hoş geldin kredisi", value: fmtTl(starterCreditsTry) },
        ]}
      />

      <section className="rounded-2xl border border-line bg-surface p-5">
        <StarterCreditsForm defaultValue={starterCreditsTry} />
      </section>

      <div className="flex flex-col gap-3">
        <FilterTabs
          active={activeFilter.id}
          items={FILTERS.map((f) => ({
            id: f.id,
            label: f.label,
            href: q ? `/admin/krediler?tur=${f.id}&q=${encodeURIComponent(q)}` : `/admin/krediler?tur=${f.id}`,
            count: counts[f.id],
          }))}
        />

        <form method="get" className="relative max-w-sm" role="search">
          {activeFilter.id !== "tumu" ? <input type="hidden" name="tur" value={activeFilter.id} /> : null}
          <label className="sr-only" htmlFor="credit-q">
            {tt("Hesap veya e-posta ara")}
          </label>
          <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-passive" />
          <Input id="credit-q" name="q" defaultValue={q} placeholder={tt("Hesap veya e-posta ara")} className="pl-9" />
        </form>
      </div>

      <DataTable
        caption={tt("Tüm hesapların kredi bakiyeleri")}
        emptyText={tt("Bu filtreyle eşleşen hesap bulunamadı.")}
        columns={[
          { key: "name", header: "Hesap / Kullanıcı", sortable: true },
          { key: "kind", header: "Tür", sortable: true },
          { key: "balance", header: "Mevcut bakiye", sortable: true, align: "right" },
          { key: "held", header: "Blokede", sortable: true, align: "right" },
          { key: "available", header: "Kullanılabilir", sortable: true, align: "right" },
          { key: "updated", header: "Son güncelleme", sortable: true },
          { key: "manage", header: "Yönet" },
        ]}
        rows={filtered.map((r) => ({
          id: r.tenantId,
          label: r.name,
          cells: {
            name: {
              display: (
                <div className="flex flex-col gap-0.5">
                  {r.href ? (
                    <Link href={r.href} className="font-medium text-fg hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-fg">{r.name}</span>
                  )}
                  {r.emails.length ? (
                    <span className="text-[12px] text-fg-muted">{r.emails.join(", ")}</span>
                  ) : null}
                </div>
              ),
              sort: r.name,
            },
            kind: {
              display: <Pill tone={KIND_TONE[r.kind]}>{tt(KIND_LABEL[r.kind])}</Pill>,
              sort: r.kind,
            },
            balance: {
              display: (
                <span className="tabular-nums font-medium text-fg">
                  {fmtTl(r.balance, r.currency)}
                </span>
              ),
              sort: r.balance,
            },
            held: {
              display: (
                <span className="tabular-nums text-fg-muted">
                  {r.held ? fmtTl(r.held, r.currency) : "—"}
                </span>
              ),
              sort: r.held,
            },
            available: {
              display: (
                <span className="tabular-nums font-semibold text-fg">
                  {fmtTl(r.available, r.currency)}
                </span>
              ),
              sort: r.available,
            },
            updated: {
              display: r.updatedAt ? (
                <span className="text-[12px] text-fg-muted">{fmtDateTime(r.updatedAt)}</span>
              ) : (
                <span className="text-[12px] text-fg-passive">{tt("Henüz açılmadı")}</span>
              ),
              sort: r.updatedAt ? r.updatedAt.getTime() : 0,
            },
            manage: {
              display: <CreditRowManager tenantId={r.tenantId} name={r.name} currentBalance={r.balance} />,
            },
          },
        }))}
      />
    </div>
  );
}
