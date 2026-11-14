# Nordvow platform botu — Meta kurulum ve App Review

Bu bot, mevcut `/api/webhooks/meta` hattını kullanır. Markaların kendi gelen kutusu durur. Bot yalnız `/admin/bot` ekranında açılan ve kimliği eşleşen Nordvow numarası, Instagram hesabı veya Facebook sayfası için çalışır.

Metinler taslaktır. App Review videosundan önce bir Türk avukatı gizlilik ve ileti metinlerini onaylamalıdır.

## İzinler (App Review)

| İzin | Ürün | Neden |
|---|---|---|
| `whatsapp_business_messaging` | WhatsApp | Kullanıcıya hizmet mesajı ve onaylı utility şablon göndermek |
| `whatsapp_business_management` | WhatsApp | Numara, şablon ve webhook aboneliği |
| `instagram_basic` | Instagram | Hesap kimliğini okumak |
| `instagram_manage_messages` | Instagram | DM almak ve yanıtlamak |
| `pages_messaging` | Messenger | Sayfa DM’i (aynı bot motoru) |
| `pages_manage_metadata` | Messenger | Webhook aboneliği |
| `business_management` | Business | İşletme varlıklarını listelemek ve Embedded Signup |

Bu izinler marka gelen kutusu için de kullanılır. Bot, kart numarası toplamaz.

## Webhook alanları

Uç: `https://<APP_URL>/api/webhooks/meta`

Doğrulama: `GET` `hub.mode=subscribe`, `hub.verify_token=META_VERIFY_TOKEN`, `hub.challenge` düz metin döner.

Abone olunacak alanlar:

- WhatsApp: `messages` (gelen mesaj, durum)
- Instagram: `messages`, `messaging_postbacks`
- Messenger (sayfa): `messages`, `messaging_postbacks`

İmza: `X-Hub-Signature-256` ve `META_APP_SECRET`.

## Ortam değişkenleri

| Değişken | Anlam |
|---|---|
| `META_API_MODE` | `http` olunca gerçek Graph çağrısı. Aksi halde mock. |
| `META_APP_SECRET` | Webhook ve silme imzası |
| `META_VERIFY_TOKEN` | Webhook GET |
| `META_APP_ID` | Embedded Signup |
| `NORDVOW_WA_PHONE_NUMBER_ID` | Paneldeki alan boşsa kullanılan numara kimliği |
| `NORDVOW_IG_USER_ID` | Instagram işletme kimliği |
| `NORDVOW_PAGE_ID` | Messenger sayfa kimliği |
| `APP_URL` | Sihirli bağlama ve ücretli bilet bağlantısı |
| `AUTH_SECRET` | Bağlama bağlantısının imzası |
| `LLM_PROVIDER` | `mock` menü ve anahtar kelime. `bedrock` ek araç seçimi |

`/admin/bot` kanalı kapatır, kimlikleri ve karşılama metnini yazar. Kanal kapalıyken o hatta marka asistanı çalışmaya devam eder.

## Şablonlar (24 saat dışı, utility)

Pencere kapalıyken serbest metin gönderilmez. WhatsApp’ta yalnız şu utility şablonlar:

- `nordvow_hesap_bagla` — bağlama kodu
- `nordvow_bilet_onay` — ücretsiz bilet kodu
- `nordvow_kupon_kodu` — kullanıcının kendi kuponu
- `nordvow_pencere_kapali` — kısa hizmet bildirimi

Pazarlama kategorisi kullanılmaz. İYS kapısı promosyonlu şablonda durur. Instagram ve Messenger’da 24 saat dışında bot yazmaz; temsilci `HUMAN_AGENT` ile yanıtlar.

## Hesap bağlama

- WhatsApp: profil telefonu tek kullanıcıyla eşleşirse bağlanır.
- Instagram / Messenger: bot, 15 dakikalık imzalı `/hesap-bagla?token=...` gönderir. Kullanıcı sitede giriş yapmışken açar. Ya da profildeki 6 haneli kodu bota yazar.
- Bağlı olmayan kişi yalnız Nordvow tanımı, herkese açık etkinlik ve `/kayit` görür.
- Profilde bağlantı kaldırılır.

Hassas işlemler (kupon kodu, bilet, kısa link) `EVET` yazılmadan çalışmaz ve saatte 5 ile sınırlıdır. Tam IBAN ve kart istenmez.

## App Review video akışı

1. Gizlilik sayfasını (`/gizlilik`) ve veri silmeyi (`/veri-silme`) gösterin. Meta verisinin satılmadığını okuyun.
2. Webhook doğrulamasının 200 döndüğünü ve panelde Instagram ile WhatsApp’ın bağlı olduğunu gösterin.
3. Kayıtlı telefonla WhatsApp’tan “menü” yazın. Kampanya, bakiye (maskeli IBAN) ve kupon listesini gösterin.
4. “Kuponlarım” sonra `EVET`. Kodun yalnız o kullanıcıya ait olduğunu söyleyin.
5. “Etkinlikler”. Ücretsiz bilette kod; ücretliyse sitedeki bağlantı ve “kart burada yazılmasın”.
6. “temsilci” yazın. Konuşmanın gelen kutusunda temsilciye düştüğünü gösterin.
7. Instagram’da bağlama bağlantısını açıp profilde kanalın göründüğünü, sonra “Bağlantıyı kaldır”ı gösterin.
8. Pencere kapalı bir konuşmada serbest metin gitmediğini, utility şablonun seçildiğini söyleyin.

Veritabanı migrasyonu: `20261114200000_platform_bot`.
