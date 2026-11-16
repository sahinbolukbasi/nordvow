import type { Metadata } from "next";
import Link from "next/link";
import { getTT } from "@/lib/i18n/tt-server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ButtonLink } from "@/components/ui/form";
import { verifyResetToken } from "@/lib/actions/password-reset";
import { getLandingContent, toVideos } from "@/lib/landing-store";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Şifre sıfırla" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const tt = await getTT();
  const { token = "" } = await searchParams;
  const [check, videos] = await Promise.all([verifyResetToken(token), getLandingContent().then(toVideos)]);

  return (
    <AuthShell
      videos={videos}
      title={tt("Yeni şifre belirleyin")}
      subtitle={
        check.valid && check.email
          ? `${check.email} ${tt("hesabı için yeni şifrenizi girin.")}`
          : tt("Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.")
      }
      footer={
        <Link href="/giris" className="text-fg underline-offset-4 hover:underline">
          {tt("← Giriş ekranına dön")}
        </Link>
      }
    >
      {check.valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border border-critical/30 bg-critical/5 p-5">
          <p className="text-sm text-fg-muted">
            {tt("Bu sıfırlama bağlantısı kullanılmış, hatalı veya 1 saatlik süresi dolmuş. Yeni bir bağlantı talep edebilirsiniz.")}
          </p>
          <ButtonLink href="/sifremi-unuttum">{tt("Yeni bağlantı iste →")}</ButtonLink>
        </div>
      )}
    </AuthShell>
  );
}

