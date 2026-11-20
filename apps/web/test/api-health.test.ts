import { describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/health/route";
import { isPublicPath, PUBLIC_PATHS } from "../lib/public-paths";

describe("ALB /api/health", () => {
  it("oturumsuz tam yol herkese açıktır, benzer önekler açık değildir", () => {
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/health")).toBe(true);
    expect(PUBLIC_PATHS.has("/api/health")).toBe(true);
    for (const blocked of ["/api/healthx", "/api/health/extra", "/api/healthz", "/healthx", "/api/healthy", "/api/secret"]) {
      expect(isPublicPath(blocked)).toBe(false);
    }
  });

  it("varsayılan yanıt 200 ve yalnız status: ok, önbelleksiz, sır yok", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|database_url|key/i);
  });

  it("deep=1 veritabanı kapalıysa 503 döner ve config sızdırmaz", async () => {
    vi.resetModules();
    vi.doMock("@infulancer/core/health", () => ({
      healthStatus: async () => ({ ok: false, db: "down" }),
    }));
    const { GET: deepGet } = await import("../app/api/health/route");
    const res = await deepGet(new Request("http://localhost/api/health?deep=1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ status: "degraded", db: "down" });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|DATABASE/i);
    vi.doUnmock("@infulancer/core/health");
  });
});
