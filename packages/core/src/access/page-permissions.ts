import { prisma } from "../db";
import type { Role } from "../enums";
import { isPathHidden, type PagePermissionRow, type ScopeType } from "./page-visibility";
export { isPathHidden } from "./page-visibility";
export type { PagePermissionRow, ScopeType } from "./page-visibility";

const PERM_CACHE_TTL_MS = 30_000;
const permCache = new Map<string, { rows: PagePermissionRow[]; expiresAt: number }>();

function invalidatePermCache(): void {
  permCache.clear();
}

/** İlgili kapsamların tüm izin kayıtlarını getirir (30 sn TTL önbellekli; yönetici değişikliğinde anında temizlenir). */
export async function loadPagePermissions(role: Role, userId: string | null): Promise<PagePermissionRow[]> {
  const key = `${role}:${userId ?? ""}`;
  const hit = permCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.rows;
  const or: { scopeType: string; scopeId: string }[] = [{ scopeType: "ROLE", scopeId: role }];
  if (userId) or.push({ scopeType: "USER", scopeId: userId });
  const rows = await prisma.pagePermission.findMany({ where: { OR: or }, select: { id: true, scopeType: true, scopeId: true, pathPrefix: true, allowed: true } });
  if (permCache.size > 500) permCache.clear();
  permCache.set(key, { rows, expiresAt: Date.now() + PERM_CACHE_TTL_MS });
  return rows;
}

/** Bir yolun verilen kullanıcı/rol için gizli olup olmadığını tek sorguda döndürür. */
export async function isPathHiddenFor(role: Role, userId: string | null, pathname: string): Promise<boolean> {
  const rows = await loadPagePermissions(role, userId);
  return isPathHidden(rows, role, userId, pathname);
}

/** Yönetici: bir kapsam+yol için izni ayarlar (allowed=false gizler, true geri açar). */
export async function setPagePermission(input: { scopeType: ScopeType; scopeId: string; pathPrefix: string; allowed: boolean; updatedByUserId?: string | null }) {
  const res = await prisma.pagePermission.upsert({
    where: { scopeType_scopeId_pathPrefix: { scopeType: input.scopeType, scopeId: input.scopeId, pathPrefix: input.pathPrefix } },
    create: { scopeType: input.scopeType, scopeId: input.scopeId, pathPrefix: input.pathPrefix, allowed: input.allowed, updatedByUserId: input.updatedByUserId ?? null },
    update: { allowed: input.allowed, updatedByUserId: input.updatedByUserId ?? null },
  });
  invalidatePermCache();
  return res;
}

/** Yönetici: bir izin kaydını siler (yola varsayılan=görünür davranışına döner). */
export async function clearPagePermission(scopeType: ScopeType, scopeId: string, pathPrefix: string) {
  await prisma.pagePermission.deleteMany({ where: { scopeType, scopeId, pathPrefix } });
  invalidatePermCache();
}
