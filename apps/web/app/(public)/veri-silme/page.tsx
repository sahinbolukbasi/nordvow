import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Veri silme" };
export const dynamic = "force-dynamic";

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ kod?: string }> }) {
  const kod = (await searchParams).kod?.slice(0, 40) ?? "";
  const known = kod ? await prisma.dataDeletionRequest.findUnique({ where: { code: kod }, select: { code: true, createdAt: true } }).catch(() => null) : null;
  return (
    <>
      {kod ? (
        <p role="status" className="mt-6 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] text-fg">
          {known
            ? `Onay kodu ${known.code} ile silme talebi alındı (${known.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}).`
            : "Bu onay kodu bulunamadı. Kodu kontrol edin veya root@nordvow.com adresine yazın."}
        </p>
      ) : null}
      <LegalPage id="deletion" current="/veri-silme" />
    </>
  );
}
