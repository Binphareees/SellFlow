#!/usr/bin/env node
/**
 * SellFlow SQLite backup + retention.
 *
 * SQLite is a single file, but copying it while the app is running can capture a
 * torn state (pages mid-write, data still only in the WAL). `VACUUM INTO` writes
 * a transactionally consistent copy of the database as it stands at that moment,
 * and it refuses to overwrite an existing file, so a backup is never silently
 * replaced.
 *
 * Environment:
 *   DATABASE_URL            must be a `file:` SQLite URL; anything else is refused
 *   BACKUP_DIR              where backups are written (default ./backups)
 *   BACKUP_RETENTION_DAYS   backups older than this are pruned (default 14)
 *
 * Usage:
 *   npm run backup:db
 */
import { chmod, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const NAME_RE = /^sellflow-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;
const DAY_MS = 86_400_000;

/** A backup holds every account row: owner-only, and so does its directory. */
export const BACKUP_FILE_MODE = 0o600;
export const BACKUP_DIR_MODE = 0o700;

/**
 * Tables whose row counts make a backup meaningfully verifiable. Counts from the
 * copy are compared with the live database after every backup.
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

export function backupDirectory() {
  const configured = process.env.BACKUP_DIR?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : "backups");
}

export function retentionDays() {
  const configured = process.env.BACKUP_RETENTION_DAYS?.trim();
  if (!configured) return 14;
  const days = Number(configured);
  if (!Number.isFinite(days) || days < 0) return 14;
  return Math.floor(days);
}

/**
 * Resolves the database file behind DATABASE_URL. A relative `file:` path is
 * resolved from `prisma/`, which is how Prisma itself resolves it.
 */
export function databaseFile(url = process.env.DATABASE_URL ?? "") {
  if (!url.startsWith("file:")) {
    throw new Error(
      "BACKUP_REFUSED: DATABASE_URL is not a file: SQLite URL. Refusing to guess what to back up.",
    );
  }

  const withoutScheme = url.slice("file:".length).replace(/\?.*$/, "").trim();
  if (!withoutScheme) throw new Error("BACKUP_REFUSED: DATABASE_URL has no file path.");

  return path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.resolve("prisma", withoutScheme);
}

/** `sellflow-YYYYMMDDTHHMMSSZ.db`, always UTC so sort order is time order. */
export function backupFileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `sellflow-${stamp}.db`;
}

/** Parses a backup file name back into its UTC timestamp, or null if it is not one. */
export function backupTimestamp(name) {
  const match = NAME_RE.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Deletes only files this script created and only when older than the window.
 * `keep` protects a name regardless of its timestamp (the backup just written).
 */
export async function pruneBackups(
  dir = backupDirectory(),
  days = retentionDays(),
  now = new Date(),
  keep = [],
) {
  const cutoff = now.getTime() - days * DAY_MS;
  const removed = [];
  const protectedNames = new Set(keep);

  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return removed;
  }

  for (const name of entries) {
    if (protectedNames.has(name)) continue;
    const createdAt = backupTimestamp(name);
    if (!createdAt || createdAt.getTime() >= cutoff) continue;
    await unlink(path.join(dir, name));
    removed.push(name);
  }

  return removed;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function sqliteUrl(file) {
  return `file:${file}`;
}

function sqlLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Row counts per counted table; a table missing from an old backup counts as -1. */
export async function countRows(client) {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    try {
      const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${table}"`);
      counts[table] = Number(rows[0]?.n ?? 0);
    } catch {
      counts[table] = -1;
    }
  }
  return counts;
}

async function integrityOf(client) {
  const rows = await client.$queryRawUnsafe("PRAGMA integrity_check");
  return String(Object.values(rows[0] ?? {})[0] ?? "unknown");
}

/**
 * Decides whether a copy is a faithful snapshot of the live database.
 *
 * `VACUUM INTO` takes its snapshot somewhere between the two live samples, so
 * the copy's counts are expected to land in the closed window [before, after]:
 * anything outside it means rows were lost or invented by the copy. Returns the
 * list of problems, empty when the copy is trusted.
 */
export function verifyCopy({ before, after, copy, integrity }) {
  const problems = [];
  if (integrity !== "ok") problems.push(`integrity_check returned "${integrity}"`);

  for (const table of COUNTED_TABLES) {
    const copied = copy?.[table];
    if (typeof copied !== "number" || copied < 0) {
      problems.push(`${table} is missing from the copy`);
      continue;
    }

    const low = before?.[table];
    const high = after?.[table];
    // -1 means the table could not be counted on the live database; with no
    // window to compare against, the integrity check has to carry the verdict.
    if (typeof low !== "number" || typeof high !== "number" || low < 0 || high < 0) continue;

    const min = Math.min(low, high);
    const max = Math.max(low, high);
    if (copied < min || copied > max) {
      problems.push(`${table} has ${copied} rows in the copy, outside the live window ${min}-${max}`);
    }
  }

  return problems;
}

/**
 * Writes one backup and verifies it. Throws if the target already exists, or if
 * the copy fails its integrity check or its row counts fall outside the live
 * window; in that case the untrusted copy is deleted rather than left behind
 * looking restorable. `verify` exists so tests can force a failure.
 */
export async function runBackup({
  now = new Date(),
  dir = backupDirectory(),
  retention = retentionDays(),
  verify = verifyCopy,
} = {}) {
  const source = databaseFile();
  await stat(source); // fail loudly on a wrong path instead of writing an empty backup

  await mkdir(dir, { recursive: true, mode: BACKUP_DIR_MODE });
  // mkdir's mode only applies to a directory it creates and is filtered by the
  // umask, so tighten an existing one as well.
  await chmod(dir, BACKUP_DIR_MODE);

  const name = backupFileName(now);
  const target = path.join(dir, name);

  if (await exists(target)) {
    throw new Error(`BACKUP_REFUSED: ${target} already exists; backups are never overwritten.`);
  }

  const live = new PrismaClient({ datasourceUrl: sqliteUrl(source) });
  let before;
  let after;
  try {
    before = await countRows(live);
    await live.$executeRawUnsafe(`VACUUM INTO ${sqlLiteral(target)}`);
    after = await countRows(live);
  } finally {
    await live.$disconnect();
  }

  // SQLite creates the copy with the process umask, so tighten it immediately.
  await chmod(target, BACKUP_FILE_MODE);

  const copy = new PrismaClient({ datasourceUrl: sqliteUrl(target) });
  let integrity;
  let copyCounts;
  try {
    integrity = await integrityOf(copy);
    copyCounts = await countRows(copy);
  } finally {
    await copy.$disconnect();
  }

  const problems = verify({ before, after, copy: copyCounts, integrity });
  if (problems.length > 0) {
    await unlink(target).catch(() => {});
    throw new Error(`BACKUP_INVALID: ${problems.join("; ")}. Removed ${target}.`);
  }

  const pruned = await pruneBackups(dir, retention, now, [name]);

  return {
    file: target,
    name,
    source,
    integrity,
    counts: copyCounts,
    before,
    after,
    pruned,
    retentionDays: retention,
    sizeBytes: (await stat(target)).size,
  };
}

async function main() {
  const result = await runBackup();
  console.log(`[backup] wrote ${result.file} (${result.sizeBytes} bytes)`);
  console.log(`[backup] integrity_check: ${result.integrity}`);
  for (const [table, count] of Object.entries(result.counts)) {
    console.log(`[backup]   ${table}: ${count}`);
  }
  console.log(
    `[backup] pruned ${result.pruned.length} backup(s) older than ${result.retentionDays} day(s)${
      result.pruned.length > 0 ? `: ${result.pruned.join(", ")}` : ""
    }`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[backup] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
