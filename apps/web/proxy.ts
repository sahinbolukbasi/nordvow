import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import {
  extractCountryFromHeaders,
  isSearchBot,
  lookupCountryByIp,
  resolveLocaleAndCountry,
} from "@infulancer/core/i18n/geo";
import { roleHome } from "./lib/roles";
import { clearAuthCookies } from "./lib/auth-cookies";
import { isPublicPath } from "./lib/public-paths";

const { auth } = NextAuth(authConfig);

/** Konuma göre /tr/... veya /en/... yönlendirmesi yapılacak herkese açık SEO rotaları. */
const LOCALIZED_REDIRECT_EXACT = new Set([
  "/",
  "/blog",
  "/destek",
  "/gizlilik",
  "/kullanim-kosullari",
  "/kvkk",
  "/cerez-politikasi",
]);

function isLocalizedRedirectPath(pathname: string): boolean {
  if (LOCALIZED_REDIRECT_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/blog/") || pathname.startsWith("/etkinlik/")) return true;
  return false;
}

const LANDING = "/";
const URL_LOCALE_RE = /^\/(tr|en)(?=\/|$)/;

function stripUrlLocale(pathname: string): { urlLocale: "tr" | "en" | null; stripped: string } {
  const m = URL_LOCALE_RE.exec(pathname);
  if (!m) return { urlLocale: null, stripped: pathname };
  const rest = pathname.slice(m[0].length) || "/";
  return { urlLocale: m[1] as "tr" | "en", stripped: rest.startsWith("/") ? rest : `/${rest}` };
}

function cookieOpts() {
  return {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function buildRequestHeaders(
  req: NextRequest,
  meta: { pathname: string; locale: string; country: string },
): Headers {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", meta.pathname);
  requestHeaders.set("x-locale", meta.locale);
  requestHeaders.set("x-detected-country", meta.country);
  return requestHeaders;
}

function attachLocaleHeadersAndCookies(
  req: NextRequest,
  res: NextResponse,
  meta: { locale: string; country: string; isManualOrUrl: boolean },
): NextResponse {
  res.headers.set("x-locale", meta.locale);
  res.headers.set("x-detected-country", meta.country);
  const opts = cookieOpts();
  if (meta.isManualOrUrl || req.cookies.get("nv_locale")?.value !== meta.locale) {
    res.cookies.set("nv_locale", meta.locale, opts);
  }
  if (!req.cookies.get("nv_country")?.value || req.cookies.get("nv_country")?.value !== meta.country) {
    res.cookies.set("nv_country", meta.country, opts);
  }
  return res;
}

export default function proxy(rawReq: NextRequest, ctx: unknown) {
  // NextAuth'un reqWithEnvURL sarmalayıcısı AUTH_URL (ör. https://nordvow.com) tanımlıysa
  // req.nextUrl.origin'i dış alan adıyla değiştirir. Next.js dahili sunucusu (-H 0.0.0.0 -p 3000)
  // ise NextResponse.rewrite hedefini kendi initUrl origin'i (rawReq.nextUrl.origin) ile karşılaştırır;
  // origin farklıysa dahili rewrite yerine dış HTTP proxy isteği atıp sonsuz 307 döngüsüne girer.
  // Bu nedenle dahili rewrite hedefi her zaman ham (rawReq) origin üzerinden üretilir.
  const internalBaseUrl = rawReq.nextUrl;

  const handler = auth(async (req) => {
    const { pathname, search } = req.nextUrl;
    const user = req.auth?.user;
    const userAgent = req.headers.get("user-agent");
    const isBot = isSearchBot(userAgent);

    // API, sistem ve medya uçlarına dil yönlendirmesi uygulanmaz.
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/webhooks/") ||
      pathname.startsWith("/auth/") ||
      pathname === "/sitemap.xml" ||
      pathname === "/robots.txt" ||
      pathname === "/opengraph-image" ||
      pathname === "/icon.svg" ||
      pathname === "/apple-icon"
    ) {
      return handleAuth(req, pathname, search, user, null, null);
    }

    const { urlLocale, stripped } = stripUrlLocale(pathname);

    // 1) Öncelik sırasıyla dil & ülke algıla (ham IP saklanmaz, yalnızca ülke kodu).
    const isManual = req.cookies.get("nv_locale_manual")?.value === "1";
    const cookieLocale = req.cookies.get("nv_locale")?.value;
    const cookieCountry = req.cookies.get("nv_country")?.value;
    const headerCountry = extractCountryFromHeaders((name) => req.headers.get(name));

    let geoIpCountry: string | null = null;
    if (!urlLocale && !isManual && !headerCountry && !cookieCountry && !isBot) {
      const rawIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
      geoIpCountry = await lookupCountryByIp(rawIp);
    }

    const resolved = resolveLocaleAndCountry({
      cookieLocale: urlLocale ?? cookieLocale,
      isManualLocale: Boolean(urlLocale) || isManual,
      cookieCountry,
      headerCountry,
      geoIpCountry,
      acceptLanguage: req.headers.get("accept-language"),
    });

    const activeLocale: "tr" | "en" = urlLocale ?? (resolved.locale === "tr" ? "tr" : "en");
    const activeCountry = resolved.country;

    // 2) Arama motoru botlarını konuma göre yönlendirme: her dil sürümünü doğrudan görebilsin.
    if (!urlLocale && !isBot && !user?.role && isLocalizedRedirectPath(pathname)) {
      const targetPath = pathname === "/" ? `/${activeLocale}` : `/${activeLocale}${pathname}`;
      const redirectUrl = new URL(`${targetPath}${search}`, req.nextUrl);
      const redirectRes = NextResponse.redirect(redirectUrl, 307);
      redirectRes.headers.set("Vary", "Accept-Language, CF-IPCountry, x-vercel-ip-country, Cookie");
      return attachLocaleHeadersAndCookies(req, redirectRes, {
        locale: activeLocale,
        country: activeCountry,
        isManualOrUrl: isManual,
      });
    }

    // 3) Oturum ve rol kontrolü (dil öneki soyulmuş gerçek rota üzerinden).
    const authRes = handleAuth(req, stripped, search, user, activeLocale, activeCountry);
    if (authRes) {
      return attachLocaleHeadersAndCookies(req, authRes, {
        locale: activeLocale,
        country: activeCountry,
        isManualOrUrl: Boolean(urlLocale) || isManual,
      });
    }

    // 4) /tr/... veya /en/... URL'lerini mevcut sayfalara dahili olarak rewrite et (sıfır kırılma).
    const reqHeaders = buildRequestHeaders(req, {
      pathname: stripped,
      locale: activeLocale,
      country: activeCountry,
    });

    let response: NextResponse;
    if (urlLocale) {
      const rewriteUrl = internalBaseUrl.clone();
      rewriteUrl.pathname = stripped;
      rewriteUrl.search = search;
      response = NextResponse.rewrite(rewriteUrl, {
        request: { headers: reqHeaders },
      });
    } else {
      response = NextResponse.next({
        request: { headers: reqHeaders },
      });
    }

    response.headers.set("x-pathname", stripped);
    return attachLocaleHeadersAndCookies(req, response, {
      locale: activeLocale,
      country: activeCountry,
      isManualOrUrl: Boolean(urlLocale) || isManual,
    });
  });

  return (handler as unknown as (req: NextRequest, ctx: unknown) => Promise<Response>)(rawReq, ctx);
}

function handleAuth(
  req: Parameters<Parameters<typeof auth>[0]>[0],
  pathname: string,
  search: string,
  user: Parameters<Parameters<typeof auth>[0]>[0]["auth"] extends infer A
    ? A extends { user?: infer U }
      ? U
      : undefined
    : undefined,
  locale: string | null,
  country: string | null,
): NextResponse | null {
  if (
    isPublicPath(pathname) ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/meta/") ||
    pathname === "/api/voice/connect" ||
    pathname === "/api/locations" ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt"
  ) {
    return locale ? null : NextResponse.next();
  }

  // Herkese açık blog, bilet/kupon kartları ve görsel uçları.
  if (
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname.startsWith("/api/blog/") ||
    pathname.startsWith("/bilet/") ||
    pathname.startsWith("/kupon/") ||
    pathname.startsWith("/etkinlik/") ||
    pathname.startsWith("/api/media/") ||
    pathname.startsWith("/api/bilet/") ||
    pathname.startsWith("/api/kupon/") ||
    pathname.startsWith("/api/etkinlik/") ||
    pathname.startsWith("/api/wallet/") ||
    pathname.startsWith("/l/") ||
    pathname.startsWith("/brand/") ||
    pathname === "/opengraph-image" ||
    pathname === "/icon.svg" ||
    pathname === "/apple-icon"
  ) {
    return locale ? null : NextResponse.next();
  }

  if (pathname === LANDING && !user?.role) return locale ? null : NextResponse.next();

  const pending = !!user?.role && user.status && user.status !== "ACTIVE";
  if (pathname === "/onay-bekliyor") {
    return user?.role ? (locale ? null : NextResponse.next()) : NextResponse.redirect(new URL("/giris", req.nextUrl));
  }
  if (pathname === "/kayit") {
    return user?.role
      ? NextResponse.redirect(new URL(pending ? "/onay-bekliyor" : roleHome[user.role], req.nextUrl))
      : locale
        ? null
        : NextResponse.next();
  }
  if (pathname === "/giris") {
    const signingOut = req.nextUrl.searchParams.get("cikis") === "1" || req.cookies.get("nv_logout")?.value === "1";
    if (signingOut) return clearAuthCookies(NextResponse.next());
    if (user?.role) return NextResponse.redirect(new URL(pending ? "/onay-bekliyor" : roleHome[user.role], req.nextUrl));
    return locale ? null : NextResponse.next();
  }

  if (pending) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Üyeliğiniz onay bekliyor." }, { status: 403 });
    return NextResponse.redirect(new URL("/onay-bekliyor", req.nextUrl));
  }

  if (!user?.role) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
    }
    const url = new URL("/giris", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const isStaff = user.role === "ADMIN" || user.role === "AGENCY";
  if ((pathname === "/admin" || pathname.startsWith("/admin/")) && !isStaff) {
    return NextResponse.redirect(new URL(roleHome[user.role], req.nextUrl));
  }
  if ((pathname === "/marka" || pathname.startsWith("/marka/")) && user.role !== "BRAND" && !isStaff) {
    return NextResponse.redirect(new URL(roleHome[user.role], req.nextUrl));
  }
  if ((pathname === "/influencer" || pathname.startsWith("/influencer/")) && user.role !== "INFLUENCER" && !isStaff) {
    return NextResponse.redirect(new URL(roleHome[user.role], req.nextUrl));
  }
  if (pathname.startsWith("/api/admin/") && !isStaff) {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  if (!locale) {
    const reqHeaders = buildRequestHeaders(req, { pathname, locale: "tr", country: country ?? "TR" });
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    res.headers.set("x-pathname", pathname);
    return res;
  }
  return null;
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp|mp4|webm)$).*)"],
};
