"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateWhatsAppCodeAction, unlinkWhatsAppAction } from "@/lib/actions/whatsapp-link";

export function WhatsAppConnectCard({
  pairingCode,
  verified,
  waPhone,
  botPhone,
}: {
  pairingCode: string;
  verified: boolean;
  waPhone: string | null;
  botPhone: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(pairingCode);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const cleanBotDigits = botPhone.replace(/[^\d]/g, "");
  const waHref = cleanBotDigits
    ? `https://wa.me/${cleanBotDigits}?text=${encodeURIComponent(code)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(code)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${verified ? "bg-emerald-500" : "bg-amber-500"}`} />
          <span className="text-sm font-medium text-fg">
            {verified ? `Bağlı (+${waPhone})` : "Henüz bağlanmadı"}
          </span>
        </div>
        {verified ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await unlinkWhatsAppAction();
                router.refresh();
              })
            }
            className="rounded-full border border-line px-3 py-1 text-[12px] text-critical hover:border-critical/40"
          >
            Bağlantıyı Kaldır
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await regenerateWhatsAppCodeAction();
                setCode(res.pairingCode);
                router.refresh();
              })
            }
            className="rounded-full border border-line px-3 py-1 text-[12px] text-fg-muted hover:text-fg"
          >
            Yeni Kod Oluştur
          </button>
        )}
      </div>

      {!verified ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/60 p-4">
          <p className="text-[13px] leading-relaxed text-fg-muted">
            Aşağıdaki butona dokunduğunuzda <strong>Nordvow WhatsApp Business</strong> sohbeti tek seferlik kodunuz
            otomatik yazılmış olarak açılır; sadece <strong>Gönder</strong>&apos;e basmanız yeterlidir.
          </p>

          {botPhone ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs">
              <span className="text-fg-muted">WhatsApp Business Hattı:</span>
              <span className="font-mono font-semibold text-fg">{botPhone}</span>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              WhatsApp Business numarası tanımlı değil; buton WhatsApp uygulamasını kodunuzla açar, alıcı olarak Nordvow hattını seçip gönderebilirsiniz.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              WhatsApp&apos;ta Aç &amp; Kodu Gönder →
            </a>

            <code className="rounded-xl border border-line bg-surface px-3 py-1.5 font-mono text-sm font-bold tracking-widest text-fg">
              {code}
            </code>

            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:border-fg/40"
            >
              {copied ? "Kopyalandı ✓" : "Kodu Kopyala"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-fg-muted">
          WhatsApp oturumunuz aktif. Kampanyalarınız, teklifleriniz, bakiyeniz ve briefleriniz için doğrudan WhatsApp&apos;tan mesaj yazabilirsiniz.
        </p>
      )}
    </div>
  );
}
