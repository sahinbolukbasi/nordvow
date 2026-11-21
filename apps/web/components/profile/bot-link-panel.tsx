import { prisma } from "@infulancer/core/db";
import { unlinkBotChannelAction } from "@/lib/actions/bot";
import { LinkCodeButton } from "@/components/profile/link-code-button";

/** Bağlı kanallar ve tek kullanımlık kod. Kod düz metin olarak saklanmaz. */
export async function BotLinkPanel({ userId }: { userId: string }) {
  const links = await prisma.channelAccountLink.findMany({ where: { userId, revokedAt: null }, orderBy: { verifiedAt: "desc" } });
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Mesaj botu">
      <h2 className="text-[15px] font-semibold">WhatsApp ve Instagram botu</h2>
      <p className="text-[13px] text-fg-muted">
        Instagram kullanıcı adınızı ve telefonunuzu girerseniz Nordvow botu sizi otomatik tanır. WhatsApp’ta telefon tek hesapla eşleşirse bağlanır. Instagram kullanıcı adı yalnız öneridir; bağlamak için bu kodu yazın. Aynı numara veya kullanıcı adı iki profildeyse tahmin edilmez. Messenger yalnız kod ve bağlantı ile bağlanır. Ayrıntı: /gizlilik
      </p>
      <LinkCodeButton />
      {links.length === 0 ? <p className="text-[13px] text-fg-passive">Bağlı kanal yok.</p> : (
        <ul className="flex flex-col gap-2 text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3">
              <span>{l.channel} · {l.externalId.slice(0, 6)}…</span>
              <form action={unlinkBotChannelAction}>
                <input type="hidden" name="channel" value={l.channel} />
                <button type="submit" className="text-[13px] underline">Bağlantıyı kaldır</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
