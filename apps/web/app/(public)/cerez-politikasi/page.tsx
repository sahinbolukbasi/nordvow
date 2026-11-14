import type { Metadata } from "next";
import { CookiePreferencesButton } from "@/components/legal/cookie-banner";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Çerez Politikası" };
export const dynamic = "force-dynamic";

export default function CookiePolicyPage() {
  return (
    <>
      <div className="pt-6"><CookiePreferencesButton /></div>
      <LegalPage id="cookies" current="/cerez-politikasi" />
    </>
  );
}
