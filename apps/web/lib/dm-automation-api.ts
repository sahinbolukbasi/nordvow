import type { Actor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { DomainError, isDomainError } from "@infulancer/core/domain/errors";
import {
  assertDmAccess,
  isDmAutomationEnabled,
  isTenantAllowedForDmAutomation,
  type DmAccessAction,
} from "@infulancer/core/dm-automation/store";

const userActionHits = new Map<string, number[]>();

export function checkUserActionRateLimit(
  userId: string,
  action: string,
  maxPerMinute = 30,
): Response | null {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const list = (userActionHits.get(key) ?? []).filter((ts) => now - ts < 60_000);
  if (list.length >= maxPerMinute) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "Çok fazla istek gönderdiniz. Lütfen bir dakika bekleyin." } },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }
  list.push(now);
  userActionHits.set(key, list);
  return null;
}

export async function resolveActorDmTenant(actor: Actor, reqUrl?: string): Promise<string> {
  if (actor.role === "BRAND" && actor.brandId) return actor.brandId;
  if (actor.role === "INFLUENCER" && actor.influencerId) return actor.influencerId;
  if (reqUrl) {
    const requested = new URL(reqUrl).searchParams.get("tenantId")?.trim();
    if (requested) return requested;
  }
  const firstBrand = await prisma.brand.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return firstBrand?.id ?? "ajans";
}

export async function verifyDmApiAccess(
  actor: Actor,
  tenantId: string,
  action: DmAccessAction,
  target?: { campaignId?: string; igAccountId?: string },
): Promise<Response | null> {
  if (!isDmAutomationEnabled()) {
    return Response.json(
      { error: { code: "FEATURE_DISABLED", message: "DM Otomasyonu özelliği şu an devre dışı." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!(await isTenantAllowedForDmAutomation(tenantId))) {
    return Response.json(
      { error: { code: "PLAN_FORBIDDEN", message: "Bu özellik çalışma alanınızın mevcut planına dahil değil." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    await assertDmAccess(actor, tenantId, action, target);
    return null;
  } catch (err) {
    return dmErrorResponse(err);
  }
}

export function dmErrorResponse(err: unknown): Response {
  if (isDomainError(err)) {
    const status =
      err.code === "YETKISIZ"
        ? 403
        : err.code === "BULUNAMADI"
          ? 404
          : err.code === "CAKISMA"
            ? 409
            : 422;
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("[dm-automation-api]", err);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "DM Otomasyonu işlemi sırasında beklenmeyen bir hata oluştu." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export function assertValidId(id: string): string {
  const clean = id.trim();
  if (!clean || clean.length > 80) {
    throw new DomainError("DOGRULAMA", "Geçersiz kayıt kimliği.");
  }
  return clean;
}

