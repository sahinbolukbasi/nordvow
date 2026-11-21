# NordVow Mesaj Kutusu (Instagram + WhatsApp Birleşik Gelen Kutusu) — Keşif Raporu (`KESIF.md`)

**Tarih:** 19 Kasım 2026  
**Kapsam:** Mevcut NordVow (`infulancer`) kod tabanındaki Meta (Instagram + WhatsApp), yetkilendirme, ORM, şifreleme, kuyruk, Bedrock AI ve S3 altyapısının tespiti ve yeni **Mesaj Kutusu** (`/dashboard/mesaj-kutusu`) mimari kararları.

---

## 1. Çerçeve, Çalışma Zamanı ve Dağıtım Ortamı
- **Next.js Sürümü:** `16.4.3` (App Router, `output: "standalone"`), React `19.3.1`, TypeScript `5.9.3`, Tailwind CSS `4.3.3`, Zod `4.6.7`.
- **Çalışma Zamanı (Runtime):** Tüm API ve webhook rotaları `export const runtime = "nodejs"` ile Node.js üzerinde çalışır (`node:crypto` HMAC-SHA256, `timingSafeEqual`, AES-256-GCM ve ham gövde `await req.text()` desteği mevcuttur).
- **Dağıtım Ortamı:** AWS `eu-central-1` (Frankfurt) ECS Fargate (`infulancer-prod-web`), önünde Cloudflare + AWS CloudFront, arkada RDS PostgreSQL ve özel S3 bucket (`infulancer-prod-assets-865369794421`).

## 2. ORM, Şema ve Mevcut Mesajlaşma Tabloları
- **ORM:** Prisma `7.10.1` (`packages/core/prisma/schema.prisma`, `packages/core/src/db.ts`), ID tipi `cuid()`.
- **Mevcut Tablolar (Doğrudan Yeniden Kullanılacak):**
  - `ChannelConnection` (`id`, `tenantId`, `provider: ChannelProvider`, `externalIds: Json`, `tokenRef`, `scopes`, `status: ConnectionStatus`, `connectedAt`, `lastVerifiedAt`, `revokedAt`, `lastError`)
  - `WhatsAppNumber` (`id`, `tenantId`, `connectionId`, `wabaId`, `phoneNumberId`, `displayNumber`, `messagingLimit`, `qualityRating`)
  - `Contact` (`id`, `tenantId`, `channel`, `externalId`, `phoneE164`, `email`, `name`, `country`, `isMinor`)
  - `Conversation` (`id`, `tenantId`, `channel`, `contactId`, `status: ConversationStatus`, `assignedUserId`, `tags`, `serviceWindowExpiresAt`, `fepWindowExpiresAt`, `humanAgentWindowExpiresAt`, `lastInboundAt`, `slaStartedAt`, `windowWarningSentAt`)
  - `Message` (`id`, `tenantId`, `conversationId`, `externalId`, `direction`, `body`, `templateId`, `category`, `mediaS3Key`, `mediaUrl`, `status`, `statusAt`, `fromAi`, `createdAt`)
  - `MessageTemplate` (`id`, `tenantId`, `name`, `language`, `category`, `body`, `containsPromotion`, `status`, `quality`, `externalId`)
  - `RawWebhook` & `WebhookDedupe` (`messageId`, `provider`, `ttl`)
  - `Consent`, `ConsentEvent`, `IysBrand` (İYS ve 6563 sayılı Kanun onay/ret kayıtları)
  - `ConfigValue` (`key`, `value: Json`) — Üretim veritabanında kesinti riski olmadan konuşma ek üstverileri (`displayId`, `priority`, `snoozedUntil`, `teamId`, `unreadCount`, `firstReplyAt`, `waitingSince`, dahili notlar, aktivite geçmişi, hazır yanıtlar `/kısakod`, etiket renkleri, takımlar, tekil `ContactConsent` delilleri ve `InboxSettings`) tenant bazlı anahtarlarla saklanır.

## 3. Kimlik Doğrulama, Çok Kiracılılık (Multi-Tenancy) ve Roller
- **Auth:** NextAuth v5 (`apps/web/auth.ts`), sunucu guard yardımcıları `apps/web/lib/auth-guard.ts` (`requireActor`, `requireApiActor`).
- **Roller:** `ADMIN`, `AGENCY` (staffRole), `BRAND` (`actor.brandId`), `INFLUENCER` (`actor.influencerId`).
- **Tenant Çözümleme:**
  - `BRAND` → `actor.brandId`
  - `INFLUENCER` (Creator) → `actor.influencerId`
  - `ADMIN` / `AGENCY` → Seçili marka/tenant veya `ajans` (veya mevcut ilk aktif marka alanı).

## 4. Mevcut Meta Entegrasyonu ve Webhook Altyapısı
- **Token Kasası:** `packages/core/src/channels/vault.ts` (`AES-256-GCM` yerel şifreleme + AWS Secrets Manager `awsVault`). Ayrıca `packages/core/src/inbox/meta-security.ts` içinde `v1:base64(iv|tag|ciphertext)` formatında taşınabilir AES-256-GCM şifreleme ve çoklu secret destekli `verifyMetaSignature` sağlanır.
- **Mevcut Meta İstemcisi:** `packages/core/src/channels/meta-client.ts` (`httpMetaClient` & `mockMetaClient`), `packages/core/src/channels/onboarding.ts` (WhatsApp Embedded Signup v4 & Instagram bağlantısı), `packages/core/src/channels/webhook.ts` ve `packages/core/src/channels/processor.ts`.
- **Mevcut Webhook Ucu:** `apps/web/app/api/webhooks/meta/route.ts`. Buna ek olarak `/api/webhooks/meta/instagram`, `/api/webhooks/meta/whatsapp`, `/api/meta/data-deletion` ve `/api/meta/deauthorize` uçları aynı ortak doğrulama ve `receiveWebhook` / `processRawWebhook` hattını paylaşır.
- **DM Otomasyonu Paylaşımı:** `packages/core/src/messaging/instagram-auto-reply.ts` ve `processor.ts` aynı `ChannelConnection` ve webhook fan-out katmanını kullanır.

## 5. Kuyruk, Realtime, Bedrock AI ve S3
- **Kuyruk & İşleme:** `receiveWebhook` ham payload'u S3 + `RawWebhook` tablosuna kaydedip `200` döner ve arka plan işlemcisini (`processRawWebhook`) tetikler; `firstSeen` (`webhook_dedupe`) ile `mid`/`wamid` tekilleştirmesi yapar.
- **Realtime:** `GET /api/inbox/stream` (Node runtime SSE `text/event-stream`, 25 sn `:ping` + `GET /api/inbox/events?after=` telafi ucu ve istemci `EventSource` + polling fallback).
- **AWS Bedrock İstemcisi:** `packages/core/src/llm/bedrock.ts` (`converseStructured`, `eu-central-1`, AB `eu.` inference profile: `eu.anthropic.claude-haiku-4-5-20251001-v1:0` / `eu.amazon.nova-lite-v1:0`).
- **S3 Yardımcıları:** `packages/core/src/storage/s3.ts` (`presignPut`, `presignGet`) ve `packages/core/src/channels/raw-store.ts` (`objectStore`).

---

## 6. Mimari Karar Tablosu

| Bileşen | Seçilen Yapı / Modül | Gerekçe |
| :--- | :--- | :--- |
| **Veri Modeli & Kalıcılık** | Mevcut `ChannelConnection`, `WhatsAppNumber`, `Contact`, `Conversation`, `Message`, `MessageTemplate`, `RawWebhook`, `WebhookDedupe` + `ConfigValue` (`inbox:*`) | Üretim RDS veritabanında şema kırılması olmadan tüm Chatwoot referans yetenekleri (displayId, snooze, priority, dahili not, hazır yanıt, etiket, takım, consent) desteklenir |
| **Ortak Meta & Güvenlik** | `packages/core/src/inbox/meta-security.ts` + `packages/core/src/channels/{vault,meta-client,webhook}.ts` | `timingSafeEqual` çoklu secret imza doğrulaması, `AES-256-GCM` token şifreleme, HMAC OAuth `state` ve Meta `signed_request` doğrulaması |
| **24 Saat Pencere Motoru** | `packages/core/src/inbox/messaging-window.ts` (`getWindowState`) | İstemci composer kilidi ve sunucu gönderim kapısında birebir aynı saf fonksiyon (WA 24s + şablon; IG 24s + opsiyonel 7g `HUMAN_AGENT`) |
| **AI Yanıt Önerisi** | `packages/core/src/inbox/store.ts` (`generateInboxAiSuggestions`) → `converseStructured` | Yalnızca insan onaylı taslak üretir; PII (`[gizli]`) maskelenir; kendi başına mesaj göndermez |
| **Gerçek Zamanlı Akış** | `apps/web/app/api/inbox/stream/route.ts` (SSE) + `EventSource` | 25 sn heartbeat, `Last-Event-ID` telafisi ve tenant/kanal izolasyonu |
| **Panel Rotası & Menü** | `/dashboard/mesaj-kutusu` (`UnifiedInboxShell`) + `/marka/gelen-kutusu` bağlantısı | Hem Marka hem Creator (`INFLUENCER`) hem de Ajans/Admin için 3 sütunlu Türkçe "Mesaj Kutusu" |

