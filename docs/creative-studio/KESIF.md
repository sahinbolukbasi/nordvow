# NordVow Creative Studio — Mimari Keşif Raporu (`KESIF.md`)

**Tarih:** 19 Kasım 2026  
**Kapsam:** Mevcut Creative Studio yapısının, altyapı bileşenlerinin ve zaman çizelgeli Video Editörü + AI entegrasyonu için yeniden kullanım kararlarının tespiti.

## 1. Paketler, Çalışma Alanları ve Araç Zinciri
- **Monorepo:** `package.json` (`workspaces`: `packages/*`, `apps/*`, Node `>=24`, `npm`).
- **Web Uygulaması:** `apps/web/package.json` — Next.js `16.4.3` (App Router, `output: "standalone"`), React `19.3.1`, TypeScript `5.9.3`, Tailwind CSS `4.3.3`, Zod `4.6.7`.
- **Çekirdek Paket:** `packages/core/package.json` — `@infulancer/core`, Prisma `7.10.1` (`@prisma/adapter-pg`), `vitest` `5.1.0`, `tsx` `4.23.15`.
- **Resmî SDK'lar:** `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs`.

## 2. Veritabanı, ORM ve Yetkilendirme
- **ORM:** Prisma `packages/core/prisma/schema.prisma` (`prisma` nesnesi: `packages/core/src/db.ts`), ID formatı `cuid()`.
- **Yetkilendirme & Oturum:** NextAuth v5 (`apps/web/auth.ts`), guard yardımcıları `apps/web/lib/auth-guard.ts` (`requireActor`, `requireApiActor`, `getActor`).
- **Kiracı (Tenant) İzolasyonu:** `apps/web/lib/creative-tenant.ts` (`creativeTenantFor`, `ownTenant`, `ownTenantOrNull`). Kullanıcı rolleri: `ADMIN` (`AGENCY` staffRole desteğiyle), `BRAND`, `INFLUENCER`.
- **Creative Studio Mevcut Tabloları:** `CreativeJob`, `GeneratedAsset`, `CreativeUpload`, `VideoEditJob`, `VideoPipelineJob`, `CreditAccount`, `CreditHold`, `CreditLedger`, `ModelRegistry`, `ConfigValue`.

## 3. Mevcut AI & Medya Katmanları
- **AWS Bedrock İstemcisi (`packages/core/src/llm/bedrock.ts`):** `@aws-sdk/client-bedrock-runtime` (`ConverseCommand`, `converseChat`, `converseStructured`), varsayılan bölge `eu-central-1`, AB profilleri (`eu.amazon.nova-lite-v1:0`, `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`).
- **fal.ai İstemcisi (`packages/core/src/creative/fal.ts`, `generate.ts`, `edit.ts`, `orchestrator.ts`):** Queue + senkron `fal.run` + imzalı webhook (`/api/webhooks/fal`), çıktıları `objectStore` (S3) içine kopyalar ve C2PA metadata gömer (`packages/core/src/creative/c2pa.ts`).
- **S3 Depolama & Doğrudan Yükleme:** `packages/core/src/storage/s3.ts` (`presignPut`, `presignGet`, `createMultipart`, `MULTIPART_THRESHOLD_BYTES`), `packages/core/src/creative/uploads.ts` (`presignCreativeUpload`, `confirmCreativeUpload`, `downloadToFile`, `saveEditedFile`, `getOwnedUpload`), `/api/creative/upload`.
- **Kredi ve Maliyet Muhasebesi (`packages/core/src/creative/credits.ts`, `pricing.ts`):** Atomik `placeHold` / `chargeHold` / `releaseHold` / `refundJobCredits` ve `CreditLedger` hareketleri.
- **FFmpeg & Post-Prodüksiyon:** `packages/core/src/creative/video-edit.ts`, `packages/core/src/creative/sfx-timeline.ts` ve `packages/core/src/creative/studio/ffmpegRenderer.ts` (`spawn` + arg dizisiyle yerel FFmpeg / FFprobe işlemleri).
- **Kampanya & Teslim Akışı:** `Campaign`, `Assignment`, `Deliverable`, `Asset` (`Direction: CREATOR_TASLAK`), `Coupon` (`packages/core/prisma/schema.prisma`, `apps/web/lib/actions/deliverables.ts`).
- **i18n Sistemi:** `apps/web/lib/i18n/tt-client.tsx` (`useTT`), `apps/web/lib/i18n/tt-server.ts` (`getTT`), `apps/web/lib/i18n/messages/tr.json` ve `en.json`.
- **Güvenlik Başlıkları:** `apps/web/next.config.ts` (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`).

## 4. Mimari Karar Tablosu

| Bileşen | Seçilen Mevcut Yapı / Yeni Modül | Gerekçe |
| :--- | :--- | :--- |
| **ORM & Kalıcılık** | `@infulancer/core` (`Prisma` + `ConfigValue`, `CreativeUpload`, `GeneratedAsset`, `CreativeJob`, `Asset`, `Deliverable`) | Üretim veritabanında kesintisiz/sıfır-migrasyon riskiyle proje, sürüm, şablon ve KVKK onayı saklanır |
| **Auth & Yetki** | `apps/web/lib/auth-guard.ts` (`requireApiActor`) + `apps/web/lib/creative-tenant.ts` | Tenant izolasyonu ve rol denetimi tek merkezden |
| **Bedrock İstemcisi** | `packages/core/src/llm/bedrock.ts` (`converseStructured`, `converseChat`, `eu.` profilleri) | Veriler `eu-central-1` / AB içinde kalır; ikinci SDK eklenmez |
| **fal.ai İstemcisi** | `packages/core/src/creative/fal.ts` (`resolveFalKey`, `submitCreative`) + `fal-ai/wizper` | Tek anahtar ve kredi havuzu; sonuçlar S3'e kopyalanır |
| **S3 & Dosya Erişimi** | `packages/core/src/storage/s3.ts` + `packages/core/src/creative/uploads.ts` | Private bucket, presigned URL ve `getOwnedUpload` koruması |
| **Editör Çekirdeği** | `packages/core/src/creative/timeline-editor/*` (`time.ts`, `timeline-schema.ts`, `ops.ts`, `captions.ts`, `compile-ffmpeg.ts`, `store.ts`) | OpenCut-classic referans alınarak sade ve saf TS olarak sıfırdan yazıldı |
| **UI Giriş Noktası** | `/creative?sekme=editor` (`CREATIVE_STUDIO_EDITOR_ENABLED`) + `apps/web/components/creative/timeline-video-editor.tsx` | Mevcut sohbet/kitaplık akışını bozmadan yeni sekme olarak entegre edildi |

