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

  const waHref = botPhone
    ? `https://wa.me/${botPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(code)}`
    : null;

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
        <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-bg/60 p-4">
          <p className="text-[13px] text-fg-muted">
            Tek seferlik eşleştirme kodunuzu WhatsApp üzerinden Nordvow Asistanına gönderin. Eşleştirme tamamlandıktan sonra
            oturumunuz kalıcı olur ve tüm işlemlerinizi WhatsApp sohbetinden AI Asistan ile yürütebilirsiniz.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-xl border border-line bg-surface px-4 py-2 font-mono text-base font-bold tracking-widest text-fg">
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
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-500"
              >
                WhatsApp ile Bağla →
              </a>
            ) : null}
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

