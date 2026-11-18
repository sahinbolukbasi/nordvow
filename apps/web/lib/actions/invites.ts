"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { approveApplication, createInvite, registerWithInvite, rejectApplication, revokeInvite } from "@infulancer/core/access/invites";
import { prisma } from "@infulancer/core/db";
import { envStr } from "@infulancer/core/env";
import { adminRecipients, dispatchNotification } from "@infulancer/core/notify/dispatch";
import type { ActionState } from "@/lib/action-state";
import { attempt, bool, optStr, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { notifyAdmins } from "@/lib/notify";
import { signIn, signOut } from "@/auth";

/** Davetli kayıt (oturum gerektirmez). Başarıda kullanıcı oturum açar ve onay bekleme ekranına gider. */
export async function registerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email");
  const password = str(fd, "password");
  const res = await attempt(async () => {
    if (password !== str(fd, "password2")) return { error: "Şifreler eşleşmiyor." };
    const kind = str(fd, "kind") === "BRAND" ? "BRAND" : "INFLUENCER";
    const categoryIds = fd.getAll("categoryIds").map(String);
    const name = str(fd, "name");
    await registerWithInvite({
      code: str(fd, "code"),
      email,
      password,
      name,
      phone: str(fd, "phone"),
      acceptTerms: bool(fd, "acceptTerms"),
      application:
        kind === "BRAND"
          ? { kind, companyName: str(fd, "companyName"), taxOffice: str(fd, "taxOffice"), taxNumber: str(fd, "taxNumber"), categoryIds, website: optStr(fd, "website") ?? undefined, about: optStr(fd, "about") ?? undefined }
          : {
              kind,
              categoryIds,
              city: optStr(fd, "city") ?? undefined,
              instagram: optStr(fd, "instagram") ?? undefined,
              tiktok: optStr(fd, "tiktok") ?? undefined,
              youtube: optStr(fd, "youtube") ?? undefined,
              about: optStr(fd, "about") ?? undefined,
            },
    });
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await dispatchNotification("USER_REGISTERED", [
        { email: normalizedEmail, vars: { ad: name, link: "/onay-bekliyor" } },
      ]);
      const admins = await adminRecipients();
      if (admins.length) {
        await dispatchNotification("ADMIN_NEW_APPLICATION", admins, {
          ad: name,
          rol: kind === "BRAND" ? "Marka" : "Influencer",
          eposta: normalizedEmail,
          link: "/admin/davetler",
        });
      }
    } catch (e) {
      console.error("[invites] register notification error:", e);
    }
    return { ok: true };
  });
  if (!res.ok) return res;
  await signIn("credentials", { email, password, redirectTo: "/onay-bekliyor" });
  return res;
}

export async function signOutAction() {
  await signOut({ redirectTo: "/giris" });
}

export async function createInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "INFLUENCER");
  return attempt(async () => {
    const inv = await createInvite(actor, {
      targetRole: str(fd, "targetRole") === "BRAND" ? "BRAND" : "INFLUENCER",
      maxUses: Number(str(fd, "maxUses") || "1"),
      expiresInDays: Number(str(fd, "days") || "14"),
      note: optStr(fd, "note"),
    });
    revalidateAll();
    return { ok: true, message: `Davet oluşturuldu: ${inv.code}`, data: { code: inv.code } };
  });
}

export async function revokeInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "INFLUENCER");
  return attempt(async () => {
    await revokeInvite(actor, str(fd, "id"));
    revalidateAll();
    return { ok: true, message: "Davet iptal edildi." };
  });
}

export async function reviewApplicationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    if (str(fd, "decision") === "approve") {
      await approveApplication(actor, id, { existingBrandId: optStr(fd, "existingBrandId"), note: optStr(fd, "note") });
      try {
        const appRow = await prisma.signupApplication.findUnique({
          where: { id },
          select: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                locale: true,
                influencer: { select: { socialAccounts: { where: { platform: "INSTAGRAM" }, select: { handle: true }, take: 1 } } },
              },
            },
          },
        });
        const u = appRow?.user;
        if (u) {
          const base = (envStr("APP_URL", "") || envStr("AUTH_URL", "") || "https://nordvow.com").replace(/\/+$/, "");
          await dispatchNotification("USER_APPROVED", [
            {
              userId: u.id,
              email: u.email,
              phone: u.phone,
              instagram: u.influencer?.socialAccounts[0]?.handle ?? null,
              locale: u.locale,
              vars: { ad: u.name, link: `${base}/giris` },
            },
          ]);
        }
      } catch {
        /* hoş geldin bildirimi hatası onayı bozmasın */
      }
      revalidateAll();
      return { ok: true, message: "Başvuru onaylandı; kullanıcıya hoş geldiniz e-postası gönderildi." };
    }
    const rejectNote = str(fd, "note");
    await rejectApplication(actor, id, rejectNote);
    try {
      const appRow = await prisma.signupApplication.findUnique({
        where: { id },
        select: { user: { select: { id: true, email: true, name: true, locale: true } } },
      });
      if (appRow?.user) {
        await dispatchNotification("USER_REJECTED", [
          {
            userId: appRow.user.id,
            email: appRow.user.email,
            locale: appRow.user.locale,
            vars: { ad: appRow.user.name, neden: rejectNote ? `\n\nAçıklama: ${rejectNote}` : "" },
          },
        ]);
      }
    } catch (e) {
      console.error("[invites] reject notification error:", e);
    }
    revalidateAll();
    return { ok: true, message: "Başvuru reddedildi." };
  });
}

/** Onaylanan kullanıcı oturumu yenilemek için çıkış yapıp tekrar girer. */
export async function reloginAction() {
  await signOut({ redirectTo: "/giris?onaylandi=1" });
  redirect("/giris");
}

export type InviteRequestRecord = {
  id: string;
  role: "INFLUENCER" | "BRAND";
  name: string;
  email: string;
  phone: string;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  companyName: string | null;
  note: string | null;
  status: "NEW" | "CONTACTED" | "INVITED" | "ARCHIVED";
  createdAt: string;
};

const INVITE_REQUESTS_KEY = "invite.requests";

/** Davet kodu olmayan kullanıcıların başvuru formu (oturum gerektirmez). */
export async function submitInviteRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const role: "INFLUENCER" | "BRAND" = str(fd, "role") === "BRAND" ? "BRAND" : "INFLUENCER";
    const name = str(fd, "name").trim();
    const email = str(fd, "email").trim().toLowerCase();
    const phone = str(fd, "phone").trim();
    const instagram = optStr(fd, "instagram");
    const tiktok = optStr(fd, "tiktok");
    const youtube = optStr(fd, "youtube");
    const companyName = optStr(fd, "companyName");
    const note = optStr(fd, "note");

    if (name.length < 2 || name.length > 100) {
      return { error: "Lütfen geçerli bir ad soyad girin." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: "Lütfen geçerli bir e-posta adresi girin." };
    }
    if (phone.length < 7 || phone.length > 30) {
      return { error: "Lütfen geçerli bir telefon numarası girin." };
    }
    if (role === "INFLUENCER" && !instagram && !tiktok && !youtube) {
      return { error: "En az bir sosyal medya hesabı (Instagram, TikTok veya YouTube) girmelisiniz." };
    }
    if (role === "BRAND" && !companyName) {
      return { error: "Marka / şirket adı girmelisiniz." };
    }

    const row = await prisma.configValue.findUnique({ where: { key: INVITE_REQUESTS_KEY }, select: { value: true } });
    const list: InviteRequestRecord[] = Array.isArray(row?.value) ? (row.value as InviteRequestRecord[]) : [];
    const item: InviteRequestRecord = {
      id: randomUUID(),
      role,
      name,
      email,
      phone,
      instagram: instagram ?? null,
      tiktok: tiktok ?? null,
      youtube: youtube ?? null,
      companyName: companyName ?? null,
      note: note ?? null,
      status: "NEW",
      createdAt: new Date().toISOString(),
    };

    const next = [item, ...list].slice(0, 500);
    await prisma.configValue.upsert({
      where: { key: INVITE_REQUESTS_KEY },
      create: { key: INVITE_REQUESTS_KEY, value: next },
      update: { value: next },
    });

    try {
      const admins = await adminRecipients();
      if (admins.length) {
        await dispatchNotification("ADMIN_NEW_APPLICATION", admins, {
          ad: name,
          rol: role === "BRAND" ? companyName || "Marka" : "Influencer",
          eposta: email,
          link: "/admin/davetler?bolum=talepler",
        });
      } else {
        await notifyAdmins(prisma, {
          title: "Yeni davet kodu başvurusu",
          body: `${name} (${role === "BRAND" ? companyName || "Marka" : "Influencer"}) · ${email}`,
          href: "/admin/davetler?bolum=talepler",
        });
      }
    } catch {
      /* bildirim hatası başvuruyu bozmasın */
    }

    revalidateAll();
    return {
      ok: true,
      message: "Başvurunuz alındı. Ekibimiz inceleyip en kısa sürede size geri dönüş sağlayacaktır.",
    };
  });
}

export async function updateInviteRequestStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const statusRaw = str(fd, "status");
    const status: InviteRequestRecord["status"] =
      statusRaw === "CONTACTED" || statusRaw === "INVITED" || statusRaw === "ARCHIVED" ? statusRaw : "NEW";

    const row = await prisma.configValue.findUnique({ where: { key: INVITE_REQUESTS_KEY }, select: { value: true } });
    const list: InviteRequestRecord[] = Array.isArray(row?.value) ? (row.value as InviteRequestRecord[]) : [];
    const next = list.map((item) => (item.id === id ? { ...item, status } : item));
    await prisma.configValue.upsert({
      where: { key: INVITE_REQUESTS_KEY },
      create: { key: INVITE_REQUESTS_KEY, value: next },
      update: { value: next },
    });

    revalidateAll();
    return { ok: true, message: "Başvuru durumu güncellendi." };
  });
}
