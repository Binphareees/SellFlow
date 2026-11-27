import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
  pruned: string[];
  retentionDays: number;
  sizeBytes: number;
};

type BackupModule = {
  runBackup: (options?: { now?: Date; dir?: string; retention?: number }) => Promise<BackupResult>;
  pruneBackups: (dir?: string, days?: number, now?: Date, keep?: string[]) => Promise<string[]>;
  retentionDays: () => number;
  backupFileName: (now?: Date) => string;
  databaseFile: (url?: string) => string;
};

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
});
