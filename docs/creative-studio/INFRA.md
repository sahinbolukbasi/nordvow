# NordVow Creative Studio — Altyapı ve Dağıtım (`INFRA.md`)

1. **S3 Bucket ve CORS:**
   - Mevcut private S3 bucket (`S3_BUCKET`) yeniden kullanılır.
   - Tarayıcıdan doğrudan presigned PUT yüklemeleri için yalnızca `https://nordvow.com` origin'ine `PUT, GET, HEAD` ve `ETag` expose izni verilmelidir.
2. **ECS Web & Medya İşleme:**
   - Web kapsayıcısı üzerinde `ffmpeg` ve `ffprobe` ikilileri ile OFL fontlar (`/usr/share/fonts` / `/app/fonts`) bulunur.
   - Çok uzun render işleri için ileride ayrı ECS Worker (`studio-media-jobs` SQS kuyruğu + DLQ) ayrıştırılabilir; `compileTimelineFfmpeg` saf fonksiyon olarak ayrı servislere taşınmaya hazırdır.
3. **CSP & Güvenlik:**
   - `next.config.ts` içinde `X-Frame-Options: DENY` aktiftir; önizleme `blob:`, S3 presigned URL ve CloudFront kaynaklarıyla çalışır.
