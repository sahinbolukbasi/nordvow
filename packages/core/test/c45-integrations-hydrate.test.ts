import { describe, expect, it } from "vitest";
import { hydrateIntegrations, integrationsSecretId, mergeSecretIntoEnv, shellAssign } from "../src/secrets/integrations";

describe("integrations sirri", () => {
  it("sır kimliğini vault önekinden çıkarır, yerel modda kapalı kalır", () => {
    expect(integrationsSecretId({ VAULT_MODE: "aws", VAULT_SECRET_PREFIX: "infulancer-prod/tenants" })).toBe("infulancer-prod/integrations");
    expect(integrationsSecretId({ VAULT_MODE: "local", VAULT_SECRET_PREFIX: "infulancer-prod/tenants" })).toBeNull();
    expect(integrationsSecretId({ INTEGRATIONS_SECRET_ID: "custom/integrations", VAULT_MODE: "local" })).toBe("custom/integrations");
  });

  it("dolu ortam değişkenini ezmez, boş olanı ve META_API_MODE'u doldurur", () => {
    const env: NodeJS.ProcessEnv = { INSTAGRAM_ACCESS_TOKEN: "env-token", META_API_MODE: "" };
    const filled = mergeSecretIntoEnv(env, {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      INSTAGRAM_IG_USER_ID: "1789",
      META_API_MODE: "http",
      SOCIAL_SYNC_MODE: "http",
      lowercase: "no",
      EMPTY: "  ",
      COUNT: 3,
    });
    expect(filled.sort()).toEqual(["INSTAGRAM_IG_USER_ID", "META_API_MODE", "SOCIAL_SYNC_MODE"]);
    expect(env.INSTAGRAM_ACCESS_TOKEN).toBe("env-token");
    expect(env.META_API_MODE).toBe("http");
    expect(env.EMPTY).toBeUndefined();
  });

  it("kabuk satırı tırnak ve apostrof kaçırır", () => {
    expect(shellAssign("META_APP_SECRET", "a'b")).toBe(`META_APP_SECRET='a'\\''b'`);
  });

  it("okuyucu hata verirse süreci düşürmez ve değer yazmaz", async () => {
    const env: NodeJS.ProcessEnv = { VAULT_MODE: "aws", VAULT_SECRET_PREFIX: "infulancer-prod/tenants", META_APP_ID: "keep" };
    const ok = await hydrateIntegrations({
      env,
      read: async () => JSON.stringify({ META_APP_ID: "new", WHATSAPP_ACCESS_TOKEN: "wa" }),
    });
    expect(ok.skipped).toBe(false);
    expect(ok.filledKeys).toEqual(["WHATSAPP_ACCESS_TOKEN"]);
    expect(env.META_APP_ID).toBe("keep");
    expect(env.WHATSAPP_ACCESS_TOKEN).toBe("wa");

    const denied = await hydrateIntegrations({
      env: { INTEGRATIONS_SECRET_ID: "infulancer-prod/integrations" },
      read: async () => {
        const err = new Error("denied");
        err.name = "AccessDeniedException";
        throw err;
      },
    });
    expect(denied.skipped).toBe(true);
    expect(denied.reason).toBe("AccessDeniedException");
    expect(denied.filledKeys).toEqual([]);
  });
});
