import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { submitBrandPaymentNotice } from "@infulancer/core/finance/brand-payments";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

const schema = z.object({
  campaignId: z.string().min(1),
  method: z.enum(["EFT_HAVALE", "KART", "DIGER"]),
  reference: z.string().trim().min(2).max(120),
  note: z.string().trim().max(400).optional(),
});

export async function POST(req: Request) {
  const guard = await requireApiActor("BRAND");
  if (guard.response) return guard.response;
  const actor = guard.actor;

  try {
    const body = schema.parse(await req.json());
    const campaign = await prisma.campaign.findFirst({
      where: { id: body.campaignId, brandId: actor.brandId!, status: { not: "IPTAL" } },
      select: { id: true, name: true, brandTotalFeeKurus: true, currency: true, brandPaymentReceivedAt: true },
    });
    if (!campaign) {
      return NextResponse.json({ ok: false, error: "Kampanya bulunamadı." }, { status: 404 });
    }
    if (campaign.brandPaymentReceivedAt) {
      return NextResponse.json({ ok: false, error: "Bu kampanyanın ödemesi zaten onaylanmış." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    const notice = await submitBrandPaymentNotice(actor.brandId!, {
      campaignId: campaign.id,
      campaignName: campaign.name,
      amountKurus: Number(campaign.brandTotalFeeKurus),
      currency: campaign.currency,
      method: body.method,
      reference: body.reference,
      note: body.note?.trim() || null,
      submittedByUserId: actor.userId,
      submittedByName: user?.name ?? "Marka kullanıcısı",
    });

    return NextResponse.json({ ok: true, notice });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Lütfen ödeme yöntemi ve referans bilgisini eksiksiz girin." }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Ödeme bildirimi kaydedilemedi." }, { status: 500 });
  }
}

