"use client";
import { useActionState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status";
import { idleState } from "@/lib/action-state";
import Link from "next/link";
import {
  createCustomAgentAction,
  deleteCustomAgentAction,
  inspectInstagramAction,
  runBulkInstagramExplorerAction,
  runCustomAgentAction,
  syncCampaignInstagramAction,
  type CustomAgentSpec,
} from "@/lib/actions/agents";
import { fmtDateTime } from "@/lib/time";

export function SyncCampaignInstagramButton({ campaignId }: { campaignId: string }) {
  const tt = useTT();
  return (
    <ActionForm
      action={syncCampaignInstagramAction}
      submitLabel={tt("Instagram Verilerini Güncelle")}
      submitVariant="secondary"
      submitSize="sm"
      aria-label={tt("Kampanya Instagram verilerini tara")}
    >
      <input type="hidden" name="campaignId" value={campaignId} />
    </ActionForm>
  );
}

export function CustomAgentForm({
  campaigns,
  defaultCampaignId,
}: {
  campaigns: { id: string; name: string }[];
  defaultCampaignId?: string;
}) {
  const tt = useTT();
  return (
    <ActionForm
      action={createCustomAgentAction}
      submitLabel={tt("Özel Agent Oluştur (AWS AgentCore)")}
      resetOnSuccess
      aria-label={tt("Özel Agent Oluştur")}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={tt("Agent Adı")}>
          {(p) => <Input {...p} name="name" required minLength={3} placeholder={tt("Örn. Yaz Kampanyası IG Analiz Ajanı")} />}
        </Field>
        <Field label={tt("Bağlı Kampanya (opsiyonel)")}>
          {(p) => (
            <Select {...p} name="campaignId" defaultValue={defaultCampaignId ?? ""}>
              <option value="">{tt("Tüm Platform (Genel)")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={tt("Kısa Hedef")} className="md:col-span-2">
          {(p) => <Input {...p} name="goal" placeholder={tt("Örn. Instagram etkileşim düşüşlerini tespit et ve yeni içerik öner")} />}
        </Field>
        <Field label={tt("Agent Talimatı (System Prompt)")} className="md:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              name="instructions"
              required
              minLength={15}
              rows={3}
              placeholder={tt("Bu ajan kampanyadaki influencer'ların Instagram performansını inceler, düşük etkileşimli profilleri raporlar...")}
            />
          )}
        </Field>
      </div>
    </ActionForm>
  );
}

export function CustomAgentCard({
  agent,
  campaignName,
  activeCampaignId,
}: {
  agent: CustomAgentSpec;
  campaignName?: string;
  activeCampaignId?: string;
}) {
  const tt = useTT();
  return (
    <Card interactive={false} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{agent.name}</CardTitle>
          <p className="text-[12px] text-fg-muted">
            {campaignName ? `${tt("Kampanya:")} ${campaignName}` : tt("Genel Platform")} · {agent.channel} ·{" "}
            {agent.lastEngine ?? "AWS AgentCore"}
          </p>
        </div>
        <StatusDot tone={agent.lastRunAt ? "active" : "muted"}>
          {agent.lastRunAt ? tt("Çalıştı") : tt("Hazır")}
        </StatusDot>
      </div>
      <p className="text-sm text-fg-muted">{agent.goal}</p>
      {agent.lastSummary ? (
        <div className="rounded-xl border border-line bg-bg/60 p-3 text-[13px] whitespace-pre-line text-fg">
          {agent.lastSummary}
          {agent.lastRunAt ? (
            <span className="mt-2 block text-[11px] text-fg-passive">
              {tt("Son çalışma:")} {fmtDateTime(new Date(agent.lastRunAt))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <ActionForm action={runCustomAgentAction} submitLabel={tt("Çalıştır (AgentCore)")} submitSize="sm">
          <input type="hidden" name="id" value={agent.id} />
          {activeCampaignId && !agent.campaignId ? <input type="hidden" name="campaignId" value={activeCampaignId} /> : null}
        </ActionForm>
        <ActionForm action={deleteCustomAgentAction} submitLabel={tt("Sil")} submitVariant="ghost" submitSize="sm">
          <input type="hidden" name="id" value={agent.id} />
        </ActionForm>
      </div>
    </Card>
  );
}

export function InstagramExplorer() {
  const tt = useTT();
  const [state, action, pending] = useActionState(inspectInstagramAction, idleState);
  const d = state.data;
  return (
    <Card interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{tt("Instagram Gezgini (Hibrit Meta Graph API + Otonom Tarama Botu)")}</CardTitle>
          <p className="mt-1 text-[13px] text-fg-muted">
            {tt("Kayıtlı veya açık Instagram profillerini canlı tarayarak takipçi gelişimi, Reels izlenme, kaydetme (saves), marka işbirliği geçmişi ve NLP yorum duygu analizini çıkarır.")}
          </p>
        </div>
        <ActionForm
          action={runBulkInstagramExplorerAction}
          submitLabel={tt("Tüm Influencer'ları Şimdi Canlı Tara")}
          submitVariant="secondary"
          submitSize="sm"
        >
          <input type="hidden" name="mode" value="all" />
        </ActionForm>
      </div>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Input
          name="handle"
          required
          placeholder="@kullaniciadi"
          aria-label={tt("Instagram kullanıcı adı")}
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending}>
          {pending ? tt("Canlı Taranıyor…") : tt("Instagram Gezgini ile Analiz Et")}
        </Button>
      </form>
      {state.error ? <p className="text-[13px] text-critical">{state.error}</p> : null}
      {d ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-fg">@{String(d.handle ?? "").replace(/^@+/, "")}</span>
            {d.score ? (
              <span className="rounded-full bg-fg px-2.5 py-0.5 text-[11px] font-semibold text-bg">
                {tt("Marka Uyum Skoru:")} {String(d.score)}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div>
              <span className="text-[11px] text-fg-muted">{tt("Takipçi")}</span>
              <p className="text-base font-semibold tabular-nums text-fg">{String(d.followers ?? "—")}</p>
            </div>
            <div>
              <span className="text-[11px] text-fg-muted">{tt("Ort. İzlenme")}</span>
              <p className="text-base font-semibold tabular-nums text-fg">{String(d.avgViews ?? "—")}</p>
            </div>
            <div>
              <span className="text-[11px] text-fg-muted">{tt("Ort. Kaydetme")}</span>
              <p className="text-base font-semibold tabular-nums text-fg">{String(d.avgSaves ?? "—")}</p>
            </div>
            <div>
              <span className="text-[11px] text-fg-muted">{tt("Ort. Beğeni")}</span>
              <p className="text-base font-semibold tabular-nums text-fg">{String(d.avgLikes ?? "—")}</p>
            </div>
            <div>
              <span className="text-[11px] text-fg-muted">{tt("Ort. Yorum")}</span>
              <p className="text-base font-semibold tabular-nums text-fg">{String(d.avgComments ?? "—")}</p>
            </div>
            <div>
              <span className="text-[11px] text-fg-muted">{tt("Etkileşim (ER)")}</span>
              <p className="text-base font-semibold tabular-nums text-fg">{String(d.er ?? "—")}</p>
            </div>
          </div>
          {d.collabs ? (
            <p className="text-[12px] text-fg-muted">
              <strong>{tt("Tespit Edilen Marka İşbirlikleri:")}</strong> {String(d.collabs)}
            </p>
          ) : null}
          {d.summary ? <p className="text-[13px] leading-relaxed text-fg">{String(d.summary)}</p> : null}
          {d.influencerId ? (
            <div>
              <Link
                href={`/admin/influencerlar/${String(d.influencerId)}`}
                className="inline-flex items-center gap-1 rounded-full bg-fg px-3.5 py-1 text-[12px] font-semibold text-bg hover:opacity-90"
              >
                {tt("Tam Kimlik ve Performans Analiz Kartını Aç →")}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
