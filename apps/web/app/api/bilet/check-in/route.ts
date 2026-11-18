import { NextResponse } from "next/server";
import { prisma } from "@infulancer/core/db";
import { canBrandManageEvent } from "@infulancer/core/events/partners";
import { checkInTicket, issueQuickTicket, undoCheckInTicket } from "@infulancer/core/events/service";
import { DomainError } from "@infulancer/core/domain/errors";
import { getActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Mobil QR tarayıcı ve kapı giriş ekranı için anlık check-in / geri alma / hızlı bilet ekleme API'si. */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "AGENCY" && actor.role !== "BRAND")) {
    return NextResponse.json({ ok: false, error: "Yetkisiz erişim." }, { status: 401 });
  }

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
    if (actor.role === "BRAND" && eventId) {
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, tenantId: true } });
      if (!ev || !(await canBrandManageEvent(ev, actor.brandId!))) {
        return NextResponse.json({ ok: false, error: "Bu etkinliği yönetme yetkiniz yok." }, { status: 403 });
      }
    }

    if (body.action === "undo" && body.ticketId) {
      const t = await prisma.eventTicket.findUnique({ where: { id: body.ticketId }, select: { event: { select: { id: true, tenantId: true } } } });
      if (!t) return NextResponse.json({ ok: false, error: "Bilet bulunamadı." }, { status: 404 });
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
      if (!eventId || !body.holderName?.trim()) {
        return NextResponse.json({ ok: false, error: "Etkinlik ve katılımcı adı gerekli." }, { status: 400 });
      }
      const created = await issueQuickTicket({
        eventId,
        holderName: body.holderName,
        guestEmail: body.guestEmail,
      });
      return NextResponse.json({
        ok: true,
        ticket: {
          id: created.id,
          code: created.code,
          holderName: created.holderName,
          status: created.status,
          checkedInAt: created.checkedInAt?.toISOString() ?? null,
        },
      });
    }

    const code = body.code?.trim();
    if (!code) {
      return NextResponse.json({ ok: false, error: "Bilet kodu gerekli." }, { status: 400 });
    }

    if (actor.role === "BRAND" && !eventId) {
      const tktMatch = code.match(/TKT-[A-Z0-9]+/i);
      const norm = (tktMatch ? tktMatch[0] : code).toUpperCase();
      const found = await prisma.eventTicket.findUnique({ where: { code: norm }, select: { event: { select: { id: true, tenantId: true } } } });
      if (found && !(await canBrandManageEvent(found.event, actor.brandId!))) {
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
