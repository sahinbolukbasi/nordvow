/**
 * Bildirim olay katalogu: sistemdeki tüm bildirim tetikleyicileri, varsayılan kanalları
 * ve kanal bazlı varsayılan şablonları. Admin bunları panelden düzenler; burada tohum değer.
 * Şablon yer tutucuları {{anahtar}} biçimindedir ve dispatch sırasında doldurulur.
 */
export type NotifChannel = "INAPP" | "EMAIL" | "WHATSAPP" | "INSTAGRAM";

export type NotifEvent = {
  key: string;
  label: string;
  /** Bu olayda kullanılabilir değişkenler (admin'e ipucu). */
  vars: string[];
  defaultChannels: NotifChannel[];
  templates: Partial<Record<NotifChannel, { subject?: string; body: string }>>;
};

export const NOTIF_EVENTS: NotifEvent[] = [
  {
    key: "USER_APPROVED",
    label: "Kayıt onayı (Hoş geldiniz)",
    vars: ["ad", "link"],
    defaultChannels: ["INAPP", "EMAIL", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Nordvow'a hoş geldiniz", body: "Kaydınız onaylandı! Buradan Nordvow AI'a istediğinizi sorabilirsiniz." },
      EMAIL: {
        subject: "Nordvow'a Hoş Geldiniz — Kaydınız Onaylandı",
        body: "Merhaba {{ad}},\n\nNordvow sistemine hoş geldiniz! Kaydınız onaylandı.\n\nInstagram ve WhatsApp üzerinden Nordvow AI asistanımıza istediğinizi sorabilir, marka iş birliklerinizi, kuponlarınızı, etkinlik biletlerinizi ve tüm sistem işlemlerinizi takip edebilirsiniz.\n\nGiriş yapın: {{link}}",
      },
      INSTAGRAM: {
        body: "Nordvow'a hoş geldin {{ad}}! 🎉 Kaydın onaylandı. Buradan Nordvow AI'a istediğini sorabilirsin — marka iş birliklerin, kuponların, etkinlik biletlerin ve tüm sistem işlemlerin için yazman yeterli. Panel: {{link}}",
      },
    },
  },
  {
    key: "EVENT_CREATED",
    label: "Etkinlik oluşturuldu",
    vars: ["baslik", "tarih"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Yeni etkinlik", body: "“{{baslik}}” etkinliği oluşturuldu ({{tarih}})." },
      EMAIL: { subject: "Yeni etkinlik: {{baslik}}", body: "Merhaba,\n\n“{{baslik}}” etkinliği {{tarih}} tarihinde planlandı." },
    },
  },
  {
    key: "EVENT_INVITED",
    label: "Etkinliğe davet",
    vars: ["ad", "baslik", "tarih", "link"],
    defaultChannels: ["INAPP", "EMAIL", "WHATSAPP", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Etkinlik daveti", body: "“{{baslik}}” etkinliğine davet edildiniz." },
      EMAIL: { subject: "Davetlisiniz: {{baslik}}", body: "Merhaba {{ad}},\n\n{{tarih}} tarihli “{{baslik}}” etkinliğine davetlisiniz. Katılım ve biletiniz: {{link}}" },
      WHATSAPP: { body: "Merhaba {{ad}} 👋 “{{baslik}}” etkinliğine davetlisiniz ({{tarih}}). Detay: {{link}}" },
      INSTAGRAM: { body: "Merhaba {{ad}} 👋 “{{baslik}}” etkinliğine davetlisiniz ({{tarih}})! Detay ve biletin: {{link}}" },
    },
  },
  {
    key: "EVENT_TICKET_ISSUED",
    label: "Etkinlik bileti hazır",
    vars: ["ad", "baslik", "kod", "link"],
    defaultChannels: ["INAPP", "EMAIL", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Etkinlik biletiniz hazır", body: "“{{baslik}}” etkinliği için biletiniz oluşturuldu (Kod: {{kod}})." },
      EMAIL: { subject: "Etkinlik Biletiniz: {{baslik}}", body: "Merhaba {{ad}},\n\n“{{baslik}}” etkinliği için biletiniz hazır. Bilet kodu: {{kod}}\nBiletinizi görüntüleyin: {{link}}" },
      INSTAGRAM: { body: "Merhaba {{ad}} 🎟️ “{{baslik}}” etkinlik biletin hazır! (Kod: {{kod}}) Biletini aç: {{link}}" },
    },
  },
  {
    key: "COUPON_GRANTED",
    label: "Kupon/hediye çeki gönderildi",
    vars: ["ad", "baslik", "deger", "kod", "link"],
    defaultChannels: ["INAPP", "EMAIL", "WHATSAPP", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Size bir kupon tanımlandı", body: "“{{baslik}}” ({{deger}}) kuponu hesabınıza eklendi." },
      EMAIL: { subject: "Size özel: {{baslik}}", body: "Merhaba {{ad}},\n\n“{{baslik}}” ({{deger}}) kuponunuz hazır. Kod: {{kod}}\nKartı görün: {{link}}" },
      WHATSAPP: { body: "Merhaba {{ad}} 🎁 “{{baslik}}” ({{deger}}) kuponunuz hazır. Kod: {{kod}} · {{link}}" },
      INSTAGRAM: { body: "Merhaba {{ad}} 🎁 “{{baslik}}” ({{deger}}) kuponun hesabına tanımlandı! Kod: {{kod}} · Sistemi aç: {{link}}" },
    },
  },
  {
    key: "NEW_OFFER",
    label: "Yeni iş birliği teklifi",
    vars: ["ad", "marka", "baslik", "tutar", "link"],
    defaultChannels: ["INAPP", "EMAIL", "WHATSAPP", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Yeni teklif", body: "{{marka}} size “{{baslik}}” teklifini gönderdi ({{tutar}})." },
      EMAIL: { subject: "Yeni teklif: {{marka}}", body: "Merhaba {{ad}},\n\n{{marka}} “{{baslik}}” iş birliği teklifini gönderdi. Tutar: {{tutar}}. Yanıtlayın: {{link}}" },
      WHATSAPP: { body: "Merhaba {{ad}} 💼 {{marka}} size yeni bir teklif gönderdi: “{{baslik}}” ({{tutar}}). {{link}}" },
      INSTAGRAM: { body: "Merhaba {{ad}} 💼 {{marka}} sana yeni bir marka iş birliği teklifi gönderdi: “{{baslik}}” ({{tutar}}). İncele: {{link}}" },
    },
  },
  {
    key: "OFFER_RESPONDED",
    label: "Teklif yanıtlandı",
    vars: ["ad", "baslik", "durum", "link"],
    defaultChannels: ["INAPP", "EMAIL", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Teklif yanıtı", body: "{{ad}} “{{baslik}}” teklifini {{durum}}." },
      EMAIL: { subject: "Teklif {{durum}}", body: "“{{baslik}}” teklifi {{ad}} tarafından {{durum}}." },
      INSTAGRAM: { body: "“{{baslik}}” iş birliği teklifi {{ad}} tarafından {{durum}}. Detay: {{link}}" },
    },
  },
  {
    key: "PAYOUT_REQUESTED",
    label: "Para çekim talebi oluşturuldu",
    vars: ["ad", "tutar", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Çekim talebiniz alındı", body: "{{tutar}} tutarındaki çekim talebiniz incelemeye alındı." },
      EMAIL: { subject: "Çekim talebiniz alındı", body: "Merhaba {{ad}},\n\n{{tutar}} tutarındaki para çekim talebiniz alınmıştır. İnceleme sonrası bilgilendirileceksiniz.\n\nÖdemelerim: {{link}}" },
    },
  },
  {
    key: "PAYOUT_APPROVED",
    label: "Para çekim onayı",
    vars: ["ad", "tutar", "link"],
    defaultChannels: ["INAPP", "EMAIL", "WHATSAPP", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Ödeme onaylandı", body: "{{tutar}} tutarındaki çekim talebiniz onaylandı." },
      EMAIL: { subject: "Ödemeniz onaylandı", body: "Merhaba {{ad}},\n\n{{tutar}} tutarındaki çekim talebiniz onaylandı ve ödeme sürecine alındı.\n\nDetay: {{link}}" },
      WHATSAPP: { body: "Merhaba {{ad}} ✅ {{tutar}} tutarındaki ödemeniz onaylandı." },
      INSTAGRAM: { body: "Merhaba {{ad}} ✅ {{tutar}} tutarındaki çekim talebin onaylandı! Panel: {{link}}" },
    },
  },
  {
    key: "PAYOUT_REJECTED",
    label: "Para çekim talebi reddedildi",
    vars: ["ad", "tutar", "neden", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Çekim talebi reddedildi", body: "{{tutar}} tutarındaki talebiniz reddedildi: {{neden}}" },
      EMAIL: { subject: "Çekim talebiniz hakkında", body: "Merhaba {{ad}},\n\n{{tutar}} tutarındaki çekim talebiniz şu nedenle reddedildi: {{neden}}\n\nDetay: {{link}}" },
    },
  },
  {
    key: "PAYOUT_SENT",
    label: "Ödeme yatırıldı",
    vars: ["ad", "tutar", "link"],
    defaultChannels: ["INAPP", "EMAIL", "WHATSAPP", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Ödemeniz yatırıldı", body: "{{tutar}} tutarındaki ödemeniz banka hesabınıza gönderildi." },
      EMAIL: { subject: "Ödemeniz yatırıldı: {{tutar}}", body: "Merhaba {{ad}},\n\n{{tutar}} tutarındaki ödemeniz kayıtlı banka hesabınıza yatırılmıştır.\n\nÖdeme geçmişiniz: {{link}}" },
      WHATSAPP: { body: "Merhaba {{ad}} 💸 {{tutar}} tutarındaki ödemeniz hesabınıza yatırıldı! {{link}}" },
      INSTAGRAM: { body: "Merhaba {{ad}} 💸 {{tutar}} tutarındaki ödemen hesabına yatırıldı! Detay: {{link}}" },
    },
  },
  {
    key: "OPEN_CALL_PUBLISHED",
    label: "Yeni açık çağrı (başvuru)",
    vars: ["marka", "baslik", "link"],
    defaultChannels: ["INAPP", "EMAIL", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Yeni açık çağrı", body: "{{marka}} “{{baslik}}” başvuru çağrısını açtı." },
      EMAIL: { subject: "Yeni fırsat: {{baslik}}", body: "{{marka}} “{{baslik}}” başvuru çağrısını açtı. Başvurun: {{link}}" },
      INSTAGRAM: { body: "Yeni marka iş birliği fırsatı! {{marka}} “{{baslik}}” çağrısını açtı. Başvur: {{link}}" },
    },
  },
  {
    key: "APPLICATION_REVIEWED",
    label: "Başvuru sonucu",
    vars: ["ad", "baslik", "durum", "link"],
    defaultChannels: ["INAPP", "EMAIL", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Başvuru sonucu", body: "“{{baslik}}” başvurunuz: {{durum}}." },
      EMAIL: { subject: "Başvuru sonucu: {{baslik}}", body: "Merhaba {{ad}},\n\n“{{baslik}}” başvurunuzun sonucu: {{durum}}." },
      INSTAGRAM: { body: "Merhaba {{ad}}, “{{baslik}}” başvurunun sonucu: {{durum}}. Panel: {{link}}" },
    },
  },
  {
    key: "ANNOUNCEMENT",
    label: "Özel duyuru (manuel)",
    vars: ["ad", "mesaj", "link"],
    defaultChannels: ["INAPP", "EMAIL", "INSTAGRAM"],
    templates: {
      INAPP: { subject: "Duyuru", body: "{{mesaj}}" },
      EMAIL: { subject: "Duyuru", body: "Merhaba {{ad}},\n\n{{mesaj}}\n\n{{link}}" },
      WHATSAPP: { body: "{{mesaj}} {{link}}" },
      INSTAGRAM: { body: "{{mesaj}} {{link}}" },
    },
  },
  {
    key: "SHIPMENT_ADDRESS_CONFIRMED",
    label: "Influencer teslimat adresini onayladı",
    vars: ["influencer", "kampanya", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Teslimat adresi onaylandı", body: "{{influencer}} teslimat adresini onayladı, ürün gönderimine hazır." },
      EMAIL: { subject: "Ürün gönderimine hazır: {{influencer}}", body: "Merhaba,\n\n{{influencer}}, “{{kampanya}}” kampanyası için teslimat adresini onayladı ve ürün gönderimine hazır.\n\nLojistik paneli: {{link}}" },
    },
  },
  {
    key: "SHIPMENT_DISPATCHED",
    label: "Kampanya ürünü kargoya verildi",
    vars: ["marka", "kargo", "takipNo", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Ürününüz kargoya verildi", body: "{{marka}} kampanya ürününüzü kargoya verdi! Takip No: {{takipNo}}" },
      EMAIL: { subject: "Kargoya verildi: {{marka}}", body: "Merhaba,\n\n{{marka}} kampanya ürününüzü {{kargo}} ile kargoya verdi.\nTakip No: {{takipNo}}\n\nDetay ve takip: {{link}}" },
    },
  },
  {
    key: "SHIPMENT_DELIVERED_INFLUENCER",
    label: "Ürün influencer'a teslim edildi",
    vars: ["marka", "kampanya", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Ürününüz teslim edildi", body: "Ürününüz teslim edildi! Artık içeriğinizi hazırlayıp Nordvow üzerinden yükleyebilirsiniz." },
      EMAIL: { subject: "Ürününüz teslim edildi: {{kampanya}}", body: "Merhaba,\n\n{{marka}} tarafından gönderilen “{{kampanya}}” ürünü teslim edildi! Artık içeriğinizi hazırlayıp Nordvow üzerinden yükleyebilirsiniz.\n\nİş detayı: {{link}}" },
    },
  },
  {
    key: "SHIPMENT_DELIVERED_BRAND",
    label: "Ürün teslim edildi (marka bildirimi)",
    vars: ["influencer", "kampanya", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Ürün teslim edildi", body: "Ürün {{influencer}}'na teslim edildi." },
      EMAIL: { subject: "Teslimat tamamlandı: {{influencer}}", body: "Merhaba,\n\n“{{kampanya}}” kampanyası kapsamında gönderilen ürün {{influencer}}'na teslim edildi.\n\nLojistik paneli: {{link}}" },
    },
  },
  {
    key: "USER_REGISTERED",
    label: "Yeni üyelik başvurusu alındı",
    vars: ["ad", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Kaydınız alındı", body: "Kaydınız başarıyla alındı ve incelemeye gönderildi." },
      EMAIL: { subject: "Nordvow — Kaydınız Alındı", body: "Merhaba {{ad}},\n\nNordvow üyelik başvurunuz alınmıştır. Ekibimiz başvurunuzu inceledikten sonra hesabınız onaylanacak ve size tekrar bilgilendirme yapılacaktır.\n\nDurumunuzu takip edin: {{link}}" },
    },
  },
  {
    key: "USER_REJECTED",
    label: "Üyelik başvurusu reddedildi",
    vars: ["ad", "neden"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Başvuru sonucu", body: "Üyelik başvurunuz onaylanamadı." },
      EMAIL: { subject: "Nordvow — Üyelik Başvurunuz Hakkında", body: "Merhaba {{ad}},\n\nNordvow üyelik başvurunuz şu aşamada onaylanamadı.{{neden}}" },
    },
  },
  {
    key: "ADMIN_NEW_APPLICATION",
    label: "Yeni üyelik / davet başvurusu (admin)",
    vars: ["ad", "rol", "eposta", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Yeni üyelik başvurusu", body: "{{ad}} ({{rol}}) · {{eposta}}" },
      EMAIL: { subject: "Yeni Başvuru: {{ad}} ({{rol}})", body: "Merhaba,\n\n{{ad}} ({{rol}}) sisteme yeni üyelik/davet başvurusu gönderdi.\nE-posta: {{eposta}}\n\nİncelemek için: {{link}}" },
    },
  },
  {
    key: "STAFF_INVITED",
    label: "Ekip üyesi eklendi",
    vars: ["ad", "rol", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Ekibe hoş geldiniz", body: "Hesabınız {{rol}} yetkisiyle oluşturuldu." },
      EMAIL: { subject: "Nordvow Ekibine Hoş Geldiniz", body: "Merhaba {{ad}},\n\nNordvow yönetim paneli hesabınız {{rol}} rolüyle oluşturuldu. Size iletilen geçici şifre ile giriş yapabilirsiniz.\n\nGiriş yapın: {{link}}" },
    },
  },
  {
    key: "CAMPAIGN_ASSIGNED",
    label: "Kampanyaya influencer atandı",
    vars: ["ad", "kampanya", "tutar", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Yeni kampanya ataması", body: "“{{kampanya}}” kampanyasına atandınız ({{tutar}})." },
      EMAIL: { subject: "Yeni Kampanya Ataması: {{kampanya}}", body: "Merhaba {{ad}},\n\n“{{kampanya}}” kampanyasına atandınız. Ücret: {{tutar}}.\n\nDetaylar ve sözleşme: {{link}}" },
    },
  },
  {
    key: "DELIVERABLE_SUBMITTED",
    label: "Teslimat güncellendi (influencer)",
    vars: ["ad", "durum", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "İş durumu: {{durum}}", body: "{{ad}} teslimatı güncelledi ({{durum}})." },
      EMAIL: { subject: "Teslimat Güncellendi: {{durum}}", body: "Merhaba,\n\n{{ad}} kampanya teslimatını “{{durum}}” durumuna güncelledi.\n\nİncelemek için: {{link}}" },
    },
  },
  {
    key: "DELIVERABLE_REVIEWED",
    label: "Teslimat değerlendirildi (ajans/marka)",
    vars: ["ad", "durum", "not", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "İş durumu: {{durum}}", body: "İşiniz “{{durum}}” durumuna geçti. {{not}}" },
      EMAIL: { subject: "Teslimat Durumu: {{durum}}", body: "Merhaba {{ad}},\n\nTeslimatınız “{{durum}}” durumuna güncellendi.{{not}}\n\nDetay: {{link}}" },
    },
  },
  {
    key: "CREDIT_REQUEST_CREATED",
    label: "Yeni Creative bakiye talebi",
    vars: ["ad", "tutar", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Yeni bakiye talebi", body: "{{ad}} {{tutar}} bakiye talep etti." },
      EMAIL: { subject: "Yeni Bakiye Talebi: {{tutar}}", body: "Merhaba,\n\n{{ad}} Creative Studio için {{tutar}} tutarında bakiye talebi oluşturdu.\n\nOnaylamak için: {{link}}" },
    },
  },
  {
    key: "CREDIT_REQUEST_REVIEWED",
    label: "Creative bakiye talebi sonucu",
    vars: ["ad", "tutar", "durum", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Bakiye talebi: {{durum}}", body: "{{tutar}} tutarındaki bakiye talebiniz {{durum}}." },
      EMAIL: { subject: "Bakiye Talebiniz {{durum}}", body: "Merhaba {{ad}},\n\n{{tutar}} tutarındaki Creative Studio bakiye talebiniz {{durum}}.\n\nStüdyo: {{link}}" },
    },
  },
  {
    key: "SUPPORT_TICKET_CREATED",
    label: "Yeni destek talebi",
    vars: ["ad", "eposta", "konu", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Yeni destek talebi", body: "{{ad}} ({{eposta}}): {{konu}}" },
      EMAIL: { subject: "Yeni Destek Talebi: {{konu}}", body: "Merhaba,\n\n{{ad}} ({{eposta}}) yeni bir destek talebi oluşturdu.\nKonu: {{konu}}\n\nYönetim paneli: {{link}}" },
    },
  },
  {
    key: "SUPPORT_TICKET_UPDATED",
    label: "Destek talebi güncellendi",
    vars: ["ad", "konu", "durum", "not", "link"],
    defaultChannels: ["INAPP", "EMAIL"],
    templates: {
      INAPP: { subject: "Destek talebiniz: {{durum}}", body: "“{{konu}}” talebiniz güncellendi: {{durum}}" },
      EMAIL: { subject: "Destek Talebiniz Güncellendi: {{konu}}", body: "Merhaba {{ad}},\n\n“{{konu}}” başlıklı destek talebinizin durumu “{{durum}}” olarak güncellendi.{{not}}\n\nPanel: {{link}}" },
    },
  },
];

export const NOTIF_EVENT_MAP = new Map(NOTIF_EVENTS.map((e) => [e.key, e]));

/** {{anahtar}} yer tutucularını değerlerle doldurur. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}
