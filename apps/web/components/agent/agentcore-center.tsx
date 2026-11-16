"use client";
import { useActionState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status";
import { idleState } from "@/lib/action-state";
import {
  createCustomAgentAction,
  deleteCustomAgentAction,
  inspectInstagramAction,
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
      <div>
        <CardTitle>{tt("Nordvow Hesabı ile Instagram Keşif & Analiz")}</CardTitle>
        <p className="mt-1 text-[13px] text-fg-muted">
          {tt("Bağlı Nordvow Meta token'larıyla herhangi bir Instagram Business / Creator hesabının canlı verilerini çekin (yalnız Instagram).")}
        </p>
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
          {pending ? tt("Taranıyor…") : tt("Instagram'da İncele")}
        </Button>
      </form>
      {state.error ? <p className="text-[13px] text-critical">{state.error}</p> : null}
      {d ? (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-bg/60 p-4 sm:grid-cols-5">
          <div>
            <span className="text-[11px] text-fg-muted">@{d.handle}</span>
            <p className="text-base font-semibold tabular-nums text-fg">{d.followers}</p>
            <span className="text-[11px] text-fg-passive">{tt("Takipçi")}</span>
          </div>
          <div>
            <span className="text-[11px] text-fg-muted">{tt("Gönderi")}</span>
            <p className="text-base font-semibold tabular-nums text-fg">{d.postsCount}</p>
          </div>
          <div>
            <span className="text-[11px] text-fg-muted">{tt("Ort. Beğeni")}</span>
            <p className="text-base font-semibold tabular-nums text-fg">{d.avgLikes}</p>
          </div>
          <div>
            <span className="text-[11px] text-fg-muted">{tt("Ort. Yorum")}</span>
            <p className="text-base font-semibold tabular-nums text-fg">{d.avgComments}</p>
          </div>
          <div>
            <span className="text-[11px] text-fg-muted">{tt("Etkileşim (ER)")}</span>
            <p className="text-base font-semibold tabular-nums text-fg">{d.er}</p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
