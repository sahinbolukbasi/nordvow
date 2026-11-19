# NordVow Mesaj Kutusu — Meta App Review & Kurulum Rehberi (`META_APP_REVIEW.md`)

**Son Doğrulama Tarihi:** 19 Kasım 2026  
**Graph API Sürümü:** `v27.0` (`META_GRAPH_API_VERSION=v27.0`)

---

## 1. Gerekli Meta İzinleri (Permissions)

### Instagram (Instagram API with Instagram Login / Graph API)
- `instagram_business_basic`: Bağlanan profesyonel (Business / Creator) Instagram hesabının kimlik, kullanıcı adı ve profil bilgilerini doğrulamak için.
- `instagram_business_manage_messages`: İşletme/creator hesabına gelen DM'leri webhook ile almak ve Mesaj Kutusu üzerinden insan temsilci yanıtı göndermek için.
- `instagram_business_manage_comments`: (Ortak Meta uygulaması üzerinden yorum/etkileşim takibi ve DM Otomasyonu için).
- **Human Agent Özelliği (İsteğe Bağlı Ek İzin):** 24 saatlik standart pencere kapandıktan sonra 7 güne kadar yalnızca insan temsilci yanıtı gönderebilmek için Meta App Review'da `Human Agent` erişimi ayrıca talep edilmelidir. Onaylanana kadar `humanAgentEnabled = false` tutulur.

### WhatsApp (WhatsApp Business Cloud API)
- `whatsapp_business_messaging`: Gelen müşteri mesajlarını ve teslimat/okundu (`statuses`) bildirimlerini almak, 24 saat penceresi içinde yanıt veya pencere dışında onaylı `UTILITY` şablonu göndermek için.
- `whatsapp_business_management`: Embedded Signup v4 ile bağlanan WABA altındaki telefon numarasını doğrulamak, webhook aboneliği (`subscribed_apps`) başlatmak ve onaylı mesaj şablonlarını (`message_templates`) senkronize etmek için.

---

## 2. Meta App Dashboard URL Ayarları

- **Instagram Webhook Callback URL:** `https://nordvow.com/api/webhooks/meta/instagram` (veya ortak `https://nordvow.com/api/webhooks/meta`)
  - **Abone Olunacak Alanlar (`subscribed_fields`):** `messages`, `message_reactions`, `messaging_seen`, `messaging_postbacks`, `comments`
- **WhatsApp Webhook Callback URL:** `https://nordvow.com/api/webhooks/meta/whatsapp` (veya ortak `https://nordvow.com/api/webhooks/meta`)
  - **Abone Olunacak Alanlar:** `messages`, `message_template_status_update`, `message_template_quality_update`, `phone_number_quality_update`
- **Verify Token:** `META_WEBHOOK_VERIFY_TOKEN` (veya `META_VERIFY_TOKEN`)
- **Deauthorize Callback URL:** `https://nordvow.com/api/meta/deauthorize`
- **Data Deletion Request Callback URL:** `https://nordvow.com/api/meta/data-deletion`
- **Veri Silme Durum Sayfası:** `https://nordvow.com/veri-silme-durumu?kod=<confirmation_code>`
- **Gizlilik Politikası URL:** `https://nordvow.com/gizlilik`

---

## 3. App Review Başvuru Metinleri (TR & EN)

### `instagram_business_manage_messages`
- **TR:** "Marka veya içerik üreticisi (creator), kendi profesyonel Instagram hesabını OAuth ile NordVow'a bağlar. Hesaba takipçilerden veya iş ortaklarından gelen DM mesajları NordVow Mesaj Kutusu'nda görüntülenir ve yalnızca bir insan temsilci tarafından 24 saatlik mesajlaşma penceresi içinde yanıtlanır. Toplu mesaj (broadcast) veya otomatik AI yanıtı gönderilmez."
- **EN:** "Brands and creators connect their own Instagram Professional account via official OAuth to NordVow. Incoming direct messages sent by users to the connected account are displayed in the NordVow Unified Inbox and replied to manually by a human agent within the 24-hour messaging window. There is no bulk broadcasting, scraping, or autonomous AI auto-replying."

### `whatsapp_business_messaging` & `whatsapp_business_management`
- **TR:** "İşletmeler kendi WhatsApp Business numaralarını Embedded Signup ile bağlar. Müşterilerden gelen mesajlar tek ekranda listelenir, 24 saatlik müşteri hizmetleri penceresi içinde insan temsilci tarafından yanıtlanır. Pencere kapandığında yalnızca kullanıcının belgeli açık rızası (opt-in) varsa Meta onaylı UTILITY şablonu tekil konuşmada gönderilebilir."
- **EN:** "Businesses connect their own WhatsApp Business phone number via Embedded Signup. Incoming customer messages are displayed in the workspace inbox and answered by a human agent within the 24-hour service window. Outside the 24-hour window, only Meta-approved UTILITY templates can be sent one-to-one to contacts with documented opt-in consent."

---

## 4. App Review Ekran Kaydı (Screencast) Senaryosu (2–3 dk, Tek Çekim)
1. `https://nordvow.com/dashboard/mesaj-kutusu` sayfasına giriş yapın.
2. Sağ üstten **Ayarlar → Kanallar** sekmesini açıp **"Instagram Hesabını Bağla"** (veya **"WhatsApp Business Bağla"**) adımını gösterin.
3. İkinci bir test hesabından bağlı Instagram hesabına veya WhatsApp numarasına `"Merhaba, yeni kampanya hakkında bilgi alabilir miyim?"` mesajı gönderin.
4. Mesajın **Mesaj Kutusu** listesinde gerçek zamanlı (SSE) göründüğünü, 24 saatlik yeşil pencere sayacının (`Yanıt penceresi açık · 23 sa 59 dk kaldı`) aktif olduğunu gösterin.
5. `✨ Yanıt öner` butonuna basıp gelen AI taslağını `"Kullan"` ile yazma kutusuna aktarın, metni düzenleyip **"Gönder"** butonuna basın.
6. İkinci hesapta yanıtın ulaştığını gösterin; ardından konuşmayı **"Çözüldü olarak işaretle"** ile kapatın.

