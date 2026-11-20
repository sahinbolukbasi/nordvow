import { prisma, Prisma } from "../db";

export class InsufficientCreditsError extends Error {
  constructor(message = "Yetersiz kredi bakiyesi. Lütfen kredi yükleyiniz.") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Medya işi bulunamadı: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

/**
 * 1. İş kabul edildiğinde tahmini kredi miktarını kullanıcı hesabında rezerve eder (bloke).
 */
export async function reserveCreditsForJob(params: {
  tenantId: string;
  jobId: string;
  creditsToHold: number;
}): Promise<string> {
  const { tenantId, jobId, creditsToHold } = params;
  const holdDecimal = new Prisma.Decimal(creditsToHold);

  return await prisma.$transaction(async (tx) => {
    // 1. Kredi hesabını kilitle ve kontrol et
    const account = await tx.creditAccount.findUnique({
      where: { tenantId },
    });

    if (!account) {
      throw new InsufficientCreditsError("Kredi hesabı bulunamadı.");
    }

    const availableCredits = account.balanceCredits.minus(account.heldCredits);
    if (availableCredits.lessThan(holdDecimal)) {
      throw new InsufficientCreditsError(
        `Yetersiz bakiye. Gerekli: ${creditsToHold} kredi, Kullanılabilir: ${availableCredits.toString()} kredi.`
      );
    }

    // 2. Bakiyeyi bloke et
    await tx.creditAccount.update({
      where: { tenantId },
      data: {
        heldCredits: {
          increment: holdDecimal,
        },
      },
    });

    // 3. CreditHold kaydı oluştur
    const hold = await tx.creditHold.create({
      data: {
        tenantId,
        credits: holdDecimal,
        status: "held",
      },
    });

    // 4. MediaJob'a bağla
    await tx.mediaJob.update({
      where: { id: jobId },
      data: {
        creditsReserved: holdDecimal,
        status: "QUEUED",
      },
    });

    return hold.id;
  });
}

/**
 * 2. İş başarıyla bittiğinde rezerve edilen krediyi düşer ve muhasebe defterine (CreditLedger) işler.
 */
export async function commitCreditsForJob(params: {
  tenantId: string;
  jobId: string;
  holdId: string;
  actualCredits: number;
  officialCostUsd?: number;
  loadedCostUsd?: number;
  providerUsed?: string;
  modelUsed?: string;
  outputMediaUrls: string[];
  inferenceMs?: number;
  c2paManifestId?: string;
}): Promise<void> {
  const {
    tenantId,
    jobId,
    holdId,
    actualCredits,
    officialCostUsd,
    loadedCostUsd,
    providerUsed,
    modelUsed,
    outputMediaUrls,
    inferenceMs,
    c2paManifestId,
  } = params;

  const actualDecimal = new Prisma.Decimal(actualCredits);

  await prisma.$transaction(async (tx) => {
    const hold = await tx.creditHold.findUnique({ where: { id: holdId } });
    if (!hold || hold.status !== "held") {
      throw new Error(`Geçersiz veya daha önce işlenmiş kredi blokesi: ${holdId}`);
    }

    // Blokeyi kapat
    await tx.creditHold.update({
      where: { id: holdId },
      data: {
        status: "settled",
        settledAt: new Date(),
      },
    });

    // Hesaptan hem bakiyeyi hem de bloke tutarını düş
    const updatedAccount = await tx.creditAccount.update({
      where: { tenantId },
      data: {
        balanceCredits: {
          decrement: actualDecimal,
        },
        heldCredits: {
          decrement: hold.credits,
        },
      },
    });

    // Çift kayıtlı muhasebe defterine immutable işlem kaydı
    await tx.creditLedger.create({
      data: {
        tenantId,
        kind: "CHARGE",
        amount: actualDecimal.negated(),
        balanceAfter: updatedAccount.balanceCredits,
        jobId,
        note: `AI Üretim Tahsilatı (${modelUsed ?? "Nordvow AI"} - ${actualCredits} Kredi)`,
      },
    });

    // MediaJob'ı başarıyla tamamla
    await tx.mediaJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        creditsCharged: actualDecimal,
        officialCostUsd: officialCostUsd ? new Prisma.Decimal(officialCostUsd) : undefined,
        loadedCostUsd: loadedCostUsd ? new Prisma.Decimal(loadedCostUsd) : undefined,
        providerUsed,
        modelUsed,
        outputMediaUrls,
        inferenceMs,
        c2paManifestId,
        completedAt: new Date(),
      },
    });
  });
}

/**
 * 3. Sistem hatasında (429/5xx) bloke edilen krediyi anında iade eder.
 * Politika/moderasyon ihlalinde iade yapılmaz (policyViolation = true).
 */
export async function refundCreditsForJob(params: {
  tenantId: string;
  jobId: string;
  holdId: string;
  reason: string;
  policyViolation?: boolean;
}): Promise<void> {
  const { tenantId, jobId, holdId, reason, policyViolation = false } = params;

  await prisma.$transaction(async (tx) => {
    const hold = await tx.creditHold.findUnique({ where: { id: holdId } });
    if (!hold || hold.status !== "held") return;

    if (policyViolation) {
      // Moderasyon/politika ihlali: Bloke serbest bırakılmaz, ceza olarak tahsil edilir
      await tx.creditHold.update({
        where: { id: holdId },
        data: { status: "forfeited_policy_violation", settledAt: new Date() },
      });

      const updatedAccount = await tx.creditAccount.update({
        where: { tenantId },
        data: {
          balanceCredits: { decrement: hold.credits },
          heldCredits: { decrement: hold.credits },
        },
      });

      await tx.creditLedger.create({
        data: {
          tenantId,
          kind: "POLICY_PENALTY",
          amount: hold.credits.negated(),
          balanceAfter: updatedAccount.balanceCredits,
          jobId,
          note: `Politika İhlali Kesintisi: ${reason}`,
        },
      });

      await tx.mediaJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: `Politika İhlali: ${reason}`,
          moderationPassed: false,
          moderationFlag: reason,
          completedAt: new Date(),
        },
      });
      return;
    }

    // Sağlayıcı veya Nordvow sistem hatası (429/5xx): Anında tam iade
    await tx.creditHold.update({
      where: { id: holdId },
      data: { status: "refunded", settledAt: new Date() },
    });

    await tx.creditAccount.update({
      where: { tenantId },
      data: {
        heldCredits: { decrement: hold.credits },
      },
    });

    await tx.mediaJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: reason,
        completedAt: new Date(),
      },
    });
  });
}
