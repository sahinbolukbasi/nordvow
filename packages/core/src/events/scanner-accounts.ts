import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { DomainError } from "../domain/errors";

export type QrScannerRecord = {
  userId: string;
  email: string;
  name: string;
  ownerBrandId: string | null;
  createdByUserId: string;
  allowedEventIds: string[];
  active: boolean;
  createdAt: string;
};

const userKey = (userId: string) => `qr_scanner:user:${userId}`;
const ownerKey = (brandId: string | null) => `qr_scanner:owner:${brandId ?? "ADMIN"}`;

async function getRecord(userId: string): Promise<QrScannerRecord | null> {
  const row = await prisma.configValue.findUnique({ where: { key: userKey(userId) } });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) return null;
  return row.value as QrScannerRecord;
}

async function saveRecord(record: QrScannerRecord): Promise<void> {
  await prisma.configValue.upsert({
    where: { key: userKey(record.userId) },
    create: { key: userKey(record.userId), value: record as unknown as object },
    update: { value: record as unknown as object },
  });
}

/** Kullanıcı QR Okuyucu hesabı ise izinli etkinlik ID listesini döner; normal kullanıcıda null. */
export async function getQrScannerRestriction(
  userId: string,
): Promise<{ allowedEventIds: string[]; ownerBrandId: string | null; active: boolean } | null> {
  const rec = await getRecord(userId);
  if (!rec) return null;
  return {
    allowedEventIds: Array.isArray(rec.allowedEventIds) ? rec.allowedEventIds : [],
    ownerBrandId: rec.ownerBrandId ?? null,
    active: rec.active !== false,
  };
}

/** Marka veya admin için oluşturulmuş tüm QR okuyucu hesaplarını listeler. */
export async function listQrScannerAccountsForOwner(brandId: string | null): Promise<QrScannerRecord[]> {
  const row = await prisma.configValue.findUnique({ where: { key: ownerKey(brandId) } });
  const ids = Array.isArray(row?.value) ? (row.value as string[]) : [];
  if (ids.length === 0) return [];
  const rows = await prisma.configValue.findMany({
    where: { key: { in: ids.map(userKey) } },
  });
  return rows
    .map((r) => r.value as QrScannerRecord)
    .filter((r) => r && typeof r.userId === "string")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Etkinlik sahibi tarafından yeni bir QR okuyucu hesabı oluşturur (yalnızca QR sayfası ve profil açık). */
export async function createQrScannerAccount(input: {
  name: string;
  email: string;
  password: string;
  brandId: string | null;
  createdByUserId: string;
  initialEventId: string;
}): Promise<QrScannerRecord> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("DOGRULAMA", "Ad soyad en az 2 karakter olmalı.");
  if (!email.includes("@")) throw new DomainError("DOGRULAMA", "Geçerli bir e-posta adresi girin.");
  if (input.password.length < 6) throw new DomainError("DOGRULAMA", "Şifre en az 6 karakter olmalı.");

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new DomainError("CAKISMA", "Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var.");
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const role = input.brandId ? "BRAND" : "AGENCY";
  const qrPath = input.brandId ? "/marka/qr-giris" : "/admin/qr-giris";
  const rootPrefix = input.brandId ? "/marka" : "/admin";

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        role,
        brandId: input.brandId,
        status: "ACTIVE",
      },
    });

    const prefixes: Array<{ pathPrefix: string; allowed: boolean }> = [
      { pathPrefix: rootPrefix, allowed: false },
      { pathPrefix: "/creative", allowed: false },
      { pathPrefix: "/dashboard", allowed: false },
      { pathPrefix: "/docs", allowed: false },
      { pathPrefix: "/destek", allowed: false },
      { pathPrefix: "/blog", allowed: false },
      { pathPrefix: qrPath, allowed: true },
      { pathPrefix: "/profil", allowed: true },
    ];

    await tx.pagePermission.createMany({
      data: prefixes.map((p) => ({
        scopeType: "USER",
        scopeId: created.id,
        pathPrefix: p.pathPrefix,
        allowed: p.allowed,
      })),
    });

    return created;
  });

  const record: QrScannerRecord = {
    userId: user.id,
    email,
    name,
    ownerBrandId: input.brandId,
    createdByUserId: input.createdByUserId,
    allowedEventIds: [input.initialEventId],
    active: true,
    createdAt: new Date().toISOString(),
  };

  await saveRecord(record);

  const ownerRow = await prisma.configValue.findUnique({ where: { key: ownerKey(input.brandId) } });
  const prevIds = Array.isArray(ownerRow?.value) ? (ownerRow.value as string[]) : [];
  const nextIds = [...new Set([user.id, ...prevIds])];
  await prisma.configValue.upsert({
    where: { key: ownerKey(input.brandId) },
    create: { key: ownerKey(input.brandId), value: nextIds as unknown as object },
    update: { value: nextIds as unknown as object },
  });

  return record;
}

/** QR okuyucu hesabına belirli bir etkinlik için tarama izni verir veya kaldırır. */
export async function setQrScannerEventAccess(input: {
  scannerUserId: string;
  eventId: string;
  allow: boolean;
  actorBrandId: string | null;
}): Promise<QrScannerRecord> {
  const rec = await getRecord(input.scannerUserId);
  if (!rec) throw new DomainError("BULUNAMADI", "QR okuyucu hesabı bulunamadı.");
  if (input.actorBrandId && rec.ownerBrandId !== input.actorBrandId) {
    throw new DomainError("YETKISIZ", "Bu hesap sizin markanıza ait değil.");
  }

  const nextEvents = input.allow
    ? [...new Set([...rec.allowedEventIds, input.eventId])]
    : rec.allowedEventIds.filter((id) => id !== input.eventId);

  const updated: QrScannerRecord = { ...rec, allowedEventIds: nextEvents };
  await saveRecord(updated);
  return updated;
}

/** QR okuyucu hesabını aktif/pasif yapar (pasif yapıldığında giriş yapamaz). */
export async function toggleQrScannerActive(input: {
  scannerUserId: string;
  active: boolean;
  actorBrandId: string | null;
}): Promise<QrScannerRecord> {
  const rec = await getRecord(input.scannerUserId);
  if (!rec) throw new DomainError("BULUNAMADI", "QR okuyucu hesabı bulunamadı.");
  if (input.actorBrandId && rec.ownerBrandId !== input.actorBrandId) {
    throw new DomainError("YETKISIZ", "Bu hesap sizin markanıza ait değil.");
  }

  await prisma.user.update({
    where: { id: input.scannerUserId },
    data: { status: input.active ? "ACTIVE" : "SUSPENDED" },
  });

  const updated: QrScannerRecord = { ...rec, active: input.active };
  await saveRecord(updated);
  return updated;
}
