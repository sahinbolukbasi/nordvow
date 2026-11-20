"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { prisma, type Platform } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { platformLabels } from "@infulancer/core/domain/labels";
import { publish } from "@infulancer/core/events";
import { setInfluencerCategories } from "@infulancer/core/domain/categories";
import { cleanSocialHandle } from "@infulancer/core/social/handle";
import { readCategorySelection } from "@/lib/categories";
import type { ActionState } from "@/lib/action-state";
import { attempt, bool, intOrNull, optStr, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { assertPlatformAdmin, requireActor } from "@/lib/auth-guard";
import { isValidTimeZone } from "@/lib/time";
import { isRegion } from "@infulancer/core/i18n/regions";

const PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE"];

const influencerSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.string().min(2).max(60),
  // Ülkeye göre IBAN (TR 26, DE 22, FR 27 hane…): ülke koduyla başlayan geçerli IBAN biçimi.
  iban: z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, { error: "Ülke koduyla başlayan geçerli bir IBAN girin (ör. TR…, DE…)." }),
  country: z.string().refine(isRegion, { error: "Ülke seçin." }),
  ibanHolder: z.string().min(2).max(120),
  taxStatus: z.enum(["FATURA", "SERBEST_MESLEK_MAKBUZU", "STOPAJLI"]),
  canIssueInvoice: z.enum(["true", "false"], { error: "Fatura kesebilir mi? seçimi zorunlu." }),
  audienceTimezone: z.string().refine(isValidTimeZone, { error: "Geçerli bir IANA saat dilimi seçin." }),
});

const labels: Record<string, string> = {
  name: "Ad soyad",
  category: "Kategori",
  iban: "IBAN",
  ibanHolder: "Hesap sahibi",
  taxStatus: "Vergi durumu",
  canIssueInvoice: "Fatura kesebilir mi?",
  audienceTimezone: "Kitle saat dilimi",
  country: "Kayıtlı ülke",
};

const demographicsSchema = z.record(z.string(), z.unknown());

type AccountInput = { platform: Platform; handle: string; followers: number; engagementRate: number; demographics: Record<string, unknown> };

/** Formdaki yapılandırılmış kitle alanları (kadın %, yaş grupları, şehir:%) ham JSON'un üzerine yazılır. */
function mergeStructuredAudience(fd: FormData, p: string, base: Record<string, unknown>, label: string): Record<string, unknown> {
  const pct = (key: string) => {
    const raw = str(fd, key).replace(",", ".").replace("%", "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new DomainError("DOGRULAMA", `${label}: kitle yüzdeleri 0–100 arası olmalı.`);
    return Math.round(n * 100) / 10000;
  };
  const out: Record<string, unknown> = { ...base };
  const w = pct(`${p}w`);
  if (w != null) out.gender = { kadin: w, erkek: Math.round((1 - w) * 10000) / 10000 };
  const ages: Record<string, number> = { ...((base.ageGroups as Record<string, number> | undefined) ?? {}) };
  let anyAge = false;
  for (const g of ["13-17", "18-24", "25-34", "35-44", "45+"]) {
    const v = pct(`${p}age_${g}`);
    if (v != null) {
      ages[g] = v;
      anyAge = true;
    }
  }
  if (anyAge) out.ageGroups = ages;
  const citiesRaw = str(fd, `${p}cities`).trim();
  if (citiesRaw) {
    const topCities = citiesRaw.split(",").map((part) => {
      const [city, share] = part.split(":").map((x) => x.trim());
      const n = Number((share ?? "").replace(",", "."));
      if (!city || !Number.isFinite(n) || n < 0 || n > 100) throw new DomainError("DOGRULAMA", `${label}: şehirler "İstanbul:38" biçiminde olmalı.`);
      return { city, share: Math.round(n * 100) / 10000 };
    });
    out.topCities = topCities.slice(0, 10);
  }
  return out;
}

function parseAccounts(fd: FormData): AccountInput[] {
  const out: AccountInput[] = [];
  for (const platform of PLATFORMS) {
    const p = `acc_${platform}_`;
    if (!bool(fd, `${p}enabled`)) continue;
    const label = platformLabels[platform];
    const rawHandle = str(fd, `${p}handle`);
    const handle = cleanSocialHandle(rawHandle, platform);
    if (!/^[a-z0-9._-]{2,60}$/.test(handle)) throw new DomainError("DOGRULAMA", `${label}: geçerli bir kullanıcı adı girin.`);
    const followers = intOrNull(str(fd, `${p}followers`));
    if (followers == null || Number.isNaN(followers) || followers < 0) {
      throw new DomainError("DOGRULAMA", `${label}: takipçi sayısı pozitif tam sayı olmalı.`);
    }
    const erRaw = str(fd, `${p}er`).replace(",", ".");
    const erPct = Number(erRaw);
    if (erRaw === "" || !Number.isFinite(erPct) || erPct < 0 || erPct > 100) {
      throw new DomainError("DOGRULAMA", `${label}: etkileşim oranı 0–100 arası yüzde olmalı.`);
    }
    const demoRaw = str(fd, `${p}demographics`) || "{}";
    let demographics: Record<string, unknown>;
    try {
      const parsed = demographicsSchema.safeParse(JSON.parse(demoRaw));
      if (!parsed.success) throw new Error("shape");
      demographics = parsed.data;
    } catch {
      throw new DomainError("DOGRULAMA", `${label}: demografi alanı geçerli bir JSON nesnesi olmalı (ör. {"kadin": 0.7}).`);
    }
    demographics = mergeStructuredAudience(fd, p, demographics, label);
    out.push({
      platform,
      handle: handle.trim().replace(/^@+/, ""),
      followers,
      engagementRate: Math.round(erPct * 100) / 10000,
      demographics,
    });
  }
  return out;
}

/** Influencer oluşturur ya da günceller; hesaplar platform başına tektir. */
export async function saveInfluencer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  const id = optStr(fd, "id");
  const created: { id?: string } = {};
  const res = await attempt(async () => {
    const cats = await readCategorySelection(fd);
    const input = parseInput(
      influencerSchema,
      {
        name: str(fd, "name"),
        category: cats.legacyName,
        iban: str(fd, "iban").replace(/\s/g, "").toUpperCase(),
        ibanHolder: str(fd, "ibanHolder"),
        taxStatus: str(fd, "taxStatus"),
        canIssueInvoice: str(fd, "canIssueInvoice"),
        audienceTimezone: str(fd, "audienceTimezone"),
        country: (str(fd, "country") || "TR").toUpperCase(),
      },
      labels,
    );
    const accounts = parseAccounts(fd);
    const userEmail = optStr(fd, "userEmail")?.toLowerCase() ?? null;
    const userPassword = str(fd, "userPassword");
    if (!id && userEmail) {
      if (!z.email().safeParse(userEmail).success) throw new DomainError("DOGRULAMA", "Kullanıcı e-postası geçersiz.");
      if (userPassword.length < 8) throw new DomainError("DOGRULAMA", "Geçici şifre en az 8 karakter olmalı.");
    }
    const passwordHash = !id && userEmail ? await bcrypt.hash(userPassword, 10) : null;
    const city = optStr(fd, "city")?.slice(0, 60) ?? null;
    const bio = optStr(fd, "bio")?.slice(0, 1000) ?? null;
    const data = { ...input, canIssueInvoice: input.canIssueInvoice === "true", city, bio };

    await prisma.$transaction(async (tx) => {
      let influencerId: string;
      if (id) {
        const exists = await tx.influencer.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new DomainError("BULUNAMADI", "Influencer bulunamadı.");
        await tx.influencer.update({ where: { id }, data });
        influencerId = id;
      } else {
        influencerId = (await tx.influencer.create({ data })).id;
        created.id = influencerId;
      }

      await setInfluencerCategories(tx, influencerId, cats.ids, cats.primaryId);
      const existing = await tx.socialAccount.findMany({ where: { influencerId } });
      const now = new Date();
      for (const acc of accounts) {
        const prev = existing.find((e) => e.platform === acc.platform);
        const values = {
          handle: acc.handle,
          followers: acc.followers,
          engagementRate: acc.engagementRate,
          demographics: acc.demographics as object,
        };
        const saved = prev
          ? await tx.socialAccount.update({ where: { id: prev.id }, data: values })
          : await tx.socialAccount.create({ data: { influencerId, platform: acc.platform, ...values } });
        // ER/takipçi trendi için değişiklikte geçmiş kaydı.
        if (!prev || prev.followers !== acc.followers || Number(prev.engagementRate) !== acc.engagementRate) {
          await tx.socialAccountSnapshot.create({
            data: {
              socialAccountId: saved.id,
              followers: acc.followers,
              engagementRate: acc.engagementRate,
              demographics: acc.demographics as object,
              takenAt: now,
            },
          });
        }
      }
      const removed = existing.filter((e) => !accounts.some((a) => a.platform === e.platform));
      if (removed.length) await tx.socialAccount.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });

      if (!id && userEmail && passwordHash) {
        await tx.user.create({
          data: { email: userEmail, name: input.name, role: "INFLUENCER", influencerId, passwordHash },
        });
      }
      await audit.append({
        actor: toAuditActor(actor),
        action: id ? "INFLUENCER_UPDATED" : "INFLUENCER_CREATED",
        entityType: "Influencer",
        entityId: influencerId,
        // IBAN audit'e maskeli yazılır.
        data: {
          ...input,
          iban: `${input.iban.slice(0, 4)}…${input.iban.slice(-4)}`,
          accounts: accounts.map((a) => ({ platform: a.platform, handle: a.handle, followers: a.followers })),
          userEmail: !id ? userEmail : undefined,
        },
      });
    });
    if (created.id) await publish({ type: "INFLUENCER_CREATED", influencerId: created.id });
    // Bağlı hesaplardan takipçi ve profil fotoğrafını hemen çek (senkron kapalıysa sessizce geçer).
    const savedId = id ?? created.id;
    if (savedId) await import("@infulancer/core/social/sync").then((m) => m.syncInfluencer(savedId)).catch(() => null);
    revalidateAll();
    return { ok: true, message: "Influencer kaydedildi." };
  });
  if (res.ok && created.id) redirect(`/admin/influencerlar/${created.id}/duzenle`);
  return res;
}

/** Influencer'ın tüm hesaplarını resmî API'lerden (yoksa demo veri) hemen senkronlar. */
export async function syncInfluencerAccounts(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const { syncInfluencer } = await import("@infulancer/core/social/sync");
    const results = await syncInfluencer(id);
    revalidateAll();
    const failed = results.filter((r) => !r.ok);
    if (!results.length) return { ok: true, message: "Senkronlanacak hesap yok." };
    if (failed.length === results.length) return { error: failed.map((f) => f.message).join(" ") };
    return { ok: true, message: `${results.length - failed.length}/${results.length} hesap güncellendi.${failed.length ? ` Hata: ${failed.map((f) => f.message).join(" ")}` : ""}` };
  });
}

const toggleInfluencerSchema = z.object({
  influencerId: z.string().min(1).max(64),
  active: z.enum(["true", "false"]),
});

/** Admin: influencer'ı pasife çeker (sistemden gizler, girişini askıya alır) veya yeniden aktifleştirir. */
export async function toggleInfluencerActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(
      toggleInfluencerSchema,
      { influencerId: str(fd, "influencerId"), active: str(fd, "active") },
      { influencerId: "Influencer", active: "Durum" },
    );
    const nextActive = input.active === "true";

    const name = await prisma.$transaction(async (tx) => {
      const inf = await tx.influencer.findUnique({
        where: { id: input.influencerId },
        select: { id: true, name: true, isActive: true, user: { select: { id: true, status: true } } },
      });
      if (!inf) throw new DomainError("BULUNAMADI", "Influencer bulunamadı.");

      await tx.influencer.update({ where: { id: inf.id }, data: { isActive: nextActive } });
      if (inf.user) {
        if (!nextActive) {
          await tx.user.update({ where: { id: inf.user.id }, data: { status: "SUSPENDED" } });
        } else if (inf.user.status === "SUSPENDED") {
          await tx.user.update({ where: { id: inf.user.id }, data: { status: "ACTIVE" } });
        }
      }

      await audit.append({
        actor: toAuditActor(actor),
        action: nextActive ? "INFLUENCER_ACTIVATED" : "INFLUENCER_DEACTIVATED",
        entityType: "Influencer",
        entityId: inf.id,
        data: { name: inf.name, from: inf.isActive, to: nextActive },
      });
      return inf.name;
    });

    revalidateAll();
    return {
      ok: true,
      message: nextActive ? `${name} aktifleştirildi.` : `${name} pasife çekildi ve sistemden gizlendi.`,
    };
  });
}

const deleteInfluencerSchema = z.object({
  influencerId: z.string().min(1).max(64),
});

/** Admin: kampanya ataması veya finansal kaydı olmayan influencer'ı kalıcı olarak siler. */
export async function deleteInfluencerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  const redirectTo = optStr(fd, "redirectTo");
  const res = await attempt(async () => {
    const input = parseInput(
      deleteInfluencerSchema,
      { influencerId: str(fd, "influencerId") },
      { influencerId: "Influencer" },
    );
    const inf = await prisma.influencer.findUnique({
      where: { id: input.influencerId },
      select: {
        id: true,
        name: true,
        user: { select: { id: true } },
        _count: { select: { assignments: true, ledgerEntries: true, payoutRequests: true } },
      },
    });
    if (!inf) throw new DomainError("BULUNAMADI", "Influencer bulunamadı.");
    if (inf._count.assignments > 0 || inf._count.ledgerEntries > 0 || inf._count.payoutRequests > 0) {
      throw new DomainError(
        "KURAL_IHLALI",
        "Bu influencer'a bağlı kampanya ataması veya finansal kayıt (hakediş/ödeme) bulunduğu için kalıcı silinemiyor. Sistemden gizlemek için 'Pasife Çek' seçeneğini kullanabilirsiniz.",
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.rateCard.deleteMany({ where: { influencerId: inf.id } });
        await tx.campaignApplication.deleteMany({ where: { influencerId: inf.id } });
        if (inf.user) {
          await tx.user.update({
            where: { id: inf.user.id },
            data: { status: "SUSPENDED", influencerId: null },
          });
        }
        await tx.influencer.delete({ where: { id: inf.id } });
        await audit.append({
          actor: toAuditActor(actor),
          action: "INFLUENCER_DELETED",
          entityType: "Influencer",
          entityId: inf.id,
          data: { name: inf.name },
        });
      });
    } catch (e: unknown) {
      const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
      if (code === "P2003") {
        throw new DomainError(
          "KURAL_IHLALI",
          "Bu influencer'a bağlı kayıtlar bulunduğu için kalıcı silinemiyor. Sistemden gizlemek için 'Pasife Çek' seçeneğini kullanabilirsiniz.",
        );
      }
      throw e;
    }

    revalidateAll();
    return { ok: true, message: `${inf.name} kalıcı olarak silindi.` };
  });
  if (res.ok && redirectTo === "/admin/influencerlar") redirect(redirectTo);
  return res;
}
