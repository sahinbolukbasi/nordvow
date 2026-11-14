import { prisma } from "@infulancer/core/db";
import { decideCouponPassAccess, visibleSharedCode, type CouponPassDecision } from "@infulancer/core/coupons/pass-access";
import { getActor } from "@/lib/auth-guard";

/** Kupon şablonu veya gönderim. Şablonda paylaşılan kod yalnız yetkiliye döner. */
export async function loadCouponPass(id: string) {
  if (!id || id.length > 64) {
    const decision: CouponPassDecision = { allow: false, status: 404 };
    return { decision, coupon: null, grant: null, sharedCode: null as string | null };
  }
  const grant = await prisma.couponGrant.findUnique({ where: { id }, include: { coupon: true } });
  const coupon = grant?.coupon ?? (await prisma.coupon.findUnique({ where: { id } }));
  const actor = await getActor();
  const decision = decideCouponPassAccess(
    !coupon ? { kind: "missing" } : grant ? { kind: "grant", tenantId: coupon.tenantId } : { kind: "template", tenantId: coupon.tenantId },
    actor ? { role: actor.role, brandId: actor.brandId } : null,
  );
  return { decision, coupon, grant, sharedCode: visibleSharedCode(coupon?.sharedCode, decision) };
}

export function couponPassError(decision: CouponPassDecision): { status: 401 | 403 | 404; message: string } {
  if (decision.allow) return { status: 404, message: "Kupon bulunamadı." };
  if (decision.status === 401) return { status: 401, message: "Oturum açmanız gerekiyor." };
  if (decision.status === 403) return { status: 403, message: "Bu kupon kodunu görme yetkiniz yok." };
  return { status: 404, message: "Kupon bulunamadı." };
}
