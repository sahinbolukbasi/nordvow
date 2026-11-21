# Sistem Güvenlik, Altyapı ve Performans Denetim Raporu

## Yönetici Özeti
* **Genel Durum:** Kritik / Orta (Üretim altyapısı sağlam temele sahip ancak kenar WAF/rate-limit, webhook imza sırası, senkron `spawnSync` blokajları ve bağlantı havuzu/zaman aşımı sertleştirmesi eksik)
* **Tespit Edilen Toplam Bulgu:** 14
* **En Büyük Darboğaz / Risk:** `apps/web/app/api/webhooks/meta/route.ts` içinde kişisel WhatsApp AI işleyicisinin Meta HMAC imza doğrulaması (`receiveWebhook`) öncesinde çalışması, CloudFront/ALB önünde WAF + IP/Kullanıcı bazlı Rate Limiting olmaması ve tek vCPU (`512 CPU / 1024 MB RAM`) ECS görevlerinde senkron `spawnSync("ffmpeg")` çağrılarının Node.js event loop'unu kilitleme riski.

---

## Faz 1: Acil Müdahale ve Çökme/DDoS Koruması (Kritik Riskler)
*(Sistemi dakikalar içinde çökertebilecek, süreci sonsuz beklemeye sokacak veya DDoS/tek kullanıcı suistimali ile kilitleyecek açıklar)*

- [ ] **Meta Webhook İmza Doğrulaması Öncesi İşlem (Spoofing & LLM/Maliyet Suistimali)**
  * **İlgili Dosya / Satır:** `apps/web/app/api/webhooks/meta/route.ts:21-34`
  * **Sorun ve Etki:** `POST` handler'ı `handleUserWhatsAppInbound(parsed)` fonksiyonunu `receiveWebhook("meta", body, req.headers.get("x-hub-signature-256"))` çağrısından önce çalıştırıyor. Saldırgan sahte Meta payload'ı göndererek imza doğrulamasını atlayıp Bedrock LLM çağrısı tetikleyebilir ve DB'ye yazabilir.
  * **Çözüm Adımı:** `x-hub-signature-256` HMAC-SHA256 doğrulamasını (ve `WEBHOOK_REQUIRE_SIGNATURE` kontrolünü) `handleUserWhatsAppInbound` öncesine taşı.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    import { createHmac, timingSafeEqual } from "node:crypto";
    import { envStr } from "@infulancer/core/env";

    function verifyMetaSig(raw: string, header: string | null): boolean {
      const secret = envStr("META_APP_SECRET", "");
      if (!secret) return envStr("WEBHOOK_REQUIRE_SIGNATURE", "false") !== "true";
      if (!header?.startsWith("sha256=")) return false;
      const expected = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
      const a = Buffer.from(header);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    }
    ```

- [ ] **CloudFront Önünde AWS WAF ve Hız Sınırı (Rate-Based Rule) Eksikliği**
  * **İlgili Dosya / Satır:** `infra/terraform/cloudfront.tf:34-90`
  * **Sorun ve Etki:** `aws_cloudfront_distribution.app` üzerinde `web_acl_id` tanımlı değil. DDoS veya bot taraması doğrudan ECS Fargate (`512 CPU / 1024 MB`) task'larına ulaşarak OOM/CPU %100 çökmesine yol açar.
  * **Çözüm Adımı:** `us-east-1` bölgesinde `aws_wafv2_web_acl` (`CLOUDFRONT` scope) tanımla; IP başına 5 dakikada 600 istek sınırı + AWS Managed Common/KnownBadInputs/Bot kurallarını ekle ve `cloudfront.tf` içinde `web_acl_id` bağla.
  * **Örnek Kod / Konfigürasyon:**
    ```hcl
    resource "aws_wafv2_web_acl" "edge" {
      provider = aws.us_east_1
      name     = "${local.name}-edge-waf"
      scope    = "CLOUDFRONT"
      default_action { allow {} }

      rule {
        name     = "rate-limit-ip"
        priority = 1
        action { block {} }
        statement {
          rate_based_statement {
            limit              = 600
            aggregate_key_type = "IP"
          }
        }
        visibility_config {
          cloudwatch_metrics_enabled = true
          metric_name                = "${local.name}-rate-limit"
          sampled_requests_enabled   = true
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.name}-waf"
        sampled_requests_enabled   = true
      }
    }
    ```

- [ ] **Senkron `spawnSync("ffmpeg")` / `rsvg-convert` ile Event Loop Blokajı**
  * **İlgili Dosya / Satır:** `packages/core/src/creative/fal.ts:162,412,418,470,481,520,579,586`, `packages/core/src/voice/ttsService.ts:20`, `packages/core/src/wallet/apple-pass.ts:118,129`
  * **Sorun ve Etki:** `spawnSync` Node.js ana event loop'unu tamamen dondurur. 1024 MB / 0.5 vCPU ECS konteynerinde eşzamanlı 2-3 video/ses isteği geldiğinde health check (`/giris`) dahil tüm kullanıcı istekleri donar ve ALB task'ı sağlıksız sayıp yeniden başlatır.
  * **Çözüm Adımı:** Tüm `spawnSync` çağrılarını asenkron `spawn` + `Promise` sarmalayıcısına (`runAsync`) ve eşzamanlılık kuyruğuna (aynı anda en fazla 1-2 ağır `ffmpeg` süreci) taşı.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    import { spawn } from "node:child_process";

    export function spawnAsync(cmd: string, args: string[], timeoutMs = 30_000): Promise<{ status: number; stdout: Buffer; stderr: string }> {
      return new Promise((resolve) => {
        const p = spawn(cmd, args);
        const out: Buffer[] = [];
        let err = "";
        const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
        p.stdout.on("data", (d: Buffer) => out.push(d));
        p.stderr.on("data", (d) => (err += String(d)));
        p.on("close", (code) => {
          clearTimeout(timer);
          resolve({ status: code ?? -1, stdout: Buffer.concat(out), stderr: err });
        });
      });
    }
    ```

- [ ] **Sınırsız Büyüyen In-Memory `Map` Önbellekleri (OOM Çökme Riski)**
  * **İlgili Dosya / Satır:** `packages/core/src/creative/fal.ts:82-83`
  * **Sorun ve Etki:** `studioJobCache` ve `syncPayloadCache` `Map` nesnelerinde boyut sınırı veya TTL temizliği yok. Webhook'u gelmeyen veya iptal edilen işler bellekte kalır; `1024 MB` ECS görevinde zamanla OOM kill oluşur.
  * **Çözüm Adımı:** `Map` girişlerine `createdAt` ekleyip her yazımda 15 dakikadan eski kayıtları ve maksimum 500 kayıt üstünü temizleyen `pruneCache()` uygula.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    const MAX_CACHE = 500;
    const TTL_MS = 15 * 60 * 1000;
    function setBounded<V>(map: Map<string, { val: V; at: number }>, key: string, val: V) {
      const now = Date.now();
      for (const [k, v] of map) {
        if (now - v.at > TTL_MS || map.size >= MAX_CACHE) map.delete(k);
        else break;
      }
      map.set(key, { val, at: now });
    }
    ```

---

## Faz 2: Kullanıcı Bazlı İstek Sınırları ve Uygulama Güvenliği (Security & Abuse)
*(Kullanıcı başı rate limit, eşzamanlı istek engeli, auth ve veri güvenliği iyileştirmeleri)*

- [ ] **Giriş, Şifre Sıfırlama ve AI Uçlarında Rate Limiting Eksikliği**
  * **İlgili Dosya / Satır:** `apps/web/auth.ts:24-41`, `apps/web/proxy.ts:37-78`, `apps/web/app/api/voice/test/route.ts`, `apps/web/app/api/creative/pipeline/photo-to-video/route.ts`
  * **Sorun ve Etki:** `/giris`, `/sifremi-unuttum` ve maliyetli AI uçlarında (`/api/voice/test`, `/api/creative/*`) IP veya `userId` başına istek sınırı yok. Tek kullanıcı dakikada yüzlerce Bedrock/fal.ai isteği göndererek kredi/API maliyetini şişirebilir veya brute-force deneyebilir.
  * **Çözüm Adımı:** `apps/web/lib/rate-limit.ts` içinde kayan pencere (sliding window) hız sınırlayıcı (IP/userId bazlı, DB veya in-memory + headers `Retry-After`) ekleyip auth ve AI route'larının başına koy.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    const buckets = new Map<string, { count: number; resetAt: number }>();
    export function checkRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
      const now = Date.now();
      const cur = buckets.get(key);
      if (!cur || cur.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfterSec: 0 };
      }
      if (cur.count >= limit) return { ok: false, retryAfterSec: Math.ceil((cur.resetAt - now) / 1000) };
      cur.count += 1;
      return { ok: true, retryAfterSec: 0 };
    }
    ```

- [ ] **Kullanıcı Başına Eşzamanlı Ağır İşlem Sınırı (Concurrency Limit per User)**
  * **İlgili Dosya / Satır:** `apps/web/app/api/creative/pipeline/photo-to-video/route.ts:38-55`, `apps/web/app/api/creative/pipeline/edit/route.ts:20-35`, `apps/web/lib/actions/creative-studio.ts:404-465`
  * **Sorun ve Etki:** Aynı tenant ardışık paralel isteklerle aynı anda 10+ `VideoPipelineJob` veya `addVoiceoverToVideoAction` başlatıp CPU/RAM/FFmpeg kuyruğunu diğer tüm markalar için kilitleyebilir.
  * **Çözüm Adımı:** İş başlatmadan önce `prisma.videoPipelineJob.count({ where: { tenantId, status: { in: ["queued", "planning", "generating", "rendering"] } } })` ve `creativeJob.count` ile tenant başına en fazla 2 eşzamanlı aktif iş sınırı uygula (`429 Too Many Requests`).
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    const active = await prisma.videoPipelineJob.count({
      where: { tenantId, status: { in: ["queued", "planning", "generating", "rendering"] } },
    });
    if (active >= 2) {
      return Response.json({ error: "Aynı anda en fazla 2 video üretim/düzenleme işi çalıştırabilirsiniz." }, { status: 429 });
    }
    ```

- [ ] **Güvenlik HTTP Başlıklarının (CSP, HSTS, X-Frame-Options, Referrer-Policy) Eksikliği**
  * **İlgili Dosya / Satır:** `apps/web/next.config.ts:12-20`
  * **Sorun ve Etki:** `next.config.ts` içinde `headers()` yapılandırması yok. Clickjacking (`X-Frame-Options`), MIME sniffing (`X-Content-Type-Options`) ve HSTS başlıkları uygulama seviyesinde eksik.
  * **Çözüm Adımı:** `apps/web/next.config.ts` içine `async headers()` ekleyerek tüm rotalara güvenli HTTP başlıklarını tanımla.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Frame-Options", value: "DENY" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          ],
        },
      ];
    },
    ```

- [ ] **İstek Gövdesi (Payload) Boyutu Sınırı**
  * **İlgili Dosya / Satır:** `apps/web/app/api/voice/docs/route.ts:24-30`, `apps/web/app/api/creative/chat/route.ts:35`
  * **Sorun ve Etki:** `/api/voice/docs` içinde `await file.arrayBuffer()` çağrılmadan önce `file.size` kontrol edilmiyor; büyük multipart gövdeler tüm dosyayı RAM'e okuyup OOM tetikleyebilir.
  * **Çözüm Adımı:** `await file.arrayBuffer()` öncesinde `if (file.size > 25 * 1024 * 1024) return jsonError(413, "Dosya 25 MB'ı aşamaz.");` kontrolü ekle ve `req.headers.get("content-length")` sınırla.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
      return jsonError(413, "Belge boyutu 25 MB sınırını aşıyor.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    ```

---

## Faz 3: Süreç Beklemeleri, Veritabanı ve Performans Optimizasyonu (Latency & Locks)
*(Process beklemelerini azaltacak, N+1 sorgularını çözecek ve caching ekleyecek adımlar)*

- [ ] **PostgreSQL Connection Pool Sınırlarının Tanımlanmamış Olması (Exhaustion Riski)**
  * **İlgili Dosya / Satır:** `packages/core/src/db.ts:10-13`, `infra/terraform/rds.tf:12-35`
  * **Sorun ve Etki:** `new PrismaPg({ connectionString })` varsayılan `pg.Pool` ayarlarıyla (`max: 10`, timeout tanımsız) çalışıyor; ECS autoscaling + Lambda (`sqs.ts`, `scheduled.ts`) aynı anda açıldığında RDS `max_connections` tükenebilir ve sorgular sonsuza kadar bekleyebilir.
  * **Çözüm Adımı:** `PrismaPg` havuzunda `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` ve `statement_timeout` parametrelerini açıkça yapılandır.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    import { Pool } from "pg";
    function createClient(): PrismaClient {
      const pool = new Pool({
        connectionString: requireEnv("DATABASE_URL"),
        max: Number(process.env.DB_POOL_MAX ?? 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 15_000,
      });
      return new PrismaClient({ adapter: new PrismaPg(pool) });
    }
    ```

- [ ] **`getOrCreateWhatsAppLink` ve `Admin` Sayfalarında Tekrarlayan DB Sorguları / Cache Eksikliği**
  * **İlgili Dosya / Satır:** `apps/web/components/shell/app-shell.tsx:31-35`, `apps/web/lib/auth-guard.ts:43-50`
  * **Sorun ve Etki:** Her sayfa gezintisinde `AppShell` + `requireActor` sırayla `user.findUnique`, `pagePermission.findMany` ve `configValue.findUnique({ key: "system.popups" })` sorguları çalıştırıyor; yüksek trafikte gereksiz DB yükü yaratıyor.
  * **Çözüm Adımı:** `system.popups` ve `configValue` okumaları için 30 saniyelik TTL'li sunucu içi/paylaşımlı bellek önbelleği (`unstable_cache` veya TTL cache) + güncellemede `revalidateTag("config")` ekle.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    import { unstable_cache } from "next/cache";
    export const getCachedPopups = unstable_cache(
      async () => {
        const row = await prisma.configValue.findUnique({ where: { key: "system.popups" }, select: { value: true } });
        return Array.isArray(row?.value) ? row.value : [];
      },
      ["system-popups"],
      { revalidate: 30, tags: ["system-popups"] },
    );
    ```

- [ ] **Eksik Zaman Aşımı (Timeout) Bulunan Dış HTTP `fetch` Çağrıları**
  * **İlgili Dosya / Satır:** `packages/core/src/assistant/agentcore.ts:120`, `packages/core/src/messaging/user-whatsapp-ai.ts:48`, `packages/core/src/channels/meta-client.ts:99,147,220,228`, `apps/web/app/api/tiktok/oauth/callback/route.ts:24`
  * **Sorun ve Etki:** Bu `fetch` çağrılarında `signal: AbortSignal.timeout(...)` yok. Meta Graph API veya TikTok OAuth yanıt vermediğinde soket dakikalarca asılı kalır ve worker slotlarını tüketir.
  * **Çözüm Adımı:** Tüm dış `fetch` çağrılarına `signal: AbortSignal.timeout(15_000)` ekle (ortak `fetchWithTimeout` yardımcısı üzerinden).
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
      return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    }
    ```

---

## Faz 4: Uzun Vadeli Dayanıklılık ve Gözlemlenebilirlik (Resilience & Monitoring)
*(Graceful shutdown, circuit breaker, loglama ve mimari iyileştirmeler)*

- [ ] **ECS Fargate Sıfır-Kesintili Kapanış (Graceful Shutdown) ve `stopTimeout` Yapılandırması**
  * **İlgili Dosya / Satır:** `infra/terraform/ecs.tf:162-191`, `infra/terraform/alb.tf:16`
  * **Sorun ve Etki:** `aws_ecs_task_definition.app` içinde `stopTimeout` tanımlı değil (varsayılan 30 sn) ve Node/Next süreci `SIGTERM` aldığında devam eden `ffmpeg`/`VideoPipelineJob` işlemlerini beklemeden kesilebilir.
  * **Çözüm Adımı:** `ecs.tf` container tanımına `stopTimeout = 60` (ALB `deregistration_delay = 30` ile uyumlu) ekle ve `packages/core/src/db.ts` içinde `SIGTERM`/`SIGINT` dinleyicisi ile `prisma.$disconnect()` kapatmasını garanti altına al.
  * **Örnek Kod / Konfigürasyon:**
    ```hcl
    # ecs.tf container_definitions içine:
    stopTimeout = 60
    ```
    ```ts
    process.once("SIGTERM", async () => {
      await prisma.$disconnect().catch(() => undefined);
    });
    ```

- [ ] **3. Parti AI Servisleri İçin Circuit Breaker (Bedrock / fal.ai)**
  * **İlgili Dosya / Satır:** `packages/core/src/creative/fal.ts:660-715`, `packages/core/src/llm/bedrock.ts:45-145`
  * **Sorun ve Etki:** `fal.ai` veya bir bölge Bedrock modeli geçici olarak hata verdiğinde her kullanıcı isteği 25-35 sn zaman aşımına kadar bekleyip zincirleme gecikme yaratıyor.
  * **Çözüm Adımı:** Ardışık 5 ağ/5xx hatasında devreyi 30 sn açan hafif bir Circuit Breaker (`withCircuitBreaker("fal", ...)`) ekle; devre açıkken anında kontrollü hata ve bakiye iadesi döndür.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    const breakers = new Map<string, { failures: number; openUntil: number }>();
    export async function withCircuitBreaker<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const b = breakers.get(name) ?? { failures: 0, openUntil: 0 };
      if (Date.now() < b.openUntil) throw new Error(`${name} servisi geçici olarak devre dışı; lütfen biraz sonra tekrar deneyin.`);
      try {
        const res = await fn();
        breakers.set(name, { failures: 0, openUntil: 0 });
        return res;
      } catch (e) {
        const failures = b.failures + 1;
        breakers.set(name, { failures, openUntil: failures >= 5 ? Date.now() + 30_000 : 0 });
        throw e;
      }
    }
    ```

- [ ] **CloudWatch Alarm ve Yapılandırılmış Sağlık Kontrolü (`/api/health`)**
  * **İlgili Dosya / Satır:** `infra/terraform/alb.tf:18-25`, `infra/terraform/ecs.tf:22-25`
  * **Sorun ve Etki:** ALB health check şu an `/giris` HTML sayfasına gidiyor (DB bağlantısı veya havuz durumunu ölçmüyor) ve CloudWatch 5xx/CPU/Memory alarmı yok.
  * **Çözüm Adımı:** `apps/web/app/api/health/route.ts` (`SELECT 1` DB kontrolü) oluşturup ALB `health_check.path`'i `/api/health` yap; CloudWatch üzerinde 5xx hata oranı ve ECS CPU/RAM > %85 alarmları tanımla.
  * **Örnek Kod / Konfigürasyon:**
    ```ts
    import { prisma } from "@infulancer/core/db";
    export const dynamic = "force-dynamic";
    export async function GET() {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return Response.json({ ok: true });
      } catch {
        return Response.json({ ok: false }, { status: 503 });
      }
    }
    ```

