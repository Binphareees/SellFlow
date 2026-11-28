import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `scripts/deploy-staging.sh` — the laptop-side deploy for staging. The script
 * itself needs a host, Docker and a `main` checkout, so these tests check the
 * invariants that a shell-level rehearsal keeps proving and a refactor can
 * quietly drop: the ssh keepalives, pipefail on both halves of the image stream,
 * the pre-migration backup, the whole-stack `up -d` and the Caddy reload.
 *
 * The behavioural proofs (dry run, shimmed rehearsal, failure paths, a `docker
 * save` that dies mid-stream) are pasted into the drill log in
 * docs/STAGING_RUNBOOK.md §16.
 */

const scriptPath = path.join(process.cwd(), "scripts", "deploy-staging.sh");
const runbookPath = path.join(process.cwd(), "docs", "STAGING_RUNBOOK.md");

let script: string;
let runbook: string;

beforeAll(async () => {
  script = await readFile(scriptPath, "utf8");
  runbook = await readFile(runbookPath, "utf8");
});

function run(args: string[]) {
  return spawnSync("bash", [scriptPath, ...args], { encoding: "utf8", timeout: 20_000 });
}

describe("deploy-staging.sh", () => {
  it("is valid bash", () => {
    const check = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  it("documents --app-only and still refuses an unknown flag", () => {
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--app-only");

    const bogus = run(["--nope"]);
    expect(bogus.status).toBe(1);
    expect(bogus.stderr).toContain("unknown argument: --nope");
  });

  it("keeps every ssh invocation alive (ServerAliveInterval/CountMax)", () => {
    // Two direct calls (run_remote, remote_capture) take the options array,
    // two calls inside pipelines interpolate the same flags as a string.
    const arrayCalls = script.match(/ssh "\$\{SSH_OPTS\[@\]\}"/g) ?? [];
    const stringCalls = script.match(/ssh \$\{SSH_OPTS\[\*\]\}/g) ?? [];
    expect(arrayCalls).toHaveLength(2);
    expect(stringCalls).toHaveLength(2);

    // No ssh call bypasses the options.
    expect(script).not.toContain('ssh "$SSH_TARGET"');
    expect(script).not.toContain("| ssh $(q");

    const opts = script.match(/SSH_OPTS=\((.*)\)/)?.[1] ?? "";
    expect(opts).toContain("-o ServerAliveInterval=30");
    expect(opts).toContain("-o ServerAliveCountMax=6");
  });

  it("runs both halves of the image stream under pipefail", () => {
    const code = script
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    const pipefail = code.match(/bash -o pipefail -c/g) ?? [];
    // One in run_shell, one as the remote wrapper of the streamed load.
    expect(pipefail).toHaveLength(2);

    const streamLine = script
      .split("\n")
      .find((line) => line.includes("docker save $IMAGES") && line.includes("gzip -1"));
    expect(streamLine).toBeDefined();
    // ssh joins its arguments, so the whole remote command (pipefail wrapper
    // and the load script inside it) must be ONE quoted argument, not
    // `bash -c` plus a separately quoted script.
    expect(streamLine).toContain('bash -o pipefail -c $(q "$remote_load")');
    // host, remote command, and the load script nested inside the remote command.
    expect(streamLine?.match(/\$\(q /g)).toHaveLength(3);
  });

  it("backs up the database with the section-12 command before migrating", () => {
    const backupAt = script.indexOf("Backing up the database before migrating");
    const migrateAt = script.indexOf("Applying migrations");
    expect(backupAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(backupAt);

    const backupBlock = script.slice(backupAt, migrateAt);
    expect(backupBlock).toContain("test -f $REMOTE_ROOT/data/prod.db");
    expect(backupBlock).toContain(
      "docker run --rm --entrypoint node -v $REMOTE_ROOT/data:/app/data -v $REMOTE_ROOT/backups:/app/backups -e BACKUP_DIR=/app/backups sellflow:pilot /app/scripts/backup-sqlite.mjs",
    );
    // A first deploy (no database) continues, and the failure path aborts.
    expect(backupBlock).toContain("nothing to back up");
    expect(backupBlock).toContain("exit 1");

    // The documented nightly command is the same one.
    expect(runbook).toContain("sellflow:pilot /app/scripts/backup-sqlite.mjs");
  });

  it("brings the whole stack up after recreating the app", () => {
    const recreateAt = script.indexOf("up -d --force-recreate app\"");
    const upAt = script.indexOf('${COMPOSE} up -d"');
    expect(recreateAt).toBeGreaterThan(-1);
    expect(upAt).toBeGreaterThan(recreateAt);
  });

  it("reloads Caddy from the runbook's path, and only when the file changed", () => {
    expect(script).toContain("exec -T caddy caddy reload --config /etc/caddy/Caddyfile");
    expect(script).toContain("$DEPLOY_DIR/Caddyfile");
    expect(script).toContain("caddy_sha_before");
    expect(script).toContain("caddy_sha_after");
    expect(script).toContain('if [ "$RELOAD_CADDY" = 1 ]');
  });

  it("ships only sellflow:current with --app-only and refuses a host without the rest", () => {
    expect(script).toContain('IMAGES="sellflow:current"');
    expect(script).toContain("docker save $IMAGES");
    expect(script).toContain("docker image inspect sellflow:migrator sellflow:pilot");
    expect(script).toContain("--app-only ships only sellflow:current");
    // Default behaviour still ships all three.
    expect(script).toContain('IMAGES="sellflow:current sellflow:migrator sellflow:pilot"');
  });
});
