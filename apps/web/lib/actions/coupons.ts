"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import {
  createCoupon,
  couponValueLabel,
  generateBulkCouponCodes,
  grantCouponMany,
  importCouponCodesAndGrant,
  setCouponGrantStatus,
  setCouponStatus,
} from "@infulancer/core/coupons/service";
import { parseCouponImportFile } from "@infulancer/core/coupons/spreadsheet";
import { dispatchNotification } from "@infulancer/core/notify/dispatch";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, parseInput, revalidateAll, str, tlToKurus } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { AGENCY_TZ, isDay, zonedToUtc } from "@/lib/time";

const createSchema = z.object({
  kind: z.enum(["KUPON", "HEDIYE_CEKI"]),
  title: z.string().min(3, { error: "Başlık en az 3 karakter." }).max(140),
  description: z.string().max(2000).optional(),
  valueType: z.enum(["YUZDE", "TUTAR"]),
  value: z.number().int().positive({ error: "Geçerli bir değer girin." }),
  terms: z.string().max(2000).optional(),
  sharedCode: z.string().max(40).optional(),
  logoKey: z.string().optional(),
  heroImageKey: z.string().optional(),
  brandColor: z.string().max(9).optional(),
  validUntilDay: z.string().optional(),
});

function resolveTenant(actor: { role: string; brandId?: string | null }, fd: FormData): string {
  return actor.role === "BRAND" ? actor.brandId! : (optStr(fd, "tenantId") ?? "");
}

/** Kupon / hediye çeki oluşturur (marka veya admin). Taslak olarak başlar. */
export async function createCouponAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  const created: { id?: string; brand?: boolean } = { brand: actor.role === "BRAND" };
  const res = await attempt(async () => {
    const valueType = str(fd, "valueType") as "YUZDE" | "TUTAR";
    const rawValue = str(fd, "value");
    const value = valueType === "TUTAR" ? tlToKurus(rawValue) : Number(rawValue);
    const validDay = str(fd, "validUntilDay");
    const input = parseInput(createSchema, {
      kind: str(fd, "kind"),
      title: str(fd, "title"),
      description: str(fd, "description") || undefined,
      valueType,
      value,
      terms: str(fd, "terms") || undefined,
      sharedCode: str(fd, "sharedCode") || undefined,
      logoKey: str(fd, "logoKey") || undefined,
      heroImageKey: str(fd, "heroImageKey") || undefined,
      brandColor: str(fd, "brandColor") || undefined,
      validUntilDay: validDay || undefined,
    });
    const tenantId = resolveTenant(actor, fd);
    const c: { id: string } = await createCoupon({
      tenantId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      valueType: input.valueType,
      value: input.value,
      terms: input.terms,
      sharedCode: input.sharedCode,
      logoKey: input.logoKey,
      heroImageKey: input.heroImageKey,
      brandColor: input.brandColor,
      validUntil: input.validUntilDay && isDay(input.validUntilDay) ? zonedToUtc(input.validUntilDay, "23:59", AGENCY_TZ) : null,
      createdByUserId: actor.userId,
    });
    await audit.append({ actor: toAuditActor(actor), action: "COUPON_CREATED", entityType: "Coupon", entityId: c.id, data: { kind: input.kind, title: input.title } });
    created.id = c.id;
    revalidateAll();
    return { ok: true, message: `${input.kind === "HEDIYE_CEKI" ? "Hediye çeki" : "Kupon"} oluşturuldu.` };
  });
  if (res.ok && created.id) redirect(`${created.brand ? "/marka" : "/admin"}/kuponlar/${created.id}`);
  return res;
}

export async function setCouponStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const id = str(fd, "id");
    const to = str(fd, "to") as "TASLAK" | "YAYINDA" | "PASIF";
    const tenantId = actor.role === "BRAND" ? actor.brandId! : (await prisma.coupon.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
    if (!tenantId) throw new DomainError("BULUNAMADI", "Kupon bulunamadı.");
    await setCouponStatus(tenantId, id, to);
    await audit.append({ actor: toAuditActor(actor), action: "COUPON_STATUS", entityType: "Coupon", entityId: id, data: { to } });
    revalidateAll();
    return { ok: true, message: "Kupon durumu güncellendi." };
  });
}

/** Kuponu influencer'lara gönderir (seçili id'ler veya "tümü"). */
export async function grantCouponAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const couponId = str(fd, "couponId");
    const row = await prisma.coupon.findUnique({ where: { id: couponId }, select: { tenantId: true } });
    if (!row || (actor.role === "BRAND" && row.tenantId !== actor.brandId)) throw new DomainError("BULUNAMADI", "Kupon bulunamadı.");
    const tenantId = row.tenantId;
    let ids = fd.getAll("influencerId").map(String).filter(Boolean);
    if (str(fd, "all") === "true") {
      ids = (await prisma.influencer.findMany({ where: { isActive: true, user: { status: "ACTIVE" } }, select: { id: true } })).map((x) => x.id);
    }
    if (!ids.length) throw new DomainError("DOGRULAMA", "En az bir influencer seçin veya 'tümü'nü işaretleyin.");
    const r = await grantCouponMany(couponId, ids, tenantId);
    await audit.append({ actor: toAuditActor(actor), action: "COUPON_GRANTED", entityType: "Coupon", entityId: couponId, data: { count: r.length } });
    try {
      const coupon = await prisma.coupon.findUnique({ where: { id: couponId }, select: { title: true, valueType: true, value: true } });
      const infs = await prisma.influencer.findMany({ where: { id: { in: r.map((g) => g.influencerId).filter((y): y is string => !!y) } }, select: { id: true, name: true, socialAccounts: { where: { platform: "INSTAGRAM" }, select: { handle: true }, take: 1 }, user: { select: { id: true, email: true, phone: true, locale: true } } } });
      const byInf = new Map(r.map((g) => [g.influencerId, g]));
      const recipients = infs.filter((i) => i.user).map((i) => {
        const g = byInf.get(i.id);
        return { userId: i.user!.id, email: i.user!.email, phone: i.user!.phone, instagram: i.socialAccounts[0]?.handle ?? null, locale: i.user!.locale, vars: { ad: i.name, baslik: coupon?.title ?? "", deger: coupon ? couponValueLabel(coupon.valueType, coupon.value) : "", kod: g?.code ?? "", link: g ? `/kupon/${g.id}` : `/influencer/davetlerim` } };
      });
      if (recipients.length) await dispatchNotification("COUPON_GRANTED", recipients);
    } catch { /* bildirim hatası gönderimi bozmasın */ }
    revalidateAll();
    return { ok: true, message: `${r.length} kişiye gönderildi.` };
  });
}

/** Kuponu kalıcı olarak siler (Admin veya kuponun sahibi Marka). */
export async function deleteCouponAction(couponId: string): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireActor("ADMIN", "BRAND");
  try {
    const c = await prisma.coupon.findUnique({ where: { id: couponId }, select: { id: true, tenantId: true, title: true } });
    if (!c) return { ok: false, error: "Kupon bulunamadı." };
    if (actor.role === "BRAND" && c.tenantId !== actor.brandId) {
      return { ok: false, error: "Bu kuponu silme yetkiniz yok." };
    }
    await prisma.coupon.delete({ where: { id: couponId } });
    await audit.append({
      actor: toAuditActor(actor),
      action: "COUPON_DELETED",
      entityType: "Coupon",
      entityId: couponId,
      data: { title: c.title },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kupon silinemedi." };
  }
}

/** Excel (.xlsx) veya CSV dosyasından kupon kodlarını içe aktarır ve kullanıcılara dağıtır. */
export async function importCouponCodesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const couponId = str(fd, "couponId");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new DomainError("DOGRULAMA", "Lütfen bir Excel (.xlsx) veya CSV (.csv) dosyası seçin.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new DomainError("DOGRULAMA", "Dosya boyutu en fazla 5 MB olabilir.");
    }

    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      select: { tenantId: true, title: true, valueType: true, value: true },
    });
    if (!coupon) throw new DomainError("BULUNAMADI", "Kupon bulunamadı.");
    if (actor.role === "BRAND" && coupon.tenantId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kupona kod yükleme yetkiniz yok.");
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const rows = await parseCouponImportFile(buf, file.name);
    const autoAssignUnmatched = fd.get("autoAssign") === "true";

    const result = await importCouponCodesAndGrant({
      couponId,
      rows,
      autoAssignUnmatched,
      allowUnassigned: true,
    });

    await audit.append({
      actor: toAuditActor(actor),
      action: "COUPON_CODES_IMPORTED",
      entityType: "Coupon",
      entityId: couponId,
      data: {
        fileName: file.name,
        createdCount: result.createdCount,
        assignedCount: result.assignedCount,
        poolCount: result.poolCount,
        skippedDuplicates: result.skippedDuplicates,
        unmatchedCount: result.unmatchedCount,
      },
    });

    revalidateAll();
    const parts = [`${result.createdCount} kod içe aktarıldı`];
    if (result.assignedCount > 0) parts.push(`${result.assignedCount} üreticiye atandı`);
    if (result.poolCount > 0) parts.push(`${result.poolCount} havuza eklendi`);
    if (result.skippedDuplicates > 0) parts.push(`${result.skippedDuplicates} mükerrer atlandı`);
    return { ok: true, message: `${parts.join(" · ")}.` };
  });
}

/** Toplu benzersiz kupon kodu üretir (CSV dışa aktarma veya havuz kullanımı için). */
export async function generateBulkCouponCodesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const couponId = str(fd, "couponId");
    const count = Number(str(fd, "count") || "10");
    const prefix = str(fd, "prefix") || "KPN";
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId }, select: { tenantId: true } });
    if (!coupon) throw new DomainError("BULUNAMADI", "Kupon bulunamadı.");
    if (actor.role === "BRAND" && coupon.tenantId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kupon için kod üretme yetkiniz yok.");
    }
    const created = await generateBulkCouponCodes({ couponId, count, prefix });
    await audit.append({
      actor: toAuditActor(actor),
      action: "COUPON_CODES_GENERATED",
      entityType: "Coupon",
      entityId: couponId,
      data: { count: created.length, prefix },
    });
    revalidateAll();
    return { ok: true, message: `${created.length} adet benzersiz kupon kodu üretildi.` };
  });
}

/** Tekil bir kupon kodunun durumunu günceller (kullanıldı / iptal / aktif). */
export async function setCouponGrantStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const grantId = str(fd, "grantId");
    const to = str(fd, "to") as "GONDERILDI" | "KULLANILDI" | "IPTAL";
    const grant = await prisma.couponGrant.findUnique({
      where: { id: grantId },
      select: { coupon: { select: { tenantId: true } } },
    });
    if (!grant) throw new DomainError("BULUNAMADI", "Kupon kodu bulunamadı.");
    if (actor.role === "BRAND" && grant.coupon.tenantId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kupon kodunu güncelleme yetkiniz yok.");
    }
    await setCouponGrantStatus(grantId, to);
    revalidateAll();
    return { ok: true, message: "Kod durumu güncellendi." };
  });
}
