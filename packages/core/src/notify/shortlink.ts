import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { envStr } from "../env";
import { DomainError } from "../domain/errors";

/** Kısa link: /l/<slug> → hedef URL. Yalnız https ve izinli host. Her ziyaret tıklamayı sayar. */
function genSlug(): string {
  return randomBytes(5).toString("base64url").replace(/[-_]/g, "").slice(0, 7);
}

/** Kendi alan adları + SHORTLINK_ALLOWLIST (virgül; `*.ornek.com` alt alan adlarını da kapsar). */
export function shortLinkAllowRules(): string[] {
  const rules = new Set<string>(["nordvow.com", "*.nordvow.com"]);
  const app = envStr("APP_URL", "");
  if (app) {
    try {
      const host = new URL(app).hostname.toLowerCase();
      if (host) {
        rules.add(host);
        rules.add(`*.${host}`);
      }
    } catch {
      /* APP_URL bozuksa yalnız sabit liste */
    }
  }
  if (process.env.NODE_ENV !== "production") {
    rules.add("localhost");
    rules.add("127.0.0.1");
  }
  for (const part of envStr("SHORTLINK_ALLOWLIST", "").split(",")) {
    const rule = part.trim().toLowerCase();
    if (rule) rules.add(rule);
  }
  return [...rules];
}

export function hostMatchesAllowRule(host: string, rule: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const r = rule.toLowerCase();
  if (r.startsWith("*.")) {
    const suffix = r.slice(2);
    return h === suffix || h.endsWith(`.${suffix}`);
  }
  return h === r;
}

/** Oluşturma ve çözümde aynı kural: https, kullanıcı bilgisi yok, host allowlist'te. */
export function assertAllowedTarget(targetUrl: string): string {
  let url: URL;
  try {
    url = new URL(targetUrl.trim());
  } catch {
    throw new DomainError("DOGRULAMA", "Geçerli bir https URL girin.");
  }
  if (url.protocol !== "https:") throw new DomainError("DOGRULAMA", "Yalnız https bağlantıları kısaltılabilir.");
  if (url.username || url.password) throw new DomainError("DOGRULAMA", "Adres kullanıcı bilgisi içeremez.");
  const host = url.hostname.toLowerCase();
  if (!host || !shortLinkAllowRules().some((rule) => hostMatchesAllowRule(host, rule))) {
    throw new DomainError("DOGRULAMA", "Bu adres kısa linke eklenemez. Yalnız nordvow.com, uygulama adresi ve SHORTLINK_ALLOWLIST içindeki siteler kabul edilir.");
  }
  return url.toString();
}

export function isAllowedTarget(targetUrl: string): boolean {
  try {
    assertAllowedTarget(targetUrl);
    return true;
  } catch {
    return false;
  }
}

export async function createShortLink(targetUrl: string, opts?: { label?: string; createdByUserId?: string | null; tenantId?: string | null }): Promise<{ id: string; slug: string; shortUrl: string }> {
  const safe = assertAllowedTarget(targetUrl);
  let slug = genSlug();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.shortLink.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) break;
    slug = genSlug();
  }
  const link = await prisma.shortLink.create({ data: { slug, targetUrl: safe, label: opts?.label ?? null, createdByUserId: opts?.createdByUserId ?? null, tenantId: opts?.tenantId ?? null } });
  const base = envStr("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  return { id: link.id, slug: link.slug, shortUrl: `${base}/l/${link.slug}` };
}

/** Slug'ı çözer ve tıklamayı artırır. İzin listesinden düşmüş hedef null döner (yönlendirme yok). */
export async function resolveAndCount(slug: string): Promise<string | null> {
  const link = await prisma.shortLink.findUnique({ where: { slug }, select: { id: true, targetUrl: true } });
  if (!link || !isAllowedTarget(link.targetUrl)) return null;
  await prisma.shortLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickAt: new Date() } });
  return link.targetUrl;
}

/** Kısa linki siler (yönetici). */
/** Admin her kaydı siler. Marka kendi tenant'ını, influencer kendi kaydını siler. */
export async function deleteShortLink(id: string, scope?: { admin?: boolean; tenantId?: string | null; userId?: string | null }): Promise<void> {
  const link = await prisma.shortLink.findUnique({ where: { id }, select: { id: true, tenantId: true, createdByUserId: true } });
  if (!link) return;
  if (!scope?.admin) {
    const tenantOk = !!scope?.tenantId && link.tenantId === scope.tenantId;
    const userOk = !!scope?.userId && link.createdByUserId === scope.userId;
    if (!tenantOk && !userOk) throw new DomainError("YETKISIZ", "Bu linki silemezsiniz.");
  }
  await prisma.shortLink.deleteMany({ where: { id } });
}
