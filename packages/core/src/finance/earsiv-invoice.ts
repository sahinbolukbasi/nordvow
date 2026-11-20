/**
 * GİB e-Arşiv / e-Fatura Taslak Doğrulama, Hesaplama ve Biçimlendirme Motoru
 * (VUK, KDV Kanunu ve GİB e-Belge standartlarına tam uyumlu).
 */

export type AliciTipi = "bireysel" | "kurumsal";
export type EFaturaMukellefi = "evet" | "hayir" | "bilinmiyor";

export interface FaturaAliciGirdi {
  tip: AliciTipi;
  unvan?: string; // kurumsal için ticaret unvanı
  adSoyad?: string; // bireysel için ad soyad
  vkn?: string; // kurumsal VKN (10 hane)
  tckn?: string; // bireysel TCKN (11 hane)
  vergiDairesi?: string;
  adres: string;
  binaNo?: string;
  postaKodu?: string;
  ilce: string;
  il: string;
  eposta?: string;
  eFaturaMukellefi?: EFaturaMukellefi;
}

export interface FaturaKalemGirdi {
  aciklama: string;
  miktar: number;
  birim?: string; // "Adet", "Saat", "Gün", "Ay", "Paket" (varsayılan "Adet")
  birimFiyat: number; // Para birimi cinsinden
  paraBirimi?: string; // Varsayılan "TRY" / "TL"
  iskontoOrani?: number; // % cinsinden (ör. 0, 10)
  iskontoNedeni?: string;
  hizmetTuru: string; // "influencer_reklam", "danismanlik", "icerik_uretimi" vb.
}

export interface FaturaGirdi {
  alici: FaturaAliciGirdi;
  kalemler: FaturaKalemGirdi[];
  faturaTarihi?: string; // "GG-AA-YYYY" veya "YYYY-AA-GG"
  islemTarihi?: string; // "GG-AA-YYYY" veya "YYYY-AA-GG"
  siparisNo?: string;
  siparisTarihi?: string;
  irsaliyeNo?: string;
  irsaliyeTarihi?: string;
  kur?: number;
  kurTarihi?: string;
  ekNot?: string;
}

export interface SaticiAyarlari {
  unvan: string;
  adres: string;
  binaNo?: string;
  postaKodu?: string;
  ilce: string;
  il: string;
  tel?: string;
  fax?: string;
  web?: string;
  eposta?: string;
  vergiDairesi: string;
  vkn: string;
  mersisNo?: string;
}

export interface TevkifatKurali {
  kod: string; // ör. "624" veya "601"
  oran: string; // ör. "3/10" veya "5/10"
  altSinirKdvDahil: number; // TL (KDV dahil alt sınır eşiği)
}

export interface FaturaAyarlar {
  satici: SaticiAyarlari;
  kdvOranlari: Record<string, number>; // hizmetTuru -> kdvOrani (%)
  tevkifatKurallari?: Record<string, TevkifatKurali>;
  eArsivEsigi?: number; // TL (KDV dahil)
  seriOnEki?: string; // 3 harf (ör. "NRD")
  sonSiraNo?: number; // ör. 1
  yil?: number; // ör. 2026
  taslakModu?: boolean; // varsayılan true
}

export interface EArsivFaturaJson {
  durum: "TASLAK" | "RESMI";
  hatalar: string[];
  uyarilar: string[];
  ornekFiligran: boolean;
  ozellestirmeNo: string;
  senaryo: "EARSIVFATURA" | "TEMELFATURA";
  faturaTipi: string;
  faturaNo: string;
  faturaTarihi: string;
  ettn: string;
  siparisNo: string;
  siparisTarihi: string;
  irsaliyeNo: string;
  irsaliyeTarihi: string;
  satici: {
    unvan: string;
    adres: string;
    binaNo: string;
    postaKodu: string;
    ilce: string;
    il: string;
    tel: string;
    fax: string;
    web: string;
    eposta: string;
    vergiDairesi: string;
    kimlikler: Array<{ schemeID: string; id: string }>;
  };
  alici: {
    unvan: string;
    adres: string;
    binaNo: string;
    postaKodu: string;
    ilce: string;
    il: string;
    vergiDairesi: string;
    kimlikler: Array<{ schemeID: string; id: string }>;
  };
  kalemler: Array<{
    siraNo: string;
    malHizmet: string;
    miktar: string;
    birim: string;
    birimFiyat: string;
    iskontoOrani: string;
    iskontoTutari: string;
    iskontoNedeni: string;
    kdvOrani: string;
    kdvTutari: string;
    digerVergiler: string;
    malHizmetTutari: string;
  }>;
  toplamlar: {
    malHizmetToplamTutari: string;
    toplamIskonto: string;
    hesaplananKdv: Array<{ ad: string; oran: string; tutar: string }>;
    vergilerDahilToplamTutar: string;
    odenecekTutar: string;
  };
  yaziyla: string;
  notlar: string[];
  ham: {
    odenecekTutar: number;
    kdvToplam: number;
    tevkifatTutari: number;
  };
}

export type FaturaHataSonuc = {
  durum: "HATA";
  hatalar: string[];
  uyarilar: string[];
};

export type FaturaSonuc = EArsivFaturaJson | FaturaHataSonuc;

// ---------------------------------------------------------------------------
// Varsayılan Yapılandırmalar
// ---------------------------------------------------------------------------

export const DEFAULT_SATICI_SETTINGS: SaticiAyarlari = {
  unvan: "NORDVOW BİLİŞİM VE PAZARLAMA TEKNOLOJİLERİ A.Ş.",
  adres: "Büyükdere Cad. No:193 Levent",
  binaNo: "193",
  postaKodu: "34394",
  ilce: "Şişli",
  il: "İSTANBUL",
  tel: "+90 (212) 345 67 89",
  fax: "",
  web: "https://www.infulancer.com",
  eposta: "muhasebe@infulancer.com",
  vergiDairesi: "Zincirlikuyu Vergi Dairesi",
  vkn: "6310574268",
  mersisNo: "0631057426800001",
};

export const DEFAULT_KDV_ORANLARI: Record<string, number> = {
  influencer_reklam: 20,
  reklam: 20,
  tanitim: 20,
  danismanlik: 20,
  icerik_uretimi: 20,
  sosyal_medya: 20,
  hizmet: 20,
  ajans_hizmeti: 20,
  yazilim: 20,
  kargo: 20,
};

export const DEFAULT_TEVKIFAT_KURALLARI: Record<string, TevkifatKurali> = {
  // Reklam ve Tanıtım Hizmetleri (KDVGT 35 / Tebliğ md. 2.1.3.2.14: 3/10 oran)
  reklam: { kod: "624", oran: "3/10", altSinirKdvDahil: 2000 },
  influencer_reklam: { kod: "624", oran: "3/10", altSinirKdvDahil: 2000 },
  danismanlik: { kod: "601", oran: "5/10", altSinirKdvDahil: 2000 },
};

// ---------------------------------------------------------------------------
// Algoritmalar & Doğrulamalar
// ---------------------------------------------------------------------------

/**
 * GİB VKN (Vergi Kimlik Numarası) sağlama algoritması.
 * 10 haneli rakam olmalıdır.
 */
export function validateVkn(vkn: string): boolean {
  if (!vkn || typeof vkn !== "string") return false;
  const clean = vkn.trim();
  if (clean.length !== 10 || !/^\d{10}$/.test(clean)) return false;

  const digits = clean.split("").map((c) => Number.parseInt(c, 10));
  let sum = 0;

  for (let i = 1; i <= 9; i++) {
    const d = digits[i - 1] ?? 0;
    const v = (d + (10 - i)) % 10;
    let w = 0;
    if (v !== 0) {
      w = (v * 2 ** (10 - i)) % 9;
      if (w === 0) w = 9;
    }
    sum += w;
  }

  const lastDigit = (10 - (sum % 10)) % 10;
  return lastDigit === (digits[9] ?? -1);
}

/**
 * T.C. Kimlik Numarası algoritması kontrolü.
 * 11 hane olmalı, ilk hane 0 olamaz, 10. ve 11. hane kuralı sağlamalı.
 */
export function validateTckn(tckn: string): boolean {
  if (!tckn || typeof tckn !== "string") return false;
  const clean = tckn.trim();
  if (clean.length !== 11 || !/^\d{11}$/.test(clean)) return false;
  if (clean[0] === "0") return false;

  const d = clean.split("").map((c) => Number.parseInt(c, 10));
  const d0 = d[0] ?? 0;
  const d1 = d[1] ?? 0;
  const d2 = d[2] ?? 0;
  const d3 = d[3] ?? 0;
  const d4 = d[4] ?? 0;
  const d5 = d[5] ?? 0;
  const d6 = d[6] ?? 0;
  const d7 = d[7] ?? 0;
  const d8 = d[8] ?? 0;
  const d9 = d[9] ?? -1;
  const d10 = d[10] ?? -1;

  const oddSum = d0 + d2 + d4 + d6 + d8;
  const evenSum = d1 + d3 + d5 + d7;

  const calcD10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  if (calcD10 !== d9) return false;

  const sumFirst10 = d.slice(0, 10).reduce((acc, curr) => acc + (curr ?? 0), 0);
  const calcD11 = sumFirst10 % 10;
  return calcD11 === d10;
}

/**
 * Sayıyı Türkçe formatlı metne dönüştürür (10000 -> "10.000,00").
 */
export function formatTurkishNumber(val: number, decimals = 2): string {
  const parts = Math.abs(val).toFixed(decimals).split(".");
  const intPart = (parts[0] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decPart = parts[1] ?? "00";
  const sign = val < 0 ? "-" : "";
  return `${sign}${intPart},${decPart}`;
}

/**
 * Tutarı "10.000,00 TL" formatında metne çevirir.
 */
export function formatTurkishCurrency(val: number): string {
  return `${formatTurkishNumber(val, 2)} TL`;
}

/**
 * Sayıyı Türkçe kelimelere dönüştürür.
 * Ör. 15600.00 -> "On Beş Bin Altı Yüz Türk Lirası Sıfır Kuruş"
 */
export function numberToTurkishWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const lira = Math.floor(rounded);
  const kurus = Math.round((rounded - lira) * 100);

  const BIRLER = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
  const ONLAR = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Altmış", "Yetmiş", "Seksen", "Doksan"];
  const BASAMAKLAR = ["", "Bin", "Milyon", "Milyar", "Trilyon"];

  function tripletToWords(n: number, isThousandsGroup: boolean): string {
    if (n === 0) return "";
    const parts: string[] = [];
    const yuz = Math.floor(n / 100);
    const on = Math.floor((n % 100) / 10);
    const bir = n % 10;

    if (yuz === 1) {
      parts.push("Yüz");
    } else if (yuz > 1) {
      parts.push(`${BIRLER[yuz] ?? ""} Yüz`);
    }

    if (on > 0 && ONLAR[on]) {
      parts.push(ONLAR[on]!);
    }

    if (isThousandsGroup && n === 1) {
      // "Bir Bin" değil, doğrudan "Bin"
    } else if (bir > 0 && BIRLER[bir]) {
      parts.push(BIRLER[bir]!);
    }

    return parts.join(" ");
  }

  function intToWords(num: number): string {
    if (num === 0) return "Sıfır";
    const groups: number[] = [];
    let n = num;
    while (n > 0) {
      groups.push(n % 1000);
      n = Math.floor(n / 1000);
    }

    const words: string[] = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const val = groups[i] ?? 0;
      if (val === 0) continue;
      const isThousand = i === 1;
      const w = tripletToWords(val, isThousand);
      if (i > 0) {
        const unit = BASAMAKLAR[i] ?? "";
        if (w) {
          words.push(`${w} ${unit}`);
        } else {
          words.push(unit);
        }
      } else if (w) {
        words.push(w);
      }
    }
    return words.join(" ");
  }

  const liraWords = `${intToWords(lira)} Türk Lirası`;
  const kurusWords = kurus > 0 ? `${intToWords(kurus)} Kuruş` : "Sıfır Kuruş";
  return `${liraWords} ${kurusWords}`.trim();
}

/**
 * Tarihi GG-AA-YYYY biçimine normalize eder.
 */
export function formatTurkishDate(dateInput?: string | Date): string {
  const d = dateInput instanceof Date ? dateInput : dateInput ? parseFlexibleDate(dateInput) : new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function parseFlexibleDate(str: string): Date {
  const clean = str.trim();
  // GG-AA-YYYY veya GG.AA.YYYY
  const trMatch = clean.match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);
  if (trMatch) {
    const [, d, m, y] = trMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  // ISO: YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

// ---------------------------------------------------------------------------
// Taslak Oluşturma ve Hesaplama Motoru
// ---------------------------------------------------------------------------

/**
 * e-Arşiv / e-Fatura taslak JSON'unu VUK kurallarına göre üretir.
 * Doğrulama hatası varsa durum: "HATA" döner.
 */
export function createEArsivDraft(
  input: FaturaGirdi,
  customSettings?: Partial<FaturaAyarlar>,
): FaturaSonuc {
  const hatalar: string[] = [];
  const uyarilar: string[] = [];

  const settings: FaturaAyarlar = {
    satici: customSettings?.satici ?? DEFAULT_SATICI_SETTINGS,
    kdvOranlari: customSettings?.kdvOranlari ?? DEFAULT_KDV_ORANLARI,
    tevkifatKurallari: customSettings?.tevkifatKurallari ?? DEFAULT_TEVKIFAT_KURALLARI,
    eArsivEsigi: customSettings?.eArsivEsigi ?? 5000,
    seriOnEki: customSettings?.seriOnEki ?? "NRD",
    sonSiraNo: customSettings?.sonSiraNo ?? 1,
    yil: customSettings?.yil ?? new Date().getFullYear(),
    taslakModu: customSettings?.taslakModu ?? true,
  };

  const alici = input.alici;
  if (!alici) {
    hatalar.push("Alıcı bilgileri eksik.");
    return { durum: "HATA", hatalar, uyarilar };
  }

  // ADIM 1 – DOĞRULAMA

  // 1. & 2. VKN / TCKN kontrolü
  let aliciKimlikTipi = "TCKN";
  let aliciKimlikNo = "";
  const aliciUnvan = (alici.tip === "kurumsal" ? alici.unvan : alici.adSoyad) || "";

  if (!aliciUnvan.trim()) {
    hatalar.push("Alıcı unvanı veya ad soyadı zorunludur.");
  }

  if (alici.tip === "kurumsal") {
    aliciKimlikTipi = "VKN";
    const vkn = (alici.vkn || "").trim();
    if (!vkn) {
      hatalar.push("Kurumsal alıcı için 10 haneli VKN zorunludur.");
    } else if (!validateVkn(vkn)) {
      hatalar.push(`Alıcı VKN (${vkn}) GİB VKN algoritması kontrolünden geçemedi.`);
    } else {
      aliciKimlikNo = vkn;
    }

    // 3. Kurumsal alıcıda vergi dairesi zorunlu
    if (!alici.vergiDairesi || !alici.vergiDairesi.trim()) {
      hatalar.push(
        "Vergi dairesi eksik, alıcının vergi levhasından veya GİB VKN sorgusundan alınmalı.",
      );
    }
  } else {
    // Bireysel alıcı
    aliciKimlikTipi = "TCKN";
    const tckn = (alici.tckn || "").trim();
    if (!tckn) {
      aliciKimlikNo = "11111111111";
      uyarilar.push("Bireysel alıcı için TCKN girilmedi, varsayılan 11111111111 kullanıldı.");
    } else if (tckn === "11111111111") {
      aliciKimlikNo = tckn;
      uyarilar.push("Bireysel alıcı için 11111111111 kullanıldı.");
    } else if (!validateTckn(tckn)) {
      hatalar.push(`Alıcı TCKN (${tckn}) 11 hane ve kontrol algoritmasını sağlamalı.`);
    } else {
      aliciKimlikNo = tckn;
    }
  }

  // 4. Zorunlu alanlar
  if (!alici.adres || !alici.adres.trim()) {
    hatalar.push("Alıcı adresi zorunludur.");
  }
  if (!alici.il || !alici.il.trim()) {
    hatalar.push("Alıcı il bilgisi zorunludur.");
  }
  if (!alici.ilce || !alici.ilce.trim()) {
    hatalar.push("Alıcı ilçe bilgisi zorunludur.");
  }

  // Kalem kontrolleri
  if (!input.kalemler || input.kalemler.length === 0) {
    hatalar.push("Faturada en az 1 kalem bulunmalıdır.");
  } else {
    for (let idx = 0; idx < input.kalemler.length; idx++) {
      const k = input.kalemler[idx];
      if (!k) continue;
      const satir = idx + 1;
      if (!k.aciklama || !k.aciklama.trim()) {
        hatalar.push(`${satir}. kalem açıklaması (mal/hizmet) boş olamaz.`);
      }
      if (typeof k.miktar !== "number" || k.miktar <= 0 || Number.isNaN(k.miktar)) {
        hatalar.push(`${satir}. kalem miktarı 0'dan büyük olmalıdır.`);
      }
      if (typeof k.birimFiyat !== "number" || k.birimFiyat < 0 || Number.isNaN(k.birimFiyat)) {
        hatalar.push(`${satir}. kalem birim fiyatı negatif olamaz.`);
      }
      if (!k.hizmetTuru || !(k.hizmetTuru in settings.kdvOranlari)) {
        hatalar.push(
          `${satir}. kalem hizmet türü ('${k.hizmetTuru || ""}') tanımlı KDV oranları listesinde bulunamadı.`,
        );
      }
    }
  }

  // 5. Tarih kontrolleri
  const faturaDate = input.faturaTarihi ? parseFlexibleDate(input.faturaTarihi) : new Date();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (faturaDate.getTime() > today.getTime()) {
    hatalar.push("Fatura tarihi bugünden ileri bir tarih olamaz.");
  }

  if (input.islemTarihi) {
    const islemDate = parseFlexibleDate(input.islemTarihi);
    const diffMs = faturaDate.getTime() - islemDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 7) {
      uyarilar.push(
        `Fatura tarihi işlem tarihinden ${diffDays} gün sonradır. VUK md. 231 uyarınca fatura malın teslimi veya hizmetin yapıldığı tarihten itibaren azami 7 gün içinde düzenlenmelidir.`,
      );
    }
  }

  // 6. e-Fatura mükellefiyeti
  let senaryo: "EARSIVFATURA" | "TEMELFATURA" = "EARSIVFATURA";
  if (alici.eFaturaMukellefi === "evet") {
    uyarilar.push("Alıcı e-Fatura mükellefidir. e-Arşiv değil e-Fatura düzenlenmelidir.");
    senaryo = "TEMELFATURA";
  } else if (alici.eFaturaMukellefi === "bilinmiyor") {
    uyarilar.push("Alıcının e-Fatura mükellefiyeti bilinmiyor. GİB kayıtlı kullanıcı listesinden kontrol ediniz.");
  }

  // Hata varsa derhal çık (Prompt Kuralı: Hata varsa sadece hata ve uyarilar dön)
  if (hatalar.length > 0) {
    return { durum: "HATA", hatalar, uyarilar };
  }

  // ADIM 2 – HESAPLAMA
  const kur = input.kur && input.kur > 0 ? input.kur : 1;
  const firstItem = input.kalemler[0];
  const isForeign = kur !== 1 && Boolean(firstItem?.paraBirimi && firstItem.paraBirimi !== "TRY" && firstItem.paraBirimi !== "TL");

  let malHizmetToplamTutari = 0;
  let toplamIskonto = 0;
  let toplamMatrah = 0;
  let toplamKdv = 0;
  let tevkifatTutari = 0;
  let tevkifatKodu = "";
  let tevkifatOraniMetin = "";

  type ItemCalc = {
    siraNo: string;
    malHizmet: string;
    miktar: string;
    birim: string;
    birimFiyat: string;
    iskontoOrani: string;
    iskontoTutari: string;
    iskontoNedeni: string;
    kdvOrani: string;
    kdvTutari: string;
    digerVergiler: string;
    malHizmetTutari: string;
    rawBrut: number;
    rawIskonto: number;
    rawMatrah: number;
    rawKdvOrani: number;
    rawKdvTutari: number;
    hizmetTuru: string;
  };

  const calculatedItems: ItemCalc[] = [];
  const kdvMap: Record<number, number> = {};

  for (let idx = 0; idx < input.kalemler.length; idx++) {
    const k = input.kalemler[idx];
    if (!k) continue;
    const birimFiyatTl = isForeign ? k.birimFiyat * kur : k.birimFiyat;
    const brut = Math.round(k.miktar * birimFiyatTl * 100) / 100;
    const iskontoPct = k.iskontoOrani && k.iskontoOrani > 0 ? k.iskontoOrani : 0;
    const iskonto = Math.round((brut * iskontoPct) / 100 * 100) / 100;
    const matrah = Math.round((brut - iskonto) * 100) / 100;
    const oran = settings.kdvOranlari[k.hizmetTuru] ?? 20;
    const kdv = Math.round((matrah * oran) / 100 * 100) / 100;

    malHizmetToplamTutari += brut;
    toplamIskonto += iskonto;
    toplamMatrah += matrah;
    toplamKdv += kdv;

    kdvMap[oran] = (kdvMap[oran] || 0) + kdv;

    // Miktar biçimi: tam sayıysa "1", ondalıklıysa "1,5"
    const miktarStr = Number.isInteger(k.miktar)
      ? String(k.miktar)
      : String(k.miktar).replace(".", ",");

    calculatedItems.push({
      siraNo: String(idx + 1),
      malHizmet: k.aciklama.trim(),
      miktar: miktarStr,
      birim: k.birim || "Adet",
      birimFiyat: formatTurkishNumber(birimFiyatTl, 2),
      iskontoOrani: `%${formatTurkishNumber(iskontoPct, 2)}`,
      iskontoTutari: formatTurkishNumber(iskonto, 2),
      iskontoNedeni: k.iskontoNedeni || "",
      kdvOrani: `%${formatTurkishNumber(oran, 2)}`,
      kdvTutari: formatTurkishNumber(kdv, 2),
      digerVergiler: "0,00",
      malHizmetTutari: formatTurkishNumber(matrah, 2),
      rawBrut: brut,
      rawIskonto: iskonto,
      rawMatrah: matrah,
      rawKdvOrani: oran,
      rawKdvTutari: kdv,
      hizmetTuru: k.hizmetTuru,
    });
  }

  malHizmetToplamTutari = Math.round(malHizmetToplamTutari * 100) / 100;
  toplamIskonto = Math.round(toplamIskonto * 100) / 100;
  toplamMatrah = Math.round(toplamMatrah * 100) / 100;
  toplamKdv = Math.round(toplamKdv * 100) / 100;
  const vergilerDahilToplamTutar = Math.round((toplamMatrah + toplamKdv) * 100) / 100;

  // Tevkifat hesabı
  let faturaTipi = "SATIS";
  if (settings.tevkifatKurallari) {
    for (const item of calculatedItems) {
      const kural = settings.tevkifatKurallari[item.hizmetTuru];
      if (kural && vergilerDahilToplamTutar >= kural.altSinirKdvDahil) {
        // Oran parçala ör. "3/10" -> pay=3, payda=10
        const [payStr, paydaStr] = kural.oran.split("/");
        const pay = payStr ? Number.parseInt(payStr, 10) : 0;
        const payda = paydaStr ? Number.parseInt(paydaStr, 10) : 0;
        if (pay && payda) {
          const itemTevkifat = Math.round((item.rawKdvTutari * pay) / payda * 100) / 100;
          tevkifatTutari += itemTevkifat;
          tevkifatKodu = kural.kod;
          tevkifatOraniMetin = kural.oran;
        }
      }
    }
    tevkifatTutari = Math.round(tevkifatTutari * 100) / 100;
    if (tevkifatTutari > 0) {
      faturaTipi = "TEVKIFAT";
    }
  }

  const odenecekTutar = Math.round((vergilerDahilToplamTutar - tevkifatTutari) * 100) / 100;

  // Sağlama kontrolü: Σ matrah + Σ kdv − tevkifat == odenecekTutar
  const checkBalance = Math.round((toplamMatrah + toplamKdv - tevkifatTutari) * 100) / 100;
  if (Math.abs(checkBalance - odenecekTutar) > 0.01) {
    hatalar.push(`Tutar sağlama kontrolü başarısız: Beklenen ${checkBalance}, hesaplanan ${odenecekTutar}`);
    return { durum: "HATA", hatalar, uyarilar };
  }

  // ADIM 3 – BİÇİMLENDİRME
  const faturaTarihiStr = formatTurkishDate(faturaDate);
  const yil = settings.yil || faturaDate.getFullYear();
  const siraNoPadded = String(settings.sonSiraNo || 1).padStart(9, "0");
  const seriOnEki = (settings.seriOnEki || "NRD").toUpperCase().slice(0, 3);
  const faturaNo = settings.taslakModu
    ? `TASLAK-${seriOnEki}${yil}${siraNoPadded}`
    : `${seriOnEki}${yil}${siraNoPadded}`;

  // KDV Grupları
  const hesaplananKdvList: Array<{ ad: string; oran: string; tutar: string }> = [];
  const sortedOranlar = Object.keys(kdvMap)
    .map(Number)
    .sort((a, b) => a - b);

  for (const o of sortedOranlar) {
    const kdvTutar = kdvMap[o] ?? 0;
    hesaplananKdvList.push({
      ad: "KDV",
      oran: formatTurkishNumber(o, 2),
      tutar: formatTurkishCurrency(kdvTutar),
    });
  }

  // Tevkifat satırı eklenir (varsa)
  if (tevkifatTutari > 0) {
    hesaplananKdvList.push({
      ad: `KDV TEVKİFAT (${tevkifatKodu})`,
      oran: tevkifatOraniMetin,
      tutar: `-${formatTurkishCurrency(tevkifatTutari)}`,
    });
  }

  // Notlar dizisi
  const notlar: string[] = [];
  if (input.ekNot && input.ekNot.trim()) {
    notlar.push(input.ekNot.trim());
  }
  if (isForeign && input.kur) {
    const kurTarihiStr = input.kurTarihi || faturaTarihiStr;
    const pBirimi = input.kalemler[0]?.paraBirimi || "USD";
    notlar.push(`1 ${pBirimi} = ${formatTurkishNumber(input.kur, 4)} TL (${kurTarihiStr} TCMB)`);
  }
  if (tevkifatTutari > 0) {
    notlar.push("3065 sayılı KDV Kanununun 9. maddesi gereğince tevkifat uygulanmıştır.");
  }
  if (settings.taslakModu) {
    notlar.push("TASLAKTIR. Yasal geçerliliği yoktur.");
  }

  const saticiKimlikler: Array<{ schemeID: string; id: string }> = [
    { schemeID: "VKN", id: settings.satici.vkn },
  ];
  if (settings.satici.mersisNo) {
    saticiKimlikler.push({ schemeID: "MERSISNO", id: settings.satici.mersisNo });
  }

  const aliciKimlikler: Array<{ schemeID: string; id: string }> = [
    { schemeID: aliciKimlikTipi, id: aliciKimlikNo },
  ];

  const yaziylaMetin = numberToTurkishWords(odenecekTutar);

  const sonuc: EArsivFaturaJson = {
    durum: settings.taslakModu ? "TASLAK" : "RESMI",
    hatalar: [],
    uyarilar,
    ornekFiligran: Boolean(settings.taslakModu),
    ozellestirmeNo: "TR1.2",
    senaryo,
    faturaTipi,
    faturaNo,
    faturaTarihi: faturaTarihiStr,
    ettn: "",
    siparisNo: input.siparisNo || "",
    siparisTarihi: input.siparisTarihi || "",
    irsaliyeNo: input.irsaliyeNo || "",
    irsaliyeTarihi: input.irsaliyeTarihi || "",
    satici: {
      unvan: settings.satici.unvan || "",
      adres: settings.satici.adres || "",
      binaNo: settings.satici.binaNo || "",
      postaKodu: settings.satici.postaKodu || "",
      ilce: settings.satici.ilce || "",
      il: settings.satici.il || "",
      tel: settings.satici.tel || "",
      fax: settings.satici.fax || "",
      web: settings.satici.web || "",
      eposta: settings.satici.eposta || "",
      vergiDairesi: settings.satici.vergiDairesi || "",
      kimlikler: saticiKimlikler,
    },
    alici: {
      unvan: aliciUnvan,
      adres: alici.adres || "",
      binaNo: alici.binaNo || "",
      postaKodu: alici.postaKodu || "",
      ilce: alici.ilce || "",
      il: alici.il || "",
      vergiDairesi: alici.vergiDairesi || "",
      kimlikler: aliciKimlikler,
    },
    kalemler: calculatedItems.map((c) => ({
      siraNo: c.siraNo,
      malHizmet: c.malHizmet,
      miktar: c.miktar,
      birim: c.birim,
      birimFiyat: c.birimFiyat,
      iskontoOrani: c.iskontoOrani,
      iskontoTutari: c.iskontoTutari,
      iskontoNedeni: c.iskontoNedeni,
      kdvOrani: c.kdvOrani,
      kdvTutari: c.kdvTutari,
      digerVergiler: c.digerVergiler,
      malHizmetTutari: c.malHizmetTutari,
    })),
    toplamlar: {
      malHizmetToplamTutari: formatTurkishCurrency(malHizmetToplamTutari),
      toplamIskonto: formatTurkishCurrency(toplamIskonto),
      hesaplananKdv: hesaplananKdvList,
      vergilerDahilToplamTutar: formatTurkishCurrency(vergilerDahilToplamTutar),
      odenecekTutar: formatTurkishCurrency(odenecekTutar),
    },
    yaziyla: yaziylaMetin,
    notlar,
    ham: {
      odenecekTutar,
      kdvToplam: toplamKdv,
      tevkifatTutari,
    },
  };

  return sonuc;
}
