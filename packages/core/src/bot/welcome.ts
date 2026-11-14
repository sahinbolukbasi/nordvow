export const ICE_BREAKERS = [
  { payload: "ICE_WHAT", question: "Nordvow nedir?" },
  { payload: "ICE_CREATOR", question: "Influencer olarak katılmak istiyorum" },
  { payload: "ICE_BRAND", question: "Marka/ajans olarak katılmak istiyorum" },
  { payload: "ICE_LINK", question: "Hesabımı bağla" },
] as const;

export const GET_STARTED = "GET_STARTED";

const DEFAULT_TR = "Merhaba, ben Nordvow asistanıyım. Ayrıntı: /gizlilik";
const DEFAULT_EN = "Hi, I am the Nordvow assistant. Details: /gizlilik";

export function welcomeLang(locale: string | null | undefined): "tr" | "en" {
  return (locale ?? "").toLowerCase().startsWith("en") ? "en" : "tr";
}

export function welcomeText(lang: "tr" | "en", settings: { welcomeTr?: string | null; welcomeEn?: string | null }): string {
  const custom = (lang === "en" ? settings.welcomeEn : settings.welcomeTr)?.trim();
  return custom || (lang === "en" ? DEFAULT_EN : DEFAULT_TR);
}

/** Buz kırıcı veya Get Started yükü. Tanınmazsa null. */
export function textForPayload(payload: string | null | undefined): { text: string; opening: boolean } | null {
  if (!payload) return null;
  if (payload === GET_STARTED) return { text: "", opening: true };
  const ice = ICE_BREAKERS.find((item) => item.payload === payload);
  if (!ice) return null;
  return { text: ice.question, opening: false };
}

export function whatsAppAutomationBody() {
  return { enable_welcome_message: true, prompts: ICE_BREAKERS.map((item) => item.question) };
}

export function messengerProfileBody(tr: string, en: string) {
  return {
    get_started: { payload: GET_STARTED },
    greeting: [
      { locale: "default", text: tr },
      { locale: "tr_TR", text: tr },
      { locale: "en_US", text: en },
    ],
    ice_breakers: ICE_BREAKERS.map((item) => ({ question: item.question, payload: item.payload })),
  };
}

export function instagramIceBody() {
  const call_to_actions = ICE_BREAKERS.map((item) => ({ question: item.question, payload: item.payload }));
  return {
    platform: "instagram" as const,
    ice_breakers: [
      { locale: "default", call_to_actions },
      { locale: "tr_TR", call_to_actions },
      { locale: "en_US", call_to_actions },
    ],
  };
}

/** Tanınmayan webhook olayı. Yalnız kısa neden; gövde yok. */
export function logUnsupportedEvent(reason: "unknown_object" | "unknown_whatsapp_field" | "unknown_messaging" | "unsupported_message_type" | "unsupported_postback"): void {
  console.warn("[meta-webhook] unsupported event", { reason });
}
