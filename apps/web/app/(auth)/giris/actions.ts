"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { loginAcceptanceDocs, recordLegalAcceptances } from "@infulancer/core/legal/acceptance";
import { signIn } from "@/auth";
import { safeNextPath } from "@/lib/roles";

export type LoginState = { error: string | null; email: string };

const GENERIC_ERROR = "E-posta veya şifre hatalı";

const schema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const parsed = schema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: GENERIC_ERROR, email };
  // KVKK aydınlatması giriş şartı değildir; kayıtta alınan kabul yeniden istenmez ve yazılmaz.
  if (formData.get("acceptTerms") !== "on") return { error: "Güncel kullanım şartlarını kabul etmelisiniz.", email };
  try {
    // Başarılıysa NEXT_REDIRECT fırlatır; "/" rolün ana sayfasına yönlendirir.
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeNextPath(formData.get("next")) ?? "/",
    });
  } catch (err) {
    if (err instanceof AuthError) return { error: GENERIC_ERROR, email };
    const digest = typeof err === "object" && err && "digest" in err ? String((err as { digest?: string }).digest) : "";
    if (digest.startsWith("NEXT_REDIRECT")) {
      const user = await prisma.user.findUnique({ where: { email: parsed.data.email.trim().toLowerCase() }, select: { id: true, role: true } });
      if (user) await recordLegalAcceptances({ userId: user.id, email: parsed.data.email, documents: loginAcceptanceDocs(user.role) }).catch(() => undefined);
    }
    throw err;
  }
  return { error: null, email };
}
