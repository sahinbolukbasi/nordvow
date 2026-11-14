# Nordvow platform botu — Meta kurulum ve App Review

Bu bot, mevcut `/api/webhooks/meta` hattını kullanır. Markaların kendi gelen kutusu durur. Bot yalnız `/admin/bot` ekranında açılan ve kimliği eşleşen Nordvow numarası, Instagram hesabı veya Facebook sayfası için çalışır.

Metinler taslaktır. App Review videosundan önce bir Türk avukatı gizlilik ve ileti metinlerini onaylamalıdır.

## İzinler (App Review)

| İzin | Ürün | Neden |
|---|---|---|
| `whatsapp_business_messaging` | WhatsApp | Kullanıcıya hizmet mesajı ve onaylı utility şablon göndermek |
| `whatsapp_business_management` | WhatsApp | Numara, şablon ve webhook aboneliği |
| `instagram_basic` | Instagram | IGSID’den kullanıcı adı okumak (`GET /{igsid}?fields=username,name`) |
| `instagram_manage_messages` | Instagram | DM almak ve yanıtlamak |
| `instagram_manage_insights` | Instagram | Business Discovery’de gönderi etkileşimi. Yoksa takipçi okunur, beğeni alanları boş kalabilir |
| `pages_show_list` | Facebook Login | Bağlı sayfaları listelemek |
| `pages_read_engagement` | Sayfa | Sayfa ve bağlı Instagram hesabını okumak |
| `pages_messaging` | Messenger | Sayfa DM’i (aynı bot motoru) |
| `pages_manage_metadata` | Messenger | Webhook aboneliği |
| `business_management` | Business | İşletme varlıklarını listelemek ve Embedded Signup |

Bu izinler marka gelen kutusu için de kullanılır. Bot, kart numarası toplamaz. Kişisel Instagram hesapları Business Discovery’de görünmez; profilde Professional hesap istenir.

## Webhook alanları

Uç: `https://<APP_URL>/api/webhooks/meta`

Doğrulama: `GET` `hub.mode=subscribe`, `hub.verify_token=META_VERIFY_TOKEN`, `hub.challenge` düz metin döner.

Ürün bazında abone olunacak alanlar (başka alan eklemeyin):

- WhatsApp (`whatsapp_business_account`): `messages`
- Instagram (`instagram`): `messages`, `messaging_postbacks`
- Messenger (`page`): `messages`, `messaging_postbacks`

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
| `INSTAGRAM_ACCESS_TOKEN` | IGSID kullanıcı adı ve Business Discovery. Yoksa `META_IG_TOKEN`, sonra `IG_GRAPH_TOKEN` |
| `INSTAGRAM_IG_USER_ID` | Business Discovery’deki kendi IG işletme kimliği. Yoksa `IG_BUSINESS_ACCOUNT_ID` |
| `SOCIAL_SYNC_MODE` | `off` veriye dokunmaz. `mock` deterministik fixture. `http` Graph ve YouTube |

`/admin/bot` kanalı kapatır, kimlikleri ve karşılama metnini yazar. Kanal kapalıyken o hatta marka asistanı çalışmaya devam eder.

Konteyner açılışında `VAULT_MODE=aws` ise `infulancer-prod/integrations` sırrı okunur. Dolu ortam değişkeni ezilmez. `META_API_MODE` ve `SOCIAL_SYNC_MODE` bu sırda doluysa ve görev tanımında boşsa oradan alınır. Görev rolünün `secretsmanager:GetSecretValue` izni yoksa okuma sessizce atlanır; uygulama mock kalır.

## Şablonlar (24 saat dışı, utility)

Pencere kapalıyken serbest metin gönderilmez. WhatsApp’ta yalnız şu utility şablonlar:

- `nordvow_hesap_bagla` — bağlama kodu
- `nordvow_bilet_onay` — ücretsiz bilet kodu
- `nordvow_kupon_kodu` — kullanıcının kendi kuponu
- `nordvow_pencere_kapali` — kısa hizmet bildirimi

Pazarlama kategorisi kullanılmaz. İYS kapısı promosyonlu şablonda durur. Instagram ve Messenger’da 24 saat dışında bot yazmaz; temsilci `HUMAN_AGENT` ile yanıtlar.

## Hesap bağlama

- WhatsApp: gönderen `wa_id` profil telefonuyla E.164 üzerinden eşleşir. `00`, `90` ve baştaki `0` aynı numaradır. Tek aktif kullanıcı varsa otomatik bağlanır. İki profil aynı numarayı taşıyorsa bağlanmaz.
- Instagram: `GET /{igsid}?fields=username,name` ile kullanıcı adı alınır (`META_API_MODE=mock` iken fixture). Profildeki Instagram kullanıcı adıyla büyük/küçük harf ve `@` yok sayılarak karşılaştırılır. Tam bir eşleşme varsa otomatik bağlanır. Aynı ad iki profildeyse bağlanmaz; 6 hane veya imzalı bağlantı gerekir ve `/admin/bot` çakışmayı listeler. OAuth veya senkronla doğrulanmış satır, aynı kullanıcının birden fazla kaydında öne alınır.
- Messenger: kullanıcı adı yok. Yalnız 6 hane veya `/hesap-bagla?token=...`.
- Bağlı olmayan kişi yalnız Nordvow tanımı, herkese açık etkinlik ve `/kayit` görür.
- Profilde bağlantı kaldırılır. Profil uyarısı: Instagram kullanıcı adı ve telefon girilirse bot otomatik tanır.

## İçerik üreticisi Instagram verisi

YouTube kanalı `forHandle` ile Data API’den okunduğu gibi, Instagram kullanıcı adı Business Discovery ile okunur:

`GET /{INSTAGRAM_IG_USER_ID}?fields=business_discovery.username(HANDLE){id,followers_count,media_count,username,name,profile_picture_url,biography,media.limit(12){like_count,comments_count,timestamp,permalink,media_type}}`

Takipçi, medya sayısı, ortalama beğeni ve yorum `SocialAccount` üzerine yazılır. Kişisel hesapta hata metni Professional hesaba geçmeyi söyler; eski takipçi silinmez. `social-sync` işi 6 saatte bir, 12 saatten eski hesapları yeniler.

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
