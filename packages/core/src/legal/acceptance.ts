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

/** KVKK aydınlatması. Yalnız kayıtta alınır; `legal_acceptances.accepted_at` saklanır. Giriş bunu yeniden istemez. */
export const KVKK_ACCEPTANCE_DOC: LegalDocId = "kvkk-aydinlatma";

export type AcceptanceRole = "BRAND" | "INFLUENCER" | "ADMIN" | "AGENCY";

/** Kayıtta zorunlu belgeler. Aydınlatma bilgilendirmedir; açık rıza ve ileti izni ayrıdır. */
export function requiredAcceptanceDocs(role: AcceptanceRole): LegalDocId[] {
  const base: LegalDocId[] = ["kullanim-sartlari", "gizlilik", KVKK_ACCEPTANCE_DOC];
  if (role === "BRAND") return [...base, "marka-sozlesmesi"];
  if (role === "INFLUENCER") return [...base, "influencer-sozlesmesi"];
  return base;
}

/** Girişte yeniden kaydedilen belgeler. KVKK aydınlatması bu listede yoktur. */
export function loginAcceptanceDocs(role: AcceptanceRole): LegalDocId[] {
  return requiredAcceptanceDocs(role).filter((id) => id !== KVKK_ACCEPTANCE_DOC);
}

/**
 * İlk sosyal/OAuth hesabı kayıt sayılır: KVKK kaydı yoksa bir kez istenir.
 * Kaydı olan kullanıcıya tekrar sorulmaz. Parola ile giriş bu kontrolü kullanmaz.
 */
export async function needsKvkkAcceptance(userId: string): Promise<boolean> {
  const row = await prisma.legalAcceptance.findFirst({
    where: { userId, document: KVKK_ACCEPTANCE_DOC },
    select: { acceptedAt: true },
  });
  return row == null;
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
