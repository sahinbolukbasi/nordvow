"use client";
import { startTransition, useActionState, useRef, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status";
import { idleState } from "@/lib/action-state";
import { testAssistantAction, quickSetupAssistantAction, type AssistantTestState } from "@/lib/actions/assistant-test";
import {
  approveKnowledgeDraftAction,
  promoteUnansweredQuestionAction,
  rejectKnowledgeDraftAction,
  seedKnowledgeDraftsAction,
} from "@/lib/actions/channels";

type Option = { key: string; name: string };

/** Hızlı kurulum: bir şablonu seçip tonunu belirleyip tek adımda açar. */
export function QuickSetup({ options, tenantId }: { options: Option[]; tenantId?: string }) {
  return (
    <Card interactive={false} className="flex flex-col gap-3">
      <CardTitle>Hızlı kurulum</CardTitle>
      <p className="text-[13px] text-fg-muted">Bir asistan şablonu seçin, tonunu belirleyin, tek adımda WhatsApp ve Instagram&apos;da açılsın. İnce ayarı sonra &quot;Ayarları düzenle&quot;den yapabilirsiniz.</p>
      <ActionForm action={quickSetupAssistantAction} submitLabel="Aç ve kaydet" aria-label="Hızlı kurulum">
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Asistan">
            {(p) => (
              <Select {...p} name="agentId" defaultValue={options[0]?.key}>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ton">
            {(p) => (
              <Select {...p} name="tone" defaultValue="samimi">
                <option value="samimi">Samimi</option>
                <option value="profesyonel">Profesyonel</option>
                <option value="kisa">Kısa ve net</option>
              </Select>
            )}
          </Field>
        </div>
      </ActionForm>
    </Card>
  );
}

/** Test ekranı: bir mesaj yazın, asistanın üreteceği yanıtı (yan etkisiz) görün. */
export function AssistantTester({ options, tenantId }: { options: Option[]; tenantId?: string }) {
  const [state, formAction, pending] = useActionState<AssistantTestState, FormData>(testAssistantAction, idleState);
  const ref = useRef<HTMLFormElement>(null);
  const r = state.result;
  return (
    <Card interactive={false} className="flex flex-col gap-3">
      <CardTitle>Test ekranı</CardTitle>
      <p className="text-[13px] text-fg-muted">Müşteri gibi yazın; asistanın kayıtlı ayarlarınızla ne cevaplayacağını görün. Burada gönderilen mesajlar gerçek alıcıya gitmez, kayda geçmez.</p>
      <form
        ref={ref}
        aria-label="Asistan testi"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
          <Field label="Hangi asistan">
            {(p) => (
              <Select {...p} name="agentId" defaultValue={options[0]?.key}>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Müşteri mesajı">
            {(p) => <Input {...p} name="message" placeholder="Örn. Kargom ne zaman gelir?" />}
          </Field>
        </div>
        {state.error ? (
          <p role="alert" className="text-[13px] text-critical">
            {state.error}
          </p>
        ) : null}
        <div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Deneniyor…" : "Dene"}
          </Button>
        </div>
      </form>

      {state.notConfigured && state.message ? (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-300">
          {state.message}
        </p>
      ) : null}

      {r ? (
        <div className="flex flex-col gap-3 rounded-[8px] border border-border p-4" aria-live="polite">
          {state.question ? (
            <div className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-glass px-3 py-2 text-sm">{state.question}</div>
          ) : null}
          {r.botText ? (
            <div className="self-start max-w-[85%] rounded-2xl rounded-bl-sm border border-line px-3 py-2 text-sm">{r.botText}</div>
          ) : (
            <p className="text-[13px] text-fg-passive">Asistan sessiz kaldı; konuşma mesai dışında sessizce temsilci kuyruğuna alınır.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
              Niyet: {r.intentLabel}
            </span>
            {r.decision.kind === "reply" ? (
              <StatusDot tone="active">Asistan yanıtladı · güven %{Math.round(r.decision.confidence * 100)}</StatusDot>
            ) : r.decision.kind === "handoff" ? (
              <StatusDot tone="passive">Temsilciye aktarılır · {r.handoffLabel}</StatusDot>
            ) : (
              <StatusDot tone="muted">Yanıt üretilmedi</StatusDot>
            )}
            {r.outOfHours ? <span className="text-fg-muted">Mesai dışı</span> : null}
          </div>
          {r.sources?.length ? (
            <p className="text-[12px] text-fg-muted">
              <strong className="font-medium text-fg">Kaynak:</strong>{" "}
              {r.sources.map((s) => `${s.title} (%${Math.round(s.confidence * 100)})`).join(" · ")}
            </p>
          ) : null}
          {r.usedKnowledge.length ? (
            <details className="text-[12px] text-fg-muted">
              <summary className="cursor-pointer">Kullanılan onaylı bilgi parçaları ({r.usedKnowledge.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {r.usedKnowledge.map((h, i) => (
                  <li key={i} className="rounded border border-line px-2 py-1">
                    {h.sourceTitle ? <strong>{h.sourceTitle}</strong> : null}{" "}
                    (%{Math.round(h.confidence * 100)}) · {h.content.slice(0, 140)}
                    {h.content.length > 140 ? "…" : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : r.decision.kind === "handoff" ? (
            <p className="text-[12px] text-fg-passive">Onaylı bilgi tabanında eşleşme bulunamadı; asistan rakam uydurmadan temsilciye aktardı.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** 3 kaynaktan (marka profili, aktif kampanyalar, web sitesi) taslak bilgi tabanı tohumlayıcısı. */
export function KnowledgeAutoSeedForm({ tenantId }: { tenantId: string }) {
  return (
    <ActionForm
      action={seedKnowledgeDraftsAction}
      submitLabel="3 kaynaktan taslak oluştur"
      submitSize="sm"
      submitVariant="secondary"
      aria-label="Otomatik bilgi tabanı oluştur"
      className="rounded-xl border border-line bg-surface-muted/30 p-3"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <p className="text-[12px] text-fg-muted">
        Marka profili, aktif kampanyalar ve (isteğe bağlı) marka web sitenizdeki SSS/kargo/iade sayfalarından taslak maddeler üretilir. Onaylamadığınız hiçbir madde yanıtta kullanılmaz.
      </p>
      <Field label="Marka web sitesi (isteğe bağlı — yalnızca bu alan adı ve robots.txt uyumlu taranır)">
        {(p) => <Input {...p} name="websiteUrl" type="url" placeholder="https://markaniz.com" />}
      </Field>
    </ActionForm>
  );
}

/** Onay bekleyen taslak bilgi tabanı maddesi (düzenle + onayla veya reddet). */
export function KnowledgeDraftReviewItem({
  tenantId,
  sourceId,
  title,
  initialText,
}: {
  tenantId: string;
  sourceId: string;
  title: string;
  initialText: string;
}) {
  const [text, setText] = useState(initialText);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg">{title}</span>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">
          Taslak · Onay bekliyor
        </span>
      </div>
      <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <ActionForm action={approveKnowledgeDraftAction} submitLabel="Onayla ve aktif et" submitSize="sm" submitVariant="primary">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="sourceId" value={sourceId} />
          <input type="hidden" name="text" value={text} />
        </ActionForm>
        <ActionForm action={rejectKnowledgeDraftAction} submitLabel="Reddet" submitSize="sm" submitVariant="ghost">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="sourceId" value={sourceId} />
        </ActionForm>
      </div>
    </li>
  );
}

/** Cevapsız kalan soru satırı + tek tıkla "Bilgi tabanına ekle". */
export function UnansweredQuestionRow({
  tenantId,
  question,
  count,
}: {
  tenantId: string;
  question: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-fg">
          {question} <span className="text-[11px] text-fg-passive">({count}×)</span>
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Kapat" : "Bilgi tabanına ekle"}
        </Button>
      </div>
      {open ? (
        <ActionForm action={promoteUnansweredQuestionAction} submitLabel="Kaydet ve onayla" submitSize="sm" resetOnSuccess>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="question" value={question} />
          <Field label="Onaylı yanıt">
            {(p) => <Textarea {...p} name="answer" rows={2} required placeholder="Bu soruya verilecek kesin ve onaylı yanıtı yazın…" />}
          </Field>
        </ActionForm>
      ) : null}
    </li>
  );
}
