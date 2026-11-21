import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { canBrandManageEvent } from "@infulancer/core/events/partners";
import {
  createQrScannerAccount,
  getQrScannerRestriction,
  setQrScannerEventAccess,
  toggleQrScannerActive,
} from "@infulancer/core/events/scanner-accounts";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

const createSchema = z.object({
  action: z.literal("create"),
  eventId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(150),
  password: z.string().min(6).max(120),
});

const toggleEventSchema = z.object({
  action: z.literal("toggleEvent"),
  eventId: z.string().min(1),
  scannerUserId: z.string().min(1),
  allow: z.boolean(),
});

const toggleActiveSchema = z.object({
  action: z.literal("toggleActive"),
  scannerUserId: z.string().min(1),
  active: z.boolean(),
});

export async function POST(req: Request) {
  const guard = await requireApiActor("ADMIN", "AGENCY", "BRAND");
  if (guard.response) return guard.response;
  const actor = guard.actor;

  const restriction = await getQrScannerRestriction(actor.userId);
  if (restriction) {
    return NextResponse.json({ ok: false, error: "QR okuyucu hesapları başka hesap oluşturamaz." }, { status: 403 });
  }

  try {
    const raw = await req.json();

    if (raw?.action === "create") {
      const parsed = createSchema.parse(raw);
      const ev = await prisma.event.findUnique({ where: { id: parsed.eventId }, select: { id: true, tenantId: true } });
      if (!ev) return NextResponse.json({ ok: false, error: "Etkinlik bulunamadı." }, { status: 404 });
      if (actor.role === "BRAND" && !(await canBrandManageEvent(ev, actor.brandId!))) {
        return NextResponse.json({ ok: false, error: "Bu etkinliği yönetme yetkiniz yok." }, { status: 403 });
      }
      const account = await createQrScannerAccount({
        name: parsed.name,
        email: parsed.email,
        password: parsed.password,
        brandId: actor.role === "BRAND" ? actor.brandId! : ev.tenantId,
        createdByUserId: actor.userId,
        initialEventId: ev.id,
      });
      return NextResponse.json({ ok: true, account });
    }

    if (raw?.action === "toggleEvent") {
      const parsed = toggleEventSchema.parse(raw);
      const ev = await prisma.event.findUnique({ where: { id: parsed.eventId }, select: { id: true, tenantId: true } });
      if (!ev) return NextResponse.json({ ok: false, error: "Etkinlik bulunamadı." }, { status: 404 });
      if (actor.role === "BRAND" && !(await canBrandManageEvent(ev, actor.brandId!))) {
        return NextResponse.json({ ok: false, error: "Bu etkinliği yönetme yetkiniz yok." }, { status: 403 });
      }
      const account = await setQrScannerEventAccess({
        scannerUserId: parsed.scannerUserId,
        eventId: ev.id,
        allow: parsed.allow,
        actorBrandId: actor.role === "BRAND" ? actor.brandId! : null,
      });
      return NextResponse.json({ ok: true, account });
    }

    if (raw?.action === "toggleActive") {
      const parsed = toggleActiveSchema.parse(raw);
      const account = await toggleQrScannerActive({
        scannerUserId: parsed.scannerUserId,
        active: parsed.active,
        actorBrandId: actor.role === "BRAND" ? actor.brandId! : null,
      });
      return NextResponse.json({ ok: true, account });
    }

    return NextResponse.json({ ok: false, error: "Geçersiz işlem." }, { status: 400 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Lütfen tüm alanları geçerli şekilde doldurun (şifre en az 6 karakter)." }, { status: 400 });
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "İşlem tamamlanamadı." }, { status: 500 });
  }
}

