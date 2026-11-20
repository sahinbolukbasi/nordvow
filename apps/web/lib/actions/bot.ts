"use server";

import { prisma } from "@infulancer/core/db";
import { issueLinkCode, unlinkChannel } from "@infulancer/core/bot/link";
import type { ChannelProvider } from "@infulancer/core/db";
import { requireActor, requireAdmin } from "@/lib/auth-guard";
import { revalidateAll } from "@/lib/action-utils";

export async function issueBotCodeAction(prev: { code: string } | { error: string } | null): Promise<{ code: string } | { error: string }> {
  void prev;
  const actor = await requireActor();
  const code = await issueLinkCode(actor.userId);
  return { code };
}

export async function setBotLeadStatusAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["YENI", "ILETISIM", "KAPANDI"].includes(status)) return;
  await prisma.botLead.updateMany({ where: { id }, data: { status } });
  revalidateAll();
}

export async function unlinkBotChannelAction(formData: FormData) {
  const actor = await requireActor();
  const channel = String(formData.get("channel") ?? "") as ChannelProvider;
  if (channel !== "WHATSAPP" && channel !== "INSTAGRAM" && channel !== "MESSENGER") return;
  await unlinkChannel(actor.userId, channel);
  revalidateAll();
}

export async function saveBotSettingsAction(formData: FormData) {
  await requireAdmin();
  const on = (k: string) => formData.get(k) === "on";
  await prisma.botSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      whatsappEnabled: on("whatsapp"),
      instagramEnabled: on("instagram"),
      messengerEnabled: on("messenger"),
      whatsappPhoneNumberId: String(formData.get("waId") ?? "") || null,
      igUserId: String(formData.get("igId") ?? "") || null,
      pageId: String(formData.get("pageId") ?? "") || null,
      welcomeTr: String(formData.get("welcomeTr") ?? "").slice(0, 500) || "Merhaba.",
      welcomeEn: String(formData.get("welcomeEn") ?? "").slice(0, 500) || "Hello.",
    },
    update: {
      whatsappEnabled: on("whatsapp"),
      instagramEnabled: on("instagram"),
      messengerEnabled: on("messenger"),
      whatsappPhoneNumberId: String(formData.get("waId") ?? "") || null,
      igUserId: String(formData.get("igId") ?? "") || null,
      pageId: String(formData.get("pageId") ?? "") || null,
      welcomeTr: String(formData.get("welcomeTr") ?? "").slice(0, 500) || "Merhaba.",
      welcomeEn: String(formData.get("welcomeEn") ?? "").slice(0, 500) || "Hello.",
    },
  });
  revalidateAll();
}
