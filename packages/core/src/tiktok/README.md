# Nordvow × TikTok Entegrasyonu

## 1. Ortam Değişkenleri (`.env`)
- `TIKTOK_CLIENT_KEY`: TikTok Developer Portal App Client Key
- `TIKTOK_CLIENT_SECRET`: TikTok Developer Portal App Client Secret (yalnız sunucuda)
- `TIKTOK_REDIRECT_URI`: `https://nordvow.com/auth/tiktok/callback` (geliştirme için `http://localhost:3000/auth/tiktok/callback`)
- `TOKEN_ENCRYPTION_KEY`: 32-byte AES-256-GCM şifreleme anahtarı (`openssl rand -hex 32`)
- `TIKTOK_APP_AUDITED`: Denetim onaylıysa `true`, aksi halde `false` (yalnız `SELF_ONLY`)

## 2. Veritabanı ve Migration
```bash
npm run db:migrate
```
Eklenen tablolar: `tiktok_accounts`, `tiktok_videos`, `tiktok_video_stats_daily`, `tiktok_account_stats_daily`, `tiktok_posts`.

## 3. Zamanlanmış Job'lar (`packages/core/src/agents/registry.ts`)
- `tiktok-token-refresh` (her 30 dk): Süresi 1 saat içinde dolacak token'ları yeniler.
- `tiktok-sync` (her 6 saat): Profil ve tüm videoları (`has_more=false` olana kadar) senkronlar.
- `tiktok-daily-snapshot` (günde 1): Hesap ve video günlük performans snapshot'larını yazar.
- `tiktok-publish-poll` (her 5 dk): İşlenmekte olan `TikTokPost` durumlarını günceller.

## 4. API Uç Noktaları & Webhook
- OAuth Başlat: `GET /api/tiktok/oauth/start` (PKCE S256 + CSRF `state`)
- OAuth Callback: `GET /auth/tiktok/callback` (ve `/api/tiktok/oauth/callback`)
- Bağlantıyı Kes (Veri Silme): `POST /api/tiktok/disconnect`
- Manuel Senkron: `POST /api/tiktok/sync`
- Creator Info (Pre-flight): `GET /api/tiktok/creator-info`
- İçerik Yayınla / Inbox: `POST /api/tiktok/publish`
- Yayın Durumu: `GET /api/tiktok/publish/status?publishId=...`
- Creator Analitik: `GET /api/tiktok/analytics`
- AI Önerileri: `POST /api/tiktok/ai`
- Kampanya TikTok Raporu (JSON/CSV): `GET /api/raporlar/kampanya/tiktok?campaignId=...&format=csv`
- Webhook: `POST /webhooks/tiktok` (`TikTok-Signature` HMAC-SHA256 + 5dk replay koruması)

## 5. TikTok Onay Checklist (Kod Dışı)
1. **Domain Doğrulama**: TikTok Developer Portal'da `nordvow.com` için DNS TXT veya URL-prefix doğrulama dosyasını (`public/` altına) ekleyin.
2. **Sandbox**: Test TikTok hesaplarını Sandbox ortamına Target User olarak ekleyin ve `http://localhost:3000/auth/tiktok/callback` URI'sini tanımlayın.
3. **Yasal Sayfalar**: `https://nordvow.com/privacy` ve `https://nordvow.com/terms` yayında ve TikTok veri kullanımı/silme açıklamalarını içerir.
4. **Demo Videosu**: TikTok ile bağlan → profil/video metriklerinin görünmesi → `creator_info` yüklenmesi → gizlilik seçimi (varsayılan seçili olmadan) → önizleme ve onay → yayınlama akışını kaydedin.
