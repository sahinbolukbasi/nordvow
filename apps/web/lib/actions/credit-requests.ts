"use server";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { approveCreditRequest, createCreditRequest, rejectCreditRequest } from "@infulancer/core/creative/credit-requests";
import { adminRecipients, dispatchNotification, recipientsFromUserIds } from "@infulancer/core/notify/dispatch";
import type { ActionState } from "@/lib/action-state";
import { attempt, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

/** Marka/influencer Creative bakiyesi (TL) talep eder. */
export async function requestCreditAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("BRAND", "INFLUENCER");
  return attempt(async () => {
    const tenantId = actor.role === "BRAND" ? actor.brandId! : actor.influencerId!;
    const amountTry = Number(str(fd, "amount").replace(/\./g, "").replace(",", "."));
    await createCreditRequest({ tenantId, requestedByUserId: actor.userId, role: actor.role, amountTry, note: str(fd, "note") || null });
    try {
      const [admins, requester] = await Promise.all([
        adminRecipients(),
        prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }),
      ]);
      if (admins.length) {
        await dispatchNotification("CREDIT_REQUEST_CREATED", admins, {
          ad: requester?.name || requester?.email || "Kullanıcı",
          tutar: `${amountTry.toLocaleString("tr-TR")} TL`,
          link: "/admin/creative",
        });
      }
    } catch { /* bildirim hatası talebi bozmasın */ }
    revalidateAll();
    return { ok: true, message: "Bakiye talebiniz alındı; yönetici onayından sonra yüklenir." };
  });
}

/** Yönetici bakiye talebini onaylar (bakiye yüklenir). */
export async function approveCreditRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const req = await approveCreditRequest(str(fd, "id"), actor.userId);
    await audit.append({ actor: toAuditActor(actor), action: "CREDIT_REQUEST_APPROVED", entityType: "CreditRequest", entityId: req.id, data: { tenantId: req.tenantId, amountTry: req.amountTry } });
    try {
      if (req.requestedByUserId) {
        const recipients = await recipientsFromUserIds([req.requestedByUserId]);
        if (recipients.length) {
          await dispatchNotification("CREDIT_REQUEST_REVIEWED", recipients, {
            tutar: `${req.amountTry.toLocaleString("tr-TR")} TL`,
            durum: "onaylandı",
            link: "/creative",
          });
        }
      }
    } catch { /* bildirim hatası onayı bozmasın */ }
    revalidateAll();
    return { ok: true, message: "Talep onaylandı, bakiye yüklendi." };
  });
}

/** Yönetici bakiye talebini reddeder. */
export async function rejectCreditRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const req = await rejectCreditRequest(str(fd, "id"), actor.userId);
    await audit.append({ actor: toAuditActor(actor), action: "CREDIT_REQUEST_REJECTED", entityType: "CreditRequest", entityId: req.id, data: { tenantId: req.tenantId } });
    try {
      if (req.requestedByUserId) {
        const recipients = await recipientsFromUserIds([req.requestedByUserId]);
        if (recipients.length) {
          await dispatchNotification("CREDIT_REQUEST_REVIEWED", recipients, {
            tutar: `${req.amountTry.toLocaleString("tr-TR")} TL`,
            durum: "reddedildi",
            link: "/creative",
          });
        }
      }
    } catch { /* bildirim hatası reddi bozmasın */ }
    revalidateAll();
    return { ok: true, message: "Talep reddedildi." };
  });
}
