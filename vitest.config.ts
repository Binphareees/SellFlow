/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig uses Next's `jsx: preserve`; Vitest must still compile page/component
  // TSX that a test imports.
  oxc: { jsx: { runtime: "automatic" } },
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
      "src/lib/subscription-v1-scope.test.ts",
      "src/server/price-access-audit.test.ts",
      "src/lib/security-headers.test.ts",
      "src/lib/auth/register-throttle.test.ts",
      "src/app/(app)/dashboard/admin/page.test.ts",
      "src/app/api/health/route.test.ts",
      "src/instrumentation.test.ts",
      "src/server/accounts.test.ts",
      "src/lib/backup-sqlite.test.ts",
      "src/lib/verify-backup.test.ts",
      "src/lib/manage-privileged.test.ts",
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
