"use server";

import { revalidatePath } from "next/cache";
import {
  matchInstagramAutoReply,
  saveInstagramAutoReplies,
  type InstagramAutoReplyRule,
} from "@infulancer/core/messaging/instagram-auto-reply";
import { requireActor } from "@/lib/auth-guard";

export async function saveIgAutoReplyRulesAction(
  tenantId: string,
  rules: InstagramAutoReplyRule[],
): Promise<{ ok: boolean; rules?: InstagramAutoReplyRule[]; error?: string }> {
  const actor = await requireActor("ADMIN", "BRAND");
  const resolvedTenant = actor.role === "BRAND" ? actor.brandId! : tenantId;
  if (!resolvedTenant) return { ok: false, error: "Marka bulunamadı." };

  const saved = await saveInstagramAutoReplies(resolvedTenant, rules);
  revalidatePath("/marka/kanallar");
  revalidatePath("/admin/kanallar");
  return { ok: true, rules: saved };
}

export async function testIgAutoReplyAction(
  tenantId: string,
  sampleText: string,
): Promise<{ matchedTitle: string | null; reply: string | null }> {
  const actor = await requireActor("ADMIN", "BRAND");
  const resolvedTenant = actor.role === "BRAND" ? actor.brandId! : tenantId;
  if (!resolvedTenant) return { matchedTitle: null, reply: null };

  const hit = await matchInstagramAutoReply(resolvedTenant, sampleText);
  return {
    matchedTitle: hit?.title ?? null,
    reply: hit?.reply ?? null,
  };
}

