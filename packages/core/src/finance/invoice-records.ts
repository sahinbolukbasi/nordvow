import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { DEFAULT_SATICI_SETTINGS } from "./earsiv-invoice";
import { DomainError } from "../domain/errors";

export async function createBrandInvoiceForWalletEntry(input: {
  walletEntryId: string;
  createdById?: string | null;
  description?: string;
  vatRate?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.brandWalletEntry.findUnique({
      where: { id: input.walletEntryId },
      include: { brand: true, invoice: true },
    });
    if (!entry) throw new DomainError("BULUNAMADI", "Bakiye hareketi bulunamadı.");
    if (entry.invoice) return entry.invoice;

    const address = await tx.brandAddress.findFirst({
      where: { brandId: entry.brandId, isBilling: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!address) {
      throw new DomainError("DOGRULAMA", "Fatura oluşturmak için markanın fatura adresi eksik.");
    }

    const vatRate = input.vatRate ?? 20;
    const gross = entry.amountKurus;
    const net = Math.round(gross / (1 + vatRate / 100));
    const vat = gross - net;
    const ettn = randomUUID();
    const year = new Date().getFullYear();
    const sequence = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "invoice_sequences" ("year", "next_value", "updated_at")
      VALUES (${year}, 2, NOW())
      ON CONFLICT ("year") DO UPDATE
      SET "next_value" = "invoice_sequences"."next_value" + 1,
          "updated_at" = NOW()
      RETURNING "next_value" - 1 AS value
    `;
    const sequenceValue = sequence[0]?.value;
    if (!sequenceValue) throw new DomainError("SUNUCU_HATASI", "Fatura sıra numarası üretilemedi.");
    const invoiceNumber = `NRD${year}${String(sequenceValue).padStart(9, "0")}`;
    const invoice = await tx.invoice.create({
      data: {
        brandId: entry.brandId,
        status: "GENERATED",
        scenario: "EARSIVFATURA",
        invoiceType: "SATIS",
        invoiceNumber,
        ettn,
        issuedAt: new Date(),
        sellerSnapshot: { ...DEFAULT_SATICI_SETTINGS },
        buyerSnapshot: {
          unvan: address.companyName ?? entry.brand.name,
          adres: address.addressLine,
          mahalle: address.neighborhood,
          ilce: address.district,
          il: address.city,
          postaKodu: address.postalCode,
          telefon: address.phone,
          vergiDairesi: address.taxOffice ?? entry.brand.taxOffice,
          vergiNo: address.taxNumber ?? entry.brand.taxNumber,
        },
        totalsSnapshot: {
          matrahKurus: net,
          vatKurus: vat,
          totalKurus: gross,
          vatRate,
        },
        sourceType: "BrandWalletEntry",
        sourceId: entry.id,
        createdById: input.createdById ?? null,
        items: {
          create: {
            lineNumber: 1,
            description: input.description ?? entry.note ?? entry.type,
            quantity: 1,
            unitPriceKurus: net,
            vatRate,
            vatAmountKurus: vat,
            lineTotalKurus: net,
          },
        },
      },
    });
    await tx.brandWalletEntry.update({ where: { id: entry.id }, data: { invoiceId: invoice.id } });
    return invoice;
  });
}
