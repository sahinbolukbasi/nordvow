import type { Actor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { isDomainError } from "@infulancer/core/domain/errors";
import { SendBlockedError } from "@infulancer/core/messaging/send";
import { jsonError } from "@/lib/uploads";

export function isInboxEnabled(): boolean {
  return process.env.INBOX_ENABLED !== "false";
}

export function inboxDisabledResponse(): Response | null {
  if (!isInboxEnabled()) {
    return jsonError(404, "Mesaj Kutusu özelliği şu an devre dışı.");
  }
  return null;
}

export async function resolveActorInboxTenant(actor: Actor, reqUrl?: string): Promise<string> {
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

export function inboxErrorResponse(err: unknown): Response {
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
      {
        error: err.message,
        code: (err.details?.code as string | undefined) ?? err.code,
        ...(err.details ? { details: err.details } : {}),
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (err instanceof SendBlockedError) {
    return Response.json(
      { error: err.message, code: err.code },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("[inbox-api]", err);
  return jsonError(500, "Mesaj Kutusu işlemi sırasında beklenmeyen bir hata oluştu.");
}

