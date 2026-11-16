"use server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { ensureStarterCredits, topUp } from "@infulancer/core/creative/credits";
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
  initialCredits: z.number().min(0, { error: "Başlangıç kredisi negatif olamaz." }).max(1_000_000).optional(),
});

/** Admin: davet linki beklemeden doğrudan Influencer, Marka, Ajans veya Admin kullanıcısı ekler. */
export async function createDirectUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const rawCredits = optStr(fd, "initialCredits");
    const parsedCredits = rawCredits !== null && rawCredits !== "" ? Number(rawCredits.replace(",", ".")) : undefined;
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
        initialCredits: parsedCredits,
      },
      { name: "Ad soyad", email: "E-posta", password: "Şifre", role: "Rol", initialCredits: "Başlangıç kredisi" },
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
        select: { id: true, email: true, role: true, brandId: true, influencerId: true },
      });
    });

    const tenantId = created.brandId ?? created.influencerId;
    if (tenantId) {
      const hadAccount = input.brandId ? await prisma.creditAccount.findUnique({ where: { tenantId }, select: { tenantId: true } }) : null;
      if (hadAccount && input.initialCredits && input.initialCredits > 0) {
        await topUp(tenantId, input.initialCredits, "Yeni kullanıcı başlangıç kredisi");
      } else {
        await ensureStarterCredits(tenantId, input.initialCredits);
      }
    }

    await audit.append({
      actor: toAuditActor(actor),
      action: "USER_CREATED_DIRECT",
      entityType: "User",
      entityId: created.id,
      data: { role: created.role, email: created.email, initialCredits: input.initialCredits ?? null },
    });
    revalidateAll();
    return { ok: true, message: `${created.email} (${created.role}) doğrudan eklendi ve aktifleştirildi.` };
  });
}

const deleteUserSchema = z.object({ userId: z.string().min(1).max(64) });

/** Admin: kullanıcıyı kalıcı olarak siler (bağlı kilitli kayıtlar varsa engeller). */
export async function deleteUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(deleteUserSchema, { userId: str(fd, "userId") }, { userId: "Kullanıcı" });
    if (input.userId === actor.userId) {
      throw new DomainError("KURAL_IHLALI", "Kendi hesabınızı silemezsiniz.");
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    if (!user) throw new DomainError("BULUNAMADI", "Kullanıcı bulunamadı.");

    if (user.role === "ADMIN" && user.status === "ACTIVE") {
      const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      if (activeAdmins <= 1) {
        throw new DomainError("KURAL_IHLALI", "Son aktif admin silinemez.");
      }
    }

    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch (e: unknown) {
      const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
      if (code === "P2003") {
        throw new DomainError(
          "KURAL_IHLALI",
          "Bu kullanıcıya bağlı geçmiş kampanya briefi, dosya, inceleme veya ödeme kayıtları bulunduğu için silinemiyor. Bunun yerine kullanıcıyı askıya alabilirsiniz.",
        );
      }
      throw e;
    }

    await audit.append({
      actor: toAuditActor(actor),
      action: "USER_DELETED",
      entityType: "User",
      entityId: user.id,
      data: { email: user.email, name: user.name, role: user.role },
    });
    revalidateAll();
    return { ok: true, message: `${user.email} silindi.` };
  });
}

const updateUserSchema = z.object({
  userId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(40).nullable(),
  password: z.string().min(8, { error: "Şifre en az 8 karakter olmalı." }).max(200).optional(),
});

/** Admin: kullanıcının ad, e-posta, telefon ve opsiyonel şifre bilgisini günceller. */
export async function updateUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const rawPassword = optStr(fd, "password");
    const input = parseInput(
      updateUserSchema,
      {
        userId: str(fd, "userId"),
        name: str(fd, "name"),
        email: str(fd, "email").toLowerCase(),
        phone: optStr(fd, "phone"),
        password: rawPassword || undefined,
      },
      { userId: "Kullanıcı", name: "Ad soyad", email: "E-posta", phone: "Telefon", password: "Yeni şifre" },
    );

    const existing = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, name: true, phone: true },
    });
    if (!existing) throw new DomainError("BULUNAMADI", "Kullanıcı bulunamadı.");

    if (input.email !== existing.email) {
      const taken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (taken) throw new DomainError("DOGRULAMA", "Bu e-posta başka bir kullanıcıda kayıtlı.");
    }

    const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined;
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

    await audit.append({
      actor: toAuditActor(actor),
      action: "USER_UPDATED",
      entityType: "User",
      entityId: existing.id,
      data: {
        from: { name: existing.name, email: existing.email, phone: existing.phone },
        to: { name: input.name, email: input.email, phone: input.phone },
        passwordChanged: !!passwordHash,
      },
    });
    revalidateAll();
    return { ok: true, message: `${input.name} güncellendi.` };
  });
}
