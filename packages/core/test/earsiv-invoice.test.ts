import { describe, expect, it } from "vitest";
import {
  type FaturaGirdi,
  createEArsivDraft,
  formatTurkishCurrency,
  formatTurkishNumber,
  numberToTurkishWords,
  validateTckn,
  validateVkn,
} from "../src/finance/earsiv-invoice";
import { renderEArsivHtml, renderTemplate } from "../src/finance/earsiv-renderer";

describe("e-Arşiv Fatura Doğrulama ve Algoritmalar", () => {
  it("GİB VKN checksum algoritmasını doğru işletmelidir", () => {
    // Geçerli VKN örnekleri
    expect(validateVkn("6310574268")).toBe(true);
    expect(validateVkn("1234567890")).toBe(true);
    expect(validateVkn("9876543217")).toBe(true);
    expect(validateVkn("0123456789")).toBe(true);

    // Geçersiz VKN örnekleri
    expect(validateVkn("0000000000")).toBe(false);
    expect(validateVkn("1234567891")).toBe(false);
    expect(validateVkn("12345")).toBe(false);
    expect(validateVkn("ABCDEFGHIJ")).toBe(false);
    expect(validateVkn("")).toBe(false);
  });

  it("TCKN checksum algoritmasını doğru işletmelidir", () => {
    // Geçerli TCKN örneği
    expect(validateTckn("10000000146")).toBe(true);

    // Geçersiz TCKN: 0 ile başlama yasağı
    expect(validateTckn("01234567890")).toBe(false);
    // Hatalı hane veya checksum
    expect(validateTckn("10000000145")).toBe(false);
    expect(validateTckn("12345678901")).toBe(false);
    expect(validateTckn("123")).toBe(false);
    expect(validateTckn("")).toBe(false);
  });

  it("Sayıyı Türkçe kelimelere doğru çevirmelidir (numberToTurkishWords)", () => {
    expect(numberToTurkishWords(15600.0)).toBe(
      "On Beş Bin Altı Yüz Türk Lirası Sıfır Kuruş",
    );
    expect(numberToTurkishWords(1000.0)).toBe("Bin Türk Lirası Sıfır Kuruş");
    expect(numberToTurkishWords(1001.5)).toBe(
      "Bin Bir Türk Lirası Elli Kuruş",
    );
    expect(numberToTurkishWords(0.0)).toBe("Sıfır Türk Lirası Sıfır Kuruş");
    expect(numberToTurkishWords(2500000.75)).toBe(
      "İki Milyon Beş Yüz Bin Türk Lirası Yetmiş Beş Kuruş",
    );
  });

  it("Türkçe sayı ve para formatlamasını doğru yapmalıdır", () => {
    expect(formatTurkishNumber(10000)).toBe("10.000,00");
    expect(formatTurkishNumber(1234567.89)).toBe("1.234.567,89");
    expect(formatTurkishCurrency(15600)).toBe("15.600,00 TL");
  });
});

describe("e-Arşiv Fatura Taslak Oluşturma ve Hesaplama Motoru", () => {
  const validKurumsalInput: FaturaGirdi = {
    alici: {
      tip: "kurumsal",
      unvan: "ÖRNEK ALICI TİCARET LİMİTED ŞİRKETİ",
      vkn: "6310574268",
      vergiDairesi: "Kadıköy Vergi Dairesi",
      adres: "Deneme Sokak Örnek Plaza No:10",
      binaNo: "10",
      postaKodu: "34710",
      ilce: "Kadıköy",
      il: "İSTANBUL",
      eposta: "muhasebe@ornek.com",
      eFaturaMukellefi: "hayir",
    },
    kalemler: [
      {
        aciklama: "Influencer pazarlama hizmeti",
        miktar: 1,
        birim: "Adet",
        birimFiyat: 10000,
        paraBirimi: "TRY",
        iskontoOrani: 0,
        hizmetTuru: "influencer_reklam",
      },
      {
        aciklama: "İçerik üretim danışmanlığı",
        miktar: 2,
        birim: "Adet",
        birimFiyat: 1500,
        paraBirimi: "TRY",
        iskontoOrani: 0,
        hizmetTuru: "danismanlik",
      },
    ],
    faturaTarihi: "20-11-2026",
  };

  it("Geçerli kurumsal girdi ile taslak JSON başarıyla oluşturulmalıdır", () => {
    // Tevkifat kuralları olmadan standart hesaplama testi
    const result = createEArsivDraft(validKurumsalInput, {
      tevkifatKurallari: {},
      taslakModu: true,
      seriOnEki: "NRD",
      yil: 2026,
      sonSiraNo: 1,
    });

    expect(result.durum).toBe("TASLAK");
    if (result.durum !== "TASLAK") return;

    expect(result.hatalar).toHaveLength(0);
    expect(result.ornekFiligran).toBe(true);
    expect(result.faturaNo).toBe("TASLAK-NRD2026000000001");
    expect(result.ettn).toBe("");
    expect(result.senaryo).toBe("EARSIVFATURA");
    expect(result.alici.unvan).toBe("ÖRNEK ALICI TİCARET LİMİTED ŞİRKETİ");
    expect(result.alici.kimlikler[0]).toEqual({
      schemeID: "VKN",
      id: "6310574268",
    });

    // Kalemler:
    // 1: 10.000 TL, %20 KDV = 2.000 TL
    // 2: 3.000 TL, %20 KDV = 600 TL
    // Toplam matrah: 13.000 TL, KDV: 2.600 TL, Toplam: 15.600 TL
    expect(result.toplamlar.malHizmetToplamTutari).toBe("13.000,00 TL");
    expect(result.toplamlar.toplamIskonto).toBe("0,00 TL");
    expect(result.toplamlar.vergilerDahilToplamTutar).toBe("15.600,00 TL");
    expect(result.toplamlar.odenecekTutar).toBe("15.600,00 TL");
    expect(result.yaziyla).toBe("On Beş Bin Altı Yüz Türk Lirası Sıfır Kuruş");
    expect(result.ham.odenecekTutar).toBe(15600);
    expect(result.ham.kdvToplam).toBe(2600);
    expect(result.notlar).toContain("TASLAKTIR. Yasal geçerliliği yoktur.");
  });

  it("Kurumsal alıcıda vergi dairesi eksikse hata döndürmelidir (tahmin edilmez)", () => {
    const invalidInput: FaturaGirdi = {
      ...validKurumsalInput,
      alici: {
        ...validKurumsalInput.alici,
        vergiDairesi: "",
      },
    };

    const result = createEArsivDraft(invalidInput);
    expect(result.durum).toBe("HATA");
    if (result.durum === "HATA") {
      expect(result.hatalar.some((h) => h.includes("Vergi dairesi eksik"))).toBe(true);
    }
  });

  it("Kurumsal alıcıda geçersiz VKN için hata döndürmelidir", () => {
    const invalidInput: FaturaGirdi = {
      ...validKurumsalInput,
      alici: {
        ...validKurumsalInput.alici,
        vkn: "1234567899", // Hatalı checksum
      },
    };

    const result = createEArsivDraft(invalidInput);
    expect(result.durum).toBe("HATA");
    if (result.durum === "HATA") {
      expect(result.hatalar.some((h) => h.includes("VKN"))).toBe(true);
    }
  });

  it("Bireysel alıcıda TCKN verilmediyse '11111111111' kullanıp uyarı vermelidir", () => {
    const bireyselInput: FaturaGirdi = {
      alici: {
        tip: "bireysel",
        adSoyad: "Ahmet Yılmaz",
        adres: "Atatürk Cad. No:5",
        ilce: "Beşiktaş",
        il: "İSTANBUL",
      },
      kalemler: [
        {
          aciklama: "Danışmanlık Hizmeti",
          miktar: 1,
          birimFiyat: 5000,
          hizmetTuru: "danismanlik",
        },
      ],
      faturaTarihi: "20-11-2026",
    };

    const result = createEArsivDraft(bireyselInput);
    expect(result.durum).toBe("TASLAK");
    if (result.durum !== "TASLAK") return;

    expect(result.alici.kimlikler[0]).toEqual({
      schemeID: "TCKN",
      id: "11111111111",
    });
    expect(result.uyarilar.some((u) => u.includes("11111111111"))).toBe(true);
  });

  it("e-Fatura mükellefine TEMELFATURA senaryosu atamalı ve uyarı vermelidir", () => {
    const eFaturaInput: FaturaGirdi = {
      ...validKurumsalInput,
      alici: {
        ...validKurumsalInput.alici,
        eFaturaMukellefi: "evet",
      },
    };

    const result = createEArsivDraft(eFaturaInput);
    expect(result.durum).toBe("TASLAK");
    if (result.durum !== "TASLAK") return;

    expect(result.senaryo).toBe("TEMELFATURA");
    expect(result.uyarilar.some((u) => u.includes("e-Fatura mükellefidir"))).toBe(true);
  });

  it("Tevkifat kuralını ve sınırını doğru uygulamalıdır", () => {
    // 10.000 TL matrah, %20 KDV = 2.000 TL.
    // Tevkifat 3/10: 2.000 * 3 / 10 = 600 TL tevkifat
    // Ödenecek tutar = 12.000 - 600 = 11.400 TL
    const tevkifatInput: FaturaGirdi = {
      ...validKurumsalInput,
      kalemler: [
        {
          aciklama: "Influencer Reklam Hizmeti",
          miktar: 1,
          birimFiyat: 10000,
          hizmetTuru: "influencer_reklam",
        },
      ],
    };

    const result = createEArsivDraft(tevkifatInput, {
      tevkifatKurallari: {
        influencer_reklam: { kod: "624", oran: "3/10", altSinirKdvDahil: 2000 },
      },
    });

    expect(result.durum).toBe("TASLAK");
    if (result.durum !== "TASLAK") return;

    expect(result.faturaTipi).toBe("TEVKIFAT");
    expect(result.ham.tevkifatTutari).toBe(600);
    expect(result.ham.odenecekTutar).toBe(11400);
    expect(result.toplamlar.odenecekTutar).toBe("11.400,00 TL");

    const tevkifatSatiri = result.toplamlar.hesaplananKdv.find((k) =>
      k.ad.includes("TEVKİFAT"),
    );
    expect(tevkifatSatiri).toBeDefined();
    expect(tevkifatSatiri?.tutar).toBe("-600,00 TL");
    expect(result.notlar.some((n) => n.includes("tevkifat uygulanmıştır"))).toBe(true);
  });
});

describe("e-Arşiv Fatura HTML Şablon Oluşturucu (Render Engine)", () => {
  it("Şablonu JSON ile hatasız ve yer tutucu bırakmadan doldurmalıdır", async () => {
    const input: FaturaGirdi = {
      alici: {
        tip: "kurumsal",
        unvan: "TEST PAZARLAMA LTD. ŞTİ.",
        vkn: "6310574268",
        vergiDairesi: "Beşiktaş Vergi Dairesi",
        adres: "Barbaros Bulvarı No:42",
        ilce: "Beşiktaş",
        il: "İSTANBUL",
      },
      kalemler: [
        {
          aciklama: "Instagram Story ve Reels Tanıtım Paketi",
          miktar: 1,
          birimFiyat: 25000,
          hizmetTuru: "influencer_reklam",
        },
      ],
    };

    const draft = createEArsivDraft(input, { taslakModu: true });
    expect(draft.durum).toBe("TASLAK");
    if (draft.durum !== "TASLAK") return;

    const html = await renderEArsivHtml(draft, { generateQrCodeIfMissing: true });

    expect(html).toContain("TEST PAZARLAMA LTD. ŞTİ.");
    expect(html).toContain("6310574268");
    expect(html).toContain("Instagram Story ve Reels Tanıtım Paketi");
    expect(html).toContain("data:image/png;base64,"); // QR kod üretilmiş olmalı
    expect(html).toContain("ÖRNEK FATURADIR");

    // Hiçbir çözümlenmemiş Handlebars yer tutucusu kalmamalıdır
    const leftovers = html.match(/\{\{[^}]+\}\}/g);
    expect(leftovers).toBeNull();
  });
});
