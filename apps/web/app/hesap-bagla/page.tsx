import type { Metadata } from "next";
import Link from "next/link";
import { linkChannel } from "@infulancer/core/bot/link";
import { verifyAccountLink } from "@infulancer/core/bot/tokens";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Hesabı bağla" };
export const dynamic = "force-dynamic";

/** Instagram/Messenger sihirli bağlantısı. Oturum açıkken IGSID hesaba yazılır. */
export default async function BindAccountPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const actor = await requireActor();
  const token = (await searchParams).token ?? "";
  const payload = verifyAccountLink(token);
  if (!payload) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-title">Bağlantı geçersiz</h1>
        <p className="mt-3 text-sm text-fg-muted">Süre dolmuş veya imza hatalı. Bottan yeni bağlantı isteyin ya da profildeki 6 haneli kodu gönderin.</p>
        <Link href="/profil" className="mt-4 inline-block underline">Profile dön</Link>
      </main>
    );
  }
  await linkChannel({ channel: payload.channel, externalId: payload.externalId, userId: actor.userId });
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-title">Hesap bağlandı</h1>
      <p className="mt-3 text-sm text-fg-muted">{payload.channel} kimliğiniz Nordvow hesabınıza bağlandı. Sohbete dönüp menü yazabilirsiniz. Ayrıntı: /gizlilik</p>
      <Link href="/profil" className="mt-4 inline-block underline">Profil</Link>
    </main>
  );
}
