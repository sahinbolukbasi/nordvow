import { randomUUID } from "node:crypto";
import { prisma, type Tx } from "../db";
import { DomainError } from "../domain/errors";

type WalletDb = Tx | typeof prisma;

export async function getBrandWalletBalance(brandId: string, db: WalletDb = prisma): Promise<number> {
  const rows = await db.brandWalletEntry.findMany({
    where: { brandId },
    select: { amountKurus: true, direction: true },
  });
  return rows.reduce(
    (total, row) => total + (row.direction === "CREDIT" ? row.amountKurus : -row.amountKurus),
    0,
  );
}

export async function listBrandWalletEntries(brandId: string, limit = 100) {
  return prisma.brandWalletEntry.findMany({
    where: { brandId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  });
}

async function addEntry(
  tx: Tx,
  input: {
    brandId: string;
    type: "TOPUP" | "CREATIVE_USAGE" | "INFLUENCER_PAYMENT" | "SHIPPING" | "REFUND" | "ADJUSTMENT";
    direction: "DEBIT" | "CREDIT";
    amountKurus: number;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    note?: string | null;
    createdById?: string | null;
  },
) {
  if (!Number.isInteger(input.amountKurus) || input.amountKurus <= 0) {
    throw new DomainError("DOGRULAMA", "Bakiye tutarı pozitif kuruş olarak verilmelidir.");
  }
  return tx.brandWalletEntry.create({ data: input });
}

export async function creditBrandWallet(input: {
  brandId: string;
  amountKurus: number;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  note?: string | null;
  createdById?: string | null;
}) {
  return prisma.$transaction((tx) =>
    addEntry(tx, { ...input, type: "TOPUP", direction: "CREDIT" }),
  );
}

export async function chargeBrandWallet(input: {
  brandId: string;
  amountKurus: number;
  type: "CREATIVE_USAGE" | "INFLUENCER_PAYMENT" | "SHIPPING" | "ADJUSTMENT";
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  note?: string | null;
  createdById?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`brand-wallet:${input.brandId}`}))`;
    const existing = await tx.brandWalletEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;

    const balance = await getBrandWalletBalance(input.brandId, tx);
    if (balance < input.amountKurus) {
      throw new DomainError("YETERSIZ_BAKIYE", "Marka bakiyesi bu işlem için yeterli değil.");
    }
    return addEntry(tx, { ...input, direction: "DEBIT" });
  });
}

export async function requestBrandWalletTopup(input: {
  brandId: string;
  amountKurus: number;
  method: string;
  reference?: string | null;
  note?: string | null;
  requestedById?: string | null;
}) {
  if (!Number.isInteger(input.amountKurus) || input.amountKurus <= 0) {
    throw new DomainError("DOGRULAMA", "Yüklenecek tutar pozitif olmalıdır.");
  }
  return prisma.walletTopupRequest.create({ data: input });
}

export async function decideBrandWalletTopup(input: {
  requestId: string;
  decidedById: string;
  approve: boolean;
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-topup:${input.requestId}`}))`;
    const request = await tx.walletTopupRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new DomainError("BULUNAMADI", "Bakiye talebi bulunamadı.");
    if (request.status !== "PENDING") {
      throw new DomainError("GECERSIZ_GECIS", "Bu bakiye talebi daha önce karara bağlandı.");
    }

    const status = input.approve ? "APPROVED" : "REJECTED";
    const updated = await tx.walletTopupRequest.update({
      where: { id: request.id },
      data: { status, decidedById: input.decidedById, decidedAt: new Date(), note: input.note ?? request.note },
    });
    if (input.approve) {
      await addEntry(tx, {
        brandId: request.brandId,
        type: "TOPUP",
        direction: "CREDIT",
        amountKurus: request.amountKurus,
        referenceType: "WalletTopupRequest",
        referenceId: request.id,
        idempotencyKey: `wallet-topup:${request.id}`,
        note: request.note,
        createdById: input.decidedById,
      });
    }
    return updated;
  });
}

export async function createBrandAdjustment(input: {
  brandId: string;
  amountKurus: number;
  direction: "CREDIT" | "DEBIT";
  note: string;
  createdById: string;
}) {
  return prisma.$transaction((tx) =>
    addEntry(tx, {
      ...input,
      type: "ADJUSTMENT",
      referenceType: "AdminAdjustment",
      referenceId: randomUUID(),
      idempotencyKey: `admin-adjustment:${randomUUID()}`,
    }),
  );
}
