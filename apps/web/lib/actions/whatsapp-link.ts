"use server";
import { regenerateWhatsAppCode, unlinkWhatsApp } from "@infulancer/core/messaging/user-whatsapp-ai";
import { requireActor } from "@/lib/auth-guard";
import { revalidateAll } from "@/lib/action-utils";

export async function regenerateWhatsAppCodeAction() {
  const actor = await requireActor();
  const row = await regenerateWhatsAppCode(actor.userId);
  revalidateAll();
  return { pairingCode: row.pairingCode };
}

export async function unlinkWhatsAppAction() {
  const actor = await requireActor();
  await unlinkWhatsApp(actor.userId);
  revalidateAll();
  return { ok: true };
}

