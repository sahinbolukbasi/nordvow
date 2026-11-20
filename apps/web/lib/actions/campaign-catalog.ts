"use server";

import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import type { ActionState } from "@/lib/action-state";
import { attempt, bool, optStr, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

export type CampaignCatalogEntry = { id: string; kind: "sector" | "template"; name: string; sector?: string; active: boolean };
export const CAMPAIGN_CATALOG_KEY = "campaign.catalog";

export async function saveCampaignCatalogEntry(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const row = await prisma.configValue.findUnique({ where: { key: CAMPAIGN_CATALOG_KEY }, select: { value: true } });
    const current = Array.isArray(row?.value) ? (row.value as unknown as CampaignCatalogEntry[]) : [];
    const id = optStr(fd, "id") ?? crypto.randomUUID();
    const entry: CampaignCatalogEntry = {
      id,
      kind: str(fd, "kind") === "template" ? "template" : "sector",
      name: str(fd, "name").trim().slice(0, 80),
      sector: optStr(fd, "sector") ?? undefined,
      active: bool(fd, "active"),
    };
    if (entry.name.length < 2) throw new Error("Ad en az 2 karakter olmalı.");
    const next = [...current.filter((item) => item.id !== id), entry];
    await prisma.configValue.upsert({ where: { key: CAMPAIGN_CATALOG_KEY }, create: { key: CAMPAIGN_CATALOG_KEY, value: next }, update: { value: next } });
    await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_CATALOG_UPDATED", entityType: "ConfigValue", entityId: CAMPAIGN_CATALOG_KEY, data: entry });
    revalidateAll();
    return { ok: true, message: "Kampanya kataloğu kaydedildi." };
  });
}

export async function deleteCampaignCatalogEntry(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const row = await prisma.configValue.findUnique({ where: { key: CAMPAIGN_CATALOG_KEY }, select: { value: true } });
    const current = Array.isArray(row?.value) ? (row.value as unknown as CampaignCatalogEntry[]) : [];
    const next = current.filter((item) => item.id !== str(fd, "id"));
    await prisma.configValue.upsert({ where: { key: CAMPAIGN_CATALOG_KEY }, create: { key: CAMPAIGN_CATALOG_KEY, value: next }, update: { value: next } });
    await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_CATALOG_DELETED", entityType: "ConfigValue", entityId: CAMPAIGN_CATALOG_KEY, data: { id: str(fd, "id") } });
    revalidateAll();
    return { ok: true, message: "Kampanya kataloğu silindi." };
  });
}
