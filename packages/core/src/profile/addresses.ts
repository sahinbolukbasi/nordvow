import { prisma } from "../db";
import { DomainError } from "../domain/errors";

export type BrandAddressInput = {
  label?: string;
  companyName?: string | null;
  recipientName?: string | null;
  phone: string;
  addressLine: string;
  neighborhood?: string | null;
  city: string;
  district: string;
  postalCode?: string | null;
  taxOffice?: string | null;
  taxNumber?: string | null;
  isBilling?: boolean;
  isShipping?: boolean;
};

function assertAddress(input: BrandAddressInput) {
  for (const [key, value] of Object.entries(input)) {
    if (["isBilling", "isShipping", "label", "companyName", "recipientName", "neighborhood", "postalCode", "taxOffice", "taxNumber"].includes(key)) continue;
    if (typeof value !== "string" || !value.trim()) {
      throw new DomainError("DOGRULAMA", `${key} alanı zorunludur.`);
    }
  }
}

export async function listBrandAddresses(brandId: string) {
  return prisma.brandAddress.findMany({
    where: { brandId },
    orderBy: [{ isBilling: "desc" }, { isShipping: "desc" }, { createdAt: "desc" }],
  });
}

export async function saveBrandAddress(brandId: string, input: BrandAddressInput) {
  assertAddress(input);
  return prisma.$transaction(async (tx) => {
    if (input.isBilling) await tx.brandAddress.updateMany({ where: { brandId }, data: { isBilling: false } });
    if (input.isShipping) await tx.brandAddress.updateMany({ where: { brandId }, data: { isShipping: false } });
    return tx.brandAddress.create({
      data: {
        brandId,
        label: input.label?.trim() || "Merkez",
        companyName: input.companyName?.trim() || null,
        recipientName: input.recipientName?.trim() || null,
        phone: input.phone.trim(),
        addressLine: input.addressLine.trim(),
        neighborhood: input.neighborhood?.trim() || null,
        city: input.city.trim(),
        district: input.district.trim(),
        postalCode: input.postalCode?.trim() || null,
        taxOffice: input.taxOffice?.trim() || null,
        taxNumber: input.taxNumber?.trim() || null,
        isBilling: input.isBilling ?? false,
        isShipping: input.isShipping ?? false,
      },
    });
  });
}

export async function getBrandDefaultAddresses(brandId: string) {
  const [billing, shipping] = await Promise.all([
    prisma.brandAddress.findFirst({ where: { brandId, isBilling: true }, orderBy: { updatedAt: "desc" } }),
    prisma.brandAddress.findFirst({ where: { brandId, isShipping: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  return { billing, shipping };
}
