import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/scoring-engine.test.ts",
      "test/meta-business-sdk.test.ts",
      "test/earsiv-invoice.test.ts",
    ],
  },
});

