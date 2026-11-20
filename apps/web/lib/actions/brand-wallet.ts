"use server";

import { requireActor } from "@/lib/auth-guard";
import { attempt, optStr, revalidateAll, str } from "@/lib/action-utils";
import { prisma } from "@infulancer/core/db";
import { createBrandAdjustment, decideBrandWalletTopup, requestBrandWalletTopup } from "@infulancer/core/finance/brand-wallet";
import { saveBrandAddress } from "@infulancer/core/profile/addresses";
import { createBrandInvoiceForWalletEntry } from "@infulancer/core/finance/invoice-records";
import type { ActionState } from "@/lib/action-state";

function amountToKurus(value: string) {
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Geçerli ve pozitif bir tutar girin.");
  return Math.round(amount * 100);
}

export async function saveBrandAddressAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    const brandId = actor.role === "ADMIN" ? str(fd, "brandId") : actor.brandId;
    if (!brandId) throw new Error("Marka bulunamadı.");
    await saveBrandAddress(brandId, {
      label: optStr(fd, "label") ?? undefined,
      companyName: optStr(fd, "companyName"),
      recipientName: optStr(fd, "recipientName"),
      phone: str(fd, "phone"),
      addressLine: str(fd, "addressLine"),
      neighborhood: optStr(fd, "neighborhood"),
      city: str(fd, "city"),
      district: str(fd, "district"),
      postalCode: optStr(fd, "postalCode"),
      taxOffice: optStr(fd, "taxOffice"),
      taxNumber: optStr(fd, "taxNumber"),
      isBilling: fd.get("isBilling") === "on",
      isShipping: fd.get("isShipping") === "on",
    });
    revalidateAll();
    return { ok: true, message: "Marka adresi kaydedildi." };
  });
}

export async function requestBrandTopupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("BRAND");
  return attempt(async () => {
    if (!actor.brandId) throw new Error("Marka bulunamadı.");
    await requestBrandWalletTopup({
      brandId: actor.brandId,
      amountKurus: amountToKurus(str(fd, "amount")),
      method: str(fd, "method"),
      reference: optStr(fd, "reference"),
      note: optStr(fd, "note"),
      requestedById: actor.userId,
    });
    revalidateAll();
    return { ok: true, message: "Bakiye yükleme talebi oluşturuldu." };
  });
}

export async function decideBrandTopupAction(
  requestId: string,
  approve: boolean,
): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    await decideBrandWalletTopup({ requestId, approve, decidedById: actor.userId });
    revalidateAll();
    return { ok: true, message: approve ? "Bakiye talebi onaylandı." : "Bakiye talebi reddedildi." };
  });
}

export async function adjustBrandWalletAction(
  brandId: string,
  amount: string,
  direction: "CREDIT" | "DEBIT",
  note: string,
): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    await createBrandAdjustment({
      brandId,
      amountKurus: amountToKurus(amount),
      direction,
      note,
      createdById: actor.userId,
    });
    revalidateAll();
    return { ok: true, message: "Marka bakiyesi düzeltildi." };
  });
}

export async function createWalletEntryInvoiceAction(entryId: string): Promise<ActionState> {
  const actor = await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    const entry = await prisma.brandWalletEntry.findUnique({ where: { id: entryId }, select: { brandId: true } });
    if (!entry || (actor.role === "BRAND" && entry.brandId !== actor.brandId)) throw new Error("Bakiye hareketi bulunamadı.");
    await createBrandInvoiceForWalletEntry({ walletEntryId: entryId, createdById: actor.userId });
    revalidateAll();
    return { ok: true, message: "Fatura oluşturuldu." };
  });
}
