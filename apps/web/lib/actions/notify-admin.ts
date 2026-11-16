"use server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { NOTIF_EVENT_MAP } from "@infulancer/core/notify/catalog";
import { sendEmail } from "@infulancer/core/notify/channels";
import { dispatchNotification, recipientsFromUserIds } from "@infulancer/core/notify/dispatch";
import { createShortLink, deleteShortLink } from "@infulancer/core/notify/shortlink";
import type { SystemPopup } from "@/components/notify/announcement-popup";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, revalidateAll, str } from "@/lib/action-utils";
import { assertPlatformAdmin, requireActor } from "@/lib/auth-guard";

const CHANNELS = ["INAPP", "EMAIL", "WHATSAPP", "INSTAGRAM"] as const;

/** Bir olayın kanallarını ve açık/kapalı durumunu kaydeder. */
export async function saveNotificationRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const eventKey = str(fd, "eventKey");
    if (!NOTIF_EVENT_MAP.has(eventKey)) throw new DomainError("BULUNAMADI", "Bilinmeyen olay.");
    const channels = fd.getAll("channels").map(String).filter((c) => (CHANNELS as readonly string[]).includes(c)) as typeof CHANNELS[number][];
    const enabled = str(fd, "enabled") !== "false";
    await prisma.notificationRule.upsert({
      where: { eventKey },
      create: { eventKey, channels, enabled },
      update: { channels, enabled },
    });
    await audit.append({ actor: toAuditActor(actor), action: "NOTIF_RULE_SAVED", entityType: "NotificationRule", entityId: eventKey, data: { channels, enabled } });
    revalidateAll();
    return { ok: true, message: "Kural kaydedildi." };
  });
}

/** Bir olay+kanal şablonunu kaydeder. */
export async function saveTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const eventKey = str(fd, "eventKey");
    const channel = str(fd, "channel");
    if (!NOTIF_EVENT_MAP.has(eventKey)) throw new DomainError("BULUNAMADI", "Bilinmeyen olay.");
    if (!(CHANNELS as readonly string[]).includes(channel)) throw new DomainError("DOGRULAMA", "Geçersiz kanal.");
    const input = z.object({ subject: z.string().max(200).optional(), body: z.string().min(1, { error: "Metin gerekli." }).max(4000) }).parse({ subject: str(fd, "subject") || undefined, body: str(fd, "body") });
    await prisma.notificationTemplate.upsert({
      where: { eventKey_channel: { eventKey, channel: channel as typeof CHANNELS[number] } },
      create: { eventKey, channel: channel as typeof CHANNELS[number], subject: input.subject ?? null, body: input.body },
      update: { subject: input.subject ?? null, body: input.body },
    });
    await audit.append({ actor: toAuditActor(actor), action: "NOTIF_TEMPLATE_SAVED", entityType: "NotificationTemplate", entityId: `${eventKey}:${channel}`, data: {} });
    revalidateAll();
    return { ok: true, message: "Şablon kaydedildi." };
  });
}

/** Özel duyuru, giriş pop-up'ı ve AWS SES toplu e-posta gönderir. */
export async function sendAnnouncementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const title = str(fd, "title") || "Nordvow Bilgilendirme";
    const message = str(fd, "message");
    const audience = str(fd, "audience"); // all | influencers | brands | agency | single
    const targetEmail = str(fd, "targetEmail").toLowerCase();
    const link = str(fd, "link");
    const sendInApp = fd.get("sendInApp") === "1";
    const sendPopup = fd.get("sendPopup") === "1";
    const sendEmailFlag = fd.get("sendEmail") === "1";

    if (message.trim().length < 3) throw new DomainError("DOGRULAMA", "Duyuru metni gerekli.");
    if (!sendInApp && !sendPopup && !sendEmailFlag) throw new DomainError("DOGRULAMA", "En az bir gönderim kanalı seçin.");

    const where =
      audience === "single"
        ? { email: targetEmail, status: "ACTIVE" as const }
        : audience === "influencers"
          ? { role: "INFLUENCER" as const, status: "ACTIVE" as const }
          : audience === "brands"
            ? { role: "BRAND" as const, status: "ACTIVE" as const }
            : audience === "agency"
              ? { role: { in: ["ADMIN" as const, "AGENCY" as const] }, status: "ACTIVE" as const }
              : { status: "ACTIVE" as const };

    const users = await prisma.user.findMany({ where, select: { id: true, email: true, name: true } });
    if (!users.length) throw new DomainError("BULUNAMADI", "Hedef kitlede aktif kullanıcı bulunamadı.");

    let inAppCount = 0;
    let emailSent = 0;
    let emailMocked = 0;
    let emailFailed = 0;

    if (sendInApp) {
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          title: title.slice(0, 120),
          body: message.slice(0, 500),
          href: link || "/profil",
        })),
      });
      inAppCount = users.length;
    }

    if (sendPopup) {
      const row = await prisma.configValue.findUnique({ where: { key: "system.popups" }, select: { value: true } });
      const prev = Array.isArray(row?.value) ? (row.value as SystemPopup[]) : [];
      const item: SystemPopup = {
        id: `pop_${Date.now().toString(36)}`,
        title: title.slice(0, 120),
        message: message.slice(0, 1500),
        link: link || null,
        audience,
        targetEmail: audience === "single" ? targetEmail : null,
        createdAt: new Date().toISOString(),
      };
      const next = [item, ...prev].slice(0, 20);
      await prisma.configValue.upsert({
        where: { key: "system.popups" },
        create: { key: "system.popups", value: next as never, note: "Giriş sonrası pop-up duyurular" },
        update: { value: next as never },
      });
    }

    if (sendEmailFlag) {
      for (const u of users) {
        const res = await sendEmail(
          u.email,
          title,
          `${message}${link ? `\n\nBağlantı: ${link}` : ""}`,
        );
        if (res.status === "SENT") emailSent++;
        else if (res.status === "MOCKED") emailMocked++;
        else emailFailed++;
      }
      const recipients = await recipientsFromUserIds(users.map((u) => u.id), () => ({ mesaj: message, link: link || "" }));
      await dispatchNotification("ANNOUNCEMENT", recipients, { mesaj: message, link: link || "" }).catch(() => undefined);
    }

    await audit.append({
      actor: toAuditActor(actor),
      action: "ANNOUNCEMENT_SENT",
      entityType: "Notification",
      entityId: audience,
      data: { count: users.length, sendInApp, sendPopup, sendEmailFlag, emailSent, emailMocked, emailFailed },
    });
    revalidateAll();
    return {
      ok: true,
      message: `İşlem tamamlandı (${users.length} kişi) — Panel bildirimi: ${inAppCount}, Pop-up: ${sendPopup ? "Açıldı" : "Hayır"}, AWS SES E-posta: ${emailSent} gönderildi / ${emailMocked} mock / ${emailFailed} hata.`,
    };
  });
}

export async function deletePopupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const id = str(fd, "id");
    const row = await prisma.configValue.findUnique({ where: { key: "system.popups" }, select: { value: true } });
    const prev = Array.isArray(row?.value) ? (row.value as SystemPopup[]) : [];
    await prisma.configValue.upsert({
      where: { key: "system.popups" },
      create: { key: "system.popups", value: prev.filter((p) => p.id !== id) as never },
      update: { value: prev.filter((p) => p.id !== id) as never },
    });
    revalidateAll();
    return { ok: true, message: "Pop-up duyuru kaldırıldı." };
  });
}

/** Kısa link oluşturur. Marka ve influencer yalnız kendi hesabına yazar. */
export async function createShortLinkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const url = str(fd, "url");
    const label = str(fd, "label") || undefined;
    const tenantId = actor.role === "BRAND" ? actor.brandId : actor.role === "INFLUENCER" ? actor.influencerId : null;
    const link = await createShortLink(url, { label, createdByUserId: actor.userId, tenantId });
    revalidateAll();
    return { ok: true, message: `Kısa link hazır: ${link.shortUrl}` };
  });
}

/** Kısa linki siler. Marka kendi kiracısını, influencer kendi kaydını silebilir. */
export async function deleteShortLinkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    await deleteShortLink(str(fd, "id"), {
      admin: actor.role === "ADMIN",
      tenantId: actor.role === "BRAND" ? actor.brandId : actor.role === "INFLUENCER" ? actor.influencerId : null,
      userId: actor.userId,
    });
    revalidateAll();
    return { ok: true, message: "Link silindi." };
  });
}
