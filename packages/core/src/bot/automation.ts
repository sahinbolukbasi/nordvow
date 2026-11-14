import { DomainError } from "../domain/errors";
import { envStr } from "../env";
import { metaClient } from "../channels/meta-client";
import { getBotSettings } from "./engine";
import { instagramIceBody, messengerProfileBody, welcomeText, whatsAppAutomationBody } from "./welcome";

function waToken(): string {
  return envStr("WHATSAPP_ACCESS_TOKEN", "").trim() || envStr("META_WABA_TOKEN", "").trim() || envStr("META_SYSTEM_USER_TOKEN", "").trim();
}

function pageToken(): string {
  return envStr("META_SYSTEM_USER_TOKEN", "").trim() || envStr("INSTAGRAM_ACCESS_TOKEN", "").trim() || envStr("META_IG_TOKEN", "").trim();
}

/** WhatsApp karşılama ve 4 buz kırıcı. Token yalnız ortamdan. */
export async function enableWhatsAppWelcome() {
  const settings = await getBotSettings();
  const phoneNumberId = settings.whatsappPhoneNumberId || envStr("NORDVOW_WA_PHONE_NUMBER_ID", "") || envStr("WHATSAPP_PHONE_NUMBER_ID", "");
  const token = waToken();
  if (!phoneNumberId) throw new DomainError("DOGRULAMA", "WhatsApp telefon numarası kimliği yok.");
  if (!token) throw new DomainError("DOGRULAMA", "WhatsApp token ortamda yok.");
  await metaClient().enableConversationalAutomation(phoneNumberId, token, whatsAppAutomationBody());
}

/** Messenger karşılama, Get Started ve buz kırıcılar; Instagram buz kırıcılar. */
export async function enablePageAndInstagramPrompts() {
  const settings = await getBotSettings();
  const token = pageToken();
  if (!token) throw new DomainError("DOGRULAMA", "Sayfa token ortamda yok.");
  const tr = welcomeText("tr", settings);
  const en = welcomeText("en", settings);
  const pageId = settings.pageId || envStr("NORDVOW_PAGE_ID", "");
  const igId = settings.igUserId || envStr("NORDVOW_IG_USER_ID", "") || envStr("INSTAGRAM_IG_USER_ID", "");
  if (!pageId && !igId) throw new DomainError("DOGRULAMA", "Sayfa veya Instagram kimliği yok.");
  if (pageId) await metaClient().setMessengerProfile(pageId, token, messengerProfileBody(tr, en));
  if (igId) await metaClient().setInstagramIceBreakers(igId, token, instagramIceBody());
}
