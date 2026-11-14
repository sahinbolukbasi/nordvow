export type BotTemplateKey = "account_link" | "ticket_confirmation" | "coupon_delivered" | "window_closed";

export type OutboundPlan =
  | { mode: "text"; body: string }
  | { mode: "template"; templateKey: BotTemplateKey; params: string[] }
  | { mode: "blocked"; reason: string };

/**
 * 24 saat penceresi kapalıyken serbest metin yok. WhatsApp'ta yalnız onaylı utility template.
 * Instagram/Messenger'da bot serbest metin gönderemez (HUMAN_AGENT yalnızca temsilci içindir).
 */
export function planOutbound(input: { channel: "WHATSAPP" | "INSTAGRAM" | "MESSENGER"; windowOpen: boolean; body: string; templateKey?: BotTemplateKey; params?: string[] }): OutboundPlan {
  if (input.windowOpen) return { mode: "text", body: input.body };
  if (input.channel === "WHATSAPP") {
    return { mode: "template", templateKey: input.templateKey ?? "window_closed", params: input.params ?? [input.body.slice(0, 200)] };
  }
  return { mode: "blocked", reason: "Pencere kapalı. Instagram ve Messenger'da bot 24 saat dışında yazamaz; temsilci HUMAN_AGENT ile yanıtlar." };
}

export const META_BOT_TEMPLATES: { key: BotTemplateKey; name: string; category: "utility"; body: string; note: string }[] = [
  { key: "account_link", name: "nordvow_hesap_bagla", category: "utility", body: "Nordvow hesap bağlama kodunuz: {{1}}. Bu kod 15 dakika geçerlidir. Ayrıntı: nordvow.com/gizlilik", note: "Hesap bağlama kodu. Pazarlama değil." },
  { key: "ticket_confirmation", name: "nordvow_bilet_onay", category: "utility", body: "Biletiniz hazır: {{1}}. Kod: {{2}}. Kart bilgisi sohbette istenmez.", note: "Ücretsiz bilet onayı." },
  { key: "coupon_delivered", name: "nordvow_kupon_kodu", category: "utility", body: "Kupon kodunuz: {{1}}. {{2}}", note: "Kullanıcıya ait kupon kodunun teslimi." },
  { key: "window_closed", name: "nordvow_pencere_kapali", category: "utility", body: "Mesajınızı aldık. Yanıtlamak için bu bildirime cevap verin veya nordvow.com hesabınıza girin. {{1}}", note: "24 saat dışı kısa hizmet bildirimi." },
];
