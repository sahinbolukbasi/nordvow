import { DomainError } from "../domain/errors";

/** @, URL ve büyük/küçük harf farkını kaldırır. */
export function normalizeSocialHandle(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?(instagram|tiktok|youtube)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "")
    .toLowerCase();
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
  const key = normalizeSocialHandle(handle);
  if (!key) return;
  const rows = await db.socialAccount.findMany({
    where: { platform: "INSTAGRAM" },
    select: { influencerId: true, handle: true },
  });
  const clash = rows.some((r) => r.influencerId !== exceptInfluencerId && normalizeSocialHandle(r.handle) === key);
  if (clash) throw new DomainError("CAKISMA", "Bu Instagram kullanıcı adı başka bir profilde kayıtlı.");
}
