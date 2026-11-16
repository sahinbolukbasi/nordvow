"use server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { assertPlatformAdmin, requireActor } from "@/lib/auth-guard";

const schema = z.object({
  userId: z.string().min(1).max(64),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  note: z.string().max(500).nullable(),
});

/**
 * Kullanıcıyı askıya alır / yeniden etkinleştirir. Askıdaki kullanıcı bir sonraki istekte
 * onay ekranına yönlenir (requireActor durumu her istekte veritabanından okur).
 * Kendi hesabınızı ve son aktif admini askıya alamazsınız; onay bekleyenler Davetler sayfasından yönetilir.
 */
export async function setUserStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(schema, { userId: str(fd, "userId"), status: str(fd, "status"), note: optStr(fd, "note") });
    if (input.userId === actor.userId) throw new DomainError("KURAL_IHLALI", "Kendi hesabınızın durumunu değiştiremezsiniz.");
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, status: true, email: true } });
      if (!user) throw new DomainError("BULUNAMADI", "Kullanıcı bulunamadı.");
      if (user.status === "PENDING" || user.status === "REJECTED") {
        throw new DomainError("KURAL_IHLALI", "Başvurusu süren kullanıcıyı Davetler sayfasından onaylayın veya reddedin.");
      }
      if (user.status === input.status) throw new DomainError("GECERSIZ_GECIS", "Kullanıcı zaten bu durumda.");
      if (user.role === "ADMIN" && input.status === "SUSPENDED") {
        const admins = await tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
        if (admins <= 1) throw new DomainError("KURAL_IHLALI", "Son aktif admin askıya alınamaz.");
      }
      await tx.user.update({ where: { id: user.id }, data: { status: input.status } });
      await audit.append({
        actor: toAuditActor(actor),
        action: input.status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REACTIVATED",
        entityType: "User",
        entityId: user.id,
        data: { from: user.status, to: input.status, note: input.note },
      });
    });
    revalidateAll();
    return { ok: true, message: input.status === "SUSPENDED" ? "Kullanıcı askıya alındı." : "Kullanıcı yeniden etkinleştirildi." };
  });
}

const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  password: z.string().min(10, { error: "En az 10 karakter olmalı." }).max(200),
  role: z.enum(["ADMIN", "AGENCY"]),
});
/** Ajans ekibine kullanıcı ekler (geçici şifreyle). Yalnız platform yöneticisi. */
export async function createStaffUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(
      staffSchema,
      { name: str(fd, "name"), email: str(fd, "email").toLowerCase(), password: str(fd, "password"), role: str(fd, "role") },
      { name: "Ad soyad", email: "E-posta", password: "Geçici şifre", role: "Rol" },
    );
    if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new DomainError("DOGRULAMA", "Bu e-posta zaten kayıtlı.");
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({ data: { email: input.email, name: input.name, role: input.role, passwordHash } });
    await audit.append({ actor: toAuditActor(actor), action: "USER_CREATED", entityType: "User", entityId: user.id, data: { role: input.role, email: input.email } });
    revalidateAll();
    return { ok: true, message: `${input.email} eklendi. Geçici şifreyi güvenli bir kanaldan paylaşın.` };
  });
}

const roleSchema = z.object({ userId: z.string().min(1).max(64), role: z.enum(["ADMIN", "AGENCY"]) });
/** Ajans ekibinde rol değiştirir (Admin ↔ Ajans). Kendi rolünüz ve son aktif admin korunur. */
export async function setStaffRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(roleSchema, { userId: str(fd, "userId"), role: str(fd, "role") });
    if (input.userId === actor.userId) throw new DomainError("KURAL_IHLALI", "Kendi rolünüzü değiştiremezsiniz.");
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: input.userId }, select: { role: true } });
      if (!u || (u.role !== "ADMIN" && u.role !== "AGENCY")) throw new DomainError("KURAL_IHLALI", "Yalnız ajans ekibinin rolü değiştirilebilir.");
      if (u.role === input.role) throw new DomainError("GECERSIZ_GECIS", "Kullanıcı zaten bu rolde.");
      if (u.role === "ADMIN" && (await tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } })) <= 1) throw new DomainError("KURAL_IHLALI", "Son aktif admin ajans rolüne alınamaz.");
      await tx.user.update({ where: { id: input.userId }, data: { role: input.role } });
      await audit.append({ actor: toAuditActor(actor), action: "USER_ROLE_CHANGED", entityType: "User", entityId: input.userId, data: { from: u.role, to: input.role } });
    });
    revalidateAll();
    return { ok: true, message: "Rol güncellendi. Kullanıcı yeniden giriş yaptığında geçerli olur." };
  });
}

const directUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  password: z.string().min(8, { error: "En az 8 karakter olmalı." }).max(200),
  phone: z.string().trim().max(40).optional(),
  role: z.enum(["INFLUENCER", "BRAND", "AGENCY", "ADMIN"]),
  brandId: z.string().trim().max(64).optional(),
  companyName: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
});

/** Admin: davet linki beklemeden doğrudan Influencer, Marka, Ajans veya Admin kullanıcısı ekler. */
export async function createDirectUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const input = parseInput(
      directUserSchema,
      {
        name: str(fd, "name"),
        email: str(fd, "email").toLowerCase(),
        password: str(fd, "password"),
        phone: optStr(fd, "phone") ?? undefined,
        role: str(fd, "role"),
        brandId: optStr(fd, "brandId") ?? undefined,
        companyName: optStr(fd, "companyName") ?? undefined,
        category: optStr(fd, "category") ?? undefined,
      },
      { name: "Ad soyad", email: "E-posta", password: "Şifre", role: "Rol" },
    );
    if (input.role === "ADMIN" || input.role === "AGENCY") assertPlatformAdmin(actor);
    if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw new DomainError("DOGRULAMA", "Bu e-posta zaten kayıtlı.");
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const created = await prisma.$transaction(async (tx) => {
      let brandId: string | null = null;
      let influencerId: string | null = null;

      if (input.role === "BRAND") {
        if (input.brandId) {
          const exists = await tx.brand.findUnique({ where: { id: input.brandId }, select: { id: true } });
          if (!exists) throw new DomainError("DOGRULAMA", "Seçilen marka bulunamadı.");
          brandId = exists.id;
        } else {
          const b = await tx.brand.create({
            data: {
              name: input.companyName?.trim() || input.name,
              contactName: input.name,
              contactEmail: input.email,
              contactPhone: input.phone || "—",
              taxOffice: "—",
              taxNumber: `TEMP-${Date.now().toString(36)}`,
              category: input.category?.trim() || "Genel",
            },
            select: { id: true },
          });
          brandId = b.id;
        }
      } else if (input.role === "INFLUENCER") {
        const inf = await tx.influencer.create({
          data: {
            name: input.name,
            category: input.category?.trim() || "Genel",
            taxStatus: "FATURA",
            iban: "",
            ibanHolder: input.name,
            canIssueInvoice: false,
            showcaseVisible: true,
          },
          select: { id: true },
        });
        influencerId = inf.id;
      }

      return tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          phone: input.phone || null,
          role: input.role,
          status: "ACTIVE",
          passwordHash,
          brandId,
          influencerId,
        },
        select: { id: true, email: true, role: true },
      });
    });

    await audit.append({
      actor: toAuditActor(actor),
      action: "USER_CREATED_DIRECT",
      entityType: "User",
      entityId: created.id,
      data: { role: created.role, email: created.email },
    });
    revalidateAll();
    return { ok: true, message: `${created.email} (${created.role}) doğrudan eklendi ve aktifleştirildi.` };
  });
}
