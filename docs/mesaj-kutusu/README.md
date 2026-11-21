# NordVow Mesaj Kutusu (Instagram + WhatsApp Birleşik Gelen Kutusu) — `README.md`

## Mimari Özet
- **Çekirdek Kütüphane (`packages/core/src/inbox/`):**
  - `meta-security.ts`: `verifyMetaSignature` (çoklu secret + `timingSafeEqual`), `verifyMetaTokenConstantTime`, `encryptMetaToken` / `decryptMetaToken` (`AES-256-GCM`), HMAC imzalı OAuth `state`, Meta `signed_request` çözücü.
  - `messaging-window.ts`: `getWindowState` (24 saatlik WhatsApp / Instagram serbest metin penceresi, `< 2 saat` kapanış uyarısı, WhatsApp şablon modu ve Instagram 7 gün `HUMAN_AGENT` insan yanıtı kontrolü).
  - `rules.ts`: Türkçe yerel ayarlı (`tr-TR`) opt-out algılayıcı (`dur`, `iptal`, `stop`, `abonelikten çık`), Chatwoot puanlamalı (`1.0 / 0.5 / 0.2`) hazır yanıt (`/kısakod`) arama, Meta hata sınıflandırma (`190` reauth, `10/100/200/551` kalıcı, `1/2/4/17/32/613/5xx` geçici), konuşma çözümleyici ve Instagram/WhatsApp webhook ayrıştırıcıları.
  - `store.ts`: Çok kiracılı (`tenantId` zorunlu) konuşma listesi/detayı, insan onaylı tekil mesaj/şablon/dahili not gönderimi, atama/etiket/durum/erteleme/öncelik yönetimi, AWS Bedrock (`eu.` profili) PII maskeli AI yanıt önerisi, creator profil eşleşmesi ve KVKK dışa aktarma/silme.
- **API Uçları (`apps/web/app/api/`):**
  - Webhook & Meta Uyum: `/api/webhooks/meta/instagram`, `/api/webhooks/meta/whatsapp`, `/api/meta/data-deletion`, `/api/meta/deauthorize`
  - Mesaj Kutusu: `/api/inbox/conversations`, `/api/inbox/conversations/[id]`, `/api/inbox/conversations/[id]/messages`, `/api/inbox/conversations/[id]/ai-suggest`, `/api/inbox/messages/[id]/retry`, `/api/inbox/contacts/[id]`, `/api/inbox/channels`, `/api/inbox/settings`, `/api/inbox/stream` (SSE)
- **Arayüz:**
  - `/dashboard/mesaj-kutusu` (`apps/web/app/dashboard/mesaj-kutusu/page.tsx` & `apps/web/components/inbox/unified-inbox-shell.tsx`)
  - `/veri-silme-durumu` (`apps/web/app/(public)/veri-silme-durumu/page.tsx`)

## Ortam Değişkenleri
- `INBOX_ENABLED=true` (varsayılan açık)
- `META_GRAPH_API_VERSION=v27.0`
- `META_APP_SECRET` / `INSTAGRAM_APP_SECRET` / `FACEBOOK_APP_SECRET` / `WHATSAPP_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN` (veya mevcut `META_VERIFY_TOKEN`)
- `META_TOKEN_ENC_KEY` (32 bayt base64; yoksa `AUTH_SECRET` üzerinden SHA-256 ile türetilir)
- `OAUTH_STATE_SECRET`
- `INBOX_BEDROCK_MODEL` (varsayılan mevcut `BEDROCK_TEXT_MODEL_ID` / `eu.anthropic.claude-haiku-4-5-20251001-v1:0`)

