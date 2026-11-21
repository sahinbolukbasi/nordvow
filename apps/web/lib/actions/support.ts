"use server";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { createSupportTicket, updateSupportTicket, type SupportCategory, type SupportStatus } from "@infulancer/core/support/service";
import { adminRecipients, dispatchNotification } from "@infulancer/core/notify/dispatch";
import type { ActionState } from "@/lib/action-state";
import { attempt, revalidateAll, str } from "@/lib/action-utils";
import { getActor, requireActor } from "@/lib/auth-guard";

const CATEGORIES: SupportCategory[] = ["HATA", "SORU", "ISTEK", "DIGER"];
const STATUSES: SupportStatus[] = ["ACIK", "INCELEMEDE", "COZULDU", "KAPANDI"];

/** Destek talebi gönderir. Girişli kullanıcıda ad/e-posta otomatik dolar, değiştirilebilir. */
export async function submitSupportTicket(_p: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await getActor();
    const user = actor ? await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }) : null;
    const categoryRaw = str(fd, "category");
    const category = (CATEGORIES.includes(categoryRaw as SupportCategory) ? categoryRaw : "SORU") as SupportCategory;
    const ticketName = str(fd, "name") || user?.name || "";
    const ticketEmail = str(fd, "email") || user?.email || "";
    const ticketSubject = str(fd, "subject");
    await createSupportTicket({
      userId: actor?.userId ?? null,
      role: actor?.role ?? null,
      name: ticketName,
      email: ticketEmail,
      category,
      subject: ticketSubject,
      message: str(fd, "message"),
      pageUrl: str(fd, "pageUrl") || null,
    });
    try {
      const admins = await adminRecipients();
      if (admins.length) {
        await dispatchNotification("SUPPORT_TICKET_CREATED", admins, {
          ad: ticketName || "Kullanıcı",
          eposta: ticketEmail || "-",
          konu: ticketSubject,
          link: "/admin/destek",
        });
      }
    } catch { /* bildirim hatası talebi bozmasın */ }
    return { ok: true, message: "Talebiniz alındı. En kısa sürede dönüş yapacağız." };
  });
}

/** Yönetici: talep durumu/notu güncelleme. */
export async function updateSupportTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const statusRaw = str(fd, "status");
    const status = STATUSES.includes(statusRaw as SupportStatus) ? (statusRaw as SupportStatus) : undefined;
    const adminNote = str(fd, "adminNote");
    const t = await updateSupportTicket(id, { status, adminNote });
    await audit.append({ actor: toAuditActor(actor), action: "SUPPORT_TICKET_UPDATED", entityType: "SupportTicket", entityId: t.id, data: { status } });
    try {
      if (t.email || t.userId) {
        await dispatchNotification("SUPPORT_TICKET_UPDATED", [
          {
            userId: t.userId ?? null,
            email: t.email ?? null,
            vars: {
              ad: t.name || "Kullanıcı",
              konu: t.subject,
              durum: status ?? t.status,
              not: adminNote ? `\n\nYanıt / Not: ${adminNote}` : "",
              link: "/destek",
            },
          },
        ]);
      }
    } catch { /* bildirim hatası güncellemeyi bozmasın */ }
    revalidateAll();
    return { ok: true, message: "Talep güncellendi." };
  });
}
