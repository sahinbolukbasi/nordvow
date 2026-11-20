import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyDmAutomationRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else {
      qs.set(k, v);
    }
  }
  qs.set("tur", "yorum-dm");
  permanentRedirect(`/dashboard/iletisim/otomasyonlar?${qs.toString()}`);
}
