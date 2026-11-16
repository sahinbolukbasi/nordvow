/** Meta webhook GET: hub.mode=subscribe ve verify token eşleşirse challenge döner. */
export function metaSubscriptionChallenge(
  input: { mode: string | null; verifyToken: string | null; challenge: string | null },
  expected: string | undefined,
): string | null {
  if (!expected) return null;
  if (input.mode === "subscribe" && input.verifyToken === expected) return input.challenge ?? "";
  return null;
}
