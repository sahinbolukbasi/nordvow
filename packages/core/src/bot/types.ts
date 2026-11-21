export type BotChannel = "WHATSAPP" | "INSTAGRAM" | "MESSENGER";

export type BotUser = {
  id: string;
  role: "ADMIN" | "AGENCY" | "BRAND" | "INFLUENCER";
  brandId: string | null;
  influencerId: string | null;
  name: string;
  email: string;
  phone: string | null;
};

export type ToolName = "campaigns" | "balance" | "coupons" | "claim_coupon" | "events" | "reserve_ticket" | "ticket_status" | "short_links" | "create_short_link" | "approvals" | "account";

export type ToolDef = {
  name: ToolName;
  /** Hassas işlem EVET olmadan çalışmaz ve saatte sınırlıdır. */
  confirm: boolean;
  run: (ctx: BotUser, args: { text: string; lang: "tr" | "en" }) => Promise<string>;
};
