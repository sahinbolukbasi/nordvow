# NordVow DM Otomasyonu (Instagram Yorum → DM, Resmî API) — `README.md`

## Mimari Özet
- **Çekirdek Modüller (`packages/core/src/dm-automation/`):**
  - `matcher.ts`: Emoji/noktalama temizliği, Latin aksan katlama, sayısal `O/0` normalize etme ve Türkçe karakter katlamalı (`İNDİRİM`/`indirim`/`INDIRIM`/`ındırım`) tam kelime / içerir / her yorum eşleştiricisi.
  - `webhook-parse.ts`: Instagram `comments` (reklam kopyası `original_media_id` dahil), `messages` (`is_echo`/`is_deleted`/`is_unsupported` filtreli) ve `postbacks` ayrıştırıcısı; `read` olayları mesaj tetiklemez.
  - `delivery-errors.ts`: Meta Graph API hata sınıflandırıcı (`190` reauth, `10/100/200/551` kesin red, `2534025` uygun değil, `4/17/32/613/429` hız sınırı, `1/2/5xx` belirsiz sonuç, şablon reddinde tek seferlik düz metin geri dönüşü).
  - `tracking.ts`: Zorunlu `DM_TRACKING_SECRET` kontrolü, 22 karakterlik HMAC alıcı token'ı (`createRecipientToken`), tuzlu IP SHA-256 hash (`hashClickIp`), bot UA filtresi, UTM ekleme ve `{username}` / `{link}` / `{kupon}` yer tutucu derleyicisi.
  - `rate-limiter.ts`: Redis sorted-set kayan pencere Lua betiği (700/saat + 5/sn yumuşak tavan), slot rezerve/iade ve 429/613 devre kesici.
  - `store.ts`: Kampanya CRUD, uyum kontrol listesi doğrulamalı aktivasyon, `DmCommentClaim` + atomik `claimCommentDelivery` deseni, 7 gün kuralı, kişi başına 24 saat limiti, herkese açık yanıt varyasyonları, `DUR/İPTAL/STOP` opt-out, polling güvenlik ağı (`reconcileAccountComments`), sonraki reel bağlama, token yenileme, KVKK saklama/silme işleri, Mesaj Kutusu entegrasyonu ve SSE olay tamponu.
- **API Uçları (`apps/web/app/api/dm-automation/`):**
  - `/accounts`, `/accounts/[id]/media`
  - `/campaigns`, `/campaigns/[id]`, `/campaigns/[id]/activate`, `/campaigns/[id]/pause`, `/campaigns/[id]/duplicate`, `/campaigns/[id]/test-match`, `/campaigns/[id]/stats`, `/campaigns/[id]/logs`, `/campaigns/[id]/logs.csv`, `/campaigns/[id]/stream`, `/campaigns/[id]/share`
  - `/opt-outs`
- **Genel Uçlar & Panel:**
  - `/r/[slug]` — Takip linki 302 yönlendirme
  - `/rapor/dm/[shareSlug]` — Paylaşılan salt-okuma marka raporu (yalnızca toplu sayılar)
  - `/dashboard/dm-otomasyonu` (ve `/dashboard/dm-automation`) — Ana liste, 7 adımlı sihirbaz, canlı telefon önizlemesi, kampanya detay sekmeleri, opt-out yönetimi.

## Yasaklanan Davranışlar (Politika Garantisi)
- Takip şartı (`follow gate`), ikinci/takip mesajı (`follow-up / drip`), okundu bilgisinden mesaj tetikleme, soğuk DM, toplu yayın (`broadcast`) ve veri kazıma kesinlikle yoktur.

## Ortam Değişkenleri
- `DM_AUTOMATION_ENABLED=true`
- `DM_AUTOMATION_ALLOWED_TENANTS=` (virgüllü tenant ID listesi; boşsa plan bazlı yetki)
- `DM_TRACKING_SECRET=` (üretimde zorunlu güçlü gizli anahtar)
- `DM_SHORT_LINK_BASE=https://nordvow.com/r`
- `DM_PRIVATE_REPLY_HOURLY_CAP=700`
- `DM_MAX_SENDS_PER_SECOND=5`
- `DM_REQUEUE_DELAY_MS=1800000`
- `DM_MAX_REQUEUE_ATTEMPTS=3`
- `DM_BREAKER_COOLDOWN_MS=900000`
- `COMMENT_POLL_LOOKBACK_HOURS=72`
- `COMMENT_POLL_MAX_PER_SWEEP=30`
- `DM_RETENTION_TEXT_DAYS=90`
- Ortak Meta değişkenleri: `META_GRAPH_API_VERSION=v27.0`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_TOKEN_ENC_KEY`, `OAUTH_STATE_SECRET`, `REDIS_URL`.

