/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    include: [
      "src/lib/resend.test.ts",
      "src/lib/auth/reset-token.test.ts",
      "src/lib/auth/password-flows.test.ts",
      "src/lib/auth/reset-request-throttle.test.ts",
      "src/server/supplier-s03-s04.test.ts",
      "src/server/decision6-stock-hold.test.ts",
      "src/lib/seed-guard.test.ts",
      "src/lib/customer-visibility.test.ts",
      "src/lib/auth/login-throttle.test.ts",
      "src/lib/csrf-origin.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    singleThread: true,
    globals: true,
    deps: {
      interopDefault: true,
    },
    setupFiles: ["src/lib/email-test-env.ts"],
  },
});
