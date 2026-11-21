import type { Metadata } from "next";
import Link from "next/link";
import { getTT } from "@/lib/i18n/tt-server";
import { AuthShell } from "@/components/auth/auth-shell";
import { getLandingContent, toVideos } from "@/lib/landing-store";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Şifremi unuttum" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const tt = await getTT();
  const videos = toVideos(await getLandingContent());

  return (
    <AuthShell
      videos={videos}
      title={tt("Şifrenizi mi unuttunuz?")}
      subtitle={tt("Kayıtlı e-posta adresinizi girin, size şifre sıfırlama bağlantısı gönderelim.")}
      footer={
        <Link href="/giris" className="text-fg underline-offset-4 hover:underline">
          {tt("← Giriş ekranına dön")}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}

