export type InboxChannelType = "INSTAGRAM" | "WHATSAPP";

export type MessagingWindowState = {
  canFreeform: boolean;
  needsHumanAgentTag: boolean;
  canTemplate: boolean;
  closesAt: Date | null;
  remainingMinutes: number | null;
  closingSoon: boolean;
  reason: "open" | "human_agent" | "closed" | "never_messaged";
};

export const MESSAGING_WINDOW_24_HOURS_MS = 24 * 60 * 60 * 1000;
export const MESSAGING_WINDOW_7_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const CLOSING_SOON_THRESHOLD_MINUTES = 120;

/**
 * 24 saatlik (ve Instagram'da opsiyonel 7 günlük HUMAN_AGENT) mesajlaşma penceresi hesaplayıcısı.
 * Hem istemci yazma alanında (composer) hem sunucu gönderim kapısında birebir aynı saf fonksiyon çalışır.
 */
export function getWindowState(input: {
  channel: InboxChannelType;
  lastIncomingAt: Date | string | null | undefined;
  now?: Date;
  humanAgentEnabled?: boolean;
  /** Gönderen gerçek bir insan temsilci mi? (AI / bot ise HUMAN_AGENT etiketi kullanılamaz) */
  byHuman?: boolean;
}): MessagingWindowState {
  const now = input.now ?? new Date();
  const byHuman = input.byHuman ?? true;

  if (!input.lastIncomingAt) {
    return {
      canFreeform: false,
      needsHumanAgentTag: false,
      canTemplate: input.channel === "WHATSAPP",
      closesAt: null,
      remainingMinutes: null,
      closingSoon: false,
      reason: "never_messaged",
    };
  }

  const lastIn = input.lastIncomingAt instanceof Date ? input.lastIncomingAt : new Date(input.lastIncomingAt);
  if (Number.isNaN(lastIn.getTime())) {
    return {
      canFreeform: false,
      needsHumanAgentTag: false,
      canTemplate: input.channel === "WHATSAPP",
      closesAt: null,
      remainingMinutes: null,
      closingSoon: false,
      reason: "never_messaged",
    };
  }

  const elapsedMs = now.getTime() - lastIn.getTime();
  const standardClosesAt = new Date(lastIn.getTime() + MESSAGING_WINDOW_24_HOURS_MS);

  if (elapsedMs < MESSAGING_WINDOW_24_HOURS_MS) {
    const remainingMinutes = Math.max(0, Math.floor((standardClosesAt.getTime() - now.getTime()) / 60_000));
    return {
      canFreeform: true,
      needsHumanAgentTag: false,
      canTemplate: input.channel === "WHATSAPP",
      closesAt: standardClosesAt,
      remainingMinutes,
      closingSoon: remainingMinutes <= CLOSING_SOON_THRESHOLD_MINUTES,
      reason: "open",
    };
  }

  if (
    input.channel === "INSTAGRAM" &&
    input.humanAgentEnabled &&
    byHuman &&
    elapsedMs < MESSAGING_WINDOW_7_DAYS_MS
  ) {
    const humanClosesAt = new Date(lastIn.getTime() + MESSAGING_WINDOW_7_DAYS_MS);
    const remainingMinutes = Math.max(0, Math.floor((humanClosesAt.getTime() - now.getTime()) / 60_000));
    return {
      canFreeform: true,
      needsHumanAgentTag: true,
      canTemplate: false,
      closesAt: humanClosesAt,
      remainingMinutes,
      closingSoon: remainingMinutes <= CLOSING_SOON_THRESHOLD_MINUTES,
      reason: "human_agent",
    };
  }

  return {
    canFreeform: false,
    needsHumanAgentTag: false,
    canTemplate: input.channel === "WHATSAPP",
    closesAt: standardClosesAt,
    remainingMinutes: 0,
    closingSoon: false,
    reason: "closed",
  };
}

export function formatRemainingWindow(remainingMinutes: number | null): string {
  if (remainingMinutes === null || remainingMinutes <= 0) return "0 dk";
  if (remainingMinutes >= 24 * 60) {
    const days = Math.floor(remainingMinutes / (24 * 60));
    const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
    return hours > 0 ? `${days} gün ${hours} sa` : `${days} gün`;
  }
  const hours = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;
  return hours > 0 ? `${hours} sa ${mins} dk` : `${mins} dk`;
}
