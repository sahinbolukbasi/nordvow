import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

/**
 * Geçersiz veya veritabanında silinmiş kullanıcıya ait eski oturum çerezlerini temizler
 * ve ERR_TOO_MANY_REDIRECTS döngüsünü kırarak /giris ekranına yönlendirir.
 */
export function GET(req: NextRequest) {
  const hata = req.nextUrl.searchParams.get("hata");
  const target = new URL("/giris", req.nextUrl);
  if (hata) target.searchParams.set("hata", hata);

  const res = NextResponse.redirect(target);
  for (const name of COOKIE_NAMES) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
    res.cookies.set(`${name}.0`, "", { path: "/", maxAge: 0 });
    res.cookies.set(`${name}.1`, "", { path: "/", maxAge: 0 });
  }
  return res;
}

