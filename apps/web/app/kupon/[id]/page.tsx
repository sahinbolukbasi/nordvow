import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { couponValueLabel } from "@infulancer/core/coupons/service";
import { buildWalletLinks } from "@infulancer/core/wallet/passes";
import { CouponCard } from "@/components/luma/pass-cards";
import { QrImage, WalletButtons } from "@/components/wallet/pass-card";
import { loadCouponPass } from "@/lib/coupon-pass";
import { dateLong } from "@/lib/event-format";
import { mediaSrc } from "@/lib/media";

export const metadata: Metadata = { title: "Kupon" };
export const dynamic = "force-dynamic";

const grantStatus: Record<string, string> = { GONDERILDI: "Kullanılabilir", GORULDU: "Kullanılabilir", KULLANILDI: "Kullanıldı", IPTAL: "İptal" };

/**
 * Kupon kartı. Gönderim bağlantısı alıcıya açıktır. Şablon kimliği paylaşılan kodu yalnız
 * marka veya yönetici oturumunda gösterir; aksi halde kod, QR ve PDF boş kalır.
 */
export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  const tt = await getTT();
  const { id } = await params;
  const pass = await loadCouponPass(id);
  const { coupon, grant } = pass;
  if (!coupon) notFound();
  const allowed = pass.decision.allow;
  const brand = await prisma.brand.findUnique({ where: { id: coupon.tenantId }, select: { name: true } });
  const code = allowed ? (pass.sharedCode ?? grant?.code ?? "ÖNİZLEME") : "••••";
  const qrContent = allowed ? (grant?.code ?? pass.sharedCode ?? id) : "onizleme";
  const links = await buildWalletLinks("coupon", id, qrContent);
  const expired = !!coupon.validUntil && coupon.validUntil < new Date();
  const kind = coupon.kind === "HEDIYE_CEKI" ? "Hediye çeki" : "Kupon";

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-8">
        <CouponCard
          kindLabel={kind}
          title={coupon.title}
          brandName={brand?.name ?? "Marka"}
          valueLabel={couponValueLabel(coupon.valueType, coupon.value)}
          code={code}
          codeHint={allowed ? (grant ? "Ödeme sırasında bu kodu girin veya QR'ı okutun" : "Önizleme: alıcılar kendi kodunu görür") : "Paylaşılan kod bu bağlantıda gösterilmez"}
          validLabel={coupon.validUntil ? `Son kullanım: ${dateLong(coupon.validUntil)}` : "Süresiz"}
          expired={expired}
          statusLabel={grant ? grantStatus[grant.status] : "Önizleme"}
          logoSrc={mediaSrc(coupon.logoKey)}
          heroSrc={mediaSrc(coupon.heroImageKey)}
          accent={coupon.brandColor ?? "#ff2bd6"}
          qr={<QrImage dataUrl={links.qrDataUrl} alt={allowed ? `Kupon QR kodu ${code}` : tt("Kupon önizleme")} />}
        />

        <section className="w-full rounded-2xl border border-line bg-surface p-4" aria-label={tt("Cüzdana ekle")}>
          <WalletButtons appleUrl={links.appleUrl} googleUrl={links.googleUrl} live={links.live} />
          <a href={`/api/kupon/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-medium text-fg hover:border-line-strong">{tt("Apple Wallet Tarzı PDF İndir")}</a>
        </section>

        {coupon.description || coupon.terms ? (
          <section className="flex w-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label={tt("Kupon ayrıntıları")}>
            {coupon.description ? <p className="text-[14px] text-fg">{coupon.description}</p> : null}
            {coupon.terms ? (
              <div>
                <h2 className="text-[12px] font-medium text-fg-muted">{tt("Kullanım koşulları")}</h2>
                <p className="mt-1 whitespace-pre-line text-[13px] text-fg-muted">{coupon.terms}</p>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
