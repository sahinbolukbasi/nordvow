# NordVow DM Otomasyonu (Instagram Yorum → DM, Resmî API) — Keşif Raporu (`KESIF.md`)

**Tarih:** 19 Kasım 2026  
**Kapsam:** Mevcut NordVow (`infulancer`) kod tabanındaki Next.js çalışma ortamı, Meta/Instagram katmanı, Mesaj Kutusu paylaşımı, veritabanı, kupon/kampanya modelleri, kuyruk/zamanlayıcı, Redis hız sınırı, UI/i18n altyapısı ve yeni **DM Otomasyonu** (`/dashboard/dm-otomasyonu`) mimari kararları.

---

## 1. Çerçeve, Çalışma Zamanı ve Uzun Ömürlü Worker Ortamı
- **Next.js Sürümü:** `16.4.3` (App Router, `output: "standalone"`), React `19.3.1`, TypeScript `5.9.3`, Tailwind CSS `4.3.3`, Zod `4.6.7`.
- **Çalışma Zamanı:** API ve webhook uçları `export const runtime = "nodejs"` ile Node.js üzerinde çalışır (`node:crypto` HMAC-SHA256, `timingSafeEqual`, AES-256-GCM, ham gövde `await req.text()`).
- **Dağıtım & Worker Süreci:** AWS `eu-central-1` (Frankfurt) ECS Fargate (`infulancer-prod-web`), önünde Cloudflare + AWS CloudFront, arkada RDS PostgreSQL ve S3 (`infulancer-prod-assets-865369794421`). Zamanlanmış ve arka plan işleri `packages/core/src/agents/registry.ts` & `packages/core/scripts/agents-scheduler.ts` (AWS EventBridge Scheduler / uzun ömürlü ECS worker) üzerinden çalışır.

## 2. ORM, ID Tipi, Tenant Modeli ve Roller
- **ORM:** Prisma `7.10.1` (`packages/core/prisma/schema.prisma`, `packages/core/src/db.ts`), ID tipi `cuid()`.
- **Tenant & Rol Modeli:**
  - `BRAND` → `actor.brandId`
  - `INFLUENCER` (Creator) → `actor.influencerId`
  - `ADMIN` / `AGENCY` (`staffRole`) → Seçili marka/creator tenant'ı veya `"ajans"`.
- **Yetki Koruması:** `apps/web/lib/auth-guard.ts` (`requireActor`, `requireApiActor`) + `apps/web/lib/dm-automation-api.ts` (`assertDmAutomationAccess`) + özellik bayrağı (`DM_AUTOMATION_ENABLED`) ve tenant izin listesi (`DM_AUTOMATION_ALLOWED_TENANTS`).

## 3. Ortak Meta / Instagram Entegrasyonu ve Mesaj Kutusu Paylaşımı
- **Paylaşılan Güvenlik & Kripto:** `packages/core/src/inbox/meta-security.ts` (`verifyMetaSignature` çoklu secret + `timingSafeEqual`, `verifyMetaTokenConstantTime`, `encryptMetaToken` / `decryptMetaToken`, `createSignedOAuthState`, `verifySignedOAuthState`, `verifyMetaSignedRequest`) ve `packages/core/src/channels/vault.ts`.
- **Paylaşılan IG Bağlantısı:** `ChannelConnection` (`provider: "INSTAGRAM"`, `externalIds`, `tokenRef`, `scopes`, `status`). İkinci bir OAuth akışı veya ikinci bir Instagram bağlantı tablosu oluşturulmamıştır; Mesaj Kutusu ile aynı `ChannelConnection` ve `/api/inbox/channels` OAuth yetkilendirme akışı paylaşılır (`instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`).
- **Tek Webhook URL'si & Dağıtıcı:** `/api/webhooks/meta/instagram` (ve `/api/webhooks/meta`) → `packages/core/src/channels/webhook.ts` (`verifyMetaSignature`) → `packages/core/src/channels/processor.ts` içinden `comments` ve `messaging` (`message` + `postback`) olayları `packages/core/src/dm-automation/store.ts` (`processInstagramWebhookForDmAutomation`) akışına dağıtılır.
- **Mesaj Kutusu Ortak Yaşamı:**
  - DM Otomasyonu'nun gönderdiği her private reply / DM, Mesaj Kutusu'ndaki `Conversation` ve `Message` tablosuna `sentByAutomation: true` yan verisiyle işlenir (Mesaj Kutusu'nda **"Otomasyon"** rozetiyle görünür).
  - Echo mesajlar yok sayılır; Mesaj Kutusu'nda engellenen kişiler (`ContactSidecarItem.blocked`) `SKIPPED_BLOCKED` ile atlanır; son 24 saatte insan temsilcinin yanıtladığı konuşmada DM tetikleyicisi susar (`SKIPPED_HUMAN_ACTIVE`).
  - Meta Data Deletion (`/api/meta/data-deletion`) ve Deauthorize (`/api/meta/deauthorize`) uçları Mesaj Kutusu ile ortaktır.

## 4. Redis, Kuyruk ve Hız Sınırlayıcı
- **Mevcut Durum:** `packages/core/package.json` içinde BullMQ/ioredis bağımlılığı yoktur; arka plan dağıtımı `setImmediate`/SQS (`receiveWebhook` → `processRawWebhook`) ve `agents-scheduler.ts` ile yapılmaktadır.
- **Hız Sınırlayıcı Kararı (`rate-limiter.ts`):** Redis bağlantısı (`REDIS_URL`) varsa Redis sorted-set kayan pencere Lua betiği (`SLIDING_WINDOW_LUA`: `ZREMRANGEBYSCORE`, `ZCARD`, `ZADD`, `PEXPIRE`) ile atomik slot rezervasyonu ve iadesi yapılır; Redis yoksa aynı atomik kayan pencere algoritmasının süreç içi (`InMemorySlidingWindow`) eşleniği devrededir. Varsayılan saatlik tavan **700** (`DM_PRIVATE_REPLY_HOURLY_CAP`, Meta limiti 750'ye %7 pay), saniyelik yumuşak tavan **5** (`DM_MAX_SENDS_PER_SECOND`) ve 429/613 sonrası **15 dk** devre kesici uygulanır.

## 5. Kampanya, Kupon ve Kısa Link Altyapısı
- **Kampanya & Kuponlar:** `Campaign`, `Assignment.couponCode`, `Coupon` (`id`, `tenantId`, `sharedCode`, `valueType`, `value`, `status`) ve `CouponGrant` (`code`, `status: GONDERILDI | GORULDU | KULLANILDI | IPTAL`). DM Otomasyonu kampanyaları mevcut `Campaign` ve `Coupon` kayıtlarına bağlanarak `{kupon}` yer tutucusunu ve kupon kullanım sayısını doğrudan okur.
- **Kısa Linkler:** Mevcut `ShortLink` (`/l/[slug]`) genel bildirim içindir. DM Otomasyonu alıcı bazlı benzersiz tıklama (22 karakter HMAC `recipientToken`), tuzlu IP hash ve bot filtresi gerektirdiğinden `/r/[slug]` rotası (`DmTrackedLink` + `DmLinkClick` + otomatik UTM ekleme) eklenmiştir.

## 6. UI Kiti, Grafik Kütüphanesi ve i18n
- **UI & Grafikler:** Tailwind CSS 4 + NordVow tasarım token'ları (`bg-surface`, `bg-bg`, `border-line`, `text-fg`, `text-fg-muted`, `neon-pink`, `neon-cyan`). Harici ağır grafik paketi yerine sıfır bağımlılıklı, erişilebilir SVG/HTML huni ve saatlik seri grafikleri kullanılır (`npm audit` sıfır ek risk).
- **i18n:** `apps/web/lib/i18n/dict.ts` (`tr` kaynak dil, `en`, `de`, `fr` sözlükleri) ve `apps/web/components/shell/nav.tsx` (`"DM Otomasyonu"` menü öğesi).

## 7. Cron / Zamanlayıcı Altyapısı
- `packages/core/src/agents/registry.ts` içine 4 yeni job eklenmiştir:
  1. `dm-reconcile` (5 dk — webhook kaçıran yorumlar için polling güvenlik ağı, son 72 saat, tur başına en fazla 30 yorum).
  2. `dm-attach-next-reel` (5 dk — "bir sonraki reel'im" kampanyalarını yeni yayınlanan Reel'e bağlar).
  3. `dm-token-refresh` (günlük — süresi < 10 gün kalan IG token'larını yeniler).
  4. `dm-retention` (günlük — KVKK 90 gün metin temizliği, 30 gün ham payload temizliği, 12 ay tıklama/IGSID hash).

---

## 8. Mimari Karar Tablosu

| Bileşen | Seçilen Yapı / Modül | Gerekçe |
| :--- | :--- | :--- |
| **Ortak Meta & Güvenlik** | `packages/core/src/inbox/meta-security.ts`, `packages/core/src/channels/{webhook,processor,meta-client}.ts` | Tek webhook URL'si, tek `ChannelConnection` tablosu, çoklu secret `timingSafeEqual` |
| **Anahtar Kelime Eşleştirici** | `packages/core/src/dm-automation/matcher.ts` | Unicode emoji/işaret temizliği + zorunlu Türkçe karakter katlaması (`ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c`) |
| **Hız Sınırlayıcı & Devre Kesici** | `packages/core/src/dm-automation/rate-limiter.ts` | Atomik kayan pencere Lua betiği (700/saat + 5/sn), slot iadesi, 15 dk devre kesici |
| **Claim & Teslimat Garantisi** | `packages/core/src/dm-automation/store.ts` (`claimCommentDelivery`) + `delivery-errors.ts` | Belirsiz sonuç (`UNCONFIRMED`) asla tekrar gönderilmez; `DmCommentClaim` yorum başına tek DM garantiler |
| **Veri Saklama** | `ConfigValue` (`dm_auto:*`) kalıcılığı + `DmDailyStat` | Üretim RDS şemasını kilitlemeden sıfır kesintiyle tam kampanya, log, link, opt-out ve istatistik yönetimi |
| **Takip Linkleri** | `apps/web/app/r/[slug]/route.ts` + `tracking.ts` | Zorunlu `DM_TRACKING_SECRET`, 22 krk HMAC alıcı token'ı, tuzlu IP hash, bot filtresi, otomatik UTM |
| **Panel & Rotalar** | `/dashboard/dm-otomasyonu` (ve `/dashboard/dm-automation`) + `/rapor/dm/[shareSlug]` | Sihirbaz, canlı önizleme, huni/saatlik grafik, CSV (OWNER/ADMIN), SSE canlı akış, salt-okuma rapor |

