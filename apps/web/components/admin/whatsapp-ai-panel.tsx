"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminRegenerateWhatsAppUserCodeAction,
  adminUnlinkWhatsAppUserAction,
  saveWhatsAppBotPhoneAction,
} from "@/lib/actions/whatsapp-admin";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export type WhatsAppUsageRow = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  waPhone: string | null;
  pairingCode: string;
  verified: boolean;
  verifiedAt: string | null;
  updatedAt: string;
  userMessages: number;
  assistantMessages: number;
  history: { role: "user" | "assistant"; text: string }[];
};

export function WhatsAppAiPanel({
  initialBotPhone,
  rows,
  stats,
}: {
  initialBotPhone: string;
  rows: WhatsAppUsageRow[];
  stats: {
    totalLinks: number;
    activeLinks: number;
    pendingLinks: number;
    totalAiUserMsgs: number;
    totalAiBotMsgs: number;
    inbound7d: number;
    outbound7d: number;
    envBotConfigured: boolean;
    llmMode: string;
  };
}) {
  const router = useRouter();
  const [botPhone, setBotPhone] = useState(initialBotPhone);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "PENDING">("ALL");
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<WhatsAppUsageRow | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const notify = (msg: string) => {
    setErrorMsg(null);
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const filtered = rows.filter((r) => {
    if (filter === "ACTIVE" && !r.verified) return false;
    if (filter === "PENDING" && r.verified) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        r.userName.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        (r.waPhone ?? "").includes(q) ||
        r.pairingCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const maxMsgs = Math.max(1, ...rows.map((r) => r.userMessages));
  const activationRate =
    stats.totalLinks > 0 ? Math.round((stats.activeLinks / stats.totalLinks) * 100) : 0;
  const replyRatio =
    stats.inbound7d > 0 ? Math.round((stats.outbound7d / stats.inbound7d) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Üst KPI Kartları */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card interactive={false} className="flex flex-col gap-1 p-4">
          <span className="text-xs text-fg-muted">Aktif Bağlı Kullanıcı</span>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {stats.activeLinks}{" "}
            <span className="text-sm font-normal text-fg-passive">/ {stats.totalLinks}</span>
          </p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
            %{activationRate} eşleşme oranı
          </span>
        </Card>

        <Card interactive={false} className="flex flex-col gap-1 p-4">
          <span className="text-xs text-fg-muted">AI Sohbet Mesajları</span>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {stats.totalAiUserMsgs + stats.totalAiBotMsgs}
          </p>
          <span className="text-[11px] text-fg-passive tabular-nums">
            {stats.totalAiUserMsgs} soru · {stats.totalAiBotMsgs} yanıt
          </span>
        </Card>

        <Card interactive={false} className="flex flex-col gap-1 p-4">
          <span className="text-xs text-fg-muted">Son 7 Gün Kanal Trafiği</span>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {stats.inbound7d + stats.outbound7d}
          </p>
          <span className="text-[11px] text-fg-passive tabular-nums">
            {stats.inbound7d} gelen · {stats.outbound7d} giden (%{replyRatio} yanıt)
          </span>
        </Card>

        <Card interactive={false} className="flex flex-col gap-1 p-4">
          <span className="text-xs text-fg-muted">Sistem &amp; AI Durumu</span>
          <p className="text-base font-semibold text-fg">
            {stats.envBotConfigured ? "Cloud API Aktif" : "Mock / Kurulum Bekliyor"}
          </p>
          <span className="text-[11px] text-fg-passive">LLM: {stats.llmMode}</span>
        </Card>
      </section>

      {/* 2. Çıkan WhatsApp Numarası Yönetimi */}
      <Card interactive={false} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Profilde Görünen WhatsApp Business Numarası</CardTitle>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              Kullanıcıların Profil → WhatsApp Bağlantısı ekranında gördüğü ve &ldquo;WhatsApp&apos;ta Aç&rdquo; butonunun yönlendirdiği hat numarası.
            </p>
          </div>
          {statusMsg ? <span className="text-xs font-medium text-emerald-500">{statusMsg}</span> : null}
          {errorMsg ? <span className="text-xs font-medium text-critical">{errorMsg}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={botPhone}
            onChange={(e) => setBotPhone(e.target.value)}
            placeholder="+905551234567"
            className="w-full max-w-xs rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveWhatsAppBotPhoneAction(botPhone);
                if (!res.ok) {
                  setErrorMsg(res.error ?? "Kaydedilemedi.");
                  return;
                }
                notify("WhatsApp numarası güncellendi.");
                router.refresh();
              })
            }
            className="rounded-full bg-fg px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50"
          >
            Numarayı Kaydet
          </button>
        </div>
      </Card>

      {/* 3. Kim Ne Kadar Kullanıyor? Tablosu */}
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Kullanıcı Bazlı WhatsApp AI Kullanımı</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "ALL", label: `Tümü (${rows.length})` },
                { id: "ACTIVE", label: `Aktif (${stats.activeLinks})` },
                { id: "PENDING", label: `Bekleyen (${stats.pendingLinks})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-standard",
                  filter === t.id
                    ? "bg-fg text-bg"
                    : "border border-border bg-bg text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
              </button>
            ))}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="İsim, e-posta, numara ara..."
              className="rounded-full border border-border bg-bg px-3 py-1 text-xs text-fg"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="border-b border-border bg-bg/50 text-left text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
                <th className="px-4 py-2.5 font-medium">Durum</th>
                <th className="px-4 py-2.5 font-medium">WhatsApp / Kod</th>
                <th className="px-4 py-2.5 font-medium">Mesaj Kullanımı</th>
                <th className="px-4 py-2.5 font-medium">Son İşlem</th>
                <th className="px-4 py-2.5 text-right font-medium">Yönetim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-fg-passive">
                    Kriterlere uyan WhatsApp AI kaydı bulunamadı.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const pct = Math.round((r.userMessages / maxMsgs) * 100);
                  return (
                    <tr key={r.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-3">
                        <span className="font-medium text-fg">{r.userName}</span>
                        <span className="block text-[11px] text-fg-muted">
                          {r.userEmail} · {r.userRole}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                            r.verified
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                          )}
                        >
                          {r.verified ? "Bağlı" : "Kod Bekliyor"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.waPhone ? `+${r.waPhone}` : r.pairingCode}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full bg-fg" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-fg">
                            {r.userMessages} soru / {r.assistantMessages} yanıt
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-fg-muted">
                        {new Date(r.updatedAt).toLocaleString("tr-TR")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {r.history.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setSelectedRow(r)}
                              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-fg hover:border-fg/40"
                            >
                              Geçmiş
                            </button>
                          ) : null}
                          {r.verified ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                start(async () => {
                                  await adminUnlinkWhatsAppUserAction(r.userId);
                                  notify(`${r.userName} bağlantısı kaldırıldı.`);
                                  router.refresh();
                                })
                              }
                              className="rounded-full border border-critical/30 px-2.5 py-1 text-[11px] text-critical hover:bg-critical/10"
                            >
                              Kes
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                start(async () => {
                                  const res = await adminRegenerateWhatsAppUserCodeAction(r.userId);
                                  notify(`Yeni kod oluşturuldu: ${res.code}`);
                                  router.refresh();
                                })
                              }
                              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-fg-muted hover:text-fg"
                            >
                              Kod Yenile
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Konuşma Geçmişi Modalı */}
      {selectedRow ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div>
                <h3 className="text-sm font-semibold text-fg">{selectedRow.userName} — Son Konuşmalar</h3>
                <p className="text-xs text-fg-muted">
                  {selectedRow.waPhone ? `+${selectedRow.waPhone}` : selectedRow.pairingCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover"
              >
                ✕
              </button>
            </div>
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto py-1 text-xs">
              {selectedRow.history.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2",
                    m.role === "user"
                      ? "self-end bg-fg text-bg"
                      : "self-start border border-border bg-bg text-fg",
                  )}
                >
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

