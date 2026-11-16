import { Prisma } from "../generated/prisma/client";
import { prisma, type Tx } from "../db";
import { notifyAdmins } from "../agents/common";
import { getConfig } from "../config/store";
import { tenantCurrency } from "./tenant";
import { creativePricing, starterIn } from "./pricing";

/**
 * Creative kredileri: submit'te HOLD, fal webhook'unda (başarılı çıktı) CHARGE.
 * Başarısız üretimde hold serbest bırakılır (fal sunucu hatasını faturalamaz, biz de faturalamayız).
 * Tüm geçişler idempotent: aynı hold ikinci kez tahsil/serbest edilemez.
 */
export class InsufficientCreditsError extends Error {}

const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

export async function placeHold(tenantId: string, credits: number, db: Tx = prisma) {
  await db.creditAccount.upsert({ where: { tenantId }, create: { tenantId, currency: await tenantCurrency(tenantId) }, update: {} });
  // Koşullu güncelleme: kullanılabilir bakiye yeterliyse hold'a al (yarış güvenli).
  const updated = await db.$executeRaw`
    UPDATE credit_accounts SET "heldCredits" = "heldCredits" + ${credits}, "updatedAt" = now()
    WHERE "tenantId" = ${tenantId} AND "balanceCredits" - "heldCredits" >= ${credits}`;
  if (updated !== 1) throw new InsufficientCreditsError("Bakiyeniz bu işlem için yetersiz. Bakiye talebi gönderin.");
  return db.creditHold.create({ data: { tenantId, credits: D(credits) } });
}

/** Bakiye hareketi kaydı (değiştirilmez). balanceAfter, işlem sonrası hesaptan okunur. */
async function ledger(db: Tx, tenantId: string, kind: "STARTER" | "TOPUP" | "CHARGE" | "REFUND" | "ADJUST", amount: number | Prisma.Decimal, note?: string | null, jobId?: string | null) {
  const acc = await db.creditAccount.findUnique({ where: { tenantId }, select: { balanceCredits: true } });
  await db.creditLedger.create({ data: { tenantId, kind, amount: D(amount), balanceAfter: acc?.balanceCredits ?? D(0), note: note ?? null, jobId: jobId ?? null } });
}
export async function chargeHold(holdId: string, db: Tx = prisma): Promise<boolean> {
  const hold = await db.creditHold.findUnique({ where: { id: holdId } });
  if (!hold || hold.status !== "held") return false;
  const n = await db.creditHold.updateMany({ where: { id: holdId, status: "held" }, data: { status: "charged", settledAt: new Date() } });
  if (n.count !== 1) return false;
  await db.$executeRaw`
    UPDATE credit_accounts SET "heldCredits" = "heldCredits" - ${hold.credits}, "balanceCredits" = "balanceCredits" - ${hold.credits}, "updatedAt" = now()
    WHERE "tenantId" = ${hold.tenantId}`;
  const job = await db.creativeJob.findFirst({ where: { creditHoldId: holdId }, select: { id: true, modelKey: true, units: true } });
  await ledger(db, hold.tenantId, "CHARGE", hold.credits.negated(), job ? `${job.modelKey} · ${Number(job.units)} birim` : null, job?.id);
  const acc = await db.creditAccount.findUnique({ where: { tenantId: hold.tenantId } });
  if (acc && acc.balanceCredits.lessThan(acc.lowBalanceAlert)) {
    await notifyAdmins("Creative bakiyesi düşük", `${hold.tenantId}: kalan ${acc.balanceCredits.toFixed(0)} TL. (fal ön ödemeli bakiyesi aynı zamanda eşzamanlılık limitidir.)`, "/creative");
  }
  return true;
}

export async function releaseHold(holdId: string, db: Tx = prisma): Promise<boolean> {
  const hold = await db.creditHold.findUnique({ where: { id: holdId } });
  if (!hold || hold.status !== "held") return false;
  const n = await db.creditHold.updateMany({ where: { id: holdId, status: "held" }, data: { status: "released", settledAt: new Date() } });
  if (n.count !== 1) return false;
  await db.$executeRaw`UPDATE credit_accounts SET "heldCredits" = "heldCredits" - ${hold.credits}, "updatedAt" = now() WHERE "tenantId" = ${hold.tenantId}`;
  return true;
}

export async function topUp(tenantId: string, credits: number, note?: string | null) {
  return prisma.$transaction(async (tx) => {
    const acc = await tx.creditAccount.upsert({
      where: { tenantId },
      create: { tenantId, balanceCredits: D(credits), currency: await tenantCurrency(tenantId) },
      update: { balanceCredits: { increment: D(credits) } },
    });
    await ledger(tx, tenantId, "TOPUP", credits, note ?? "Bakiye yükleme");
    return acc;
  });
}

/** Yönetici tarafından bakiye artırma veya azaltma (blokeli bakiyenin altına düşmez). */
export async function adjustCredits(tenantId: string, delta: number, note?: string | null) {
  if (delta === 0) return prisma.creditAccount.findUnique({ where: { tenantId } });
  const currency = await tenantCurrency(tenantId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.creditAccount.upsert({
      where: { tenantId },
      create: { tenantId, balanceCredits: D(0), currency },
      update: {},
    });
    const nextBalance = Number(existing.balanceCredits) + delta;
    const held = Number(existing.heldCredits);
    if (nextBalance < held) {
      throw new InsufficientCreditsError(`Bakiye blokeli tutarın (${held.toLocaleString("tr-TR")}) altına düşürülemez.`);
    }
    const acc = await tx.creditAccount.update({
      where: { tenantId },
      data: { balanceCredits: { increment: D(delta) } },
    });
    await ledger(tx, tenantId, delta > 0 ? "TOPUP" : "ADJUST", delta, note?.trim() || (delta > 0 ? "Yönetici yüklemesi" : "Yönetici kesintisi"));
    return acc;
  });
}

/** Yönetici tarafından bakiyeyi doğrudan belirli bir tutara ayarlar (blokeli bakiyenin altına düşmez). */
export async function setCreditBalance(tenantId: string, targetBalance: number, note?: string | null) {
  if (targetBalance < 0) throw new InsufficientCreditsError("Bakiye negatif olamaz.");
  const currency = await tenantCurrency(tenantId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.creditAccount.upsert({
      where: { tenantId },
      create: { tenantId, balanceCredits: D(0), currency },
      update: {},
    });
    const held = Number(existing.heldCredits);
    if (targetBalance < held) {
      throw new InsufficientCreditsError(`Bakiye blokeli tutarın (${held.toLocaleString("tr-TR")}) altına ayarlanamaz.`);
    }
    const delta = Math.round((targetBalance - Number(existing.balanceCredits)) * 1000) / 1000;
    if (delta === 0) return existing;
    const acc = await tx.creditAccount.update({
      where: { tenantId },
      data: { balanceCredits: D(targetBalance) },
    });
    await ledger(tx, tenantId, "ADJUST", delta, note?.trim() || "Yönetici bakiye güncellemesi");
    return acc;
  });
}

/**
 * Hoş geldin bakiyesi (TL): hesabı hiç olmayan (ilk kez Creative açan) marka/influencer için
 * tek seferlik başlangıç bakiyesi açar. Hesap zaten varsa hiçbir şey yapmaz.
 * Varsayılan değer admin panelinden (`creative.starterCreditsTry`) yönetilir.
 */
export async function ensureStarterCredits(tenantId: string, creditsTry?: number) {
  const existing = await prisma.creditAccount.findUnique({ where: { tenantId }, select: { tenantId: true } });
  if (existing) return existing;
  const amountTry = creditsTry ?? (await getConfig("creative.starterCreditsTry"));
  // Hesap kendi para biriminde açılır (TRY tutarının karşılığı; gösterimde çevrim yok).
  const currency = await tenantCurrency(tenantId);
  const credits = amountTry <= 0 ? 0 : starterIn(amountTry, await creativePricing(), currency);
  try {
    return await prisma.$transaction(async (tx) => {
      const acc = await tx.creditAccount.create({ data: { tenantId, balanceCredits: D(credits), currency } });
      if (credits > 0) await ledger(tx, tenantId, "STARTER", credits, "Hoş geldin bakiyesi");
      return acc;
    });
  } catch {
    // Eşzamanlı ilk açılış: diğer istek hesabı açtı.
    return prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } });
  }
}
