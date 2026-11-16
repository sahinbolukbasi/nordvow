import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { authCookieNames } from "./auth-cookies";

function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT");
}

/** Oturumu siler (parçalı çerezler dahil) ve /giris?cikis=1 adresine gider. Proxy bu isteği panele geri atmaz. */
export async function completeSignOut(to = "/giris?cikis=1"): Promise<never> {
  try {
    await signOut({ redirect: false });
  } catch (err) {
    if (!isRedirect(err)) throw err;
  }
  const jar = await cookies();
  const prod = process.env.NODE_ENV === "production";
  for (const name of authCookieNames()) {
    const secure = name.startsWith("__Secure-") || name.startsWith("__Host-") || prod;
    jar.set(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure });
  }
  jar.set("nv_logout", "1", { path: "/", maxAge: 120, httpOnly: true, sameSite: "lax", secure: prod });
  redirect(to);
}
