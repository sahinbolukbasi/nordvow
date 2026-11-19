# NordVow Creative Studio — Zaman Çizelgeli Video Editörü (`README.md`)

## Mimari Özet
- **Çekirdek Kütüphane:** `packages/core/src/creative/timeline-editor/`
  - `time.ts`: 120.000 tick/sn kayıpsız tamsayı zaman aritmetiği (`24/25/30/50/60 fps`).
  - `timeline-schema.ts`: Zod şemalı zaman çizelgesi + sunucu tarafı kilitli marka katmanı doğrulaması.
  - `ops.ts`: Ekle, sil (ripple), böl (`S/Q/W`, 1x ve 1.5x hız korunumlu), taşı, trim, çoğalt, snapping (`8 px`), sessizlik kesme (`computeSilenceKeepIntervals`), 9:16 reframe (`crop | blur | pad`).
  - `captions.ts`: Orantılı 3 kelime / 0.8 sn altyazı bölme, SRT parse/serialize, `classic | bold-yellow | karaoke | box` ASS derleyicisi.
  - `compile-ffmpeg.ts`: Saf FFmpeg argüman derleyici + sunucu MP4 render, `silencedetect`, `fal-ai/wizper` Türkçe transkripsiyon + Bedrock düzeltme/hook/senaryo/highlight asistanı.
  - `store.ts`: Proje CRUD, optimistic lock (`revision` / `409 Conflict`), 30 adımlı sürüm geçmişi, 3 hazır marka şablonu, KVKK rızası (`fal_transfer_v1`) ve kampanya teslimi.
- **API Uçları:** `apps/web/app/api/studio/**`
- **Arayüz:** `apps/web/components/creative/timeline-video-editor.tsx` (`/creative?sekme=editor`).

## Ortam Değişkenleri
- `CREATIVE_STUDIO_EDITOR_ENABLED=true` (varsayılan açık)
- `STUDIO_FAL_TRANSCRIBE_MODEL=fal-ai/wizper`
- Mevcut `FAL_KEY`, `S3_BUCKET`, `AWS_REGION=eu-central-1`, `BEDROCK_REGION=eu-central-1`, `BEDROCK_TEXT_MODEL_ID` yeniden kullanılır.

## Doğrulanan Modeller (19 Kasım 2026)
- **fal.ai Transkripsiyon:** `fal-ai/wizper` (`language: "tr"`, `chunk_level: "segment"`)
- **AWS Bedrock (AB):** `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, `eu.amazon.nova-lite-v1:0`

