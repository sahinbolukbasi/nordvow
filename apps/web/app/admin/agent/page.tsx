import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { isAgentCoreEnabled } from "@infulancer/core/assistant/agentcore";
import { agentOverview } from "@infulancer/core/agents/catalog";
import { envStr } from "@infulancer/core/env";
import { syncReasonNotes, syncSourceLabels } from "@infulancer/core/social/sync";
import { AgentRunList } from "@/components/agent/agent-run-list";
import { AuditAgentControls } from "@/components/agent/agent-forms";
import { CustomAgentCard, CustomAgentForm, InstagramExplorer, SyncCampaignInstagramButton } from "@/components/agent/agentcore-center";
import { TrackerGallery, TrackerList } from "@/components/agent/tracker-ui";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { requireActor } from "@/lib/auth-guard";
import type { CustomAgentSpec } from "@/lib/actions/agents";
import { loadTrackerViews, templateViews, trackerTargets } from "@/lib/trackers";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Agent Merkezi (AWS AgentCore)" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SECTIONS = [
  { id: "kampanya", label: "Kampanya & Analitik" },
  { id: "instagram", label: "Instagram Gezgini" },
  { id: "ozel", label: "Özel Agent (AgentCore)" },
] as const;

export default async function AgentCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tt = await getTT();
  await requireActor("ADMIN");
  const sp = await searchParams;
  const section = SECTIONS.find((s) => s.id === one(sp.bolum))?.id ?? "kampanya";

  const [campaigns, customRow, openCount] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
      select: { id: true, name: true, status: true, brand: { select: { name: true } } },
    }),
    prisma.configValue.findUnique({ where: { key: "custom.agents" }, select: { value: true } }),
    prisma.agentRun.count({ where: { status: "ACIK" } }),
  ]);

  const customAgents = Array.isArray(customRow?.value) ? (customRow.value as CustomAgentSpec[]) : [];
  const selectedCampaignId = one(sp.kampanya) || campaigns[0]?.id || "";
  const igReady = Boolean(envStr("INSTAGRAM_IG_USER_ID", "") && (envStr("INSTAGRAM_ACCESS_TOKEN", "") || envStr("META_IG_TOKEN", "") || envStr("META_SYSTEM_USER_TOKEN", "")));
  const agentCoreLive = isAgentCoreEnabled();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tt("Agent Merkezi")}
        description={tt("Kampanya bazlı botları yönetin, toplanan Instagram verilerini analiz edin ve AWS AgentCore ile özel ajanlar oluşturun.")}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <StatusDot tone={agentCoreLive ? "active" : "muted"}>
              {agentCoreLive ? "AWS AgentCore Aktif" : "AWS AgentCore (Bedrock Yedekli)"}
            </StatusDot>
            <StatusDot tone={igReady ? "active" : "passive"}>
              {igReady ? "Instagram (Nordvow Meta) Hazır" : "Instagram Token Eksik"}
            </StatusDot>
          </div>
        }
      />

      <nav aria-label={tt("Agent merkezi bölümleri")} className="flex flex-wrap gap-2 border-b border-border">
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            href={`/admin/agent?bolum=${s.id}${selectedCampaignId ? `&kampanya=${selectedCampaignId}` : ""}`}
            aria-current={section === s.id ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", section === s.id ? "border-fg text-fg font-medium" : "border-transparent text-fg-muted hover:text-fg")}
          >
            {s.label}
            {s.id === "kampanya" && openCount ? ` (${openCount} açık)` : ""}
            {s.id === "ozel" && customAgents.length ? ` (${customAgents.length})` : ""}
          </Link>
        ))}
      </nav>

      {section === "kampanya" ? (
        <CampaignAgentsView campaigns={campaigns} selectedCampaignId={selectedCampaignId} customAgents={customAgents} />
      ) : section === "instagram" ? (
        <InstagramOnlyView />
      ) : (
        <CustomAgentsView campaigns={campaigns} selectedCampaignId={selectedCampaignId} customAgents={customAgents} />
      )}
    </div>
  );
}

async function CampaignAgentsView({
  campaigns,
  selectedCampaignId,
  customAgents,
}: {
  campaigns: { id: string; name: string; status: string; brand: { name: string } }[];
  selectedCampaignId: string;
  customAgents: CustomAgentSpec[];
}) {
  const tt = await getTT();
  if (!campaigns.length) {
    return (
      <Card interactive={false}>
        <p className="text-sm text-fg-muted">{tt("Henüz kampanya yok. Önce bir kampanya oluşturun.")}</p>
      </Card>
    );
  }

  const [campaign, trackers, templates, targets] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: selectedCampaignId },
      include: {
        brand: { select: { name: true } },
        assignments: {
          include: {
            influencer: {
              select: {
                id: true,
                name: true,
                socialAccounts: {
                  where: { platform: "INSTAGRAM" },
                  select: { handle: true, followers: true, engagementRate: true, avgLikes: true, avgComments: true, lastSyncedAt: true },
                },
              },
            },
            deliverables: { select: { id: true, platform: true, contentType: true, status: true } },
          },
        },
      },
    }),
    loadTrackerViews(),
    Promise.resolve(templateViews()),
    trackerTargets(),
  ]);

  const delivIds = (campaign?.assignments ?? []).flatMap((a) => a.deliverables.map((d) => d.id));
  const runs = await prisma.agentRun.findMany({
    where: {
      OR: [
        { targetType: "Campaign", targetId: selectedCampaignId },
        ...(delivIds.length ? [{ targetType: "Deliverable", targetId: { in: delivIds } }] : []),
      ],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 40,
  });
  const resolverIds = [...new Set(runs.map((r) => r.resolvedById).filter((x): x is string => !!x))];
  const resolvers = resolverIds.length ? await prisma.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, name: true } }) : [];
  const resolverName = new Map(resolvers.map((u) => [u.id, u.name]));

  const igAccounts = (campaign?.assignments ?? []).flatMap((a) =>
    a.influencer.socialAccounts.map((s) => ({ influencer: a.influencer.name, ...s })),
  );
  const totalFollowers = igAccounts.reduce((sum, a) => sum + a.followers, 0);
  const avgEr = igAccounts.length ? igAccounts.reduce((sum, a) => sum + Number(a.engagementRate), 0) / igAccounts.length : 0;
  const openFindings = runs.filter((r) => r.status === "ACIK").length;
  const approvedFindings = runs.filter((r) => r.status === "ONAYLANDI").length;
  const campaignTrackers = trackers.filter((t) => t.targetName === campaign?.name);
  const campaignCustomAgents = customAgents.filter((a) => a.campaignId === selectedCampaignId || !a.campaignId);

  return (
    <div className="flex flex-col gap-6">
      {/* Kampanya Seçici */}
      <Card interactive={false} className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">{tt("Kampanya Seçin:")}</span>
          <div className="flex flex-wrap gap-1.5">
            {campaigns.slice(0, 12).map((c) => (
              <Link
                key={c.id}
                href={`/admin/agent?bolum=kampanya&kampanya=${c.id}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition-standard",
                  c.id === selectedCampaignId ? "border-fg bg-fg text-bg font-medium" : "border-border text-fg-muted hover:text-fg",
                )}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
        {campaign ? <SyncCampaignInstagramButton campaignId={campaign.id} /> : null}
      </Card>

      {/* Toplanan Verilerin Analitik Özeti */}
      {campaign ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label={tt("Kampanya Agent Analitiği")}>
          {[
            { label: tt("Marka"), value: campaign.brand.name },
            { label: tt("Influencer"), value: String(campaign.assignments.length) },
            { label: tt("IG Toplam Takipçi"), value: totalFollowers.toLocaleString("tr-TR") },
            { label: tt("IG Ort. Etkileşim"), value: igAccounts.length ? `%${(avgEr * 100).toFixed(2)}` : "—" },
            { label: tt("Açık Agent Bulgusu"), value: String(openFindings) },
            { label: tt("Onaylanan"), value: String(approvedFindings) },
          ].map((s) => (
            <Card key={s.label} interactive={false} className="p-4">
              <span className="text-[11px] text-fg-muted">{s.label}</span>
              <p className="mt-1 truncate text-lg font-semibold tabular-nums text-fg">{s.value}</p>
            </Card>
          ))}
        </section>
      ) : null}

      {/* Kampanyadaki Instagram Hesaplarından Toplanan Veriler */}
      <Card interactive={false} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <CardTitle>{tt("Toplanan Instagram Verileri")}</CardTitle>
          <span className="text-[12px] text-fg-muted">{igAccounts.length} {tt("Instagram hesabı")}</span>
        </div>
        {igAccounts.length === 0 ? (
          <p className="text-sm text-fg-muted">{tt("Bu kampanyada kayıtlı Instagram hesabı bulunmuyor.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[12px] text-fg-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">{tt("Influencer")}</th>
                  <th className="py-2 pr-4 font-medium">Instagram</th>
                  <th className="py-2 pr-4 font-medium">{tt("Takipçi")}</th>
                  <th className="py-2 pr-4 font-medium">{tt("Ort. Beğeni")}</th>
                  <th className="py-2 pr-4 font-medium">{tt("Etkileşim")}</th>
                  <th className="py-2 font-medium">{tt("Son Tarama")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {igAccounts.map((a) => (
                  <tr key={a.handle}>
                    <td className="py-2 pr-4 font-medium text-fg">{a.influencer}</td>
                    <td className="py-2 pr-4 text-fg-muted">@{a.handle}</td>
                    <td className="py-2 pr-4 tabular-nums">{a.followers.toLocaleString("tr-TR")}</td>
                    <td className="py-2 pr-4 tabular-nums">{a.avgLikes?.toLocaleString("tr-TR") ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums">%{(Number(a.engagementRate) * 100).toFixed(2)}</td>
                    <td className="py-2 text-[12px] text-fg-passive">{a.lastSyncedAt ? fmtDateTime(a.lastSyncedAt) : tt("Bekliyor")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Özel AWS AgentCore Ajanları */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-section">{tt("Kampanya Botları & AWS AgentCore Ajanları")}</h2>
          <Link href={`/admin/agent?bolum=ozel&kampanya=${selectedCampaignId}`} className="text-sm font-medium text-fg underline-offset-4 hover:underline">
            + {tt("Yeni Özel Agent Oluştur")}
          </Link>
        </div>
        {campaignCustomAgents.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {campaignCustomAgents.map((a) => (
              <CustomAgentCard
                key={a.id}
                agent={a}
                campaignName={campaigns.find((c) => c.id === a.campaignId)?.name}
                activeCampaignId={selectedCampaignId}
              />
            ))}
          </div>
        ) : (
          <Card interactive={false}>
            <p className="text-sm text-fg-muted">
              {tt("Bu kampanya için henüz özel AgentCore ajanı oluşturulmadı. \"Özel Agent (AgentCore)\" sekmesinden birkaç saniyede oluşturabilirsiniz.")}
            </p>
          </Card>
        )}
      </section>

      {/* Kampanya Takipçileri & Bulgular */}
      <section className="flex flex-col gap-3">
        <h2 className="text-section">{tt("Kampanya Agent Çalışmaları & Bulgular")} ({runs.length})</h2>
        <AgentRunList
          runs={runs.map((r) => ({
            id: r.id,
            checkType: r.checkType,
            severity: r.severity,
            status: r.status,
            summary: r.summary,
            model: r.model,
            promptVersion: r.promptVersion,
            createdAt: r.createdAt,
            resolvedByName: r.resolvedById ? (resolverName.get(r.resolvedById) ?? null) : null,
            resolutionNote: r.resolutionNote,
          }))}
        />
      </section>

      <details className="rounded-2xl border border-line bg-surface px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium">{tt("Kampanya Otomatik Takipçileri")} ({campaignTrackers.length})</summary>
        <div className="mt-4 flex flex-col gap-4">
          <TrackerGallery templates={templates} targets={targets} />
          <TrackerList trackers={campaignTrackers} emptyText={tt("Bu kampanyaya bağlı ekstra takipçi şablonu yok.")} />
        </div>
      </details>
    </div>
  );
}

async function InstagramOnlyView() {
  const tt = await getTT();
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: "INSTAGRAM" },
    orderBy: { followers: "desc" },
    take: 40,
    include: { influencer: { select: { id: true, name: true } } },
  });
  return (
    <div className="flex flex-col gap-6">
      <InstagramExplorer />
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Sistemdeki Instagram Hesapları & Analiz Kartları")} ({accounts.length})</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[12px] text-fg-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">{tt("Influencer")}</th>
                <th className="py-2 pr-4 font-medium">Handle</th>
                <th className="py-2 pr-4 font-medium">{tt("Takipçi")}</th>
                <th className="py-2 pr-4 font-medium">{tt("Ort. Beğeni")}</th>
                <th className="py-2 pr-4 font-medium">{tt("Etkileşim")}</th>
                <th className="py-2 pr-4 font-medium">{tt("Kaynak")}</th>
                <th className="py-2 pr-4 font-medium">{tt("Neden")}</th>
                <th className="py-2 font-medium">{tt("Detaylı Analiz")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 font-medium text-fg">
                    <Link href={`/admin/influencerlar/${a.influencer.id}`} className="hover:underline">
                      {a.influencer.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-fg-muted">@{a.handle}</td>
                  <td className="py-2 pr-4 tabular-nums">{a.followers.toLocaleString("tr-TR")}</td>
                  <td className="py-2 pr-4 tabular-nums">{a.avgLikes?.toLocaleString("tr-TR") ?? "—"}</td>
                  <td className="py-2 pr-4 tabular-nums">%{(Number(a.engagementRate) * 100).toFixed(2)}</td>
                  <td className="py-2 pr-4 text-[12px] text-fg-passive">{syncSourceLabels[a.syncSource] ?? a.syncSource}</td>
                  <td className="py-2 pr-4 text-[12px] text-fg-muted">{a.syncReason ? (syncReasonNotes[a.syncReason] ?? a.syncReason) : "—"}</td>
                  <td className="py-2">
                    <Link
                      href={`/admin/influencerlar/${a.influencer.id}`}
                      className="rounded-full border border-line px-3 py-1 text-[12px] font-medium text-fg hover:border-fg/40"
                    >
                      {tt("Analiz Kartı →")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function CustomAgentsView({
  campaigns,
  selectedCampaignId,
  customAgents,
}: {
  campaigns: { id: string; name: string; status: string; brand: { name: string } }[];
  selectedCampaignId: string;
  customAgents: CustomAgentSpec[];
}) {
  const tt = await getTT();
  const auditAgents = await agentOverview();
  return (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Yeni Özel Agent Oluştur (AWS AgentCore)")}</CardTitle>
        <CustomAgentForm campaigns={campaigns} defaultCampaignId={selectedCampaignId} />
      </Card>

      {customAgents.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {customAgents.map((a) => (
            <CustomAgentCard
              key={a.id}
              agent={a}
              campaignName={campaigns.find((c) => c.id === a.campaignId)?.name}
              activeCampaignId={selectedCampaignId}
            />
          ))}
        </div>
      ) : null}

      <details className="rounded-2xl border border-line bg-surface px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium">{tt("Sistem Zamanlanmış Denetim Agent'ları")} ({auditAgents.length})</summary>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {auditAgents.map((a) => (
            <Card key={a.job} interactive={false} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{a.name}</CardTitle>
                <StatusDot tone={a.enabled ? "active" : "passive"}>{a.enabled ? tt("Açık") : tt("Kapalı")}</StatusDot>
              </div>
              <p className="text-[13px] text-fg-muted">{a.does}</p>
              <AuditAgentControls job={a.job} enabled={a.enabled} required={a.required} />
            </Card>
          ))}
        </div>
      </details>
    </div>
  );
}
