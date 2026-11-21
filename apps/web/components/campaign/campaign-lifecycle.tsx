import { getTT } from "@/lib/i18n/tt-server";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { campaignSetup } from "@infulancer/core/domain/campaign-setup";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/time";

type Stage = { key: string; title: string; detail: string; progress: number; href?: string; alert?: boolean };
const PUBLISHED = new Set(["YAYINLANDI", "METRIK_BEKLIYOR", "TAMAMLANDI"]);

/**
 * 7 aşamalı yatay kampanya zaman çizelgesi:
 * Planlama → Teklif → İçerik → Yayın → Ölçüm → Kapanış → Ödeme
 * + "Sıradaki iş" çağrı kutusu ve md. 23/A uyum uyarısı.
 */
export async function CampaignLifecycle({ campaignId, base }: { campaignId: string; base?: string }) {
  const tt = await getTT();
  const [c, offers] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        status: true,
        startsAt: true,
        endsAt: true,
        closedAt: true,
        reportSummary: true,
        brandPaymentReceivedAt: true,
        assignments: {
          where: { contractStatus: { not: "RED" } },
          select: {
            contractStatus: true,
            deliverables: {
              where: { status: { not: "IPTAL" } },
              select: {
                status: true,
                contractViolation: true,
                updatedAt: true,
                _count: { select: { metricSnapshots: true } },
              },
            },
          },
        },
      },
    }),
    prisma.offer.findMany({
      where: { campaignId },
      select: { status: true },
    }),
  ]);
  if (!c) return null;

  const setup = await campaignSetup(campaignId);
  const planSteps = setup?.steps.filter((s) => s.key !== "yayin") ?? [];
  const planDone = planSteps.filter((s) => s.done).length;

  const totalInvites = Math.max(c.assignments.length, offers.length);
  const acceptedInvites =
    c.assignments.filter((a) => a.contractStatus === "KABUL").length ||
    offers.filter((o) => o.status === "KABUL" || o.status === "KAMPANYAYA_EKLENDI").length;

  const ds = c.assignments.flatMap((a) => a.deliverables);
  const pendingApproval = ds.filter((d) => d.status === "ICERIK_YUKLENDI");
  const revisionRequested = ds.filter((d) => d.status === "REVIZYON");
  const approvedOrPublished = ds.filter((d) => d.status === "ONAYLANDI" || PUBLISHED.has(d.status));
  const published = ds.filter((d) => PUBLISHED.has(d.status));
  const measured = ds.filter((d) => PUBLISHED.has(d.status) && d._count.metricSnapshots > 0);
  const missing23a = ds.filter((d) => d.contractViolation);

  const ratio = (a: number, b: number) => (b ? Math.min(1, a / b) : 0);

  const stages: Stage[] = [
    {
      key: "planlama",
      title: "Planlama",
      detail: `${planDone}/${planSteps.length || 5} tamam`,
      progress: ratio(planDone, planSteps.length || 5),
      href: base ? `${base}/olustur?adim=ozet` : undefined,
    },
    {
      key: "teklif",
      title: "Teklif",
      detail: totalInvites ? `${acceptedInvites}/${totalInvites} kabul` : "Henüz teklif yok",
      progress: ratio(acceptedInvites, totalInvites),
      href: base ? `${base}?sekme=influencerlar` : undefined,
    },
    {
      key: "icerik",
      title: "İçerik",
      detail: pendingApproval.length
        ? `${pendingApproval.length} onay bekliyor`
        : ds.length
          ? `${approvedOrPublished.length}/${ds.length} onaylı`
          : "Taslak bekleniyor",
      progress: ratio(approvedOrPublished.length, ds.length),
      href: base ? `${base}?sekme=teslimler` : undefined,
      alert: pendingApproval.length > 0 || revisionRequested.length > 0,
    },
    {
      key: "yayin",
      title: "Yayın",
      detail: ds.length ? `${published.length}/${ds.length} yayında` : "Planlanmadı",
      progress: ratio(published.length, ds.length),
      href: base ? `${base}?sekme=teslimler` : undefined,
    },
    {
      key: "olcum",
      title: "Ölçüm",
      detail: published.length ? `${measured.length}/${published.length} ölçüldü` : "Yayın bekleniyor",
      progress: ratio(measured.length, published.length),
      href: base ? `${base}?sekme=rapor` : undefined,
    },
    {
      key: "kapanis",
      title: "Kapanış",
      detail: c.status === "KAPANDI" ? "Kapandı ✓" : `Bitiş ${fmtDate(c.endsAt)}`,
      progress: c.status === "KAPANDI" ? 1 : c.reportSummary ? 0.5 : 0,
      href: base,
    },
    {
      key: "odeme",
      title: "Ödeme",
      detail: c.brandPaymentReceivedAt ? "Tamamlandı ✓" : c.status === "KAPANDI" ? "Ödeme bekliyor" : "Onay sonrası serbest",
      progress: c.brandPaymentReceivedAt ? 1 : 0,
      href: base,
    },
  ];

  const activeIdx = c.status === "IPTAL" ? -1 : Math.max(0, stages.findIndex((s) => s.progress < 1));
  const current = activeIdx === -1 ? stages.length - 1 : activeIdx;

  // "Sıradaki iş" tek satırlık aksiyon çağrısı
  let nextActionText: string | null = null;
  let nextActionHref: string | undefined = base;
  if (pendingApproval.length > 0) {
    const oldest = pendingApproval.reduce((min, d) => (d.updatedAt < min ? d.updatedAt : min), pendingApproval[0]!.updatedAt);
    const daysWaiting = Math.max(1, Math.floor((Date.now() - oldest.getTime()) / 86_400_000));
    nextActionText = `${pendingApproval.length} taslak onayınızı bekliyor · en eskisi ${daysWaiting} gündür`;
    nextActionHref = base ? `${base}?sekme=teslimler` : undefined;
  } else if (missing23a.length > 0) {
    nextActionText = `${missing23a.length} içerikte md. 23/A reklam ibaresi eksik · düzeltme isteği gönderin`;
    nextActionHref = base ? `${base}?sekme=uyum` : undefined;
  } else if (c.status === "TASLAK") {
    nextActionText = "Kampanya taslak durumunda · brief ve kısa listeyi kontrol edip onaylı olarak yayınlayabilirsiniz.";
    nextActionHref = base ? `${base}/olustur?adim=ozet` : undefined;
  } else if (totalInvites === 0) {
    nextActionText = "Henüz influencer teklifi gönderilmedi · kısa listenizden onaylı teklif iletin.";
    nextActionHref = base ? `${base}?sekme=influencerlar` : undefined;
  } else if (c.status === "AKTIF" && published.length > 0 && measured.length === published.length && !c.closedAt) {
    nextActionText = "Tüm yayınlar ölçüldü · kapanış kontrol listesini (23/A + metrikler) tamamlayıp kampanyayı kapatabilirsiniz.";
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={tt("Kampanya aşamaları")} className="rounded-3xl border border-line bg-glass p-4 backdrop-blur">
        <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {stages.map((s, i) => {
            const done = s.progress >= 1;
            const active = i === current && !done;
            const body = (
              <>
                <span className="flex items-center gap-2 text-[12px]">
                  <span
                    aria-hidden
                    className={cn(
                      "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      done
                        ? "bg-neon-lime text-black"
                        : s.alert
                          ? "bg-amber-500 text-black"
                          : active
                            ? "bg-neon-pink text-black"
                            : "border border-line-strong text-fg-passive",
                    )}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={cn("truncate", active ? "font-semibold text-fg" : done ? "text-fg" : "text-fg-muted")}>
                    {s.title}
                  </span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-line">
                  <span
                    className={cn("block h-full rounded-full transition-all", done ? "bg-neon-lime" : s.alert ? "bg-amber-500" : "bg-neon")}
                    style={{ width: `${Math.round(s.progress * 100)}%` }}
                  />
                </span>
                <span className="truncate text-[11px] tabular-nums text-fg-muted">{s.detail}</span>
              </>
            );
            const cls = cn(
              "flex flex-col gap-1.5 rounded-2xl p-2 transition-standard",
              active && "bg-surface ring-1 ring-neon-pink/40",
              s.href && "hover:bg-surface-hover",
            );
            return (
              <li key={s.key} aria-current={active ? "step" : undefined}>
                {s.href ? (
                  <Link href={s.href} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {nextActionText ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bg">
              Sıradaki iş
            </span>
            <span className="text-fg">{nextActionText}</span>
          </div>
          {nextActionHref ? (
            <Link href={nextActionHref} className="text-[12px] font-semibold text-fg underline underline-offset-4 hover:opacity-80">
              İncele →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
