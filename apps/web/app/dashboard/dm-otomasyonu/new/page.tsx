import type { Metadata } from "next";
import { DmAutomationShell } from "@/components/dm-automation/dm-automation-shell";
import { AppShell } from "@/components/shell/app-shell";
import { loadDmAutomationPageContext } from "@/lib/dm-automation-page";

export const metadata: Metadata = { title: "Yeni DM Otomasyonu · NordVow" };
export const dynamic = "force-dynamic";

export default async function DmAutomationNewPage() {
  const ctx = await loadDmAutomationPageContext();
  return (
    <AppShell role={ctx.actor.role}>
      <DmAutomationShell
        initialTenantId={ctx.initialTenantId}
        tenantOptions={ctx.tenantOptions}
        initialView="new"
        featureAllowed={ctx.tenantAllowed}
        canAdminExport={ctx.canAdminExport}
      />
    </AppShell>
  );
}

