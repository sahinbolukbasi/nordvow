import { claimCoupon, listLinks, makeLink, reserveTicket, ticketStatus, toolAccount, toolApprovals, toolBalance, toolCampaigns, toolCoupons, toolEvents } from "./tools";
import type { ToolDef, ToolName } from "./types";

function urlIn(text: string): string {
  const m = text.match(/https:\/\/\S+/i);
  return m?.[0]?.replace(/[),.;]+$/, "") ?? "";
}

export const BOT_TOOLS: Record<ToolName, ToolDef> = {
  account: { name: "account", confirm: false, run: (ctx, a) => toolAccount(ctx, a.lang) },
  campaigns: { name: "campaigns", confirm: false, run: (ctx, a) => toolCampaigns(ctx, a.lang) },
  balance: { name: "balance", confirm: false, run: (ctx, a) => toolBalance(ctx, a.lang) },
  coupons: { name: "coupons", confirm: false, run: (ctx, a) => toolCoupons(ctx, a.lang) },
  claim_coupon: { name: "claim_coupon", confirm: true, run: (ctx, a) => claimCoupon(ctx, a.lang) },
  events: { name: "events", confirm: false, run: (_ctx, a) => toolEvents(a.lang) },
  reserve_ticket: { name: "reserve_ticket", confirm: true, run: (ctx, a) => reserveTicket(ctx, a.text.replace(/https?:\/\/\S+/g, "").trim(), a.lang) },
  ticket_status: { name: "ticket_status", confirm: false, run: (ctx, a) => ticketStatus(ctx, (a.text.match(/TKT-[A-Z0-9]+/i)?.[0] ?? "").toUpperCase(), a.lang) },
  short_links: { name: "short_links", confirm: false, run: (ctx, a) => listLinks(ctx, a.lang) },
  create_short_link: { name: "create_short_link", confirm: true, run: (ctx, a) => makeLink(ctx, urlIn(a.text)) },
  approvals: { name: "approvals", confirm: false, run: (ctx, a) => toolApprovals(ctx, a.lang) },
};

export function toolByMenu(menu: string | null, text: string): ToolName | null {
  if (menu === "campaigns") return "campaigns";
  if (menu === "balance") return "balance";
  if (menu === "coupons") return text.toLocaleLowerCase("tr").includes("evet") ? "claim_coupon" : "coupons";
  if (menu === "events") return /bilet al|rezerv|buy ticket|reserve/i.test(text) ? "reserve_ticket" : "events";
  if (menu === "shortlink") return /https:\/\//i.test(text) ? "create_short_link" : "short_links";
  if (menu === "ticket") return "ticket_status";
  if (menu === "menu") return "account";
  return null;
}
