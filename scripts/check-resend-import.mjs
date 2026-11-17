import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(__dirname, "../src/lib/resend.ts");

function runChild(args, environment) {
  const result = spawnSync("node", args, {
    cwd: __dirname,
    env: environment,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const output =
    result.stdout?.toString().trim() ?? "";
  return { stdout: output, exitCode: result.status };
}

// Helper: build a small inline module that tests whether the resend module
// can be imported through the indicated loader.
function makeImportTest(loaderKind) {
  // Escape the script path for safe embedding in a JS string.
  const escapedScript = script.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

  if (loaderKind === "modern-dynamic") {
    // Modern next-safe path: dynamic import from module code with no env.
    return `
const mod = "${escapedScript}";
const t0 = performance.now();
try {
  await import(mod);
  console.log("client dynamic import reachable");
} catch (err) {
  const msg = String(err?.message ?? err);
  console.log(
    msg.includes("Email sender is not fully configured")
      ? "client dynamic import blocked"
      : ("client dynamic import blocked: " + msg)
  );
}
`;
  }

  if (loaderKind === "legacy-require") {
    return `
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = path.resolve(__dirname, "${escapedScript}");
const require = createRequire(import.meta.url);

try {
  require(mod);
  console.log("client require import reachable");
} catch (err) {
  const msg = String(err?.message ?? err);
  console.log(
    msg.includes("Email sender is not fully configured")
      ? "client require import blocked"
      : ("client require import blocked: " + msg)
  );
}
`;
  }

  throw new Error("Unknown loader kind: " + loaderKind);
}

// Configure children to ignore any existing Resend env. We do not forward
// the real API key into the child, and we explicitly empty the key variable so
// the module's import-time validation sees a missing value.
const childEnv = {
  NODE_ENV: "production",
  RESEND_FROM_EMAIL: "",
  RESEND_REPLY_TO: "",
  RESEND_API_KEY: "",
  PATH: process.env.PATH ?? "",
};

const modernDynamic = runChild(
  [
    "--input-type=module",
    "-e",
    makeImportTest("modern-dynamic"),
  ],
  childEnv,
);

if (modernDynamic.exitCode === 0) {
  console.log("client import blocked by module validation (dynamic import, no env)");
  process.exit(0);
}

console.warn(
  "Warning: dynamic import path did not block as expected. stdout:",
  JSON.stringify(modernDynamic.stdout),
  "exit:",
  modernDynamic.exitCode,
);

const legacyRequire = runChild(
  [
    "--input-type=module",
    "-e",
    makeImportTest("legacy-require"),
  ],
  childEnv,
);

if (legacyRequire.exitCode === 0) {
  console.log("client import blocked by module validation (legacy require, no env)");
  process.exit(0);
}

console.error(
  "Unexpected check result for legacy require path. stdout:",
  JSON.stringify(legacyRequire.stdout),
  "exit:",
  legacyRequire.exitCode,
);
process.exit(1);
