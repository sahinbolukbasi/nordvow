export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { hydrateIntegrations } = await import("@infulancer/core/secrets/integrations");
    await hydrateIntegrations();
  }
}
