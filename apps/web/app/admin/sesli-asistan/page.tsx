import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { VoiceAssistantAdminPanel } from "@/components/admin/voice-assistant-admin-panel";
import { requireAdmin } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Sesli Asistan Yönetimi" };
export const dynamic = "force-dynamic";

export default async function AdminVoiceAssistantPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sesli Asistan & Çağrı Yönlendirme"
        description="Vodafone / SIP numara yönlendirmesi, gerçekçi Türkçe ses, maliyet profili, rezervasyon, görevli notları ve çağrı kayıtlarını yönetin."
      />
      <VoiceAssistantAdminPanel />
    </div>
  );
}

