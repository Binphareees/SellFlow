import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Offsite backup tooling: `scripts/verify-backup.mjs` (read-only verifier) and
 * `scripts/pull-backups.sh` (additive rsync pull). Both run on the laptop, so
 * the tests run them the way the operator does — as commands — against real
 * files in a temporary directory, with the rsync transport replaced by a local
 * shim so nothing leaves the machine.
 */

type VerifyResult = {
  ok: boolean;
  file: string;
  sizeBytes: number;
  integrity: string;
  counts: Record<string, number>;
  problems: string[];
};

type VerifyModule = {
  COUNTED_TABLES: string[];
  verifyBackupFile: (file: string) => VerifyResult;
};

type BackupModule = {
  runBackup: (options?: { dir?: string; now?: Date }) => Promise<{
    file: string;
    counts: Record<string, number>;
  }>;
  COUNTED_TABLES: string[];
};

const scriptsDir = path.join(process.cwd(), "scripts");
const verify = (await import(
  /* @vite-ignore */ pathToFileURL(path.join(scriptsDir, "verify-backup.mjs")).href
)) as VerifyModule;
const backup = (await import(
  /* @vite-ignore */ pathToFileURL(path.join(scriptsDir, "backup-sqlite.mjs")).href
)) as BackupModule;

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run backup tests against prisma/dev.db. Point DATABASE_URL at a disposable database.",
  );
}

const VERIFY_CLI = path.join(scriptsDir, "verify-backup.mjs");
const PULL_CLI = path.join(scriptsDir, "pull-backups.sh");
const REMOTE_BACKUP_DIR = "/srv/sellflow/backups";

let dir: string;
let goodBackup: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sellflow-offsite-test-"));
  // A real backup, written by the real script, so the verifier is measured
  // against the artefact it will actually see.
  const result = await backup.runBackup({ dir, now: new Date("2026-11-28T02:15:00Z") });
  goodBackup = result.file;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Reads the first `bytes` bytes of a file into a new one (a truncated copy). */
async function truncateCopy(source: string, target: string, bytes: number) {
  const buffer = await readFile(source);
  await writeFile(target, buffer.subarray(0, bytes));
}

describe("verify-backup", () => {
  it("counts exactly the tables the backup script reports", () => {
    expect(verify.COUNTED_TABLES).toEqual(backup.COUNTED_TABLES);
  });

  it("accepts a backup the backup script just wrote, with the same counts", async () => {
    const result = verify.verifyBackupFile(goodBackup);

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.integrity).toBe("ok");
    expect(result.sizeBytes).toBeGreaterThan(0);
    for (const table of verify.COUNTED_TABLES) {
      expect(result.counts[table]).toBeGreaterThanOrEqual(0);
    }
    expect(result.counts.User).toBeGreaterThan(0);
  });

  it("rejects a truncated copy", async () => {
    const truncated = path.join(dir, "truncated.db");
    await truncateCopy(goodBackup, truncated, 512);

    const result = verify.verifyBackupFile(truncated);

    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("rejects a corrupted copy", async () => {
    const corrupted = path.join(dir, "corrupted.db");
    const buffer = Buffer.from(await readFile(goodBackup));
    // Scribble over page 1 but keep the file length: a header that no longer
    // describes the database, which is what a bad disk or a half-written copy
    // looks like.
    buffer.fill(0xff, 16, 200);
    await writeFile(corrupted, buffer);

    const result = verify.verifyBackupFile(corrupted);

    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/integrity_check|malformed|unreadable|User/);
  });

  it("rejects an empty file and a missing file", async () => {
    const empty = path.join(dir, "empty.db");
    await writeFile(empty, "");

    expect(verify.verifyBackupFile(empty).ok).toBe(false);
    expect(verify.verifyBackupFile(path.join(dir, "does-not-exist.db")).ok).toBe(false);
  });

  it("opens the backup read-only: no journal, no lock, mtime unchanged", async () => {
    const copy = path.join(dir, "readonly-probe.db");
    await writeFile(copy, await readFile(goodBackup));
    const before = await stat(copy);

    const result = verify.verifyBackupFile(copy);
    const after = await stat(copy);

    expect(result.ok).toBe(true);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(dir)).not.toContain("readonly-probe.db-wal");
    expect(await readdir(dir)).not.toContain("readonly-probe.db-journal");
  });

  it("exits 0 on a good backup and 1 on a bad one", async () => {
    const good = spawnSync(process.execPath, [VERIFY_CLI, goodBackup], { encoding: "utf8" });
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("[verify] integrity_check: ok");
    expect(good.stdout).toContain("[verify] OK");

    const bad = spawnSync(process.execPath, [VERIFY_CLI, path.join(dir, "truncated.db")], {
      encoding: "utf8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("[verify] FAILED");

    const noArgs = spawnSync(process.execPath, [VERIFY_CLI], { encoding: "utf8" });
    expect(noArgs.status).toBe(2);
  });
});

describe("pull-backups", () => {
  /**
   * Stands in for ssh: rsync invokes it as `<shim> <host> rsync --server …`, and
   * the shim runs that rsync locally with the remote backup directory rewritten
   * to a temporary one.
   */
  async function writeShim(shimPath: string) {
    await writeFile(
      shimPath,
      [
        "#!/usr/bin/env bash",
        "set -Eeuo pipefail",
        // rsync calls the transport as `ssh -l <user> <host> <command>`; drop
        // the option words, then the host, and run the rsync command locally.
        'while [ $# -gt 0 ]; do case "$1" in -l) shift 2 ;; -*) shift ;; *) break ;; esac; done',
        "shift",
        "args=()",
        'for a in "$@"; do args+=("${a//\\/srv\\/sellflow\\/backups/$FAKE_REMOTE}"); done',
        'exec "${args[@]}"',
        "",
      ].join("\n"),
    );
    await chmod(shimPath, 0o755);
  }

  function pull(shim: string, remote: string, dest: string) {
    return spawnSync("bash", [PULL_CLI, dest], {
      encoding: "utf8",
      env: {
        ...process.env,
        SSH_TARGET: "backup@staging.invalid",
        REMOTE_BACKUP_DIR,
        RSYNC_SSH: shim,
        FAKE_REMOTE: remote,
      },
    });
  }

  it("copies new backups, keeps them 0600 in a 0700 directory, and never deletes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sellflow-pull-test-"));
    try {
      const remote = path.join(root, "remote");
      const dest = path.join(root, "local");
      const shim = path.join(root, "ssh-shim");
      await mkdir(remote);
      await writeShim(shim);

      const first = path.join(remote, "sellflow-20261127T021500Z.db");
      const second = path.join(remote, "sellflow-20261128T021500Z.db");
      await writeFile(first, await readFile(goodBackup));
      await writeFile(second, await readFile(goodBackup));

      // A copy that exists only here: the host never had it (or already pruned
      // it). It must survive every pull.
      await mkdir(dest, { mode: 0o700 });
      const localOnly = path.join(dest, "sellflow-20261101T021500Z.db");
      await writeFile(localOnly, "kept only on this laptop");

      const run = pull(shim, remote, dest);
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(await readdir(dest)).toEqual(
        expect.arrayContaining([
          "sellflow-20261127T021500Z.db",
          "sellflow-20261128T021500Z.db",
          "sellflow-20261101T021500Z.db",
        ]),
      );
      expect((await stat(path.join(dest, "sellflow-20261127T021500Z.db"))).mode & 0o777).toBe(0o600);
      expect((await stat(dest)).mode & 0o777).toBe(0o700);
      expect(await readFile(localOnly, "utf8")).toBe("kept only on this laptop");

      // The remote copies disappear (retention pruned them, or the host is
      // gone). A second pull must not remove anything locally.
      await rm(first);
      await rm(second);
      const again = pull(shim, remote, dest);
      expect(again.stderr).toBe("");
      expect(again.status).toBe(0);
      expect(await readdir(dest)).toEqual(
        expect.arrayContaining([
          "sellflow-20261127T021500Z.db",
          "sellflow-20261128T021500Z.db",
          "sellflow-20261101T021500Z.db",
        ]),
      );
      expect(await readFile(localOnly, "utf8")).toBe("kept only on this laptop");
      // The previously pulled copies are still readable backups.
      expect(verify.verifyBackupFile(path.join(dest, "sellflow-20261128T021500Z.db")).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to run without a directory or a target", () => {
    const noDest = spawnSync("bash", [PULL_CLI], {
      encoding: "utf8",
      env: { ...process.env, SSH_TARGET: "backup@staging.invalid" },
    });
    expect(noDest.status).toBe(1);
    expect(noDest.stderr).toContain("usage:");

    const noTarget = spawnSync("bash", [PULL_CLI, "/tmp/never-created"], {
      encoding: "utf8",
      env: { ...process.env, SSH_TARGET: "" },
    });
    expect(noTarget.status).toBe(1);
    expect(noTarget.stderr).toContain("SSH_TARGET is not set");
  });
});