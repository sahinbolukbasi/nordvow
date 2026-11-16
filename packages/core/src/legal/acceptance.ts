import { prisma } from "../db";

/** Yasal paket sürümü. Metin değişince bu sürüm de değişir; kabul kaydı sürümü saklar. */
export const LEGAL_VERSION = "2026-11-14.1";
export const LEGAL_UPDATED = "14 Kasım 2026";

export const LEGAL_DOCS = [
  "kullanim-sartlari",
  "gizlilik",
  "kvkk-aydinlatma",
  "acik-riza",
  "cerez-politikasi",
  "veri-silme",
  "influencer-sozlesmesi",
  "marka-sozlesmesi",
  "mesafeli-satis",
  "iade-iptal",
  "ileti-izni",
] as const;

export type LegalDocId = (typeof LEGAL_DOCS)[number];

/** Sözleşme kabulü zorunlu belgeler. Aydınlatma bilgilendirmedir; rıza ve ileti izni ayrıdır. */
export function requiredAcceptanceDocs(role: "BRAND" | "INFLUENCER" | "ADMIN" | "AGENCY"): LegalDocId[] {
  const base: LegalDocId[] = ["kullanim-sartlari", "gizlilik", "kvkk-aydinlatma"];
  if (role === "BRAND") return [...base, "marka-sozlesmesi"];
  if (role === "INFLUENCER") return [...base, "influencer-sozlesmesi"];
  return base;
}

export async function recordLegalAcceptances(input: { userId?: string | null; email: string; documents: string[]; version?: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const version = input.version ?? LEGAL_VERSION;
  const documents = [...new Set(input.documents.filter(Boolean))];
  if (!email || !documents.length) return;
  await prisma.legalAcceptance.createMany({
    data: documents.map((document) => ({ userId: input.userId ?? null, email, document, version })),
  });
}
