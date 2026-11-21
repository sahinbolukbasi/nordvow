"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/form";

export function EInvoiceButton({ href, missing }: { href: string; missing: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>E-Fatura</Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <h2 className="font-semibold text-fg">{missing.length ? "Fatura bilgileri eksik" : "E-Fatura akışı"}</h2>
            {missing.length ? (
              <>
                <p className="text-sm text-fg-muted">Fatura oluşturmak için şu bilgileri tamamlayın:</p>
                <ul className="list-disc pl-5 text-sm text-fg">{missing.map((item) => <li key={item}>{item}</li>)}</ul>
                <Link href="/profil?sekme=fatura" className="text-sm font-medium text-fg underline">Profil fatura bilgilerini düzenle</Link>
              </>
            ) : <p className="text-sm text-fg-muted">Bilgileriniz hazır. Fatura önizlemesini açabilirsiniz.</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Kapat</Button>
              {!missing.length ? <Link href={href} className="inline-flex h-9 items-center rounded-lg bg-fg px-3 text-sm text-bg">Faturayı aç</Link> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
