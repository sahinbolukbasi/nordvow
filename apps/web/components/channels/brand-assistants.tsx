import { prisma } from "@infulancer/core/db";
import { formatSourceTitle } from "@infulancer/core/assistant/rag";
import { handoffReasonLabels, type HandoffReason } from "@infulancer/core/assistant/runtime";
import { AssistantForm } from "@/components/agent/agent-forms";
import {
  AssistantTester,
  KnowledgeAutoSeedForm,
  KnowledgeDraftReviewItem,
  QuickSetup,
  UnansweredQuestionRow,
} from "@/components/channels/assistant-test";
import { KnowledgeForm } from "@/components/inbox/inbox-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status";
import { assistantAnalyticsFor, assistantsFor } from "@/lib/assistants";
import { fmtDate } from "@/lib/time";

/** Sohbet asistanları (WhatsApp ve Instagram DM'de çalışır) + analitik + onaylı bilgi tabanı. */
export async function BrandAssistants({ tenantId: t }: { tenantId: string }) {
  const [items, analytics, sources, chunks] = await Promise.all([
    assistantsFor(t),
    assistantAnalyticsFor(t),
    prisma.knowledgeSource.findMany({
      where: { tenantId: t, type: { not: "message" }, status: { in: ["ready", "approved", "draft"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { chunks: { select: { content: true }, take: 3 } },
    }),
    prisma.knowledgeChunk.count({
      where: { tenantId: t, source: { status: { in: ["ready", "approved"] } } },
    }),
  ]);

  const activeItems = items.filter((a) => a.configured && a.values.enabled);
  const draftSources = sources.filter((s) => s.status === "draft");
  const readySources = sources.filter((s) => s.status === "ready" || s.status === "approved");
  const options = items.map((a) => ({ key: a.template.key, name: a.template.name }));

  return (
    <div className="flex flex-col gap-6">
      {/* Tek kaynaklı durum ve 30 günlük analitik özeti */}
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>AI Asistan Özeti ve Analitik (Son 30 Gün)</CardTitle>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              Müşteri yazar → asistan onaylı dokümanlardan kaynaklı cevaplar → emin değilse Gelen Kutusu&apos;ndaki temsilciye aktarır (aktarılanlarda AI ücreti yok).
            </p>
          </div>
          <StatusDot tone={activeItems.length > 0 ? "active" : "passive"}>
            {activeItems.length > 0 ? `${activeItems.length} aktif asistan · Aktif` : "Aktif asistan yok · Kurulmadı"}
          </StatusDot>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <dt className="text-[11px] text-fg-muted">30 gün konuşma</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{analytics.totalConversations30d}</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <dt className="text-[11px] text-fg-muted">Tek başına çözüm</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {analytics.selfResolvedRatePct != null ? `%${analytics.selfResolvedRatePct}` : "—"}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <dt className="text-[11px] text-fg-muted">Aktarma oranı</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {analytics.handoffRatePct != null ? `%${analytics.handoffRatePct}` : "—"}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <dt className="text-[11px] text-fg-muted">Ort. ilk yanıt</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {analytics.avgFirstResponseSec != null ? `${analytics.avgFirstResponseSec} sn` : "—"}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <dt className="text-[11px] text-fg-muted">Onaylı bilgi</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{readySources.length} kaynak</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <dt className="text-[11px] text-fg-muted">30 gün maliyet</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              ${analytics.monthlyCostUsd.toFixed(4)} <span className="text-[11px] font-normal text-fg-muted">/ ${analytics.monthlyBudgetUsd}</span>
            </dd>
          </div>
        </dl>

        {analytics.topHandoffReasons.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
            <span className="font-medium text-fg">En sık aktarma nedenleri:</span>
            {analytics.topHandoffReasons.map((r) => (
              <span key={r.reason} className="rounded-full border border-line px-2.5 py-0.5">
                {handoffReasonLabels[r.reason as HandoffReason] ?? r.reason} ({r.count})
              </span>
            ))}
          </div>
        ) : null}

        {analytics.unansweredQuestions.length > 0 ? (
          <div className="rounded-xl border border-line p-3">
            <p className="text-[12px] font-semibold text-fg">
              Cevapsız kalan en sık sorular ({analytics.unansweredQuestions.length})
            </p>
            <ul className="mt-1 divide-y divide-line">
              {analytics.unansweredQuestions.map((u) => (
                <UnansweredQuestionRow key={u.question} tenantId={t} question={u.question} count={u.count} />
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <QuickSetup options={options} tenantId={t} />
        <AssistantTester options={options} tenantId={t} />
      </div>

      <section className="flex flex-col gap-4" aria-label="Asistanlar">
        {items.map((a) => {
          const isInfluencerScope = a.template.key === "influencer_assistant";
          return (
            <Card key={a.template.key} interactive={false} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{a.template.name}</CardTitle>
                    <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                      {isInfluencerScope ? "Influencer kapsamı · izole bilgi tabanı" : "Müşteri kapsamı"}
                    </span>
                  </div>
                  <p className="max-w-2xl text-[13px] text-fg-muted">{a.template.description.replace(/\s*\(RAG\)/gi, "")}</p>
                </div>
                <StatusDot tone={a.configured && a.values.enabled ? "active" : "passive"}>
                  {a.configured && a.values.enabled ? "Açık" : a.configured ? "Kapalı" : "Kurulmadı"}
                </StatusDot>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <span>
                  <span className="text-fg-muted">Son 30 gün çözülen: </span>
                  <span className="tabular-nums">{a.handled}</span>
                </span>
                <span className="text-fg-muted">
                  Aktarma nedenleri:{" "}
                  {a.handoffs.length
                    ? a.handoffs.map((h) => `${handoffReasonLabels[h.reason as HandoffReason] ?? h.reason} (${h.count})`).join(", ")
                    : "—"}
                </span>
              </div>
              <details className="rounded-[8px] border border-border" open={!a.configured && a.template.key === "brand_faq"}>
                <summary className="cursor-pointer px-4 py-3 text-sm text-fg-muted hover:text-fg">
                  {a.configured ? "Ayarları düzenle" : "Kur ve aç"}
                </summary>
                <div className="border-t border-border p-4">
                  <AssistantForm values={a.values} tenantId={t} />
                </div>
              </details>
            </Card>
          );
        })}
      </section>

      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Bilgi tabanı</CardTitle>
            <p className="text-[13px] text-fg-muted">
              Asistanların cevaplarken kullandığı onaylı kaynaklar. {readySources.length} onaylı kaynak · {chunks} aktif bilgi parçası
              {draftSources.length > 0 ? ` · ${draftSources.length} taslak onay bekliyor` : ""}.
            </p>
          </div>
        </div>

        <KnowledgeAutoSeedForm tenantId={t} />

        {draftSources.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-fg">
              Asistanınız 3 kaynaktan {draftSources.length} cevap taslağı hazırladı. 2 dakikada kontrol edip açın.
            </p>
            <ul className="flex flex-col gap-3">
              {draftSources.map((s) => (
                <KnowledgeDraftReviewItem
                  key={s.id}
                  tenantId={t}
                  sourceId={s.id}
                  title={formatSourceTitle(s.uri)}
                  initialText={s.chunks.map((c) => c.content).join("\n")}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {readySources.length ? (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {readySources.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  <span>{formatSourceTitle(s.uri)}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted">
                    {s.type === "influencer_brief" ? "Influencer" : "Müşteri"}
                  </span>
                </div>
                <span className="text-fg-muted">{fmtDate(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : draftSources.length === 0 ? (
          <p className="text-[13px] text-fg-passive">
            Henüz onaylı bilgi eklenmedi. Yukarıdaki &quot;3 kaynaktan taslak oluştur&quot; düğmesiyle başlayın veya aşağıdan manuel ekleyin.
          </p>
        ) : null}

        <KnowledgeForm tenantId={t} />
      </Card>
    </div>
  );
}
