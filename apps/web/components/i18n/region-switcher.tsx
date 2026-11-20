"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LOCALE_LABEL, LOCALES, REGIONS, regionOf, type Locale } from "@infulancer/core/i18n/regions";
import { setRegionAction } from "@/lib/actions/region";
import { idleState } from "@/lib/action-state";
import { usePrefs, useT } from "@/lib/i18n/client";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/cn";

const STORAGE_LOCALE_KEY = "nv_locale_pref";

function writeClientPreference(locale: Locale, country: string) {
  const maxAge = 60 * 60 * 24 * 365;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? ";secure" : "";
  document.cookie = `nv_locale=${encodeURIComponent(locale)};path=/;max-age=${maxAge};samesite=lax${secure}`;
  document.cookie = `nv_country=${encodeURIComponent(country)};path=/;max-age=${maxAge};samesite=lax${secure}`;
  document.cookie = `nv_locale_manual=1;path=/;max-age=${maxAge};samesite=lax${secure}`;
  try {
    localStorage.setItem(STORAGE_LOCALE_KEY, JSON.stringify({ locale, country, manual: true }));
  } catch {
    // depolama kapalı olabilir
  }
}

/** URL /tr/... veya /en/... önekli ise hedef dile çevirir; değilse null döner. */
function targetLocalizedUrl(pathname: string, nextLocale: Locale): string | null {
  if (nextLocale !== "tr" && nextLocale !== "en") return null;
  if (/^\/(tr|en)(?=\/|$)/.test(pathname)) {
    const rest = pathname.replace(/^\/(tr|en)(?=\/|$)/, "") || "";
    const qs = typeof window !== "undefined" ? window.location.search : "";
    return `/${nextLocale}${rest}${qs}`;
  }
  return null;
}

/**
 * Her sayfada görünür Dil (TR / EN) ve Ülke seçici.
 * Kullanıcı elle değiştirdiğinde tercih cookie + localStorage + (varsa) hesap ayarlarına yazılır
 * ve konum algısını her zaman ezer.
 */
export function RegionSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, country } = usePrefs();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loc, setLoc] = useState<Locale>(locale);
  const [cty, setCty] = useState(country);
  const [state, action, pending] = useActionState(setRegionAction, idleState);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  useEffect(() => {
    setLoc(locale);
    setCty(country);
  }, [locale, country]);

  useEffect(() => {
    if (state.ok) {
      writeClientPreference(loc, cty);
      setOpen(false);
      const nextUrl = targetLocalizedUrl(pathname, loc);
      if (nextUrl) {
        router.push(nextUrl);
      } else {
        router.refresh();
      }
    }
  }, [state, router, pathname, loc, cty]);

  const r = regionOf(country);
  const showCountry = r.code.toLowerCase() !== locale.toLowerCase();

  return (
    <div ref={ref} className="relative">
      {/* Tek Dil ve Bölge seçici */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-fg-muted transition-standard hover:bg-surface-hover hover:text-fg",
          compact && "px-1.5",
        )}
        aria-label={`${t("region.title", "Dil ve bölge")}: ${LOCALE_LABEL[locale]}, ${r.nativeName}, ${r.currency}`}
      >
        <span aria-hidden className="text-[13px]">🌐</span>
        <span className="font-medium uppercase">{locale}</span>
        {!compact ? (
          <span className="text-fg-passive">
            {showCountry ? `· ${r.code} ` : ""}· {r.currency}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] sm:hidden"
          />
          <form
            action={action}
            role="dialog"
            aria-label={t("region.title", "Dil ve bölge")}
            className="animate-modal-in fixed inset-x-4 top-16 z-50 mx-auto flex w-auto max-w-[280px] flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-xl sm:absolute sm:inset-auto sm:top-auto sm:right-0 sm:mx-0 sm:mt-2 sm:w-64 sm:rounded-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-fg">{t("region.title", "Dil ve bölge")}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
                aria-label={t("close", "Kapat")}
              >
                ✕
              </button>
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              {t("region.language", "Dil")}
              <select
                name="locale"
                value={loc}
                onChange={(e) => setLoc(e.target.value as Locale)}
                className="h-8 rounded-lg border border-border bg-bg px-2 text-xs text-fg"
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              {t("region.country", "Ülke")}
              <select
                name="country"
                value={cty}
                onChange={(e) => setCty(e.target.value)}
                className="h-8 rounded-lg border border-border bg-bg px-2 text-xs text-fg"
              >
                {REGIONS.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.nativeName} ({x.code}) · {x.currency}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] leading-snug text-fg-passive">
              {t("region.note", "Tutarlar ülkenin para birimiyle gösterilir. Ham IP saklanmaz.")}
            </p>
            {state.error ? (
              <p role="alert" className="text-[11px] text-critical">
                {state.error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="h-8 rounded-full bg-fg text-xs font-semibold text-bg disabled:opacity-50"
            >
              {t("region.save", "Kaydet")}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
