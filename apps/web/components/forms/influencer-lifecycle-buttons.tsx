"use client";

import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Button } from "@/components/ui/form";
import { deleteInfluencerAction, toggleInfluencerActiveAction } from "@/lib/actions/influencers";

/** Influencer'ı sistemden gizlemek için pasife çekme / yeniden aktifleştirme butonu. */
export function InfluencerToggleActiveButton({
  influencerId,
  name,
  isActive,
}: {
  influencerId: string;
  name: string;
  isActive: boolean;
}) {
  const tt = useTT();
  const [confirming, setConfirming] = useState(false);

  if (!isActive) {
    return (
      <ActionForm
        action={toggleInfluencerActiveAction}
        submitLabel={tt("Aktifleştir")}
        submitVariant="secondary"
        submitSize="sm"
        aria-label={`${name}: ${tt("Aktifleştir")}`}
        className="!flex-row items-center gap-1"
      >
        <input type="hidden" name="influencerId" value={influencerId} />
        <input type="hidden" name="active" value="true" />
      </ActionForm>
    );
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`${name}: ${tt("Pasife Çek")}`}
        className="text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
      >
        {tt("Pasife Çek")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
      <span className="text-[12px] font-medium text-amber-300">
        {name} {tt("sistemden gizlensin mi?")}
      </span>
      <ActionForm
        action={toggleInfluencerActiveAction}
        submitLabel={tt("Evet, Pasife Çek")}
        submitSize="sm"
        submitVariant="primary"
        className="gap-1"
      >
        <input type="hidden" name="influencerId" value={influencerId} />
        <input type="hidden" name="active" value="false" />
      </ActionForm>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {tt("Vazgeç")}
      </Button>
    </div>
  );
}

/** 2 adımlı onaylı influencer kalıcı silme butonu. */
export function InfluencerDeleteButton({
  influencerId,
  name,
  redirectToList = false,
}: {
  influencerId: string;
  name: string;
  redirectToList?: boolean;
}) {
  const tt = useTT();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`${name}: ${tt("Sil")}`}
        className="text-critical hover:bg-critical/10 hover:text-critical"
      >
        {tt("Sil")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-critical/40 bg-critical/5 px-2.5 py-1.5">
      <span className="text-[12px] font-medium text-critical">
        {name} {tt("kalıcı olarak silinsin mi?")}
      </span>
      <ActionForm
        action={deleteInfluencerAction}
        submitLabel={tt("Evet, Sil")}
        submitSize="sm"
        submitVariant="primary"
        className="gap-1"
      >
        <input type="hidden" name="influencerId" value={influencerId} />
        {redirectToList ? <input type="hidden" name="redirectTo" value="/admin/influencerlar" /> : null}
      </ActionForm>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {tt("Vazgeç")}
      </Button>
    </div>
  );
}
