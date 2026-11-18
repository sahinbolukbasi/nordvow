"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { idleState } from "@/lib/action-state";
import {
  saveQuickInviteMessageAction,
  updateInviteRequestStatusAction,
  type InviteRequestRecord,
} from "@/lib/actions/invites";
import { InviteRequestStatusButtons } from "@/components/signup/invite-request-status-buttons";
import { Card, CardTitle } from "@/components/ui/card";
import { useTT } from "@/lib/i18n/tt-client";

const DEFAULT_QUICK_TEXT =
  "Merhaba {{ad}}, Nordvow davet başvurunuz incelendi. Platforma katılmak için aşağıdaki davet bağlantısını kullanabilirsiniz:";

function normalizeWaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 10) return `90${digits}`;
  return digits;
}

function formatQuickMessage(template: string, name: string): string {
  return template.replace(/\{\{\s*ad\s*\}\}/gi, name.trim() || "Merhaba");
}

export function InviteRequestsPanel({
  requests,
  initialQuickText,
}: {
  requests: InviteRequestRecord[];
  initialQuickText: string;
}) {
  const tt = useTT();
  const router = useRouter();
  const [quickText, setQuickText] = useState(initialQuickText || DEFAULT_QUICK_TEXT);
  const [saveState, saveAction] = useActionState(saveQuickInviteMessageAction, idleState);
  const [statusState, statusAction] = useActionState(updateInviteRequestStatusAction, idleState);
  const [pendingSave, startSave] = useTransition();
  const [pendingStatus, startStatus] = useTransition();

  const active = requests.filter((r) => r.status !== "ARCHIVED");
  const closed = requests.filter((r) => r.status === "ARCHIVED");

  const markStatus = (id: string, status: InviteRequestRecord["status"]) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", status);
    startStatus(() => {
      statusAction(fd);
      router.refresh();
    });
  };

  const handleSendWhatsappAndClose = (r: InviteRequestRecord) => {
    const phone = normalizeWaPhone(r.phone);
    const msg = formatQuickMessage(quickText, r.name);
    if (phone) {
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
    markStatus(r.id, "ARCHIVED");
  };

  return (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{tt("Hızlı WhatsApp Mesaj Alanı")}</CardTitle>
          <span className="text-[12px] text-fg-passive">
            {tt("İsteğe bağlı yer tutucu: {{ad}} (başvuran adı)")}
          </span>
        </div>
        <textarea
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          rows={3}
          placeholder={tt("Gelen başvurulara WhatsApp ile gönderilecek hızlı mesajı yazın...")}
          className="w-full rounded-xl border border-line bg-glass px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-passive focus:border-line-strong focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pendingSave}
              onClick={() => {
                const fd = new FormData();
                fd.set("text", quickText);
                startSave(() => saveAction(fd));
              }}
              className="rounded-xl border border-line bg-glass px-3.5 py-1.5 text-[13px] font-medium text-fg transition hover:border-line-strong disabled:opacity-50"
            >
              {pendingSave ? tt("Kaydediliyor...") : tt("Mesajı Kaydet")}
            </button>
            {saveState.ok && saveState.message ? (
              <span className="text-[12px] text-emerald-400">{saveState.message}</span>
            ) : !saveState.ok && saveState.error ? (
              <span className="text-[12px] text-critical">{saveState.error}</span>
            ) : null}
          </div>
          {!statusState.ok && statusState.error ? (
            <span className="text-[12px] text-critical">{statusState.error}</span>
          ) : null}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        {active.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Açık davet kodu başvurusu yok.")}</p>
        ) : (
          active.map((r) => (
            <Card key={r.id} interactive={false} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>{r.role === "BRAND" && r.companyName ? `${r.companyName} (${r.name})` : r.name}</CardTitle>
                  <p className="text-[13px] text-fg-muted">
                    {r.role === "BRAND" ? tt("Marka / Ajans") : tt("Influencer")} · {r.email} · {r.phone}
                  </p>
                </div>
                <span className="text-[12px] text-fg-passive">
                  {new Date(r.createdAt).toLocaleString("tr-TR")}
                </span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {r.instagram || r.tiktok || r.youtube ? (
                  <>
                    <dt className="text-fg-passive">{tt("Sosyal medya")}</dt>
                    <dd>
                      {[r.instagram && `IG: ${r.instagram}`, r.tiktok && `TikTok: ${r.tiktok}`, r.youtube && `YT: ${r.youtube}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </dd>
                  </>
                ) : null}
                {r.note ? (
                  <>
                    <dt className="text-fg-passive">{tt("Not")}</dt>
                    <dd className="text-fg-muted">{r.note}</dd>
                  </>
                ) : null}
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <InviteRequestStatusButtons id={r.id} current={r.status} />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={pendingStatus}
                    onClick={() => handleSendWhatsappAndClose(r)}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {tt("WhatsApp ile Gönder & Kapat")}
                  </button>
                  <Link
                    href="/admin/davetler?bolum=davetler"
                    className="text-[12px] text-fg-muted underline underline-offset-4 hover:text-fg"
                  >
                    {tt("Davet linki oluştur →")}
                  </Link>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {closed.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>
            {tt("Kapatılan Başvurular")} ({closed.length})
          </CardTitle>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {closed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">
                    {r.role === "BRAND" && r.companyName ? `${r.companyName} (${r.name})` : r.name}
                  </span>
                  <span className="text-[12px] text-fg-muted">
                    {r.role === "BRAND" ? tt("Marka / Ajans") : tt("Influencer")} · {r.email} · {r.phone}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-line bg-glass px-2 py-0.5 text-[11px] text-fg-passive">
                    {tt("Kapatıldı")}
                  </span>
                  <button
                    type="button"
                    disabled={pendingStatus}
                    onClick={() => markStatus(r.id, "NEW")}
                    className="rounded-lg border border-line bg-glass px-2.5 py-1 text-[12px] text-fg-muted transition hover:border-line-strong hover:text-fg disabled:opacity-50"
                  >
                    {tt("Tekrar Aç")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

