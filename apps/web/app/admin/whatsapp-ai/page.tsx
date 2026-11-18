import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { envStr } from "@infulancer/core/env";
import { PageHeader } from "@/components/ui/layout";
import { WhatsAppAiPanel, type WhatsAppUsageRow } from "@/components/admin/whatsapp-ai-panel";
import { assertPlatformAdmin, requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "WhatsApp AI Takip" };
export const dynamic = "force-dynamic";

export default async function AdminWhatsAppAiPage() {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [links, botPhoneCfg, dbWaNum, waMsgStats] = await Promise.all([
    prisma.whatsAppLink.findMany({ orderBy: [{ verified: "desc" }, { updatedAt: "desc" }], take: 300 }),
    prisma.configValue.findUnique({ where: { key: "whatsapp.bot_phone" } }),
    prisma.whatsAppNumber.findFirst({
      where: { displayNumber: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { displayNumber: true },
    }),
    prisma.message.groupBy({
      by: ["direction"],
      where: { createdAt: { gte: sevenDaysAgo }, conversation: { channel: "WHATSAPP" } },
      _count: true,
    }),
  ]);

  const userIds = links.map((l) => l.userId);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  let totalAiUserMsgs = 0;
  let totalAiBotMsgs = 0;

  const rows: WhatsAppUsageRow[] = links.map((l) => {
    const u = userMap.get(l.userId);
    const hist = Array.isArray(l.history)
      ? (l.history as { role?: string; text?: string }[]).filter(
          (m): m is { role: "user" | "assistant"; text: string } =>
            (m.role === "user" || m.role === "assistant") && typeof m.text === "string",
        )
      : [];
    const userMessages = hist.filter((m) => m.role === "user").length;
    const assistantMessages = hist.filter((m) => m.role === "assistant").length;
    totalAiUserMsgs += userMessages;
    totalAiBotMsgs += assistantMessages;

    return {
      id: l.id,
      userId: l.userId,
      userName: u?.name ?? "Bilinmeyen Kullanıcı",
      userEmail: u?.email ?? "—",
      userRole: u?.role ?? "—",
      waPhone: l.waPhone,
      pairingCode: l.pairingCode,
      verified: l.verified,
      verifiedAt: l.verifiedAt ? l.verifiedAt.toISOString() : null,
      updatedAt: l.updatedAt.toISOString(),
      userMessages,
      assistantMessages,
      history: hist,
    };
  });

  const cfgPhone = typeof botPhoneCfg?.value === "string" ? botPhoneCfg.value.trim() : "";
  const initialBotPhone = cfgPhone || envStr("WHATSAPP_BOT_PHONE", "") || dbWaNum?.displayNumber || "";

  const activeLinks = rows.filter((r) => r.verified).length;
  const inbound7d = waMsgStats.find((s) => s.direction === "INBOUND")?._count ?? 0;
  const outbound7d = waMsgStats.find((s) => s.direction === "OUTBOUND")?._count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp AI Takip & Yönetim"
        description="Kullanıcıların WhatsApp AI kullanım oranlarını, mesaj sayılarını, konuşma geçmişlerini ve profilde çıkan WhatsApp Business numarasını buradan yönetin."
      />
      <WhatsAppAiPanel
        initialBotPhone={initialBotPhone}
        rows={rows}
        stats={{
          totalLinks: rows.length,
          activeLinks,
          pendingLinks: rows.length - activeLinks,
          totalAiUserMsgs,
          totalAiBotMsgs,
          inbound7d,
          outbound7d,
          envBotConfigured: Boolean(envStr("WHATSAPP_ACCESS_TOKEN", "") && envStr("WHATSAPP_PHONE_NUMBER_ID", "")),
          llmMode: envStr("LLM_PROVIDER", "mock"),
        }}
      />
    </div>
  );
}
