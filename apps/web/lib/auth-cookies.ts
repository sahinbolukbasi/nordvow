import type { NextResponse } from "next/server";

/** Auth.js oturum çerezleri (düz, __Secure-/__Host- ve parçalı .0… adları). */
export const AUTH_COOKIE_BASES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
] as const;

export function authCookieNames(chunks = 4): string[] {
  const names: string[] = [];
  for (const base of AUTH_COOKIE_BASES) {
    names.push(base);
    if (base.includes("session-token")) {
      for (let i = 0; i < chunks; i++) names.push(`${base}.${i}`);
    }
  }
  return names;
}

function clearOpts(name: string) {
  const secure = name.startsWith("__Secure-") || name.startsWith("__Host-") || process.env.NODE_ENV === "production";
  return { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" as const, secure };
}

/** Yanıtta oturum çerezlerini ve çıkış bayrağını siler. */
export function clearAuthCookies(res: NextResponse): NextResponse {
  for (const name of authCookieNames()) res.cookies.set(name, "", clearOpts(name));
  const prod = process.env.NODE_ENV === "production";
  res.cookies.set("nv_logout", "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: prod });
  return res;
}
