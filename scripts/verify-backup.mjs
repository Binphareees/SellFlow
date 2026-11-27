#!/usr/bin/env node
/**
 * SellFlow backup verifier.
 *
 *   node scripts/verify-backup.mjs ~/sellflow-backups/sellflow-20261128T021500Z.db
 *   npm run verify:backup -- ~/sellflow-backups/<file>.db
 *
 * Opens the file READ-ONLY (no journal, no lock, no write of any kind), runs
 * `PRAGMA integrity_check` and prints the same table counts `backup:db` records,
 * so a pulled copy can be compared with what the host logged at backup time.
 *
 * Exit codes: 0 the copy is sound, 1 anything wrong with it, 2 bad usage.
 *
 * Node 22+ is required: this uses `node:sqlite`, which is not in Node 20.
 */
import { existsSync, statSync } from "node:fs";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

/**
 * Kept identical to `COUNTED_TABLES` in scripts/backup-sqlite.mjs.
 * `src/lib/verify-backup.test.ts` fails if the two lists ever drift, because
 * comparing this output with the backup log is the whole point.
 */
export const COUNTED_TABLES = [
  "User",
  "Profile",
  "BusinessWorkspace",
  "Product",
  "ProductListing",
  "SupplierOrder",
  "PaymentStatusClaim",
  "AuditLog",
];

function usage(code) {
  const stream = code === 2 ? process.stderr : process.stdout;
  stream.write(
    `SellFlow backup verifier

Usage:
  node scripts/verify-backup.mjs <backup-file>
  npm run verify:backup -- <backup-file>

Opens the file read-only, runs PRAGMA integrity_check, prints row counts.
Exit 0 = sound copy, 1 = problem found, 2 = bad usage.
`,
  );
  process.exit(code);
}

/**
 * Verifies one SQLite file. Never writes to it: `readOnly` is passed to the
 * driver, and every statement is a SELECT or a PRAGMA.
 *
 * A table that cannot be counted is reported as a problem rather than as 0 —
 * "missing" and "empty" are different answers when the question is whether a
 * backup is restorable.
 */
export function verifyBackupFile(file) {
  const problems = [];
  const counts = {};
  let integrity = "unknown";

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(file).size;
  } catch (error) {
    return { ok: false, file, sizeBytes, integrity, counts, problems: [`cannot stat: ${error.message}`] };
  }

  if (sizeBytes === 0) {
    return { ok: false, file, sizeBytes, integrity, counts, problems: ["file is empty"] };
  }

  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    return { ok: false, file, sizeBytes, integrity, counts, problems: [`cannot open: ${error.message}`] };
  }

  try {
    try {
      const rows = db.prepare("PRAGMA integrity_check").all();
      integrity = String(Object.values(rows[0] ?? {})[0] ?? "unknown");
      // integrity_check returns one "ok" row on success and up to 100 problem
      // rows otherwise; only the first is printed, the count is reported too.
      if (rows.length > 1) problems.push(`integrity_check returned ${rows.length} problem rows`);
    } catch (error) {
      integrity = "unreadable";
      problems.push(`integrity_check failed: ${error.message}`);
    }

    if (integrity !== "ok") problems.push(`integrity_check returned "${integrity}"`);

    for (const table of COUNTED_TABLES) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get();
        counts[table] = Number(row?.n ?? 0);
      } catch (error) {
        counts[table] = -1;
        problems.push(`${table}: ${error.message}`);
      }
    }
  } finally {
    try {
      db.close();
    } catch {
      // A close failure on a corrupt file is not a new problem.
    }
  }

  return { ok: problems.length === 0, file, sizeBytes, integrity, counts, problems };
}

function main(argv) {
  const file = argv[0];
  if (!file || file === "--help" || file === "-h") usage(file ? 0 : 2);
  if (!existsSync(file)) {
    process.stderr.write(`[verify] FAILED: no such file: ${file}\n`);
    return 1;
  }

  const result = verifyBackupFile(file);

  process.stdout.write(`[verify] file: ${result.file} (${result.sizeBytes} bytes)\n`);
  process.stdout.write(`[verify] integrity_check: ${result.integrity}\n`);
  for (const [table, count] of Object.entries(result.counts)) {
    process.stdout.write(`[verify]   ${table}: ${count === -1 ? "unreadable" : count}\n`);
  }

  if (!result.ok) {
    for (const problem of result.problems) {
      process.stderr.write(`[verify] FAILED: ${problem}\n`);
    }
    return 1;
  }

  process.stdout.write("[verify] OK\n");
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith("verify-backup.mjs");

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}