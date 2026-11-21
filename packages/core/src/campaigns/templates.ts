import type { ContentPlanItem, Objective } from "../domain/campaign-plan";
import type { Platform } from "../enums";

export type CampaignSectorId =
  | "kozmetik"
  | "moda"
  | "yeme_icme"
  | "teknoloji"
  | "anne_bebek"
  | "spor";

export interface CampaignTemplate {
  key: string;
  sector: CampaignSectorId;
  sectorLabel: string;
  objective: Objective;
  objectiveLabel: string;
  title: string;
  defaultInterests: string[];
  defaultPlatforms: Platform[];
  defaultAgeMin: number;
  defaultAgeMax: number;
  defaultGender: "hepsi" | "kadin" | "erkek";
  recommendedPlan: ContentPlanItem[];
  briefStarter: string;
  dos: string[];
  donts: string[];
  hashtags: string[];
  kpiHints: string[];
}

export const SECTORS: { id: CampaignSectorId; label: string }[] = [
  { id: "kozmetik", label: "Kozmetik & Cilt Bakımı" },
  { id: "moda", label: "Moda & Aksesuar" },
  { id: "yeme_icme", label: "Yeme-İçme" },
  { id: "teknoloji", label: "Teknoloji & Elektronik" },
  { id: "anne_bebek", label: "Anne & Bebek" },
  { id: "spor", label: "Spor & Sağlık" },
];

export const EXPECTATION_HINTS = [
  "Teklif yanıtları genelde 24–72 saat sürer (tahmin).",
  "Mikro içerik üreticilerinde etkileşim oranı (ER) daha yüksek, tekil erişim daha hedeflidir.",
  "Doğrulanmış kitle verisi yalnızca hesabını bağlayan içerik üreticilerinde gösterilir.",
  "Yayın öncesi tüm içerikler md. 23/A reklam ibaresi kontrolünden geçer.",
];

const ROK_DONTS = [
  "Kesin sağlık/tedavi beyanı veya kanıtlanmamış iddia kullanma",
  "Denemediğin ürünü deneyimlemiş gibi anlatma (ROK kılavuzu)",
  "Rakip marka adı veya karşılaştırmalı karalama yapma",
];

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    key: "kozmetik_satis",
    sector: "kozmetik",
    sectorLabel: "Kozmetik & Cilt Bakımı",
    objective: "satis",
    objectiveLabel: "Satış",
    title: "Kozmetik · Rutin & Satış Dönüşümü",
    defaultInterests: ["güzellik", "cilt bakımı"],
    defaultPlatforms: ["INSTAGRAM", "TIKTOK"],
    defaultAgeMin: 18,
    defaultAgeMax: 34,
    defaultGender: "kadin",
    recommendedPlan: [
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "15–30 sn, ilk 3 sn ürün + rutin kullanımı" },
      { platform: "TIKTOK", contentType: "VIDEO", count: 1, notes: "15–30 sn, trend ses + önce/sonra anlatımı" },
    ],
    briefStarter:
      "Ürünü günlük cilt/makyaj rutininizde doğal ışık altında deneyimleyerek gösterin; takipçilerinize özel indirim kodunu ekranda ve açıklamada paylaşarak satışa yönlendirin.",
    dos: [
      "Ürünü ilk 3 saniyede net biçimde göster",
      "İndirim kodunu ekranda okunaklı yaz ve açıklamaya ekle",
      "Satın alma bağlantısını story/bio'da paylaş",
    ],
    donts: ROK_DONTS,
    hashtags: ["#ciltbakımı", "#güzellik", "#rutin", "#reklam"],
    kpiHints: ["Satış adedi", "Link tıklaması", "Kupon kullanımı", "Erişim"],
  },
  {
    key: "kozmetik_bilinirlik",
    sector: "kozmetik",
    sectorLabel: "Kozmetik & Cilt Bakımı",
    objective: "bilinirlik",
    objectiveLabel: "Bilinirlik",
    title: "Kozmetik · Lansman & Farkındalık",
    defaultInterests: ["güzellik", "cilt bakımı", "yaşam"],
    defaultPlatforms: ["INSTAGRAM", "TIKTOK"],
    defaultAgeMin: 18,
    defaultAgeMax: 34,
    defaultGender: "kadin",
    recommendedPlan: [
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "Kutu açılımı + ilk izlenim (20–30 sn)" },
      { platform: "INSTAGRAM", contentType: "STORY", count: 3, notes: "3 kare yakın çekim ve ürün dokusu" },
    ],
    briefStarter:
      "Yeni ürünü ilk izlenim ve doku vurgusuyla tanıtın; marka hikâyesini samimi ve doğal bir anlatımla geniş kitleye ulaştırın.",
    dos: ["Doğal ışıkta yakın plan doku çekimi yap", "Marka adını ilk 5 saniyede geçir", "Hikâyede soru/anket etiketi kullan"],
    donts: ROK_DONTS,
    hashtags: ["#yenilansman", "#güzellik", "#bakım", "#reklam"],
    kpiHints: ["Erişim", "Gösterim", "Kaydetme", "Etkileşim oranı"],
  },
  {
    key: "moda_satis",
    sector: "moda",
    sectorLabel: "Moda & Aksesuar",
    objective: "satis",
    objectiveLabel: "Satış",
    title: "Moda · Kombin & Sezon Satışı",
    defaultInterests: ["moda", "yaşam"],
    defaultPlatforms: ["INSTAGRAM", "TIKTOK"],
    defaultAgeMin: 18,
    defaultAgeMax: 34,
    defaultGender: "hepsi",
    recommendedPlan: [
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "3 farklı kombin geçişli video" },
      { platform: "INSTAGRAM", contentType: "STORY", count: 3, notes: "Ürün etiketli link kartları" },
    ],
    briefStarter:
      "Koleksiyon parçasını günlük hayatta farklı ortamlara uyarlanan kombinlerle gösterin; kumaş kalitesi ve kalıp bilgisiyle birlikte kampanya linkini paylaşın.",
    dos: ["Boydan ve yakın dikiş/kumaş detayı göster", "Kalıp ve beden önerisi paylaş", "Link etiketini ilk story karesinde kullan"],
    donts: ROK_DONTS,
    hashtags: ["#kombin", "#moda", "#stil", "#reklam"],
    kpiHints: ["Satış", "Link tıklaması", "Kaydetme", "Erişim"],
  },
  {
    key: "yeme_icme_urun_tanitimi",
    sector: "yeme_icme",
    sectorLabel: "Yeme-İçme",
    objective: "urun_tanitimi",
    objectiveLabel: "Ürün tanıtımı",
    title: "Yeme-İçme · Tadım & Tarif Deneyimi",
    defaultInterests: ["yeme-içme", "yaşam"],
    defaultPlatforms: ["INSTAGRAM", "TIKTOK"],
    defaultAgeMin: 18,
    defaultAgeMax: 44,
    defaultGender: "hepsi",
    recommendedPlan: [
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "Hızlı hazırlama / ilk tadım anı" },
      { platform: "TIKTOK", contentType: "VIDEO", count: 1, notes: "ASMR dokunuşlu pratik tarif" },
    ],
    briefStarter:
      "Ürünü pratik bir tarif veya gerçek tadım anıyla buluşturun; ambalajı ve ürünün öne çıkan lezzet detayını net gösterin.",
    dos: ["Ambalaj ön yüzünü net kadrajla", "Gerçek tadım tepkisini paylaş", "Nereden bulunabileceğini belirt"],
    donts: ROK_DONTS,
    hashtags: ["#lezzet", "#tarif", "#tadım", "#reklam"],
    kpiHints: ["Erişim", "Kaydetme", "Video izlenme", "Etkileşim oranı"],
  },
  {
    key: "teknoloji_urun_tanitimi",
    sector: "teknoloji",
    sectorLabel: "Teknoloji & Elektronik",
    objective: "urun_tanitimi",
    objectiveLabel: "Ürün tanıtımı",
    title: "Teknoloji · İnceleme & Kullanım Senaryosu",
    defaultInterests: ["teknoloji", "oyun"],
    defaultPlatforms: ["YOUTUBE", "INSTAGRAM"],
    defaultAgeMin: 18,
    defaultAgeMax: 44,
    defaultGender: "hepsi",
    recommendedPlan: [
      { platform: "YOUTUBE", contentType: "SHORTS", count: 1, notes: "45–60 sn öne çıkan 3 özellik" },
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "Günlük kullanım testi" },
    ],
    briefStarter:
      "Cihazın günlük hayatta çözdüğü problemi 3 somut özellikle deneyimleyerek anlatın; teknik özellikleri anlaşılır ve gerçek test görüntüleriyle destekleyin.",
    dos: ["Gerçek kullanım ortamında test et", "En güçlü 3 özelliği ekranda başlıkla vurgula", "Ürün linkini açıklamaya ekle"],
    donts: ROK_DONTS,
    hashtags: ["#teknoloji", "#inceleme", "#ürün", "#reklam"],
    kpiHints: ["Video izlenme", "Link tıklaması", "Kaydetme", "Erişim"],
  },
  {
    key: "anne_bebek_bilinirlik",
    sector: "anne_bebek",
    sectorLabel: "Anne & Bebek",
    objective: "bilinirlik",
    objectiveLabel: "Bilinirlik",
    title: "Anne & Bebek · Güven & Günlük Rutin",
    defaultInterests: ["anne-bebek", "yaşam"],
    defaultPlatforms: ["INSTAGRAM"],
    defaultAgeMin: 25,
    defaultAgeMax: 44,
    defaultGender: "kadin",
    recommendedPlan: [
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "Günlük rutinde pratik kullanım" },
      { platform: "INSTAGRAM", contentType: "STORY", count: 3, notes: "Soru-cevap ve detay çekimi" },
    ],
    briefStarter:
      "Ebeveynlerin günlük yaşamını kolaylaştıran kullanım detaylarını samimi, sade ve güven veren bir dille aktarın.",
    dos: ["Ürünün kullanım kolaylığını gerçek rutinde göster", "Güvenlik ve içerik bilgisini yalnızca onaylı metinden aktar"],
    donts: [...ROK_DONTS, "Tıbbi veya pediatrik tavsiye verme"],
    hashtags: ["#annebebek", "#günlükrutin", "#reklam"],
    kpiHints: ["Erişim", "Kaydetme", "Etkileşim oranı"],
  },
  {
    key: "spor_etkinlik",
    sector: "spor",
    sectorLabel: "Spor & Sağlık",
    objective: "etkinlik",
    objectiveLabel: "Etkinlik",
    title: "Spor · Antrenman & Etkinlik Paylaşımı",
    defaultInterests: ["spor", "fitness"],
    defaultPlatforms: ["INSTAGRAM", "TIKTOK"],
    defaultAgeMin: 18,
    defaultAgeMax: 34,
    defaultGender: "hepsi",
    recommendedPlan: [
      { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "Antrenman / etkinlik enerjisi (20–30 sn)" },
      { platform: "INSTAGRAM", contentType: "STORY", count: 3, notes: "Etkinlik anından canlı kareler" },
    ],
    briefStarter:
      "Antrenman veya etkinlik atmosferini yüksek enerjili kısa kesitlerle aktarın; takipçileri deneyime ve marka topluluğuna davet edin.",
    dos: ["Hareketli ve doğal ortam çekimleri yap", "Etkinlik/ürün adını ilk 3 saniyede göster"],
    donts: ROK_DONTS,
    hashtags: ["#spor", "#fitness", "#etkinlik", "#reklam"],
    kpiHints: ["Erişim", "Video izlenme", "Etkileşim oranı"],
  },
];

export function findCampaignTemplate(sector?: string | null, objective?: string | null): CampaignTemplate {
  if (sector && objective) {
    const exact = CAMPAIGN_TEMPLATES.find((t) => t.sector === sector && t.objective === objective);
    if (exact) return exact;
  }
  if (sector) {
    const bySector = CAMPAIGN_TEMPLATES.find((t) => t.sector === sector);
    if (bySector) return bySector;
  }
  if (objective) {
    const byObj = CAMPAIGN_TEMPLATES.find((t) => t.objective === objective);
    if (byObj) return byObj;
  }
  return CAMPAIGN_TEMPLATES[0]!;
}

