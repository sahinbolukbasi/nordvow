import { prisma } from "../db";
import {
  type EArsivFaturaJson,
  type FaturaAyarlar,
  type FaturaGirdi,
  type FaturaSonuc,
  createEArsivDraft,
  formatTurkishDate,
  validateVkn,
} from "./earsiv-invoice";
import { renderEArsivHtml } from "./earsiv-renderer";

export {
  type EArsivFaturaJson,
  type FaturaAyarlar,
  type FaturaGirdi,
  type FaturaSonuc,
  createEArsivDraft,
  formatTurkishDate,
  validateVkn,
  renderEArsivHtml,
};

export interface BuildCampaignInvoiceOptions {
  customSettings?: Partial<FaturaAyarlar>;
  addressOverride?: {
    adres?: string;
    binaNo?: string;
    postaKodu?: string;
    ilce?: string;
    il?: string;
  };
}

/**
 * Kampanya ve Marka verilerinden e-Arşiv Fatura Girdi modelini üretir.
 */
export async function buildCampaignInvoiceDraft(
  campaignId: string,
  brandId?: string,
  options: BuildCampaignInvoiceOptions = {},
): Promise<{ draft: FaturaSonuc; campaignName: string; brandName: string }> {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      ...(brandId ? { brandId } : {}),
    },
    include: {
      brand: true,
      assignments: {
        where: { contractStatus: { not: "RED" } },
        include: { influencer: { select: { name: true } } },
      },
    },
  });

  if (!campaign) {
    throw new Error(`Kampanya bulunamadı (${campaignId})`);
  }

  const brand = campaign.brand;
  const isIndividual = brand.taxNumber && brand.taxNumber.length === 11;
  const isVknValid = !isIndividual && validateVkn(brand.taxNumber);

  // Marka adres detayları (opsiyonel override veya marka alanından)
  const adres = options.addressOverride?.adres || "Merkez Mah. İş Merkezi";
  const ilce = options.addressOverride?.ilce || (brand.taxOffice ? brand.taxOffice.replace(/ Vergi Dairesi.*$/i, "").trim() : "Şişli");
  const il = options.addressOverride?.il || "İSTANBUL";

  const totalFeeKurus = Number(campaign.brandTotalFeeKurus);
  const budgetKurus = Number(campaign.budgetKurus);
  const effectiveKurus = totalFeeKurus > 0 ? totalFeeKurus : budgetKurus;

  // KDV matrahı hesaplaması: totalFee KDV dahil olarak geliyorsa birim fiyatı 1.20'ye bölerek matrah çıkartabilir
  // veya net hizmet bedeli olarak değerlendirip KDV ekler. GİB kuralı: birimFiyat matrahtır.
  // 100 kuruş = 1 TL
  const birimFiyatTl = effectiveKurus / 100;

  const influencerCount = campaign.assignments.length;
  const influencerNote = influencerCount > 0
    ? `${influencerCount} influencer katılımı (${campaign.assignments.slice(0, 3).map((a) => a.influencer.name).join(", ")}${influencerCount > 3 ? "..." : ""})`
    : undefined;

  const girdi: FaturaGirdi = {
    alici: {
      tip: isIndividual ? "bireysel" : "kurumsal",
      unvan: brand.name,
      adSoyad: isIndividual ? brand.contactName || brand.name : undefined,
      vkn: !isIndividual ? brand.taxNumber : undefined,
      tckn: isIndividual ? brand.taxNumber : undefined,
      vergiDairesi: brand.taxOffice || "Bilinmiyor",
      adres,
      binaNo: options.addressOverride?.binaNo || "",
      postaKodu: options.addressOverride?.postaKodu || "34000",
      ilce,
      il,
      eposta: brand.contactEmail || undefined,
      eFaturaMukellefi: "hayir",
    },
    kalemler: [
      {
        aciklama: `${campaign.name} — Influencer Pazarlama ve Kampanya Yönetimi`,
        miktar: 1,
        birim: "Adet",
        birimFiyat: birimFiyatTl,
        paraBirimi: campaign.currency || "TRY",
        iskontoOrani: 0,
        hizmetTuru: "influencer_reklam",
      },
    ],
    faturaTarihi: formatTurkishDate(new Date()),
    islemTarihi: formatTurkishDate(campaign.createdAt),
    siparisNo: campaign.slug || campaign.id.slice(-8).toUpperCase(),
    siparisTarihi: formatTurkishDate(campaign.createdAt),
    ekNot: influencerNote,
  };

  const draft = createEArsivDraft(girdi, options.customSettings);

  return {
    draft,
    campaignName: campaign.name,
    brandName: brand.name,
  };
}

/**
 * Kampanya için resmi e-Arşiv fatura HTML görünümünü derler.
 */
export async function getCampaignInvoiceHtml(
  campaignId: string,
  brandId?: string,
  options: BuildCampaignInvoiceOptions = {},
): Promise<string> {
  const { draft } = await buildCampaignInvoiceDraft(campaignId, brandId, options);
  if (draft.durum === "HATA") {
    throw new Error(`Fatura taslağı oluşturulamadı: ${draft.hatalar.join(", ")}`);
  }
  return renderEArsivHtml(draft as EArsivFaturaJson);
}
