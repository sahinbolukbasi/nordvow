import { z } from "zod";
import {
  completeWhatsAppSignup,
  connectInstagram,
  OnboardingError,
} from "@infulancer/core/channels/onboarding";
import { vault } from "@infulancer/core/channels/vault";
import { prisma } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { envStr } from "@infulancer/core/env";
import { createSignedOAuthState } from "@infulancer/core/inbox/meta-security";
import { recordInboxAudit } from "@infulancer/core/inbox/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  inboxDisabledResponse,
  inboxErrorResponse,
  resolveActorInboxTenant,
} from "@/lib/inbox-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channelActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connect_instagram"),
    code: z.string().min(1).max(500),
    pageId: z.string().regex(/^\d{4,30}$/, { error: "Sayfa ID sayısal olmalı." }),
    igUserId: z.string().regex(/^\d{4,30}$/, { error: "Instagram hesap ID sayısal olmalı." }),
    accountType: z.enum(["BUSINESS", "CREATOR"]).default("BUSINESS"),
    igUsername: z.string().max(80).optional(),
  }),
  z.object({
    action: z.literal("connect_whatsapp"),
    code: z.string().min(1).max(500),
    wabaId: z.string().regex(/^\d{4,30}$/, { error: "WABA ID sayısal olmalı." }),
    phoneNumberId: z.string().regex(/^\d{4,30}$/, { error: "Phone Number ID sayısal olmalı." }),
    displayNumber: z.string().max(32).optional(),
    pin: z.string().regex(/^\d{6}$/, { error: "PIN 6 haneli sayı olmalı." }).default("123456"),
  }),
  z.object({
    action: z.literal("sync_templates"),
  }),
]);

export async function GET(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const [connections, templates] = await Promise.all([
      prisma.channelConnection.findMany({
        where: { tenantId, provider: { in: ["INSTAGRAM", "WHATSAPP"] } },
        include: { phoneNumbers: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.messageTemplate.findMany({
        where: { tenantId },
        orderBy: { updatedAt: "desc" },
        take: 40,
      }),
    ]);

    const igAppId = envStr("INSTAGRAM_APP_ID", "") || envStr("FACEBOOK_APP_ID", "");
    const baseUrl = envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com").replace(/\/$/, "");
    const oauthState = createSignedOAuthState({ userId: auth.actor.userId, tenantId });
    const igAuthorizeUrl = igAppId
      ? `https://www.instagram.com/oauth/authorize?client_id=${encodeURIComponent(igAppId)}&redirect_uri=${encodeURIComponent(`${baseUrl}/dashboard/mesaj-kutusu`)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments&state=${encodeURIComponent(oauthState)}`
      : null;

    return Response.json(
      {
        channels: connections.map((c) => {
          const ext = (c.externalIds ?? {}) as Record<string, unknown>;
          const waNum = c.phoneNumbers[0];
          return {
            id: c.id,
            provider: c.provider,
            status: c.status,
            displayName:
              c.provider === "WHATSAPP"
                ? waNum?.displayNumber ?? `WABA #${waNum?.wabaId ?? ext.waba_id ?? ""}`
                : ext.ig_username
                  ? `@${String(ext.ig_username)}`
                  : `IG #${String(ext.ig_user_id ?? "")}`,
            externalIds: ext,
            connectedAt: c.connectedAt?.toISOString() ?? c.createdAt.toISOString(),
            lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
            lastError: c.lastError ?? null,
          };
        }),
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          body: t.body,
        })),
        igAuthorizeUrl,
        graphApiVersion: envStr("META_GRAPH_API_VERSION", "v27.0"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const body = await readJson(req, channelActionSchema);

    if (body.action === "connect_instagram") {
      try {
        const conn = await connectInstagram({
          tenantId,
          code: body.code,
          pageId: body.pageId,
          igUserId: body.igUserId,
          accountType: body.accountType,
        });
        if (body.igUsername) {
          const ext = (conn.externalIds ?? {}) as Record<string, unknown>;
          await prisma.channelConnection.update({
            where: { id: conn.id },
            data: { externalIds: { ...ext, ig_username: body.igUsername.replace(/^@/, "") } },
          });
        }
        await recordInboxAudit(tenantId, auth.actor.userId, "channel.connect.instagram", conn.id);
        return Response.json({ connected: true, channelId: conn.id }, { status: 201 });
      } catch (e) {
        if (e instanceof OnboardingError) throw new DomainError("KURAL_IHLALI", e.message);
        throw e;
      }
    }

    if (body.action === "connect_whatsapp") {
      try {
        const num = await completeWhatsAppSignup({
          tenantId,
          code: body.code,
          wabaId: body.wabaId,
          phoneNumberId: body.phoneNumberId,
          displayNumber: body.displayNumber,
          pin: body.pin,
        });
        await recordInboxAudit(tenantId, auth.actor.userId, "channel.connect.whatsapp", num.connectionId);
        return Response.json({ connected: true, channelId: num.connectionId }, { status: 201 });
      } catch (e) {
        if (e instanceof OnboardingError) throw new DomainError("KURAL_IHLALI", e.message);
        throw e;
      }
    }

    // sync_templates: onaylı UTILITY şablonlarını senkronla
    const defaults = [
      {
        name: "talep_bilgilendirme_tr",
        language: "tr",
        category: "utility" as const,
        body: "Merhaba {{1}}, ilettiğiniz talep hakkında güncellememiz var: {{2}}. Yanıtınızı bu mesaj üzerinden paylaşabilirsiniz.",
      },
      {
        name: "kampanya_teslimat_durumu_tr",
        language: "tr",
        category: "utility" as const,
        body: "Merhaba {{1}}, kampanya sürecinizle ilgili bilgilendirme: {{2}}.",
      },
    ];
    for (const t of defaults) {
      await prisma.messageTemplate.upsert({
        where: { tenantId_name_language: { tenantId, name: t.name, language: t.language } },
        create: {
          tenantId,
          name: t.name,
          language: t.language,
          category: t.category,
          body: t.body,
          containsPromotion: false,
          status: "ACTIVE",
          quality: "HIGH",
          statusUpdatedAt: new Date(),
        },
        update: { status: "ACTIVE", statusUpdatedAt: new Date() },
      });
    }
    await recordInboxAudit(tenantId, auth.actor.userId, "channel.templates.sync");
    return Response.json({ synced: true });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const channelId = new URL(req.url).searchParams.get("id")?.trim();
    if (!channelId) throw new DomainError("DOGRULAMA", "Kanal ID parametresi gereklidir.");

    const conn = await prisma.channelConnection.findFirst({ where: { id: channelId, tenantId } });
    if (!conn) throw new DomainError("BULUNAMADI", "Kanal bağlantısı bulunamadı.");

    await vault().remove(conn.tokenRef).catch(() => undefined);
    await prisma.channelConnection.update({
      where: { id: conn.id },
      data: { status: "REVOKED", revokedAt: new Date(), lastError: "Kullanıcı tarafından bağlantı kesildi." },
    });
    await recordInboxAudit(tenantId, auth.actor.userId, "channel.disconnect", conn.id);
    return Response.json({ disconnected: true });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}
