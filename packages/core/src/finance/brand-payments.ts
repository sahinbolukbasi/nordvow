import { randomUUID } from "node:crypto";
import { prisma } from "../db";

export type BrandPaymentNotice = {
  id: string;
  campaignId: string;
  campaignName: string;
  amountKurus: number;
  currency: string;
  method: "EFT_HAVALE" | "KART" | "DIGER";
  reference: string;
  note: string | null;
  submittedByUserId: string;
  submittedByName: string;
  createdAt: string;
};

const noticeKey = (brandId: string) => `brand_payment_notices:${brandId}`;

export async function listBrandPaymentNotices(brandId: string): Promise<BrandPaymentNotice[]> {
  const row = await prisma.configValue.findUnique({ where: { key: noticeKey(brandId) } });
  return Array.isArray(row?.value) ? (row.value as BrandPaymentNotice[]) : [];
}

export async function submitBrandPaymentNotice(
  brandId: string,
  input: Omit<BrandPaymentNotice, "id" | "createdAt">,
): Promise<BrandPaymentNotice> {
  const existing = await listBrandPaymentNotices(brandId);
  const record: BrandPaymentNotice = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await prisma.configValue.upsert({
    where: { key: noticeKey(brandId) },
    create: { key: noticeKey(brandId), value: [record, ...existing] as unknown as object },
    update: { value: [record, ...existing] as unknown as object },
  });
  return record;
}

