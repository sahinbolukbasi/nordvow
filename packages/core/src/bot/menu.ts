export type MenuId = "campaigns" | "balance" | "coupons" | "events" | "shortlink" | "ticket" | "menu" | "handoff" | "yes" | "no";

const ITEMS: { id: MenuId; keys: string[] }[] = [
  { id: "campaigns", keys: ["kampanyalarım", "kampanyalarim", "kampanyalar", "tekliflerim", "campaigns", "my campaigns"] },
  { id: "balance", keys: ["bakiyem", "bakiye", "hakediş", "hakedis", "ödeme", "odeme", "balance", "payout"] },
  { id: "coupons", keys: ["kuponlarım", "kuponlarim", "kupon", "coupons", "coupon"] },
  { id: "events", keys: ["etkinlikler", "etkinlik", "bilet", "events", "ticket"] },
  { id: "shortlink", keys: ["link kısalt", "link kisalt", "kısa link", "kisa link", "linklerim", "short link", "shorten"] },
  { id: "ticket", keys: ["bilet sorgula", "qr", "ticket status"] },
  { id: "menu", keys: ["menü", "menu", "yardım", "yardim", "help", "merhaba", "selam", "hello", "hi"] },
  { id: "handoff", keys: ["insan", "temsilci", "agent", "human", "müşteri", "musteri"] },
  { id: "yes", keys: ["evet", "yes", "onay", "onaylıyorum", "onayliyorum"] },
  { id: "no", keys: ["hayır", "hayir", "no", "iptal", "vazgeç", "vazgec"] },
];

export function normalizeBotText(text: string): string {
  return text.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
}

/** Anahtar kelime ve menü. LLM yokken de çalışır. */
export function matchMenu(text: string): MenuId | null {
  const t = normalizeBotText(text);
  if (!t) return null;
  for (const item of ITEMS) {
    if (item.keys.some((k) => t === k || t.startsWith(`${k} `) || t.includes(k))) return item.id;
  }
  return null;
}

export function detectBotLang(text: string): "tr" | "en" {
  const t = normalizeBotText(text);
  if (/\b(balance|campaigns|events|coupon|coupons|ticket|hello|help|yes|menu|human|agent)\b/.test(t) && !/[çğıöşü]/.test(t)) return "en";
  return "tr";
}

export const MENU_BUTTONS_TR = ["Kampanyalarım", "Bakiyem", "Kuponlarım", "Etkinlikler", "Link kısalt", "Temsilci"] as const;
export const MENU_BUTTONS_EN = ["My campaigns", "Balance", "Coupons", "Events", "Shorten link", "Agent"] as const;

export function menuText(lang: "tr" | "en"): string {
  const buttons = lang === "en" ? MENU_BUTTONS_EN : MENU_BUTTONS_TR;
  const head = lang === "en" ? "Choose one:" : "Birini seçin:";
  return `${head}\n${buttons.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n${lang === "en" ? "Details: /gizlilik" : "Ayrıntı: /gizlilik"}`;
}
