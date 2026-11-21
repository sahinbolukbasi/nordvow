import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { BRAND_NAME, SUPPORT_EMAIL } from "@infulancer/core/brand";
import { SupportForm } from "@/components/support/support-form";
import Link from "next/link";
import { getActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Destek ve yardım" };
export const dynamic = "force-dynamic";

/** Destek ve yardım: hata bildirimi, soru ve istekler. Girişli/girişsiz herkese açık. */
export default async function SupportPage() {
  const tt = await getTT();
  const actor = await getActor();
  const user = actor ? await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }) : null;
  const tickets = actor
    ? await prisma.supportTicket.findMany({ where: { userId: actor.userId }, orderBy: { updatedAt: "desc" }, take: 100 })
    : [];
  const activeTickets = tickets.filter((ticket) => ticket.status !== "KAPANDI");
  const closedTickets = tickets.filter((ticket) => ticket.status === "KAPANDI");
  const statusText = (ticket: (typeof tickets)[number]) =>
    ticket.status === "KAPANDI" ? "Kapandı" : ticket.adminNote ? "Admin yanıtladı" : "Yanıt bekliyor";
  const ticketList = (items: typeof tickets) => items.length ? (
    <div className="flex flex-col gap-3">
      {items.map((ticket) => (
        <article key={ticket.id} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-fg">{ticket.subject}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-fg-muted">{statusText(ticket)}</span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div className="max-w-[90%] self-start rounded-2xl rounded-tl-sm bg-bg px-3 py-2 text-sm text-fg-muted">
              <p className="mb-1 text-[11px] font-medium text-fg-passive">Siz</p>
              <p className="whitespace-pre-line">{ticket.message}</p>
            </div>
          </div>
          {ticket.adminNote ? (
            <div className="mt-2 flex justify-end">
              <div className="max-w-[90%] rounded-2xl rounded-tr-sm border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Admin</p>
              <p className="whitespace-pre-line text-fg">{ticket.adminNote}</p>
              </div>
            </div>
          ) : <p className="mt-2 text-xs text-fg-passive">Admin yanıtı bekleniyor.</p>}
        </article>
      ))}
    </div>
  ) : <p className="rounded-2xl border border-dashed border-line p-5 text-sm text-fg-muted">Bu bölümde talep yok.</p>;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-0">
      <header className="flex flex-col gap-2">
        <h1 className="text-title text-fg">{tt("Destek ve yardım")}</h1>
        <p className="text-sm text-fg-muted">{tt("Bir hatayla mı karşılaştınız veya bir sorunuz mu var? Aşağıdan bize yazın; ekibimiz en kısa sürede dönüş yapar. Dilerseniz doğrudan")}{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-fg underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>{" "}{tt("adresine de yazabilirsiniz.")}</p>
      </header>

      <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold">Talep oluştur</h2>
        <SupportForm defaultName={user?.name ?? ""} defaultEmail={user?.email ?? ""} />
      </section>

      {actor ? (
        <div className="flex flex-col gap-5">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Aktif taleplerim</h2>
            {ticketList(activeTickets)}
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">Kapanmış talepler</h2>
            {ticketList(closedTickets)}
          </section>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
          <span className="text-[13px] font-medium text-fg">{tt("E-posta")}</span>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
          <span className="text-[13px] font-medium text-fg">{tt("Dokümantasyon")}</span>
          <Link href="/docs" className="text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">{tt("Yardım ve rehberler")}</Link>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
          <span className="text-[13px] font-medium text-fg">{tt("Yanıt süresi")}</span>
          <span className="text-[13px] text-fg-muted">{tt("Genellikle 1 iş günü içinde")}</span>
        </div>
      </section>
      <p className="text-[12px] text-fg-passive">{BRAND_NAME}{" "}{tt("destek ekibi · talepleriniz yöneticilere iletilir ve takibe alınır.")}</p>
    </div>
  );
}
