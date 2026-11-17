/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/lib/resend.test.ts"],
    environment: "node",
    globals: true,
    deps: {
      interopDefault: true,
    },
    setupFiles: ["src/lib/email-test-env.ts"],
  },
});
