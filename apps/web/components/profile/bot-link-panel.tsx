import { prisma } from "@infulancer/core/db";
import { issueLinkCode } from "@infulancer/core/bot/link";
import { unlinkBotChannelAction } from "@/lib/actions/bot";

/** Profilde 6 haneli kod ve bağlı kanallar. Kod 15 dakika geçerlidir. */
export async function BotLinkPanel({ userId }: { userId: string }) {
  const now = new Date();
  const [links, existing] = await Promise.all([
    prisma.channelAccountLink.findMany({ where: { userId, revokedAt: null }, orderBy: { verifiedAt: "desc" } }),
    prisma.botLinkCode.findFirst({ where: { userId, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
  ]);
  const code = existing?.code ?? (await issueLinkCode(userId, now));
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Mesaj botu">
      <h2 className="text-[15px] font-semibold">WhatsApp ve Instagram botu</h2>
      <p className="text-[13px] text-fg-muted">
        WhatsApp’ta kayıtlı telefonunuz eşleşirse hesap otomatik bağlanır. Instagram’da bottan gelen bağlantıyı giriş yapmışken açın veya bu kodu gönderin. Kod 15 dakika geçerlidir. Ayrıntı: /gizlilik
      </p>
      <p className="font-mono text-2xl tracking-[0.3em]">{code}</p>
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
