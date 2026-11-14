import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { LegalDoc } from "@/components/legal/legal-doc";
import { getLegalEntity } from "@/lib/legal";

export const metadata: Metadata = { title: "Veri silme" };
export const dynamic = "force-dynamic";

const CONTACT = "root@nordvow.com";

/** Meta App Review: kullanıcı verisinin nasıl silineceği. Giriş gerekmez. */
export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ kod?: string }> }) {
  const tt = await getTT();
  const e = await getLegalEntity();
  const kod = (await searchParams).kod?.slice(0, 40) ?? "";
  const known = kod ? await prisma.dataDeletionRequest.findUnique({ where: { code: kod }, select: { code: true, createdAt: true } }).catch(() => null) : null;
  return (
    <LegalDoc
      current="/veri-silme"
      entity={e}
      title={tt("Veri silme")}
      intro={
        <p>
          <strong>{tt("Taslak:")}</strong>{" "}{tt("bu metin hukuk incelemesi bekler. ")}
          {tt("Nordvow hesabınızdaki veya Meta (Facebook, Instagram, WhatsApp) üzerinden iletilen kişisel verilerinizin silinmesini bu sayfadaki adımlarla isteyebilirsiniz.")}
        </p>
      }
      sections={[
        {
          id: "nasil",
          title: "Silme nasıl istenir",
          body: (
            <ol>
              <li>{tt("Hesabınıza giriş yapıp profilinizden çıkış yapmanıza gerek yoktur; talep e-posta ile de alınır.")}</li>
              <li>
                {tt("Konu satırına \"Veri silme\" yazarak")}{" "}
                <a href={`mailto:${CONTACT}?subject=Veri%20silme`} className="underline underline-offset-4">{CONTACT}</a>{" "}
                {tt("adresine gönderin. Mesajda hesap e-postanızı ve varsa Meta kullanıcı kimliğinizi belirtin.")}
              </li>
              <li>{tt("Meta uygulamasındaki \"Verilerimi sil\" akışı da aynı talebi oluşturur. Meta, imzalı bir istek gönderir; size bir onay kodu ve bu sayfanın bağlantısı döner.")}</li>
              <li>{tt("Yasal saklama yükümlülüğü olmayan veriler 30 gün içinde silinir veya anonimleştirilir. Fatura ve denetim kayıtları kanuni süre boyunca tutulabilir.")}</li>
            </ol>
          ),
        },
        {
          id: "meta",
          title: "Meta, WhatsApp ve Instagram",
          body: (
            <p>{tt("WhatsApp, Instagram veya Messenger üzerinden platforma düşen mesajlar ve hesap bağlantı bilgileri silme talebine dahildir. Meta'nın kendi sunucularındaki kopyalar için ayrıca Meta'nın hesap ayarlarındaki silme araçlarını kullanmanız gerekir. Ayrıntı için")}{" "}
              <Link href="/gizlilik" className="underline underline-offset-4">{tt("Gizlilik Politikası")}</Link>.</p>
          ),
        },
        {
          id: "durum",
          title: "Talep durumu",
          body: known ? (
            <p>{tt("Onay kodu")}{" "}<strong className="font-mono">{known.code}</strong>{" "}{tt("ile kayıtlı bir silme talebi alındı")}{" "}({known.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}). {tt("İşlem tamamlandığında aynı e-posta adresine bilgi verilir. Sorularınız için")}{" "}<a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>.</p>
          ) : kod ? (
            <p>{tt("Bu onay kodu sistemde bulunamadı. Kodu kontrol edin veya")}{" "}<a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>{" "}{tt("adresine yazın.")}</p>
          ) : (
            <p>{tt("Meta'dan dönen bağlantıda bir onay kodu varsa adresin sonundaki kod ile durum burada görünür. Kod yoksa talebinizi doğrudan")}{" "}<a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>{" "}{tt("adresine iletin.")}</p>
          ),
        },
      ]}
    />
  );
}
