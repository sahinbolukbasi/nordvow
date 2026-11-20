"use client";
import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { saveNotificationRuleAction, saveTemplateAction, sendAnnouncementAction, createShortLinkAction } from "@/lib/actions/notify-admin";

const CHANNELS: { key: string; label: string }[] = [
  { key: "INAPP", label: "Sistem içi" },
  { key: "EMAIL", label: "E-posta" },
  { key: "WHATSAPP", label: "WhatsApp" },
  { key: "INSTAGRAM", label: "Instagram" },
];

/** Olay → kanal kuralı (hangi kanallardan gönderilsin). */
export function RuleForm({ eventKey, active, enabled }: { eventKey: string; active: string[]; enabled: boolean }) {
  const tt = useTT();
  return (
    <ActionForm action={saveNotificationRuleAction} submitLabel={tt("Kaydet")} submitSize="sm" aria-label={`${eventKey} kuralı`} className="gap-2">
      <input type="hidden" name="eventKey" value={eventKey} />
      <div className="flex flex-wrap items-center gap-3">
        {CHANNELS.map((c) => (
          <label key={c.key} className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" name="channels" value={c.key} defaultChecked={active.includes(c.key)} className="h-4 w-4 accent-[var(--color-fg)]" />
            {c.label}
          </label>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-fg-muted">
          <input type="checkbox" name="enabled" value="true" defaultChecked={enabled} className="h-4 w-4 accent-[var(--color-fg)]" />{tt("Aktif")}</label>
      </div>
    </ActionForm>
  );
}

/** Olay+kanal şablonu düzenleme. */
export function TemplateForm({ eventKey, channel, subject, body, vars }: { eventKey: string; channel: string; subject: string | null; body: string; vars: string[] }) {
  const tt = useTT();
  return (
    <ActionForm action={saveTemplateAction} submitLabel={tt("Şablonu kaydet")} submitSize="sm" aria-label={`${eventKey} ${channel} şablonu`} className="gap-2">
      <input type="hidden" name="eventKey" value={eventKey} />
      <input type="hidden" name="channel" value={channel} />
      {channel === "EMAIL" ? <Field label={tt("Konu")}>{(p) => <Input {...p} name="subject" defaultValue={subject ?? ""} />}</Field> : <input type="hidden" name="subject" value={subject ?? ""} />}
      <Field label={`Metin (${channel})`} hint={`Değişkenler: ${vars.map((v) => `{{${v}}}`).join(" ")}`}>
        {(p) => <Textarea {...p} name="body" rows={3} defaultValue={body} />}
      </Field>
    </ActionForm>
  );
}

/** Özel duyuru, giriş pop-up'ı ve AWS SES toplu e-posta gönderimi. */
export function AnnouncementForm() {
  const tt = useTT();
  const [audience, setAudience] = useState("all");
  return (
    <ActionForm action={sendAnnouncementAction} submitLabel={tt("Bildirim / Pop-up / E-posta Gönder")} resetOnSuccess aria-label={tt("Özel duyuru")}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={tt("Hedef kitle")}>
          {(p) => (
            <Select {...p} name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="all">{tt("Tüm aktif kullanıcılar")}</option>
              <option value="influencers">{tt("Tüm Influencerlar")}</option>
              <option value="brands">{tt("Tüm Markalar")}</option>
              <option value="agency">{tt("Ajans & Admin ekibi")}</option>
              <option value="single">{tt("Tekil kullanıcı (e-posta ile)")}</option>
            </Select>
          )}
        </Field>
        {audience === "single" ? (
          <Field label={tt("Kullanıcı e-postası")}>
            {(p) => <Input {...p} name="targetEmail" type="email" required placeholder="kullanici@ornek.com" />}
          </Field>
        ) : (
          <Field label={tt("Başlık / Konu")}>
            {(p) => <Input {...p} name="title" required placeholder={tt("Örn. Yeni Kampanya Dönemi Duyurusu")} />}
          </Field>
        )}
      </div>
      {audience === "single" ? (
        <Field label={tt("Başlık / Konu")}>
          {(p) => <Input {...p} name="title" required placeholder={tt("Örn. Hesabınız Hakkında Bilgilendirme")} />}
        </Field>
      ) : null}
      <Field label={tt("Mesaj")}>
        {(p) => <Textarea {...p} name="message" rows={4} required placeholder={tt("Bildirim, pop-up ve e-posta içeriği…")} />}
      </Field>
      <Field label={tt("Yönlendirme bağlantısı (opsiyonel)")}>
        {(p) => <Input {...p} name="link" placeholder="/kampanyalar veya https://nordvow.com/..." />}
      </Field>
      <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-bg/50 px-4 py-3 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="sendInApp" value="1" defaultChecked className="h-4 w-4 accent-[var(--color-fg)]" />
          {tt("Panel bildirim kutusuna at")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="sendPopup" value="1" defaultChecked className="h-4 w-4 accent-[var(--color-fg)]" />
          {tt("Giriş yapınca pop-up olarak göster")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="sendEmail" value="1" defaultChecked className="h-4 w-4 accent-[var(--color-fg)]" />
          {tt("Kayıtlı e-postaya toplu mail gönder (AWS SES)")}
        </label>
      </div>
    </ActionForm>
  );
}

/** Kısa link oluşturma. */
export function ShortLinkForm() {
  const tt = useTT();
  return (
    <ActionForm action={createShortLinkAction} submitLabel={tt("Kısalt")} resetOnSuccess aria-label={tt("Link kısalt")}>
      <Field label={tt("Hedef URL")}>{(p) => <Input {...p} name="url" required placeholder="https://uzun-link…" />}</Field>
      <Field label={tt("Etiket (opsiyonel)")}>{(p) => <Input {...p} name="label" placeholder={tt("Yaz kampanyası")} />}</Field>
    </ActionForm>
  );
}
