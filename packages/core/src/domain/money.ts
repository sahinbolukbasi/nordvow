import { DomainError } from "./errors";

/**
 * Kampanya bütçesi ve marka bedeli tavanı: 100.000.000,00 (para biriminin ana birimi).
 * Sütun BigInt olduğu için daha büyük tutar sığar; bu sınır yazım hatalarını (ör. milyarlık) keser.
 * 100_000_000,00 × 100 = 10_000_000_000 kuruş.
 */
export const MAX_CAMPAIGN_AMOUNT_KURUS = 10_000_000_000;
export const MAX_CAMPAIGN_AMOUNT_LABEL = "100.000.000,00";

/** Postgres INTEGER ve hakediş defterindeki amountKurus üst sınırı. */
export const PG_INT32_MAX = 2_147_483_647;
/** Atama bedeli / komisyon bu sütunlarda durur; taşma yazılmadan reddedilir. */
export const MAX_FEE_KURUS = PG_INT32_MAX;
export const MAX_FEE_LABEL = "21.474.836,47";

function assertIntegerKurus(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new DomainError("DOGRULAMA", `${label} geçersiz.`);
}

/** Kampanya bütçesi ve marka bedeli. 0 geçerli (bütçe boş bırakılabilir); üst sınır zorunlu. */
export function assertCampaignAmountKurus(value: number, label: string): number {
  assertIntegerKurus(value, label);
  if (value < 0) throw new DomainError("DOGRULAMA", `${label} negatif olamaz.`);
  if (value > MAX_CAMPAIGN_AMOUNT_KURUS) {
    throw new DomainError("DOGRULAMA", `${label} en fazla ${MAX_CAMPAIGN_AMOUNT_LABEL} olabilir.`);
  }
  return value;
}

/**
 * feeKurus / commissionKurus. Sütun ve defter 32 bit; tavan aşılırsa Prisma ValueOutOfRange yerine
 * doğrulama hatası döner. 0 komisyon için geçerlidir.
 */
export function assertFeeKurus(value: number, label: string, min = 0): number {
  assertIntegerKurus(value, label);
  if (value < min) throw new DomainError("DOGRULAMA", `${label} geçersiz.`);
  if (value > MAX_FEE_KURUS) {
    throw new DomainError("DOGRULAMA", `${label} en fazla ${MAX_FEE_LABEL} olabilir.`);
  }
  return value;
}
