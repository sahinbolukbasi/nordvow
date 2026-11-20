import { NextResponse } from "next/server";
import { prisma } from "@infulancer/core/db";
import { canBrandManageEvent } from "@infulancer/core/events/partners";
import { getQrScannerRestriction } from "@infulancer/core/events/scanner-accounts";
import { checkInTicket, undoCheckInTicket } from "@infulancer/core/events/service";
import { DomainError } from "@infulancer/core/domain/errors";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Mobil QR tarayıcı ve kapı giriş ekranı için anlık check-in / geri alma / hızlı bilet ekleme API'si. */
export async function POST(req: Request) {
  const guard = await requireApiActor("ADMIN", "AGENCY", "BRAND");
  if (guard.response) {
    return NextResponse.json({ ok: false, error: "Yetkisiz erişim." }, { status: guard.response.status });
  }
  const actor = guard.actor;

  try {
    const body = (await req.json()) as {
      action?: "checkIn" | "undo" | "quickAdd";
      code?: string;
      eventId?: string;
      ticketId?: string;
      holderName?: string;
      guestEmail?: string;
    };

    const eventId = body.eventId?.trim();
    const scannerRestriction = await getQrScannerRestriction(actor.userId);
    if (scannerRestriction) {
      if (!scannerRestriction.active) {
        return NextResponse.json({ ok: false, error: "QR okuyucu hesabınız pasif durumda." }, { status: 403 });
      }
      if (eventId && !scannerRestriction.allowedEventIds.includes(eventId)) {
        return NextResponse.json({ ok: false, error: "Bu etkinliğin biletlerini tarama yetkiniz yok." }, { status: 403 });
      }
    }

    if (actor.role === "BRAND" && eventId) {
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, tenantId: true } });
      if (!ev || !(await canBrandManageEvent(ev, actor.brandId!))) {
        return NextResponse.json({ ok: false, error: "Bu etkinliği yönetme yetkiniz yok." }, { status: 403 });
      }
    }

    if (body.action === "undo" && body.ticketId) {
      const t = await prisma.eventTicket.findUnique({ where: { id: body.ticketId }, select: { eventId: true, event: { select: { id: true, tenantId: true } } } });
      if (!t) return NextResponse.json({ ok: false, error: "Bilet bulunamadı." }, { status: 404 });
      if (scannerRestriction && !scannerRestriction.allowedEventIds.includes(t.eventId)) {
        return NextResponse.json({ ok: false, error: "Bu etkinliğin biletini geri alma yetkiniz yok." }, { status: 403 });
      }
      if (actor.role === "BRAND" && !(await canBrandManageEvent(t.event, actor.brandId!))) {
        return NextResponse.json({ ok: false, error: "Bu bilet sizin etkinliğinize ait değil." }, { status: 403 });
      }
      const updated = await undoCheckInTicket(body.ticketId);
      return NextResponse.json({
        ok: true,
        ticket: {
          id: updated.id,
          code: updated.code,
          holderName: updated.holderName,
          status: updated.status,
          checkedInAt: updated.checkedInAt?.toISOString() ?? null,
        },
      });
    }

    if (body.action === "quickAdd") {
      return NextResponse.json(
        { ok: false, error: "QR tarama ekranından katılımcı eklenemez; yalnızca etkinlik yöneticisi davet edebilir." },
        { status: 403 },
      );
    }

    const code = body.code?.trim();
    if (!code) {
      return NextResponse.json({ ok: false, error: "Bilet kodu gerekli." }, { status: 400 });
    }

    if (scannerRestriction || (actor.role === "BRAND" && !eventId)) {
      const tktMatch = code.match(/TKT-[A-Z0-9]+/i);
      const norm = (tktMatch ? tktMatch[0] : code).toUpperCase();
      const found = await prisma.eventTicket.findUnique({ where: { code: norm }, select: { eventId: true, event: { select: { id: true, tenantId: true } } } });
      if (scannerRestriction && (!found || !scannerRestriction.allowedEventIds.includes(found.eventId))) {
        return NextResponse.json({ ok: false, error: "Bu etkinliğin biletini tarama yetkiniz yok." }, { status: 403 });
      }
      if (actor.role === "BRAND" && !eventId && found && !(await canBrandManageEvent(found.event, actor.brandId!))) {
        return NextResponse.json({ ok: false, error: "Bu bilet sizin etkinliğinize ait değil." }, { status: 403 });
      }
    }

    const res = await checkInTicket(code, eventId);
    return NextResponse.json({
      ok: true,
      alreadyUsed: res.alreadyUsed,
      ticket: {
        id: res.ticket.id,
        code: res.ticket.code,
        holderName: res.ticket.holderName,
        status: res.ticket.status,
        checkedInAt: res.ticket.checkedInAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    if (e instanceof DomainError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "İşlem sırasında bir hata oluştu." }, { status: 500 });
  }
}

