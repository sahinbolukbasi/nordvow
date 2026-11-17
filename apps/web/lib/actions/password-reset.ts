"use server";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@infulancer/core/audit";
import { BRAND_NAME } from "@infulancer/core/brand";
import { prisma } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { envStr } from "@infulancer/core/env";
import { sendEmail } from "@infulancer/core/notify/channels";
import { renderBrandedEmail } from "@infulancer/core/notify/email-template";
import type { ActionState } from "@/lib/action-state";
import { attempt, parseInput, str } from "@/lib/action-utils";

const PREFIX = "auth.pwdreset.";
const TTL_MS = 60 * 60 * 1000; // 1 saat

type ResetPayload = {
  userId: string;
  email: string;
  expiresAt: number;
};

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function appBaseUrl(): string {
  const raw = envStr("AUTH_URL", "") || envStr("NEXT_PUBLIC_APP_URL", "") || "https://nordvow.com";
  return raw.replace(/\/+$/, "");
}

/** Şifre sıfırlama token'ının geçerliliğini kontrol eder (süresi dolmamış ve silinmemiş). */
export async function verifyResetToken(rawToken: string): Promise<{ valid: boolean; email?: string }> {
  const token = rawToken.trim();
  if (token.length < 20) return { valid: false };
  const row = await prisma.configValue.findUnique({ where: { key: `${PREFIX}${hashToken(token)}` } });
  if (!row) return { valid: false };
  const val = row.value as Partial<ResetPayload> | null;
  if (!val?.userId || !val.expiresAt || val.expiresAt < Date.now()) {
    return { valid: false };
  }
  return { valid: true, email: val.email };
}

/** E-posta ile şifre sıfırlama bağlantısı gönderir. */
export async function requestPasswordResetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const input = parseInput(
      z.object({ email: z.email().max(200) }),
      { email: str(fd, "email").toLowerCase() },
      { email: "E-posta" },
    );

    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    if (user && user.status !== "REJECTED" && user.status !== "SUSPENDED") {
      const rawToken = randomBytes(32).toString("hex");
      const key = `${PREFIX}${hashToken(rawToken)}`;
      const payload: ResetPayload = {
        userId: user.id,
        email: user.email,
        expiresAt: Date.now() + TTL_MS,
      };
      await prisma.configValue.upsert({
        where: { key },
        create: { key, value: payload, verified: true, note: "Şifre sıfırlama anahtarı (geçici)" },
        update: { value: payload },
      });

      const resetUrl = `${appBaseUrl()}/sifre-sifirla?token=${rawToken}`;
      const subject = `${BRAND_NAME} — Şifre sıfırlama talebi`;
      const body = [
        `Merhaba ${user.name},`,
        `${BRAND_NAME} hesabınız için şifre sıfırlama talebi aldık. Aşağıdaki butona tıklayarak yeni şifrenizi belirleyebilirsiniz. Bu bağlantı 1 saat boyunca geçerlidir.`,
        `Bağlantı: ${resetUrl}`,
        `Bu talebi siz yapmadıysanız bu e-postayı güvenle yok sayabilirsiniz.`,
      ].join("\n\n");

      const html = renderBrandedEmail({
        subject,
        body,
        ctaUrl: resetUrl,
        ctaLabel: "Yeni Şifre Belirle",
        locale: "tr",
      });
      const sendRes = await sendEmail(user.email, subject, body, html);
      if (sendRes.status !== "SENT") {
        console.warn("[password-reset] sendEmail status:", sendRes.status, sendRes.error ?? "");
      }
      await prisma.notificationLog
        .create({
          data: {
            eventKey: "PASSWORD_RESET",
            channel: "EMAIL",
            userId: user.id,
            toAddress: user.email,
            subject,
            body,
            status: sendRes.status,
            error: sendRes.error ?? null,
          },
        })
        .catch(() => undefined);
      await audit.append({
        actor: { id: user.id, role: user.role },
        action: "PASSWORD_RESET_REQUESTED",
        entityType: "User",
        entityId: user.id,
        data: { email: user.email },
      });
    }

    return {
      ok: true,
      message: "Eğer bu e-posta adresi sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu (ve gereksiz klasörünü) kontrol edin.",
    };
  });
}

/** Yeni şifreyi kaydeder, token'ı temizler ve giriş ekranına yönlendirir. */
export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await attempt(async () => {
    const input = parseInput(
      z
        .object({
          token: z.string().trim().min(20),
          password: z.string().min(8, { error: "Şifre en az 8 karakter olmalı." }).max(200),
          confirmPassword: z.string().min(8).max(200),
        })
        .refine((d) => d.password === d.confirmPassword, {
          message: "Şifreler eşleşmiyor.",
          path: ["confirmPassword"],
        }),
      {
        token: str(fd, "token"),
        password: str(fd, "password"),
        confirmPassword: str(fd, "confirmPassword"),
      },
      { token: "Doğrulama kodu", password: "Yeni şifre", confirmPassword: "Yeni şifre (tekrar)" },
    );

    const key = `${PREFIX}${hashToken(input.token)}`;
    const row = await prisma.configValue.findUnique({ where: { key } });
    const payload = row?.value as Partial<ResetPayload> | null;
    if (!row || !payload?.userId || !payload.expiresAt || payload.expiresAt < Date.now()) {
      throw new DomainError("GECERSIZ_GECIS", "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş. Lütfen tekrar talep edin.");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new DomainError("BULUNAMADI", "Kullanıcı bulunamadı.");

    const passwordHash = await bcrypt.hash(input.password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.configValue.delete({ where: { key } }),
    ]);

    await audit.append({
      actor: { id: user.id, role: user.role },
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "User",
      entityId: user.id,
      data: { email: user.email },
    });

    return { ok: true, message: "Şifreniz güncellendi." };
  });

  if (res.ok) {
    redirect("/giris?sifresifirlandi=1");
  }
  return res;
}

