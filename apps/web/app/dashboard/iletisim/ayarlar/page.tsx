import { redirect } from "next/navigation";

export default async function IletisimAyarlarIndex({
  searchParams,
}: {
  searchParams: Promise<{ marka?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.marka ? `?marka=${encodeURIComponent(sp.marka)}` : "";
  redirect(`/dashboard/iletisim/ayarlar/kanallar${qs}`);
}

