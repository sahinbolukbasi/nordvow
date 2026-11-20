/** Karar izi. Telefon, gövde ve sır yazılmaz. */
export function botLog(level: "info" | "warn", step: string, fields: Record<string, string | number | boolean> = {}): void {
  const line = { step, ...fields };
  if (level === "warn") console.warn("[meta-bot]", line);
  else console.info("[meta-bot]", line);
}
