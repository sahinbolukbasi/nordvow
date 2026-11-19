import { prisma } from "@infulancer/core/db";
import {
  isDmAutomationEnabled,
  isTenantAllowedForDmAutomation,
} from "@infulancer/core/dm-automation/store";
import type { TenantOption } from "@/components/inbox/unified-inbox-shell";
import { requireActor } from "@/lib/auth-guard";

export async function loadDmAutomationPageContext() {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true, email: true },
  });
  const actorName = user?.name ?? user?.email?.split("@")[0] ?? "Kullanıcı";

  let tenantOptions: TenantOption[] = [];
  let initialTenantId = "ajans";

  if (actor.role === "BRAND" && actor.brandId) {
    const b = await prisma.brand.findUnique({
      where: { id: actor.brandId },
      select: { id: true, name: true },
    });
    initialTenantId = actor.brandId;
    if (b) tenantOptions = [{ id: b.id, name: b.name, kind: "Marka" }];
  } else if (actor.role === "INFLUENCER" && actor.influencerId) {
    const inf = await prisma.influencer.findUnique({
      where: { id: actor.influencerId },
      select: { id: true, name: true },
    });
    initialTenantId = actor.influencerId;
    if (inf) tenantOptions = [{ id: inf.id, name: inf.name, kind: "Creator" }];
  } else {
    const [brands, influencers] = await Promise.all([
      prisma.brand.findMany({ orderBy: { name: "asc" }, take: 30, select: { id: true, name: true } }),
      prisma.influencer.findMany({ orderBy: { name: "asc" }, take: 30, select: { id: true, name: true } }),
    ]);
    tenantOptions = [
      ...brands.map((b): TenantOption => ({ id: b.id, name: b.name, kind: "Marka" })),
      ...influencers.map((i): TenantOption => ({ id: i.id, name: i.name, kind: "Creator" })),
    ];
    initialTenantId = brands[0]?.id ?? influencers[0]?.id ?? "ajans";
  }

  const featureEnabled = isDmAutomationEnabled();
  const tenantAllowed = featureEnabled && (await isTenantAllowedForDmAutomation(initialTenantId));
  const canAdminExport = actor.role !== "ADMIN" || !actor.staffRole;

  return {
    actor,
    actorName,
    tenantOptions,
    initialTenantId,
    featureEnabled,
    tenantAllowed,
    canAdminExport,
  };
}

