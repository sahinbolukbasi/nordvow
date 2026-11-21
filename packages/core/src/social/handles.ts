import { DomainError } from "../domain/errors";

/** Kayıt ve Graph çağrısı aynı biçimi kullanır: @, URL, sorgu, büyük/küçük harf. */
export const INSTAGRAM_HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export function normalizeInstagramHandle(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  s = s.replace(/[?#].*$/, "");
  const fromUrl = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/@?([^/?#]+)/i);
  if (fromUrl?.[1]) s = fromUrl[1];
  s = s.replace(/^@+/, "");
  s = (s.split("/")[0] ?? "").trim().toLowerCase();
  return s;
}

export function isValidInstagramHandle(handle: string): boolean {
  return INSTAGRAM_HANDLE_RE.test(handle);
}

/** Instagram için normalizeInstagramHandle. TikTok ve YouTube adreslerinde sorgu ve @ aynı şekilde düşer. */
export function normalizeSocialHandle(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (/tiktok\.com|youtube\.com/i.test(s)) {
    return s
      .replace(/^https?:\/\/(www\.)?(tiktok|youtube)\.com\//i, "")
      .replace(/[?#].*$/, "")
      .replace(/^@+/, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
  return normalizeInstagramHandle(s);
}

type HandleDb = {
  socialAccount: {
    findMany(args: {
      where: { platform: "INSTAGRAM" };
      select: { influencerId: true; handle: true };
    }): Promise<{ influencerId: string; handle: string }[]>;
  };
};

/** Aynı Instagram kullanıcı adı iki profilde olamaz. */
export async function assertUniqueInstagramHandle(db: HandleDb, handle: string, exceptInfluencerId?: string) {
  const key = normalizeInstagramHandle(handle);
  if (!key) return;
  const rows = await db.socialAccount.findMany({
    where: { platform: "INSTAGRAM" },
    select: { influencerId: true, handle: true },
  });
  const clash = rows.some((r) => r.influencerId !== exceptInfluencerId && normalizeInstagramHandle(r.handle) === key);
  if (clash) throw new DomainError("CAKISMA", "Bu Instagram kullanıcı adı başka bir profilde kayıtlı.");
}
