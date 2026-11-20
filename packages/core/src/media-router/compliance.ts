import { prisma, BiometricConsentType, LegalConsentStatus } from "../db";
import * as crypto from "node:crypto";

export class BiometricConsentRequiredError extends Error {
  constructor(consentType: BiometricConsentType) {
    super(
      `Yasal Zorunluluk (KVKK/GDPR): '${consentType}' işlemi için kayıtlı açık biyometrik rıza beyanı bulunamadı. Lütfen rıza formunu onaylayınız.`
    );
    this.name = "BiometricConsentRequiredError";
  }
}

/**
 * Ses klonlama, yüz/avatar (lip-sync) ve dijital ikiz işlemlerinden önce
 * kullanıcının açık, kayıtlı yasal rıza beyanını doğrulayan kontrol fonksiyonu.
 */
export async function assertLegalConsent(params: {
  userId: string;
  consentType: BiometricConsentType;
}): Promise<string> {
  const { userId, consentType } = params;

  const activeConsent = await prisma.biometricLegalConsent.findFirst({
    where: {
      userId,
      consentType,
      status: LegalConsentStatus.ACTIVE,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { consentedAt: "desc" },
  });

  if (!activeConsent) {
    throw new BiometricConsentRequiredError(consentType);
  }

  return activeConsent.id;
}

/**
 * Kullanıcıdan alınan biyometrik açık rıza beyanını şifreli ve zaman damgalı olarak kaydeder.
 */
export async function recordBiometricConsent(params: {
  userId: string;
  organizationId?: string;
  consentType: BiometricConsentType;
  legalText: string;
  legalTextVersion: string;
  ipAddress: string;
  userAgent: string;
  signatureEvidence?: string;
  durationDays?: number;
}): Promise<string> {
  const {
    userId,
    organizationId,
    consentType,
    legalText,
    legalTextVersion,
    ipAddress,
    userAgent,
    signatureEvidence,
    durationDays = 365,
  } = params;

  // Hukuki metnin değiştirilmediğini kanıtlamak için SHA-256 hash'i alınır
  const legalTextHash = crypto.createHash("sha256").update(legalText).digest("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);

  const consent = await prisma.biometricLegalConsent.create({
    data: {
      userId,
      organizationId,
      consentType,
      legalTextVersion,
      legalTextHash,
      ipAddress,
      userAgent,
      signatureEvidence,
      status: LegalConsentStatus.ACTIVE,
      expiresAt,
    },
  });

  return consent.id;
}
