// Test-only environment setup for the resend module.
// This file is imported before the resend module in tests so that
// RESEND_FROM_EMAIL / RESEND_REPLY_TO / RESEND_API_KEY are present at
// module load time. The real secret lives only in .env.local (which is git
// ignored) and is never read here as a value.

import { setGlobalEnvForTest } from "./test-env-setup";

setGlobalEnvForTest({
  NODE_ENV: "test",
  RESEND_FROM_EMAIL: "SellFlow Security <security@sellflow.shop>",
  RESEND_REPLY_TO: "support@sellflow.shop",
  RESEND_API_KEY: "re_testkey_notarealkey",
});
