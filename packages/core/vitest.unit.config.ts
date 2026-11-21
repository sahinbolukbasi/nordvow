import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/scoring-engine.test.ts",
      "test/meta-business-sdk.test.ts",
      "test/earsiv-invoice.test.ts",
    ],
    // Puan motoru prisma'yı import eder; birim test sorgusu yok. Bağlantı açılmaz.
    env: {
      DATABASE_URL: "postgresql://ci:ci@127.0.0.1:5432/ci",
      AUDIT_DATABASE_URL: "postgresql://ci:ci@127.0.0.1:5432/ci_audit",
    },
  },
});

