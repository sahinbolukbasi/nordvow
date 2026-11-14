/** Kupon PDF / kart kararı. Şablon kimliği oturumsuz paylaşılan kodu açmaz; gönderim bağlantısı açar. */
export type CouponPassActor = { role: string; brandId?: string | null };

export type CouponPassSubject =
  | { kind: "missing" }
  | { kind: "grant"; tenantId: string }
  | { kind: "template"; tenantId: string };

export type CouponPassDecision = { allow: true } | { allow: false; status: 401 | 403 | 404 };

/**
 * Gönderim (grant) kimliği, alıcıya giden tahmin edilemez bağlantıdır; kodu göstermek bu bağlantının amacıdır.
 * Şablon kimliği loglarda ve panel adresinde durur: paylaşılan kod yalnız yönetici veya kuponun markası görür.
 */
export function decideCouponPassAccess(subject: CouponPassSubject, actor: CouponPassActor | null): CouponPassDecision {
  if (subject.kind === "missing") return { allow: false, status: 404 };
  if (subject.kind === "grant") return { allow: true };
  if (!actor) return { allow: false, status: 401 };
  if (actor.role === "ADMIN" || actor.role === "AGENCY") return { allow: true };
  if (actor.role === "BRAND" && actor.brandId && actor.brandId === subject.tenantId) return { allow: true };
  return { allow: false, status: 403 };
}

/** Yetki yoksa paylaşılan kod null döner; çağıran bunu PDF, QR veya cüzdana koymaz. */
export function visibleSharedCode(sharedCode: string | null | undefined, decision: CouponPassDecision): string | null {
  if (!decision.allow) return null;
  const code = sharedCode?.trim();
  return code ? code : null;
}
