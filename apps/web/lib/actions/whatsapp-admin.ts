"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@infulancer/core/db";
import { regenerateWhatsAppCode, unlinkWhatsApp } from "@infulancer/core/messaging/user-whatsapp-ai";
import { assertPlatformAdmin, requireActor } from "@/lib/auth-guard";

export async function saveWhatsAppBotPhoneAction(phone: string): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  const cleaned = phone.trim();
  if (cleaned && cleaned.replace(/[^\d]/g, "").length < 7) {
    return { ok: false, error: "Geçerli bir telefon numarası girin (ör. +905551234567)." };
  }

  await prisma.configValue.upsert({
    where: { key: "whatsapp.bot_phone" },
    create: { key: "whatsapp.bot_phone", value: cleaned },
    update: { value: cleaned },
  });
  revalidatePath("/admin/whatsapp-ai");
  revalidatePath("/profil");
  return { ok: true };
}

export async function adminUnlinkWhatsAppUserAction(userId: string): Promise<{ ok: boolean }> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  await unlinkWhatsApp(userId);
  revalidatePath("/admin/whatsapp-ai");
  revalidatePath("/profil");
  return { ok: true };
}

export async function adminRegenerateWhatsAppUserCodeAction(userId: string): Promise<{ ok: boolean; code: string }> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  const res = await regenerateWhatsAppCode(userId);
  revalidatePath("/admin/whatsapp-ai");
  revalidatePath("/profil");
  return { ok: true, code: res.pairingCode };
}

