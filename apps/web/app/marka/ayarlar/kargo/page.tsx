import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function BrandCargoSettingsPage() {
  const actor = await requireActor("BRAND", "ADMIN");
  if (actor.role === "ADMIN") redirect("/admin/kargo");
  redirect("/profil?sekme=kargo");
}

