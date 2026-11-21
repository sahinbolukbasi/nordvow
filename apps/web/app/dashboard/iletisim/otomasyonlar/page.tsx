import type { Metadata } from "next";
import Link from "next/link";
import { getInstagramAutoReplies } from "@infulancer/core/messaging/instagram-auto-reply";
import { BrandAssistants } from "@/components/channels/brand-assistants";
import { InstagramAutoReplyPanel } from "@/components/channels/instagram-auto-reply-panel";
import { DmAutomationShell } from "@/components/dm-automation/dm-automation-shell";
import { IletisimShell } from "@/components/iletisim/iletisim-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { loadIletisimContext } from "@/lib/iletisim/context";

export const metadata: Metadata = { title: "Otomasyonlar · Nordvow" };
export const dynamic = "force-dynamic";

type OtomasyonTuru = "tumu" | "yorum-dm" | "anahtar-kelime" | "asistan";

function normalizeTur(raw?: string): OtomasyonTuru {
  if (raw === "yorum-dm" || raw === "anahtar-kelime" || raw === "asistan") return raw;
  return "tumu";
}

export default async function OtomasyonlarPage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string; marka?: string }>;
}) {
  const sp = await searchParams;
  const tur = normalizeTur(sp.tur);
  const ctx = await loadIletisimContext(sp.marka);
  const igAutoReplies = await getInstagramAutoReplies(ctx.activeTenantId).catch(() => []);

  const markaParam = ctx.isAdmin && ctx.activeTenantId ? `&marka=${encodeURIComponent(ctx.activeTenantId)}` : "";
  const hrefFor = (t: OtomasyonTuru) =>
    t === "tumu"
      ? `/dashboard/iletisim/otomasyonlar${ctx.markaQs}`
      : `/dashboard/iletisim/otomasyonlar?tur=${t}${markaParam}`;

  const filters: { id: OtomasyonTuru; label: string }[] = [
    { id: "tumu", label: "Tümü" },
    { id: "yorum-dm", label: "Yorumdan DM" },
    { id: "anahtar-kelime", label: "Anahtar kelime cevabı" },
    { id: "asistan", label: "AI Asistan" },
  ];

  const isBrandOrAdmin = ctx.isBrand || ctx.isAdmin;

  return (
    <IletisimShell
      role={ctx.actor.role}
      activeTab="otomasyonlar"
      awaitingHuman={ctx.awaitingHuman}
      banner={ctx.banner}
      isAdmin={ctx.isAdmin}
      activeTenantName={ctx.activeTenantName}
      markaQs={ctx.markaQs}
    >
      {/* Gerçek backend çalışma sırasını gösteren şerit (processor.ts ile birebir uyumlu) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-fg-muted">
          <span className="font-semibold text-fg">Otomatik yanıt sırası:</span>
          <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-fg">1. Yorumdan DM</span>
          <span aria-hidden>→</span>
          <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-fg">2. Anahtar kelime cevabı</span>
          <span aria-hidden>→</span>
          <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-fg">3. AI Asistan</span>
          <span aria-hidden>→</span>
          <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-fg">4. Temsilci</span>
        </div>
        <span className="text-[11px] text-fg-muted">
          Aynı DM&apos;e eşleşen ilk kural cevap verir; eşleşme yoksa temsilciye düşer.
        </span>
      </div>

      {/* Tür filtresi */}
      <nav aria-label="Otomasyon türleri" className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const active = tur === f.id;
          return (
            <Link
              key={f.id}
              href={hrefFor(f.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                active
                  ? "border-fg bg-fg text-bg"
                  : "border-line bg-surface text-fg-muted hover:border-fg/40 hover:text-fg",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {/* 1. Yorumdan DM */}
      {tur === "tumu" || tur === "yorum-dm" ? (
        <section className="flex flex-col gap-3" aria-label="Yorumdan DM">
          <DmAutomationShell
            initialTenantId={ctx.activeTenantId}
            tenantOptions={ctx.visibleTenantOptions}
            initialView="list"
            featureAllowed={ctx.tenantAllowed}
            canAdminExport={ctx.canAdminExport}
          />
        </section>
      ) : null}

      {/* 2. Anahtar kelime cevabı */}
      {tur === "tumu" || tur === "anahtar-kelime" ? (
        <section className="flex flex-col gap-3" aria-label="Anahtar kelime cevabı">
          <InstagramAutoReplyPanel tenantId={ctx.activeTenantId} initialRules={igAutoReplies} />
        </section>
      ) : null}

      {/* 3. AI Asistan */}
      {tur === "tumu" || tur === "asistan" ? (
        <section className="flex flex-col gap-3" aria-label="AI Asistan">
          {isBrandOrAdmin && ctx.activeTenantId !== "ajans" ? (
            <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <BrandAssistants tenantId={ctx.activeTenantId} />
            </div>
          ) : (
            <Card interactive={false} className="flex flex-col gap-2">
              <CardTitle>AI Asistan</CardTitle>
              <p className="text-sm text-fg-muted">
                Creator hesabınızda gelen mesajlarda AI yanıt önerilerini{" "}
                <Link href="/dashboard/iletisim/gelen-kutusu" className="font-medium text-fg underline">
                  Gelen Kutusu
                </Link>{" "}
                içinden tek tıkla kullanabilirsiniz.
              </p>
            </Card>
          )}
        </section>
      ) : null}
    </IletisimShell>
  );
}

