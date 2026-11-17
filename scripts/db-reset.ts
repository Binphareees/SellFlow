/**
 * Guarded replacement for `prisma migrate reset`.
 *
 * `prisma migrate reset` drops and recreates the database before its seed hook
 * runs, so relying on the seed guard alone would allow a production database to
 * be destroyed and then left empty. This wrapper applies the same fail-closed
 * environment and target checks *before* Prisma is allowed to touch the
 * database, then runs reset with `--skip-seed` and seeds explicitly.
 *
 * The command is demo-only. It requires:
 *   NODE_ENV=development|test
 *   SEED_DEMO_DATA=true
 *   a disposable local file target (see scripts/seed-guard.ts)
 */
import { spawnSync } from "node:child_process";
import { demoSeedRefusalReason, refuseDemoSeed } from "./seed-guard";

const reason = demoSeedRefusalReason();
if (reason) {
  refuseDemoSeed(
    `${reason} Reset is refused before Prisma can drop or recreate the database.`,
  );
}

console.log("Resetting the disposable demo database (explicit opt-in confirmed)…");

const reset = spawnSync(
  "npx",
  ["prisma", "migrate", "reset", "--force", "--skip-seed"],
  { stdio: "inherit", env: process.env },
);
if (reset.status !== 0) process.exit(reset.status ?? 1);

const seed = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(seed.status ?? 1);
