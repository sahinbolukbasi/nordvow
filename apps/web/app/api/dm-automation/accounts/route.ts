import { z } from "zod";
import { envStr } from "@infulancer/core/env";
import { createSignedOAuthState, verifySignedOAuthState } from "@infulancer/core/inbox/meta-security";
import { getHourlyRateLimitCap, getHourlyUsageCount } from "@infulancer/core/dm-automation/rate-limiter";
import {
  connectDmInstagramAccount,
  disconnectDmInstagramAccount,
  getMonthlyUsage,
  getTenantDmQuota,
  listDmInstagramAccounts,
} from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const connectSchema = z.object({
  code: z.string().min(1).max(500).optional(),
  state: z.string().min(1).max(1000).optional(),
  igUserId: z.string().min(3).max(60).optional(),
  igUsername: z.string().min(1).max(80).optional(),
  accountType: z.enum(["BUSINESS", "CREATOR", "PERSONAL"]).default("CREATOR"),
  accessToken: z.string().max(1000).optional(),
});

export async function GET(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view");
    if (denied) return denied;

    const [accounts, quota, monthlyUsed] = await Promise.all([
      listDmInstagramAccounts(tenantId),
      getTenantDmQuota(tenantId),
      getMonthlyUsage(tenantId),
    ]);

    const hourlyCap = getHourlyRateLimitCap();
    const igAppId = envStr("INSTAGRAM_APP_ID", "") || envStr("FACEBOOK_APP_ID", "");
    const baseUrl = (envStr("APP_URL", "") || envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com")).replace(/\/$/, "");
    const oauthState = createSignedOAuthState({ userId: auth.actor.userId, tenantId });
    const igAuthorizeUrl = igAppId
      ? `https://www.instagram.com/oauth/authorize?client_id=${encodeURIComponent(igAppId)}&redirect_uri=${encodeURIComponent(`${baseUrl}/dashboard/dm-otomasyonu`)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments&state=${encodeURIComponent(oauthState)}`
      : null;

    return Response.json(
      {
        accounts: accounts.map((a) => ({
          ...a,
          hourlyUsed: getHourlyUsageCount(a.igUserId),
          hourlyCap,
        })),
        quota,
        monthlyUsed,
        igAuthorizeUrl,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return dmErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "admin");
    if (denied) return denied;

    const body = await readJson(req, connectSchema);
    let targetTenantId = tenantId;
    if (body.code && body.state) {
      const verified = verifySignedOAuthState(body.state);
      if (!verified || verified.userId !== auth.actor.userId) {
        return Response.json(
          { error: { code: "YETKISIZ", message: "Instagram OAuth doğrulama durumu geçersiz veya süresi dolmuş." } },
          { status: 400 },
        );
      }
      targetTenantId = verified.tenantId;
    }

    const baseUrl = (envStr("APP_URL", "") || envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com")).replace(/\/$/, "");
    const account = await connectDmInstagramAccount({
      tenantId: targetTenantId,
      actorId: auth.actor.userId,
      code: body.code,
      redirectUri: `${baseUrl}/dashboard/dm-otomasyonu`,
      igUserId: body.igUserId,
      igUsername: body.igUsername,
      accountType: body.accountType,
      accessToken: body.accessToken,
    });
    return Response.json({ account }, { status: 201 });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const url = new URL(req.url);
    const accountId = url.searchParams.get("id")?.trim() ?? "";
    const wipe = url.searchParams.get("wipe") === "true";

    const denied = await verifyDmApiAccess(auth.actor, tenantId, "admin", { igAccountId: accountId });
    if (denied) return denied;

    const res = await disconnectDmInstagramAccount(tenantId, accountId, auth.actor.userId, wipe);
    return Response.json(res);
  } catch (err) {
    return dmErrorResponse(err);
  }
}

