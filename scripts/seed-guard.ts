/**
 * Shared guard for the demo dataset in `prisma/seed.ts` and `scripts/db-reset.ts`.
 *
 * Demo seeding creates a platform admin and a mediator whose password is
 * committed to the repository (audit finding S-15). It must therefore fail
 * closed unless all of the following are true:
 *
 *   1. NODE_ENV is explicitly `development` or `test`. Unset, empty, quoted
 *      empty, `production`, `staging`, `ci`, `preview`, typos and anything else
 *      refuse. A missing variable is unknown, never proof that a database is
 *      safe.
 *   2. SEED_DEMO_DATA is explicitly `true`. The npm scripts never add it, so an
 *      operator has to type it deliberately.
 *   3. DATABASE_URL is a local `file:` database inside the project or the OS
 *      temporary directory, and its resolved path does not look like a
 *      production deployment target.
 *
 * The target check is a heuristic, not proof. It fails closed for every target
 * it cannot classify (remote schemes, unresolved interpolation, paths outside
 * the project and temp directory, and production-shaped paths). See the S-15
 * report for the remaining limitation: a production database placed inside an
 * otherwise ordinary project path cannot be distinguished by URL inspection
 * alone.
 */
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);
const PRODUCTION_ROOTS = ["/app", "/var", "/srv", "/opt", "/mnt", "/data"];

export type DemoSeedDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export function refuseDemoSeed(reason: string): never {
  console.error(`\nRefusing to seed demo data: ${reason}`);
  console.error(
    "Nothing was written. Production setup is `npx prisma migrate deploy`, then `npm run pilot:seed` with real account details.",
  );
  process.exit(1);
}

function normalise(value: string | undefined): string {
  return (value ?? "").replace(/["']/g, "").trim().toLowerCase();
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isProductionLikePath(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, "/");
  const lower = normalised.toLowerCase();
  const fileName = lower.split("/").pop() ?? "";

  if (/^(prod|production|live)(\.|[-_])/.test(fileName)) return true;
  if (/\.(prod|production|live)\./.test(fileName)) return true;

  return PRODUCTION_ROOTS.some(
    (root) => lower === root || lower.startsWith(`${root}/`),
  );
}

/**
 * Classifies the database target without connecting to it. Relative SQLite
 * paths are resolved the way Prisma resolves them: from the schema directory.
 */
export function classifyDemoSeedTarget(
  databaseUrl: string | undefined,
): DemoSeedDecision {
  const raw = (databaseUrl ?? "").trim();
  if (!raw) return { allowed: false, reason: "DATABASE_URL is not set." };

  if (raw.includes("${")) {
    return {
      allowed: false,
      reason:
        "DATABASE_URL contains unresolved environment interpolation, so the target cannot be classified.",
    };
  }

  const separator = raw.indexOf(":");
  const scheme = separator === -1 ? "" : raw.slice(0, separator).toLowerCase();
  if (scheme !== "file") {
    return {
      allowed: false,
      reason: `DATABASE_URL uses the ${scheme || "unrecognized"} scheme. Only a local file database can be verified as disposable.`,
    };
  }

  const rawPath = raw
    .slice(separator + 1)
    .split("?")[0]
    .replace(/^\/\//, "")
    .replace(/\\/g, "/");

  if (!rawPath) {
    return { allowed: false, reason: "DATABASE_URL has no file path." };
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(moduleDir, "..");
  const schemaDir = resolve(projectRoot, "prisma");
  const resolvedPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(schemaDir, rawPath);

  if (isProductionLikePath(resolvedPath)) {
    return {
      allowed: false,
      reason: `DATABASE_URL points at ${resolvedPath}, which matches a production deployment target.`,
    };
  }

  if (
    !isInside(projectRoot, resolvedPath) &&
    !isInside(resolve(tmpdir()), resolvedPath)
  ) {
    return {
      allowed: false,
      reason: `DATABASE_URL points at ${resolvedPath}, outside the project and the temporary directory. Only a disposable local target is accepted.`,
    };
  }

  return { allowed: true };
}

export function demoSeedRefusalReason(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const environment = normalise(env.NODE_ENV);
  if (!environment) {
    return "NODE_ENV is not set. Classify the environment explicitly: NODE_ENV=development or NODE_ENV=test.";
  }
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return `NODE_ENV=${environment} is not a demo environment; only development and test are accepted.`;
  }
  if (normalise(env.SEED_DEMO_DATA) !== "true") {
    return "SEED_DEMO_DATA=true is required. Set it for this one command; it is never applied automatically.";
  }

  const target = classifyDemoSeedTarget(env.DATABASE_URL);
  return target.allowed ? null : target.reason;
}

export function assertDemoSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const reason = demoSeedRefusalReason(env);
  if (reason) refuseDemoSeed(reason);
}
