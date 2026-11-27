import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type BackupResult = {
  file: string;
  name: string;
  source: string;
  integrity: string;
  counts: Record<string, number>;
  before: Record<string, number>;
  after: Record<string, number>;
  pruned: string[];
  retentionDays: number;
  sizeBytes: number;
};

type BackupOptions = {
  now?: Date;
  dir?: string;
  retention?: number;
  verify?: (input: {
    before: Record<string, number>;
    after: Record<string, number>;
    copy: Record<string, number>;
    integrity: string;
  }) => string[];
};

type BackupModule = {
  runBackup: (options?: BackupOptions) => Promise<BackupResult>;
  pruneBackups: (dir?: string, days?: number, now?: Date, keep?: string[]) => Promise<string[]>;
  retentionDays: () => number;
  backupFileName: (now?: Date) => string;
  databaseFile: (url?: string) => string;
  verifyCopy: (input: {
    before: Record<string, number>;
    after: Record<string, number>;
    copy: Record<string, number>;
    integrity: string;
  }) => string[];
  COUNTED_TABLES: string[];
  BACKUP_FILE_MODE: number;
  BACKUP_DIR_MODE: number;
};

/** Every counted table at the same value, so a test can vary one of them. */
function countsAt(value: number) {
  return Object.fromEntries(backup.COUNTED_TABLES.map((table) => [table, value]));
}

// The script is plain Node ESM outside the TypeScript project, so it is imported
// by URL at runtime; no types are resolved for it by tsc.
const moduleUrl = pathToFileURL(path.join(process.cwd(), "scripts", "backup-sqlite.mjs")).href;
const backup = (await import(/* @vite-ignore */ moduleUrl)) as BackupModule;

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run backup tests against prisma/dev.db. Point DATABASE_URL at a disposable database.",
  );
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sellflow-backup-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SQLite backup", () => {
  it("writes a consistent copy that passes integrity_check with matching row counts", async () => {
    const result = await backup.runBackup({ dir, now: new Date("2026-11-27T10:00:00Z") });

    expect(result.name).toBe("sellflow-20261127T100000Z.db");
    expect(result.integrity).toBe("ok");
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.counts.User).toBeGreaterThan(0);

    const copy = new PrismaClient({ datasourceUrl: `file:${result.file}` });
    const live = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const integrity = await copy.$queryRawUnsafe<Array<Record<string, string>>>("PRAGMA integrity_check");
      expect(Object.values(integrity[0] ?? {})[0]).toBe("ok");
      expect(await copy.user.count()).toBe(await live.user.count());
    } finally {
      await copy.$disconnect();
      await live.$disconnect();
    }
  });

  it("never overwrites an existing backup", async () => {
    const now = new Date("2026-11-27T11:00:00Z");
    await backup.runBackup({ dir, now });

    await expect(backup.runBackup({ dir, now })).rejects.toThrow(/already exists/);
  });

  it("defaults the retention window to 14 days when nothing is configured", () => {
    const saved = process.env.BACKUP_RETENTION_DAYS;
    delete process.env.BACKUP_RETENTION_DAYS;
    try {
      expect(backup.retentionDays()).toBe(14);
    } finally {
      if (saved !== undefined) process.env.BACKUP_RETENTION_DAYS = saved;
    }
  });

  it("keeps the backup just written even if the window is zero days", async () => {
    const fresh = await backup.runBackup({ dir, now: new Date("2026-11-27T13:00:00Z"), retention: 0 });

    expect(await readdir(dir)).toContain(fresh.name);
    expect(fresh.pruned).not.toContain(fresh.name);
  });

  it("refuses a DATABASE_URL that is not a file: URL", () => {
    expect(() => backup.databaseFile("postgresql://user:pass@host:5432/db")).toThrow(/BACKUP_REFUSED/);
    expect(() => backup.databaseFile("file:")).toThrow(/BACKUP_REFUSED/);
  });

  it("prunes only the backups older than the retention window", async () => {
    const oldName = backup.backupFileName(new Date(Date.now() - 30 * 86_400_000));
    const freshName = backup.backupFileName(new Date(Date.now() - 1 * 86_400_000));
    await writeFile(path.join(dir, oldName), "old");
    await writeFile(path.join(dir, freshName), "fresh");

    const removed = await backup.pruneBackups(dir, 14);

    expect(removed).toEqual([oldName]);
    expect(await readdir(dir)).toContain(freshName);
  });

  it("proves a restore: a copied backup answers a real query", async () => {
    const result = await backup.runBackup({ dir, now: new Date("2026-11-27T12:00:00Z") });
    const restored = path.join(dir, "restored.db");
    await copyFile(result.file, restored);

    const client = new PrismaClient({ datasourceUrl: `file:${restored}` });
    try {
      expect(await client.user.count()).toBe(result.counts.User);
      const [row] = await client.$queryRawUnsafe<Array<Record<string, string>>>("PRAGMA integrity_check");
      expect(Object.values(row ?? {})[0]).toBe("ok");
    } finally {
      await client.$disconnect();
    }
  });

  it("writes the backup and its directory owner-only", async () => {
    const privateDir = path.join(dir, "private");
    const result = await backup.runBackup({ dir: privateDir, now: new Date("2026-11-27T14:00:00Z") });

    const fileMode = (await stat(result.file)).mode & 0o777;
    const dirMode = (await stat(privateDir)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it("deletes the new copy when validation fails", async () => {
    const failingDir = path.join(dir, "failing");
    await mkdir(failingDir);
    const now = new Date("2026-11-27T15:00:00Z");

    await expect(
      backup.runBackup({
        dir: failingDir,
        now,
        verify: () => ['integrity_check returned "corrupt"'],
      }),
    ).rejects.toThrow(/BACKUP_INVALID/);

    expect(await readdir(failingDir)).toEqual([]);
    expect(await readdir(failingDir)).not.toContain(backup.backupFileName(now));
  });

  it("accepts copy counts inside the live window and rejects counts outside it", () => {
    const before = countsAt(5);
    const after = countsAt(7);
    const inside = countsAt(6);

    // Anywhere between the two live samples is a valid snapshot point.
    expect(backup.verifyCopy({ before, after, copy: inside, integrity: "ok" })).toEqual([]);
    // The boundaries themselves are inclusive.
    expect(backup.verifyCopy({ before, after, copy: before, integrity: "ok" })).toEqual([]);
    expect(backup.verifyCopy({ before, after, copy: after, integrity: "ok" })).toEqual([]);

    // Fewer rows than the earlier sample, or more than the later one, is a bad copy.
    const lost = backup.verifyCopy({ before, after, copy: { ...inside, User: 4 }, integrity: "ok" });
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatch(/User has 4 rows.*5-7/);

    const invented = backup.verifyCopy({ before, after, copy: { ...inside, AuditLog: 8 }, integrity: "ok" });
    expect(invented).toHaveLength(1);
    expect(invented[0]).toMatch(/AuditLog has 8 rows.*5-7/);

    // A failed integrity check is always fatal, whatever the counts say.
    expect(backup.verifyCopy({ before, after, copy: inside, integrity: "corrupt" })).toHaveLength(1);
  });

  it("records the live row counts around the copy", async () => {
    const result = await backup.runBackup({ dir, now: new Date("2026-11-27T16:00:00Z") });

    for (const table of Object.keys(result.counts)) {
      expect(result.counts[table]).toBeGreaterThanOrEqual(Math.min(result.before[table], result.after[table]));
      expect(result.counts[table]).toBeLessThanOrEqual(Math.max(result.before[table], result.after[table]));
    }
  });
});
