"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDualMinor } from "@infulancer/core/i18n/regions";
import { ActionForm } from "@/components/forms/action-form";
import { Card } from "@/components/ui/card";
import { Button, Input, Textarea } from "@/components/ui/form";
import { StatusDot } from "@/components/ui/status";
import {
  influencerMarkDeliverableDoneAction,
  runCampaignStoryAgentAction,
  sendCampaignMessageAction,
  toggleArchiveCampaignInfluencerAction,
  type CampaignDirectMessage,
} from "@/lib/actions/campaign-hub";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

export type UnifiedCampaignRow = {
  rowKey: string; // "assignment:<id>" or "offer:<id>"
  kind: "ASSIGNMENT" | "OFFER";
  influencerId: string;
  influencerName: string;
  influencerHandle: string | null;
  influencerCountry: string;
  influencerCurrency: string;
  statusCategory: "BEKLIYOR" | "KABUL" | "RED" | "REVIZE";
  statusLabel: string;
  feeMinor: number;
  feeCurrency: string;
  counterFeeMinor?: number | null;
  note?: string | null;
  deliverablesTotal: number;
  deliverablesDone: number;
  deliverableItems: {
    id: string;
    label: string;
    status: string;
    isDone: boolean;
    postUrl: string | null;
    publishedAt: string | null;
  }[];
  updatedAt: string;
};

export type StoryTrackingRow = {
  deliverableId: string;
  influencerId: string;
  influencerName: string;
  igHandle: string | null;
  oauthConnected: boolean;
  contentType: string;
  status: string;
  isPublished: boolean;
  publishedAt: string | null;
  plannedAt: string;
  postUrl: string | null;
  shortLinkUrl: string | null;
  reach: number;
  views: number;
  clicks: number;
  likes: number;
  retentionText: string;
  lastCapturedAt: string | null;
};

const FILTER_TABS = [
  { id: "AKTIF", label: "Aktif Liste" },
  { id: "BEKLIYOR", label: "Bekliyor" },
  { id: "KABUL", label: "Kabul Edildi" },
  { id: "REVIZE", label: "Revize / Karşı Teklif" },
  { id: "RED", label: "Reddedildi" },
  { id: "ARSIV", label: "Arşivlenenler" },
] as const;

function statusToneForCategory(cat: UnifiedCampaignRow["statusCategory"]) {
  if (cat === "KABUL") return "active" as const;
  if (cat === "REVIZE") return "muted" as const;
  if (cat === "RED") return "critical" as const;
  return "passive" as const;
}

export function CampaignHub({
  campaignId,
  campaignName,
  campaignCurrency,
  viewerRole,
  canManage,
  executionMode,
  fx,
  rows,
  archivedKeys,
  messages,
  storyRows,
}: {
  campaignId: string;
  campaignName: string;
  campaignCurrency: string;
  viewerRole: "BRAND" | "ADMIN";
  canManage: boolean;
  executionMode: "AJANS" | "SELF";
  fx: Record<string, number>;
  rows: UnifiedCampaignRow[];
  archivedKeys: string[];
  messages: CampaignDirectMessage[];
  storyRows: StoryTrackingRow[];
}) {
  const tt = useTT();
  const [tab, setTab] = useState<(typeof FILTER_TABS)[number]["id"]>("AKTIF");
  const [search, setSearch] = useState("");
  const [activeChatInfluencer, setActiveChatInfluencer] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const archivedSet = new Set(archivedKeys);

  const filteredRows = rows.filter((r) => {
    const isArchived = archivedSet.has(r.rowKey);
    if (tab === "ARSIV") {
      if (!isArchived) return false;
    } else {
      if (isArchived) return false;
      if (tab !== "AKTIF" && r.statusCategory !== tab) return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        r.influencerName.toLowerCase().includes(q) ||
        (r.influencerHandle ?? "").toLowerCase().includes(q) ||
        r.statusLabel.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    AKTIF: rows.filter((r) => !archivedSet.has(r.rowKey)).length,
    BEKLIYOR: rows.filter((r) => !archivedSet.has(r.rowKey) && r.statusCategory === "BEKLIYOR").length,
    KABUL: rows.filter((r) => !archivedSet.has(r.rowKey) && r.statusCategory === "KABUL").length,
    REVIZE: rows.filter((r) => !archivedSet.has(r.rowKey) && r.statusCategory === "REVIZE").length,
    RED: rows.filter((r) => !archivedSet.has(r.rowKey) && r.statusCategory === "RED").length,
    ARSIV: rows.filter((r) => archivedSet.has(r.rowKey)).length,
  };

  const chatMessages = activeChatInfluencer
    ? messages.filter((m) => m.influencerId === activeChatInfluencer.id)
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Tek Merkezli Kampanya Yönetim Tablosu ve İletişim */}
      <Card interactive={false} className="flex flex-col gap-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-section">{tt("Tek Merkezli Kampanya & Teklif Yönetim Tablosu")}</h2>
              <span className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
                {executionMode === "SELF" ? tt("Marka Yönetimi (Self-Managed)") : tt("Ajans Yönetimi")}
              </span>
            </div>
            <p className="text-[13px] text-fg-muted">
              {tt("Gönderilen teklifler, influencer dönüşleri (Bekliyor, Kabul Edildi, Reddedildi, Revize İstendi), görev tamamlama bildirimleri ve doğrudan mesajlaşma tek tabloda.")}
            </p>
          </div>
          <div className="w-full sm:w-64">
            <Input
              placeholder={tt("Influencer veya durum ara...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Durum Filtre Sekmeleri */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
          {FILTER_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-standard",
                  on
                    ? "bg-fg text-bg"
                    : "border border-line bg-surface text-fg-muted hover:border-fg/30 hover:text-fg",
                )}
              >
                {tt(t.label)}{" "}
                <span className="ml-1 tabular-nums opacity-75">{counts[t.id]}</span>
              </button>
            );
          })}
        </div>

        {/* Tablo */}
        {filteredRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-fg-muted">
            {tab === "ARSIV"
              ? tt("Arşivlenmiş influencer veya teklif kaydı bulunmuyor.")
              : tt("Bu filtreye uygun teklif veya influencer ataması bulunmuyor.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-fg-muted">
                  <th className="py-2.5 pr-3 font-medium">{tt("Influencer")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("Onay / Teklif Durumu")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("Tutar")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("Görev & İçerik Senkronu")}</th>
                  <th className="py-2.5 pl-3 text-right font-medium">{tt("Hızlı Aksiyonlar")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRows.map((r) => {
                  const isArchived = archivedSet.has(r.rowKey);
                  const infMsgCount = messages.filter((m) => m.influencerId === r.influencerId).length;
                  const profileHref =
                    viewerRole === "ADMIN"
                      ? `/admin/influencerlar/${r.influencerId}`
                      : `/marka/kesfet/${r.influencerId}`;

                  return (
                    <tr key={r.rowKey} className="align-top hover:bg-surface-muted/30">
                      <td className="py-3.5 pr-3">
                        <div className="flex flex-col gap-0.5">
                          <Link href={profileHref} className="font-medium text-fg hover:underline">
                            {r.influencerName}
                          </Link>
                          <span className="text-[12px] text-fg-muted">
                            {r.influencerHandle ? `@${r.influencerHandle} · ` : ""}
                            {r.influencerCountry} ({r.influencerCurrency})
                          </span>
                          <span className="text-[11px] text-fg-passive">
                            {r.kind === "ASSIGNMENT" ? tt("Kampanya Ataması") : tt("Doğrudan Teklif")}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-1">
                          <StatusDot tone={statusToneForCategory(r.statusCategory)}>
                            {r.statusLabel}
                          </StatusDot>
                          {r.note ? (
                            <span className="max-w-xs text-[12px] text-fg-muted">{r.note}</span>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-3 py-3.5 tabular-nums">
                        {viewerRole === "BRAND" && r.kind === "ASSIGNMENT" ? (
                          <span className="text-fg-passive">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-fg">
                              {r.feeMinor > 0
                                ? formatDualMinor(r.feeMinor, r.feeCurrency || campaignCurrency, {
                                    viewerCurrency: campaignCurrency,
                                    fx,
                                  })
                                : "—"}
                            </span>
                            {r.counterFeeMinor && r.counterFeeMinor > 0 ? (
                              <span className="text-[12px] text-amber-600 dark:text-amber-400">
                                {tt("Karşı teklif:")}{" "}
                                {formatDualMinor(r.counterFeeMinor, r.feeCurrency || campaignCurrency, {
                                  viewerCurrency: campaignCurrency,
                                  fx,
                                })}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3.5">
                        {r.deliverableItems.length === 0 ? (
                          <span className="text-[12px] text-fg-passive">
                            {tt("Henüz görev tanımlanmadı")}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[12px] font-medium text-fg">
                              {r.deliverablesDone} / {r.deliverablesTotal} {tt("tamamlandı")}
                            </span>
                            <ul className="flex flex-col gap-1">
                              {r.deliverableItems.map((d) => (
                                <li key={d.id} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                      d.isDone
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                        : "bg-surface-muted text-fg-muted",
                                    )}
                                  >
                                    {d.isDone ? "✓ Yaptı" : "⏳ Bekliyor"}
                                  </span>
                                  <span className="text-fg">{d.label}</span>
                                  {d.postUrl ? (
                                    <a
                                      href={d.postUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] underline opacity-80 hover:opacity-100"
                                    >
                                      {tt("Paylaşım ↗")}
                                    </a>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 pl-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setActiveChatInfluencer({
                                id: r.influencerId,
                                name: r.influencerName,
                              })
                            }
                          >
                            {tt("Mesaj Gönder")}
                            {infMsgCount > 0 ? ` (${infMsgCount})` : ""}
                          </Button>

                          <ActionForm
                            action={toggleArchiveCampaignInfluencerAction}
                            submitLabel={isArchived ? tt("Arşivden Çıkar") : tt("Arşivle")}
                            submitSize="sm"
                            submitVariant="ghost"
                          >
                            <input type="hidden" name="campaignId" value={campaignId} />
                            <input type="hidden" name="rowKey" value={r.rowKey} />
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Kampanya İçi Doğrudan Mesajlaşma Çekmecesi */}
        {activeChatInfluencer ? (
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-muted/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[14px] font-semibold text-fg">
                  {activeChatInfluencer.name} — {tt("Kampanya İçi Doğrudan İletişim")}
                </h3>
                <p className="text-[12px] text-fg-muted">
                  {tt("Gönderdiğiniz mesaj influencer'ın bildirim kutusuna ve görev ekranına anında düşer.")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setActiveChatInfluencer(null)}
              >
                {tt("Kapat ✕")}
              </Button>
            </div>

            {chatMessages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-fg-muted">
                {tt("Bu influencer ile henüz kampanya mesajı yok. İlk mesajı aşağıdan gönderin.")}
              </p>
            ) : (
              <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-surface p-3">
                {chatMessages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-xl px-3 py-2 text-[13px]",
                      m.senderRole === "INFLUENCER"
                        ? "self-start border border-line bg-surface-muted/60 text-fg"
                        : "self-end bg-fg text-bg",
                    )}
                  >
                    <span className="text-[11px] font-medium opacity-75">
                      {m.senderName} · {new Date(m.createdAt).toLocaleString("tr-TR")}
                    </span>
                    <p className="whitespace-pre-line">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}

            <ActionForm
              action={sendCampaignMessageAction}
              submitLabel={tt("Mesajı Gönder & Bildirim İlet")}
              resetOnSuccess
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="campaignId" value={campaignId} />
              <input type="hidden" name="influencerId" value={activeChatInfluencer.id} />
              <Textarea
                name="body"
                rows={2}
                required
                placeholder={`${activeChatInfluencer.name} için kampanya notu, revize talebi veya bilgilendirme yazın (` + campaignName + ")..."}
              />
            </ActionForm>
          </div>
        ) : null}
      </Card>

      {/* 2. Otonom Agent & Instagram Story Takip Kartı */}
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-section">{tt("Otonom Agent & Instagram Story / İçerik Takibi")}</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {tt("Canlı Veritabanı Telemetrisi")}
              </span>
            </div>
            <p className="text-[13px] text-fg-muted">
              {tt("Kampanyaya katılan influencer'ların Instagram hesapları ve paylaştıkları Story/Reels içerikleri otonom agent tarafından takip edilir: Story görüntülenme, link tıklaması, paylaşım durumu ve yayında kalma süresi.")}
            </p>
          </div>
          {canManage ? (
            <ActionForm
              action={runCampaignStoryAgentAction}
              submitLabel={tt("Story & Gönderi Agent Taramasını Şimdi Çalıştır")}
              submitSize="sm"
              submitVariant="secondary"
            >
              <input type="hidden" name="campaignId" value={campaignId} />
            </ActionForm>
          ) : null}
        </div>

        {storyRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-fg-muted">
            {tt("Bu kampanyada henüz Instagram Story veya gönderi görevi atanmamış.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-fg-muted">
                  <th className="py-2.5 pr-3 font-medium">{tt("Influencer & Instagram")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("İçerik Tipi")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("Paylaşım Durumu")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tt("Story / İçerik Görüntülenme")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tt("Link Tıklaması")}</th>
                  <th className="py-2.5 pl-3 text-right font-medium">{tt("Yayında Kalma Süresi")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {storyRows.map((s) => (
                  <tr key={s.deliverableId} className="hover:bg-surface-muted/30">
                    <td className="py-3 pr-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-fg">{s.influencerName}</span>
                        <span className="text-[11px] text-fg-muted">
                          {s.igHandle ? `@${s.igHandle}` : tt("Instagram hesabı")} ·{" "}
                          {s.oauthConnected ? tt("Meta Graph API Doğrulamalı") : tt("Instagram Gezgini Bot")}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium text-fg">{s.contentType}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusDot tone={s.isPublished ? "active" : "passive"}>
                          {s.isPublished ? tt("Paylaşıldı / Yayında") : s.status}
                        </StatusDot>
                        {s.postUrl ? (
                          <a
                            href={s.postUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] underline text-fg-muted hover:text-fg"
                          >
                            {tt("Gör ↗")}
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                      {s.reach > 0 || s.views > 0
                        ? Math.max(s.reach, s.views).toLocaleString("tr-TR")
                        : "0"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                      {s.clicks.toLocaleString("tr-TR")}
                    </td>
                    <td className="py-3 pl-3 text-right tabular-nums text-fg-muted">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                          s.isPublished
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-surface-muted text-fg-passive",
                        )}
                      >
                        {s.retentionText}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Influencer Görev Tamamlama ("Yaptım / Tamamlandı" & "Yapmadım") + Kampanya Mesajlaşma Kartı
 * `/influencer/isler/[id]` sayfasında kullanılır.
 */
export function InfluencerTaskSyncCard({
  deliverableId,
  campaignId,
  campaignName,
  influencerId,
  isDone,
  currentPostUrl,
  messages,
}: {
  deliverableId: string;
  campaignId: string;
  campaignName: string;
  influencerId: string;
  isDone: boolean;
  currentPostUrl: string | null;
  messages: CampaignDirectMessage[];
}) {
  const tt = useTT();
  const myMessages = messages.filter((m) => m.influencerId === influencerId);

  return (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-4 border-emerald-500/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-section">{tt("Görev Tamamlama Bildirimi (Anlık Kampanya Senkronu)")}</h2>
            <p className="text-[13px] text-fg-muted">
              {tt("İçeriğinizi paylaştığınızda 'Yaptım / Tamamlandı' olarak işaretleyin; durumunuz marka ve ajansın kampanya yönetim tablosuna anında yansır.")}
            </p>
          </div>
          <StatusDot tone={isDone ? "active" : "muted"}>
            {isDone ? tt("✓ Yaptım / Tamamlandı") : tt("⏳ Henüz Tamamlanmadı")}
          </StatusDot>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ActionForm
            action={influencerMarkDeliverableDoneAction}
            submitLabel={tt("✓ Yaptım / Tamamlandı Olarak İşaretle")}
            className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-muted/30 p-4"
          >
            <input type="hidden" name="deliverableId" value={deliverableId} />
            <input type="hidden" name="done" value="true" />
            <Input
              name="postUrl"
              type="url"
              defaultValue={currentPostUrl ?? ""}
              placeholder="https://www.instagram.com/p/... (opsiyonel paylaşım linki)"
            />
            <Input
              name="note"
              placeholder={tt("Markaya/ajansa kısa tamamlama notu (opsiyonel)")}
            />
          </ActionForm>

          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface-muted/20 p-4">
            <p className="text-[13px] text-fg-muted">
              {tt("Paylaşımı henüz yapmadıysanız veya geri çektiyseniz durumu 'Yapmadım / Bekliyor' olarak güncelleyebilirsiniz.")}
            </p>
            <ActionForm
              action={influencerMarkDeliverableDoneAction}
              submitLabel={tt("✗ Yapmadım / Bekliyor Olarak Güncelle")}
              submitVariant="secondary"
            >
              <input type="hidden" name="deliverableId" value={deliverableId} />
              <input type="hidden" name="done" value="false" />
            </ActionForm>
          </div>
        </div>
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <div>
          <h2 className="text-section">{tt("Kampanya İçi Doğrudan Mesajlaşma")}</h2>
          <p className="text-[13px] text-fg-muted">
            {tt("Marka veya ajans ekibinden bu kampanya için gelen mesajları görün ve doğrudan yanıtlayın.")}
          </p>
        </div>

        {myMessages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-muted">
            {tt("Henüz bu kampanya için mesaj yok. Marka veya ajansa aşağıdan mesaj gönderebilirsiniz.")}
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-surface p-3">
            {myMessages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl px-3 py-2 text-[13px]",
                  m.senderRole === "INFLUENCER"
                    ? "self-end bg-fg text-bg"
                    : "self-start border border-line bg-surface-muted/60 text-fg",
                )}
              >
                <span className="text-[11px] font-medium opacity-75">
                  {m.senderName} · {new Date(m.createdAt).toLocaleString("tr-TR")}
                </span>
                <p className="whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ul>
        )}

        <ActionForm
          action={sendCampaignMessageAction}
          submitLabel={tt("Marka / Ajansa Mesaj Gönder")}
          resetOnSuccess
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="influencerId" value={influencerId} />
          <Textarea
            name="body"
            rows={2}
            required
            placeholder={`${campaignName} kampanyası hakkında marka veya ajansa mesajınız...`}
          />
        </ActionForm>
      </Card>
    </div>
  );
}
