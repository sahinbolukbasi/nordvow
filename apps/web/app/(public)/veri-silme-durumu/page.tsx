import type { Metadata } from "next";
import { getMetaDataDeletionStatus } from "@infulancer/core/inbox/store";

export const metadata: Metadata = { title: "Meta Veri Silme Talebi Durumu · NordVow" };
export const dynamic = "force-dynamic";

export default async function DataDeletionStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ kod?: string }>;
}) {
  const { kod } = await searchParams;
  const code = (kod ?? "").trim();
  const status = code ? await getMetaDataDeletionStatus(code) : null;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-4 px-4 py-12">
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h1 className="text-lg font-bold text-fg">KVKK & Meta Veri Silme Durumu</h1>
        <p className="mt-1 text-xs text-fg-muted">
          Instagram ve WhatsApp entegrasyonları kapsamında iletilen veri silme talebinizin güncel durumunu aşağıdan takip edebilirsiniz.
        </p>

        {!code ? (
          <div className="mt-4 rounded-xl border border-line bg-bg p-4 text-xs text-fg-muted">
            Onay kodu (<code>?kod=...</code>) belirtilmedi. Meta üzerinden veri silme talebi oluşturduğunuzda size verilen bağlantı ile bu sayfayı görüntüleyebilirsiniz.
          </div>
        ) : !status ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-400">
            <strong>{code}</strong> onay koduna ait bir veri silme kaydı bulunamadı veya kayıt saklama süresi sonunda sistemden tamamen temizlendi.
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Onay Kodu:</span>
              <code className="font-bold text-emerald-400">{status.confirmationCode}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Durum:</span>
              <span className="font-semibold text-emerald-400">
                {status.status === "COMPLETED" ? "Tamamlandı (Tüm Veriler Silindi)" : status.status}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Talep Zamanı:</span>
              <span className="text-fg">{new Date(status.requestedAt).toLocaleString("tr-TR")}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

