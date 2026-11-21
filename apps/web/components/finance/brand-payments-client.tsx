"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTT } from "@/lib/i18n/tt-client";

export function BrandPaymentAction({
  campaignId,
  campaignName,
  amountLabel,
  hasNotice,
}: {
  campaignId: string;
  campaignName: string;
  amountLabel: string;
  hasNotice?: boolean;
}) {
  const tt = useTT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"EFT_HAVALE" | "KART" | "DIGER">("EFT_HAVALE");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reference.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marka/odemeler", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, method, reference: reference.trim(), note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? tt("Ödeme bildirimi gönderilemedi."));
        return;
      }
      setDone(true);
      setOpen(false);
      setReference("");
      setNote("");
      router.refresh();
    } catch {
      setError(tt("Bağlantı hatası."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setDone(false);
        }}
        className="inline-flex h-8 items-center rounded-[8px] bg-fg px-3 text-[12px] font-semibold text-bg hover:opacity-90"
      >
        {open ? tt("Kapat") : hasNotice ? tt("Yeni Ödeme Bildir") : tt("Ödeme Yap / Bildir")}
      </button>

      {done ? <span className="text-[11px] text-emerald-400">{tt("Ödeme bildiriminiz alındı.")}</span> : null}

      {open ? (
        <form
          onSubmit={onSubmit}
          className="mt-1 flex w-72 flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 text-left shadow-lg"
        >
          <div className="text-[12px] font-semibold text-fg">
            {campaignName} · {amountLabel}
          </div>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as "EFT_HAVALE" | "KART" | "DIGER")}
            className="h-9 rounded-lg border border-line bg-bg px-2.5 text-[12px] text-fg focus:border-fg focus:outline-none"
          >
            <option value="EFT_HAVALE">{tt("EFT / Havale")}</option>
            <option value="KART">{tt("Kredi / Banka Kartı")}</option>
            <option value="DIGER">{tt("Diğer")}</option>
          </select>
          <input
            type="text"
            required
            minLength={2}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={tt("Dekont / İşlem Referans No *")}
            className="h-9 rounded-lg border border-line bg-bg px-2.5 text-[12px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tt("Açıklama (opsiyonel)")}
            className="h-9 rounded-lg border border-line bg-bg px-2.5 text-[12px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !reference.trim()}
            className="h-9 rounded-lg bg-fg px-3 text-[12px] font-semibold text-bg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? tt("Gönderiliyor...") : tt("Ödeme Bildirimini Gönder")}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function PrintInvoiceButton() {
  const tt = useTT();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center rounded-[8px] bg-fg px-4 text-[13px] font-semibold text-bg hover:opacity-90 print:hidden"
    >
      {tt("Yazdır / PDF Kaydet")}
    </button>
  );
}

