import Link from "next/link";
import { LEGAL_UPDATED, LEGAL_VERSION } from "@infulancer/core/legal/acceptance";
import { getPreferences } from "@/lib/i18n/server";
import { getLegalEntity } from "@/lib/legal";
import { LEGAL_NAV } from "@/lib/legal/catalog";
import { identityIntro, identityLines, identityTitle } from "@/lib/legal/identity";
import { PACK_EN } from "@/lib/legal/pack-en";
import { PACK_TR } from "@/lib/legal/pack-tr";
import type { Block, LegalDocId, LegalLang } from "@/lib/legal/types";

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.p) return <p key={i}>{b.p}</p>;
        if (b.ul) return <ul key={i}>{b.ul.map((item) => <li key={item}>{item}</li>)}</ul>;
        if (b.ol) return <ol key={i}>{b.ol.map((item) => <li key={item}>{item}</li>)}</ol>;
        return null;
      })}
    </>
  );
}

/** Herkese açık yasal sayfa. Türkçe bağlayıcıdır; diğer dillerde İngilizce bilgi metni gösterilir. */
export async function LegalPage({ id, current }: { id: LegalDocId; current: string }) {
  const { locale } = await getPreferences();
  const lang: LegalLang = locale === "tr" ? "tr" : "en";
  const entity = await getLegalEntity();
  const doc = (lang === "tr" ? PACK_TR : PACK_EN)[id];
  const lines = identityLines(entity);
  return (
    <div className="grid grid-cols-1 gap-10 py-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:self-start lg:overflow-y-auto">
        <nav aria-label={lang === "tr" ? "Yasal belgeler" : "Legal documents"} className="flex flex-col gap-1 text-sm">
          {LEGAL_NAV.map((d) => (
            <Link key={d.href} href={d.href} aria-current={d.href === current ? "page" : undefined} className={`rounded-lg px-3 py-2 ${d.href === current ? "bg-surface font-medium text-fg" : "text-fg-muted hover:text-fg"}`}>
              {lang === "tr" ? d.tr : d.en}
            </Link>
          ))}
        </nav>
      </aside>
      <article className="flex max-w-3xl flex-col gap-8 leading-relaxed">
        <header className="flex flex-col gap-3 border-b border-line pb-6">
          <p className="text-[12px] font-medium tracking-wide text-fg-passive uppercase">{lang === "tr" ? "Taslak · avukat incelemesi gerekir" : "Draft · lawyer review required"}</p>
          <h1 className="text-[34px] font-semibold tracking-tight">{doc.title}</h1>
          <p className="text-[13px] text-fg-passive">
            {lang === "tr" ? "Son güncelleme" : "Last updated"}: {LEGAL_UPDATED} · {lang === "tr" ? "Sürüm" : "Version"} {LEGAL_VERSION}
          </p>
          {lang !== "tr" ? <p className="text-[13px] text-fg-muted">The Turkish version is the binding text. This English text is for information.</p> : null}
          <p className="text-[15px] text-fg-muted">{identityIntro(lang)}</p>
          <div className="text-[15px] text-fg-muted">{doc.intro}</div>
        </header>
        <section id="kimlik" className="flex scroll-mt-20 flex-col gap-3 text-[15px]">
          <h2 className="text-lg font-semibold">1. {identityTitle(lang)}</h2>
          <ul className="flex flex-col gap-1 text-fg-muted">
            {lines.map((line) => <li key={line} className="ml-5 list-disc">{line}</li>)}
          </ul>
        </section>
        {doc.sections.map((s, i) => (
          <section key={s.id} id={s.id} className="flex scroll-mt-20 flex-col gap-3 text-[15px] [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_strong]:text-fg">
            <h2 className="text-lg font-semibold">{i + 2}. {s.title}</h2>
            <div className="flex flex-col gap-3 text-fg-muted"><Blocks blocks={s.blocks} /></div>
          </section>
        ))}
        <footer className="rounded-2xl border border-line bg-glass p-5 text-[14px] text-fg-muted">
          <p className="font-medium text-fg">{entity.title || "[Şirket unvanı]"}</p>
          <p>{entity.address || "[Merkez adresi]"}</p>
          <p>
            {lang === "tr" ? "Destek" : "Support"}: <a className="underline underline-offset-4" href={`mailto:${entity.email}`}>{entity.email || "[Destek e-postası]"}</a>
            {" · "}KVKK: <a className="underline underline-offset-4" href={`mailto:${entity.kvkkEmail}`}>{entity.kvkkEmail || "[KVKK başvuru e-postası]"}</a>
            {entity.kep ? ` · KEP: ${entity.kep}` : " · KEP: [KEP adresi]"}
          </p>
        </footer>
      </article>
    </div>
  );
}
