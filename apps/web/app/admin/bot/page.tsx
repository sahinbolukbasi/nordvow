import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { META_BOT_TEMPLATES } from "@infulancer/core/bot/window-plan";
import { MENU_BUTTONS_TR } from "@infulancer/core/bot/menu";
import { saveBotSettingsAction } from "@/lib/actions/bot";
import { requireAdmin } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Platform botu" };
export const dynamic = "force-dynamic";

export default async function AdminBotPage() {
  await requireAdmin();
  const [settings, links, calls] = await Promise.all([
    prisma.botSettings.findUnique({ where: { id: "default" } }),
    prisma.channelAccountLink.count({ where: { revokedAt: null } }),
    prisma.botToolCall.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Platform botu" description="WhatsApp, Instagram ve Messenger’da Nordvow hesabı. Bağlı olmayan kişi yalnız herkese açık bilgi görür." />
      <p className="text-sm text-fg-muted">{links} bağlı hesap. Menü: {MENU_BUTTONS_TR.join(" · ")}</p>
      <form action={saveBotSettingsAction} className="grid max-w-xl grid-cols-1 gap-3 rounded-2xl border border-line bg-surface p-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="whatsapp" defaultChecked={settings?.whatsappEnabled} /> WhatsApp açık</label>
        <label className="flex flex-col gap-1">Telefon numarası kimliği<input name="waId" defaultValue={settings?.whatsappPhoneNumberId ?? ""} className="rounded-lg border border-line px-3 py-2" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="instagram" defaultChecked={settings?.instagramEnabled} /> Instagram açık</label>
        <label className="flex flex-col gap-1">IG kullanıcı kimliği<input name="igId" defaultValue={settings?.igUserId ?? ""} className="rounded-lg border border-line px-3 py-2" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="messenger" defaultChecked={settings?.messengerEnabled} /> Messenger açık</label>
        <label className="flex flex-col gap-1">Sayfa kimliği<input name="pageId" defaultValue={settings?.pageId ?? ""} className="rounded-lg border border-line px-3 py-2" /></label>
        <label className="flex flex-col gap-1">Karşılama (TR)<textarea name="welcomeTr" rows={3} defaultValue={settings?.welcomeTr ?? ""} className="rounded-lg border border-line px-3 py-2" /></label>
        <label className="flex flex-col gap-1">Karşılama (EN)<textarea name="welcomeEn" rows={3} defaultValue={settings?.welcomeEn ?? ""} className="rounded-lg border border-line px-3 py-2" /></label>
        <button type="submit" className="h-9 rounded-full bg-fg px-4 text-bg">Kaydet</button>
      </form>
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">Son araç çağrıları</h2>
        <ul className="text-[13px] text-fg-muted">
          {calls.map((c) => <li key={c.id}>{c.createdAt.toISOString().slice(0, 16)} · {c.channel} · {c.tool} · {c.ok ? "tamam" : "hata"}</li>)}
          {calls.length === 0 ? <li>Henüz çağrı yok.</li> : null}
        </ul>
      </section>
      <section className="flex flex-col gap-2 text-[13px] text-fg-muted">
        <h2 className="text-[15px] font-semibold text-fg">Meta’ya gönderilecek utility şablonlar</h2>
        <ul>{META_BOT_TEMPLATES.map((t) => <li key={t.key}><strong>{t.name}</strong> — {t.body}</li>)}</ul>
      </section>
    </div>
  );
}
