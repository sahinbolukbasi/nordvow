"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEventAction } from "@/lib/actions/events";
import { deleteCouponAction } from "@/lib/actions/coupons";

export function DeleteConfirmButton({
  id,
  kind,
  label,
}: {
  id: string;
  kind: "event" | "coupon";
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const handleConfirm = () => {
    setErr(null);
    start(async () => {
      const res = kind === "event" ? await deleteEventAction(id) : await deleteCouponAction(id);
      if (!res.ok) {
        setErr(res.error ?? "Silme işlemi başarısız.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-full border border-critical/30 bg-surface px-3 py-1 text-[11px] font-medium text-critical transition-standard hover:bg-red-500/10"
      >
        Sil
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Silme Onayı"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-fg">
                {kind === "event" ? "Etkinliği Sil" : "Kuponu Sil"}
              </h3>
              <p className="text-[13px] text-fg-muted">
                <strong>{label}</strong> kaydını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
              </p>
            </div>
            {err ? <p className="text-[12px] text-critical">{err}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-full border border-line px-4 py-1.5 text-[12px] font-medium text-fg hover:border-fg/40"
              >
                İptal
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirm}
                className="rounded-full bg-red-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {pending ? "Siliniyor…" : "Evet, Sil"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

