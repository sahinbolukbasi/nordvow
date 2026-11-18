import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { getEventPartnerIds } from "@infulancer/core/events/partners";
import { mapLinks } from "@infulancer/core/wallet/maps";
import { googleCalendarUrl } from "@infulancer/core/wallet/ical";
import { DateBadge, InfoRow, PersonIcon, PinIcon, Pill } from "@/components/luma/primitives";
import { dateLong, rangeLabel } from "@/lib/event-format";
import { resolveEventByParam } from "@/lib/event-lookup";
import { getActor } from "@/lib/auth-guard";
import { mediaSrc } from "@/lib/media";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const resolvedId = await resolveEventByParam(id);
  const e = resolvedId ? await prisma.event.findUnique({ where: { id: resolvedId }, select: { title: true } }) : null;
  return { title: e?.title ?? "Etkinlik" };
}

/** Herkese açık etkinlik sayfası (Luma düzeni). Sol alt köşede katılacak kişiler listesi gösterilir. */
export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const tt = await getTT();
  const { id } = await params;
  const resolvedId = await resolveEventByParam(id);
  if (!resolvedId) notFound();
  const e = await prisma.event.findUnique({
    where: { id: resolvedId },
    include: {
      tickets: {
        where: { status: { not: "IPTAL" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          holderName: true,
          status: true,
          invite: { select: { influencerId: true } },
        },
      },
    },
  });
  if (!e) notFound();
  const attendeeInfIds = e.tickets.map((t) => t.invite?.influencerId).filter((x): x is string => !!x);
  const [brand, partnerIds, actor, attendeeInfs] = await Promise.all([
    e.tenantId ? prisma.brand.findUnique({ where: { id: e.tenantId }, select: { name: true } }) : null,
    getEventPartnerIds(e.id),
    getActor().catch(() => null),
    attendeeInfIds.length
      ? prisma.influencer.findMany({
          where: { id: { in: attendeeInfIds } },
          select: { id: true, name: true, category: true },
        })
      : Promise.resolve([]),
  ]);
  const infMap = new Map(attendeeInfs.map((i) => [i.id, i]));
  const attendees = e.tickets.map((t) => {
    const inf = t.invite?.influencerId ? infMap.get(t.invite.influencerId) : null;
    return {
      id: t.id,
      name: inf?.name ?? t.holderName,
      category: inf?.category ?? null,
      checkedIn: t.status === "KULLANILDI",
    };
  });
  const partnerBrands = partnerIds.length
    ? await prisma.brand.findMany({ where: { id: { in: partnerIds } }, orderBy: { name: "asc" }, select: { name: true } })
    : [];
  const myInvite = actor?.influencerId ? await prisma.eventInvite.findFirst({ where: { eventId: e.id, influencerId: actor.influencerId }, include: { ticket: true } }) : null;
  const organizer = [brand?.name ?? BRAND_NAME, ...partnerBrands.map((b) => b.name)].join(" × ");
  const cover = mediaSrc(e.coverImageKey);
  const gallery = (e.imageKeys ?? []).map((k) => mediaSrc(k)).filter((x): x is string => !!x);
  const map = mapLinks({ latitude: e.latitude, longitude: e.longitude, address: e.address, venueName: e.venueName });
  const location = [e.venueName, e.address, e.city].filter(Boolean).join(", ");
  const gcal = googleCalendarUrl({ uid: e.id, title: e.title, description: e.description, location: location || null, startsAt: e.startsAt, endsAt: e.endsAt });
  const past = (e.endsAt ?? e.startsAt) < new Date();
  const full = e.capacity != null && e.tickets.length >= e.capacity;
  const myTicket = myInvite?.ticket && myInvite.ticket.status !== "IPTAL" ? myInvite.ticket : null;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-4 py-10 md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5">
          <div className="aspect-square w-full overflow-hidden rounded-3xl border border-line">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt={`${e.title} kapak görseli`} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(135deg,var(--color-neon-violet),var(--color-neon-pink))] opacity-85" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="border-b border-line pb-2 text-[13px] font-medium text-fg-muted">{tt("Düzenleyen")}</span>
            <span className="flex items-center gap-2 font-medium text-fg">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-hover text-[12px] font-semibold" aria-hidden>{organizer.slice(0, 1).toLocaleUpperCase("tr")}</span>
              {organizer}
            </span>
          </div>
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label={tt("Katılacak kişiler")}>
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-[13px] font-medium text-fg-muted">{tt("Katılacak Kişiler")}</span>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-fg">{attendees.length}</span>
            </div>
            {attendees.length === 0 ? (
              <p className="text-[12px] text-fg-muted">{tt("Henüz onaylanan katılımcı yok.")}</p>
            ) : (
              <>
                <div className="flex -space-x-2 overflow-hidden">
                  {attendees.slice(0, 8).map((a) => (
                    <span
                      key={a.id}
                      title={a.name}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-surface-hover text-[11px] font-semibold text-fg"
                    >
                      {a.name.slice(0, 1).toLocaleUpperCase("tr")}
                    </span>
                  ))}
                  {attendees.length > 8 ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-fg text-[10px] font-semibold text-bg">
                      +{attendees.length - 8}
                    </span>
                  ) : null}
                </div>
                <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto pr-1 text-[13px]">
                  {attendees.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-semibold text-fg" aria-hidden>
                          {a.name.slice(0, 1).toLocaleUpperCase("tr")}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">{a.name}</p>
                          {a.category ? <p className="truncate text-[11px] text-fg-muted">{a.category}</p> : null}
                        </div>
                      </div>
                      {a.checkedIn ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          {tt("Geldi")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </aside>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Pill>{e.visibility === "HERKESE_ACIK" ? tt("Herkese açık") : tt("Davetli etkinlik")}</Pill>
              {e.status === "TASLAK" ? <Pill tone="amber">{tt("Taslak · henüz yayınlanmadı")}</Pill> : past ? <Pill tone="gray">{tt("Sona erdi")}</Pill> : e.status === "IPTAL" ? <Pill tone="red">{tt("İptal edildi")}</Pill> : null}
            </div>
            <h1 className="text-[34px] font-semibold leading-tight tracking-tight text-fg">{e.title}</h1>
          </div>

          <div className="flex flex-col gap-4">
            <InfoRow icon={<DateBadge date={e.startsAt} size="sm" />} title={rangeLabel(e.startsAt, e.endsAt)}>{dateLong(e.startsAt)}</InfoRow>
            <InfoRow icon={<PinIcon />} title={e.venueName || tt("Konum")}>{[e.address, e.city].filter(Boolean).join(", ") || tt("Ayrıntılar davetlilerle paylaşılır")}</InfoRow>
            <InfoRow icon={<PersonIcon />} title={e.capacity ? `${e.tickets.length}/${e.capacity} yer dolu` : tt("Sınırsız katılım")}>{full ? tt("Kapasite doldu") : null}</InfoRow>
          </div>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" aria-label={tt("Katılım")}>
            <h2 className="text-[13px] font-medium text-fg-muted">{tt("Katılım")}</h2>
            {myTicket ? (
              <>
                <p className="font-medium text-fg">{tt("Katılıyorsunuz. Biletiniz hazır.")}</p>
                <Link href={`/bilet/${myTicket.id}`} target="_blank" rel="noopener noreferrer" className="w-fit rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90">{tt("Biletimi göster")}</Link>
              </>
            ) : myInvite ? (
              <>
                <p className="text-fg">{tt("Bu etkinliğe davetlisiniz.")}</p>
                <Link href="/influencer/davetlerim" className="w-fit rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90">{tt("Katılımımı bildir")}</Link>
              </>
            ) : (
              <p className="text-[14px] text-fg-muted">{e.visibility === "KAPALI" ? tt("Bu etkinliğe katılım davet iledir. Davetliyseniz bilet bağlantınızı kullanın.") : tt("Katılmak için düzenleyenin davetini bekleyin ya da hesabınızdan iletişime geçin.")}</p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3 text-[13px]">
              <a href={gcal} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-fg hover:border-line-strong">{tt("Google Takvim")}</a>
              <a href={`/api/etkinlik/${e.id}/ics`} className="rounded-full border border-line px-3 py-1.5 text-fg hover:border-line-strong">{tt("Apple / Outlook")}</a>
            </div>
          </section>

          <section className="flex flex-col gap-2" aria-label={tt("Etkinlik hakkında")}>
            <h2 className="border-b border-line pb-2 text-[13px] font-medium text-fg-muted">{tt("Hakkında")}</h2>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg">{e.description}</p>
          </section>

          {gallery.length ? (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={tt("Galeri")}>
              {gallery.map((g, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={g} alt={`Galeri görseli ${i + 1}`} loading="lazy" decoding="async" className="aspect-square w-full rounded-2xl object-cover" />
              ))}
            </section>
          ) : null}

          {map.hasCoords || e.address ? (
            <section className="flex flex-col gap-3" aria-label={tt("Konum")}>
              <h2 className="border-b border-line pb-2 text-[13px] font-medium text-fg-muted">{tt("Konum")}</h2>
              {location ? <p className="text-[14px] text-fg">{location}</p> : null}
              {map.osmEmbed ? <iframe title={tt("Etkinlik konumu haritası")} src={map.osmEmbed} className="h-60 w-full rounded-2xl border border-line" loading="lazy" /> : null}
              <div className="flex flex-wrap gap-2 text-[13px]">
                <a href={map.google} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-fg hover:border-line-strong">{tt("Google Haritalar'da aç")}</a>
                <a href={map.apple} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-fg hover:border-line-strong">{tt("Apple Haritalar'da aç")}</a>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
