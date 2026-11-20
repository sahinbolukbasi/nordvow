import type { Actor } from "@infulancer/core/access/actor";
import { BRAND_NAME } from "@/lib/brand";
import { CopilotHomeShell } from "@/components/copilot/copilot-home-shell";
import { copilotWelcome } from "@/lib/copilot";

/** Rol ana sayfalarının en üstünde gömülü asistan: sağ üst köşeden büyütülebilir. */
export async function CopilotHome({ actor }: { actor: Actor }) {
  const welcome = await copilotWelcome(actor);
  return <CopilotHomeShell welcome={welcome} brandName={BRAND_NAME} />;
}
