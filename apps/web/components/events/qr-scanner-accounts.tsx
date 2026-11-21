"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

export type QrScannerItem = {
  userId: string;
  name: string;
  email: string;
  allowedEventIds: string[];
  active: boolean;
  createdAt: string;
};

export function QrScannerAccountsPanel({
  eventId,
  initialAccounts,
}: {
  eventId: string;
  initialAccounts: QrScannerItem[];
}) {
  const tt = useTT();
  const router = useRouter();
  const [accounts, setAccounts] = useState<QrScannerItem[]>(initialAccounts);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/etkinlik/qr-scanners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          eventId,
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; account?: QrScannerItem };
      if (!res.ok || !data.ok || !data.account) {
        setError(data.error ?? tt("Hesap oluşturulamadı."));
        return;
      }
      setAccounts((prev) => [data.account!, ...prev]);
      setName("");
      setEmail("");
      setPassword("");
      setSuccess(`${tt("QR okuyucu hesabı oluşturuldu")}: ${data.account.email}`);
      router.refresh();
    } catch {
      setError(tt("Bağlantı hatası."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEvent(scannerUserId: string, allow: boolean) {
    setBusyId(scannerUserId);
    setError(null);
    try {
      const res = await fetch("/api/etkinlik/qr-scanners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggleEvent", eventId, scannerUserId, allow }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; account?: QrScannerItem };
      if (!res.ok || !data.ok || !data.account) {
        setError(data.error ?? tt("İzin güncellenemedi."));
        return;
      }
      setAccounts((prev) => prev.map((a) => (a.userId === scannerUserId ? data.account! : a)));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(scannerUserId: string, active: boolean) {
    setBusyId(scannerUserId);
    setError(null);
    try {
      const res = await fetch("/api/etkinlik/qr-scanners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggleActive", scannerUserId, active }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; account?: QrScannerItem };
      if (!res.ok || !data.ok || !data.account) {
        setError(data.error ?? tt("Durum güncellenemedi."));
        return;
      }
      setAccounts((prev) => prev.map((a) => (a.userId === scannerUserId ? data.account! : a)));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-fg">{tt("QR Okuyucu Hesapları")}</h3>
            <p className="text-[12px] text-fg-muted">
              {tt("Bu hesaplar giriş yaptığında yalnızca izin verdiğiniz etkinliklerin QR biletlerini tarayabilir.")}
            </p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-fg-muted">
            {tt("Henüz QR okuyucu hesabı oluşturulmadı. Sağdaki formdan kapı görevlisi hesabı oluşturabilirsiniz.")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {accounts.map((acc) => {
              const hasAccess = acc.allowedEventIds.includes(eventId);
              const isBusy = busyId === acc.userId;
              return (
                <li key={acc.userId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-fg">{acc.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          acc.active ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
                        )}
                      >
                        {acc.active ? tt("Aktif") : tt("Pasif")}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          hasAccess ? "bg-violet-500/15 text-violet-300" : "bg-surface-hover text-fg-muted",
                        )}
                      >
                        {hasAccess ? tt("Bu etkinliğe izinli") : tt("İzni yok")}
                      </span>
                    </div>
                    <p className="truncate text-[12px] text-fg-muted">
                      {acc.email} · {acc.allowedEventIds.length} {tt("etkinlik izni")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void toggleEvent(acc.userId, !hasAccess)}
                      className={cn(
                        "h-8 rounded-lg px-3 text-[12px] font-medium transition-standard disabled:opacity-50",
                        hasAccess
                          ? "border border-line text-fg hover:border-line-strong"
                          : "bg-fg text-bg hover:opacity-90",
                      )}
                    >
                      {hasAccess ? tt("Etkinlik İznini Kaldır") : tt("Bu Etkinliğe İzin Ver")}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void toggleActive(acc.userId, !acc.active)}
                      className="h-8 rounded-lg border border-line px-2.5 text-[12px] text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50"
                    >
                      {acc.active ? tt("Pasife Al") : tt("Aktifleştir")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 xl:sticky xl:top-6 xl:self-start">
        <h3 className="text-[15px] font-semibold text-fg">{tt("Yeni QR Okuyucu Oluştur")}</h3>
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] text-fg-muted">
            {tt("Oluşturulan kullanıcı yalnız QR Giriş & Biletler ekranına ve Profilim sayfasına erişebilir; davet/katılımcı ekleyemez.")}
          </p>
          <input
            type="text"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tt("Görevli Ad Soyad *")}
            className="h-10 rounded-lg border border-line bg-bg px-3 text-[13px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={tt("E-posta adresi *")}
            className="h-10 rounded-lg border border-line bg-bg px-3 text-[13px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tt("Giriş şifresi (en az 6 karakter) *")}
            className="h-10 rounded-lg border border-line bg-bg px-3 text-[13px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
          {success ? <p className="text-[12px] text-emerald-400">{success}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="h-10 rounded-lg bg-fg px-4 text-[13px] font-semibold text-bg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? tt("Oluşturuluyor...") : tt("QR Okuyucu Hesabı Oluştur")}
          </button>
        </form>
      </section>
    </div>
  );
}

