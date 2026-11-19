import { redirect } from "next/navigation";

export default async function DmAutomationDetailAliasPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  redirect(`/dashboard/dm-otomasyonu/${encodeURIComponent(campaignId)}`);
}

