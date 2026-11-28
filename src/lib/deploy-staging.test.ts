import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `scripts/deploy-staging.sh` against a shimmed host.
 *
 * The script needs a server, Docker and a `main` checkout, so every test here
 * builds a throwaway workspace: a git repo on `main` with the files the script
 * copies, a temp `REMOTE_ROOT` tree, and stand-ins for `ssh`, `docker`, `curl`
 * and `gzip` first on `PATH`. The ssh stand-in logs the command and runs it
 * locally, joining its arguments the way ssh does — which is also how the
 * nested quoting of the remote command string gets exercised.
 *
 * Behaviour covered: the first deploy (no backup, no reload), an unchanged and a
 * changed Caddyfile, a reload that fails twice, a reload that never succeeds, an
 * undeterminable `prod.db` check, a `docker save` that dies mid-stream, and the
 * three `--app-only` outcomes. The pasted drill log is in
 * docs/STAGING_RUNBOOK.md §16.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "deploy-staging.sh");
const REAL_GZIP = spawnSync("bash", ["-c", "command -v gzip"], { encoding: "utf8" }).stdout.trim();

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const SHIMS: Record<string, string> = {
  ssh: [
    "#!/usr/bin/env bash",
    "# Stand-in for ssh: logs the call, then runs the remote command here after",
    "# joining the arguments the way ssh does before handing them to the shell.",
    "set -uo pipefail",
    'state="${SHIM_STATE:?}"',
    "args=()",
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    "    -o) shift 2 ;;",
    "    -*) shift ;;",
    '    *) args+=("$1"); shift ;;',
    "  esac",
    "done",
    'if [ "${#args[@]}" -lt 2 ]; then',
    '  echo "ssh shim: expected a host and a command" >&2',
    "  exit 255",
    "fi",
    'cmd="${args[*]:1}"',
    'printf \'%s\\n\' "$cmd" >> "$state/ssh.log"',
    'if [ -n "${SSH_FAIL_MATCH:-}" ]; then',
    '  case "$cmd" in',
    '    *"$SSH_FAIL_MATCH"*) exit 255 ;;',
    "  esac",
    "fi",
    'exec bash -c "$cmd"',
  ].join("\n"),
  docker: [
    "#!/usr/bin/env bash",
    "# Stand-in for the docker CLI: logs every call and answers the four",
    "# subcommands the deploy uses.",
    "set -uo pipefail",
    'state="${SHIM_STATE:?}"',
    'printf \'%s\\n\' "$*" >> "$state/docker.log"',
    'all="$*"',
    'case "${1:-}" in',
    "  image)",
    '    for img in "${@:3}"; do',
    '      if [ -n "${DOCKER_MISSING_IMAGE:-}" ] && [ "$img" = "$DOCKER_MISSING_IMAGE" ]; then',
    "        exit 1",
    "      fi",
    "    done",
    "    exit 0",
    "    ;;",
    "  save)",
    "    printf 'fake image archive\\n'",
    '    if [ -n "${DOCKER_SAVE_FAIL:-}" ]; then exit 1; fi',
    "    exit 0",
    "    ;;",
    "  load)",
    "    cat > /dev/null",
    "    exit 0",
    "    ;;",
    "  build|tag)",
    "    exit 0",
    "    ;;",
    "  run)",
    '    case "$all" in',
    "      *backup-sqlite.mjs*)",
    '        if [ -n "${BACKUP_FAIL:-}" ]; then',
    '          echo "[backup] failed: BACKUP_INVALID" >&2',
    "          exit 1",
    "        fi",
    '        echo "[backup] wrote /app/backups/sellflow-test.db"',
    "        exit 0",
    "        ;;",
    "      *sellflow:migrator*)",
    '        printf \'migrator\\n\' >> "$state/migrator.log"',
    '        echo "All migrations have been successfully applied."',
    "        exit 0",
    "        ;;",
    "    esac",
    "    exit 0",
    "    ;;",
    "  compose)",
    '    case "$all" in',
    '      *"caddy reload"*)',
    "        n=0",
    '        if [ -f "$state/reload.count" ]; then n="$(cat "$state/reload.count")"; fi',
    "        n=$((n + 1))",
    '        printf \'%s\\n\' "$n" > "$state/reload.count"',
    '        if [ -n "${RELOAD_FAIL_ALWAYS:-}" ]; then',
    '          echo "Error: adapting config: caddyfile is not valid" >&2',
    "          exit 1",
    "        fi",
    '        if [ -n "${RELOAD_FAIL_TIMES:-}" ] && [ "$n" -le "$RELOAD_FAIL_TIMES" ]; then',
    '          echo "Error: sending configuration to instance: caddy is starting" >&2',
    "          exit 1",
    "        fi",
    "        exit 0",
    "        ;;",
    "    esac",
    "    exit 0",
    "    ;;",
    "esac",
    "exit 0",
  ].join("\n"),
  curl: [
    "#!/usr/bin/env bash",
    "# Stand-in for curl: the deploy only polls /api/health.",
    "set -uo pipefail",
    'printf \'%s\\n\' "$*" >> "${SHIM_STATE:?}/curl.log"',
    'case "$*" in',
    "  *'%{http_code}'*) printf '%s' \"${CURL_CODE:-200}\" ;;",
    '  *) printf \'{"status":"ok"}\' ;;',
    "esac",
  ].join("\n"),
  gzip: [
    "#!/usr/bin/env bash",
    "# Stand-in that logs and then hands the work to the real gzip, so the stream",
    "# is a real gzip stream and the remote gunzip is the real one.",
    "set -uo pipefail",
    'printf \'gzip %s\\n\' "$*" >> "${SHIM_STATE:?}/gzip.log"',
    'exec "${REAL_GZIP:?}" "$@"',
  ].join("\n"),
};

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Log lines the shims added during this run only. */
  ssh: string;
  docker: string;
  curl: string;
};

type Workspace = {
  repo: string;
  remote: string;
  state: string;
  /** Runs the real deploy script from the throwaway checkout. */
  run: (args: string[], env?: Record<string, string>) => RunResult;
  /** Commits a new/changed file and returns the new HEAD. */
  commit: (relPath: string, content: string) => string;
  head: () => string;
  log: (name: string) => string;
  writeRemote: (relPath: string, content: string) => void;
};

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ["-c", "user.email=deploy-test@example.com", "-c", "user.name=Deploy Test", "add", "-A"]);
  git(cwd, [
    "-c",
    "user.email=deploy-test@example.com",
    "-c",
    "user.name=Deploy Test",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function createWorkspace(): Workspace {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sellflow-deploy-"));
  tempDirs.push(dir);
  const repo = path.join(dir, "repo");
  const remote = path.join(dir, "remote");
  const state = path.join(dir, "state");
  const shims = path.join(dir, "shims");
  for (const sub of [
    repo,
    state,
    shims,
    path.join(remote, "app"),
    path.join(remote, "data"),
    path.join(remote, "backups"),
  ]) {
    mkdirSync(sub, { recursive: true });
  }

  // The files the script tars to the host, plus the guarded paths the
  // --app-only diff looks at — all tracked, so the checkout starts clean.
  const files: Record<string, string> = {
    "deploy/docker-compose.staging.yml": "services:\n  app:\n    image: sellflow:current\n",
    "deploy/Caddyfile": "staging.sellflow.shop {\n\treverse_proxy app:3000\n}\n",
    "prisma/migrations/0001_init/migration.sql": "-- init\n",
    "scripts/backup-sqlite.mjs": "// backup\n",
    Dockerfile: "FROM node:22-slim\n",
    ".dockerignore": "node_modules\n",
    "src/placeholder.ts": "export {};\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), content);
  }
  git(repo, ["init", "-q", "-b", "main"]);
  commitAll(repo, "initial");

  // The operator-owned files the script only checks for and never writes.
  writeFileSync(path.join(remote, "app", ".env.production"), "NODE_ENV=production\n");

  for (const [name, body] of Object.entries(SHIMS)) {
    const file = path.join(shims, name);
    writeFileSync(file, `${body}\n`);
    chmodSync(file, 0o755);
  }

  const log = (name: string) => {
    const file = path.join(state, name);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  };

  return {
    repo,
    remote,
    state,
    run: (args, env = {}) => {
      const before = {
        ssh: log("ssh.log").length,
        docker: log("docker.log").length,
        curl: log("curl.log").length,
      };
      const result = spawnSync("bash", [SCRIPT, ...args], {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          PATH: `${shims}:${process.env.PATH ?? ""}`,
          SSH_TARGET: "deploy@staging.invalid",
          REMOTE_ROOT: remote,
          SKIP_BUILD: "1",
          HEALTH_TIMEOUT: "6",
          SHIM_STATE: state,
          REAL_GZIP,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
          ...env,
        },
      });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        ssh: log("ssh.log").slice(before.ssh),
        docker: log("docker.log").slice(before.docker),
        curl: log("curl.log").slice(before.curl),
      };
    },
    commit: (relPath, content) => {
      const file = path.join(repo, relPath);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      return commitAll(repo, `add ${relPath}`);
    },
    head: () => git(repo, ["rev-parse", "HEAD"]),
    log,
    writeRemote: (relPath, content) => {
      const file = path.join(remote, relPath);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
  };
}

function countLines(text: string, needle: string): number {
  return text.split("\n").filter((line) => line.includes(needle)).length;
}

describe("deploy-staging.sh", () => {
  it("is valid bash and still documents its flags", () => {
    const check = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);

    const help = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--app-only");

    const bogus = spawnSync("bash", [SCRIPT, "--nope"], { encoding: "utf8" });
    expect(bogus.status).toBe(1);
    expect(bogus.stderr).toContain("unknown argument: --nope");
  });

  it("first deploy: no backup to take, no reload, health passes, ref recorded", () => {
    const ws = createWorkspace();
    const result = ws.run(["--yes"]);

    expect(result.status).toBe(0);
    // The ERR trap prints "stopped at line" — it must not have fired.
    expect(result.stderr).not.toContain("stopped at line");
    // No prod.db on the host yet.
    expect(result.stdout).toContain("nothing to back up");
    expect(result.docker).not.toContain("backup-sqlite.mjs");
    // Caddy is started by `up -d` with the file already mounted.
    expect(result.stdout).toContain("first deploy: Caddy starts with the Caddyfile already mounted");
    expect(result.ssh).not.toContain("caddy reload");
    expect(existsSync(path.join(ws.state, "reload.count"))).toBe(false);
    // The migration ran, the whole stack came up, the health gate passed.
    expect(ws.log("migrator.log")).toContain("migrator");
    expect(result.docker).toContain("up -d --force-recreate app");
    expect(countLines(result.docker, "compose")).toBeGreaterThanOrEqual(2);
    expect(result.stdout).toContain("health 200");
    // The deployed ref is written for the next --app-only.
    expect(readFileSync(path.join(ws.remote, "app", ".last-deployed-ref"), "utf8").trim()).toBe(ws.head());
  });

  it("second deploy, Caddyfile unchanged: backs up before migrating, no reload", () => {
    const ws = createWorkspace();
    expect(ws.run(["--yes"]).status).toBe(0);
    ws.writeRemote("data/prod.db", "pretend database\n");

    const result = ws.run(["--yes"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Caddyfile unchanged on the host");
    expect(result.stdout).toContain("Caddy not reloaded");
    expect(result.ssh).not.toContain("caddy reload");
    expect(existsSync(path.join(ws.state, "reload.count"))).toBe(false);

    const calls = result.docker.split("\n");
    expect(result.stdout).toContain("[backup] wrote");
    // Whole lines, not substrings: the image stream names all three images.
    const backupAt = calls.findIndex((line) => line.includes("backup-sqlite.mjs"));
    const migrateAt = calls.findIndex((line) => line.startsWith("run ") && line.includes("sellflow:migrator"));
    expect(backupAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(backupAt);
  });

  it("reloads Caddy exactly once when the Caddyfile on the host changed", () => {
    const ws = createWorkspace();
    expect(ws.run(["--yes"]).status).toBe(0);
    ws.writeRemote("app/deploy/Caddyfile", "drifted.example.com {\n\treverse_proxy app:3000\n}\n");

    const result = ws.run(["--yes"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("changed on the host");
    expect(ws.log("reload.count").trim()).toBe("1");
    expect(countLines(result.ssh, "caddy reload --config /etc/caddy/Caddyfile")).toBe(1);
  });

  it(
    "retries a failing reload and succeeds on the third attempt",
    () => {
      const ws = createWorkspace();
      expect(ws.run(["--yes"]).status).toBe(0);
      ws.writeRemote("app/deploy/Caddyfile", "drifted.example.com {\n\treverse_proxy app:3000\n}\n");

      const result = ws.run(["--yes"], { RELOAD_FAIL_TIMES: "2" });

      expect(result.status).toBe(0);
      expect(ws.log("reload.count").trim()).toBe("3");
      expect(countLines(result.stderr, "retrying in 3s")).toBe(2);
      expect(result.stderr).not.toContain("still serving the previous config");
    },
    60_000,
  );

  it(
    "gives up after five failed reloads and says the old config is still serving",
    () => {
      const ws = createWorkspace();
      expect(ws.run(["--yes"]).status).toBe(0);
      ws.writeRemote("app/deploy/Caddyfile", "drifted.example.com {\n\treverse_proxy app:3000\n}\n");

      const result = ws.run(["--yes"], { RELOAD_FAIL_ALWAYS: "1" });

      expect(result.status).toBe(1);
      expect(ws.log("reload.count").trim()).toBe("5");
      expect(result.stderr).toContain("still serving the previous config");
      expect(countLines(result.stderr, "retrying in 3s")).toBe(4);
    },
    60_000,
  );

  it("aborts before migrating when the prod.db check cannot be answered", () => {
    const ws = createWorkspace();
    const result = ws.run(["--yes"], { SSH_FAIL_MATCH: "prod.db && echo yes" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not determine whether");
    expect(existsSync(path.join(ws.state, "migrator.log"))).toBe(false);
    expect(result.docker).not.toContain("compose");
    expect(result.stdout).not.toContain("Applying migrations");
  });

  it("stops when docker save dies mid-stream, before any migration", () => {
    const ws = createWorkspace();
    const result = ws.run(["--yes"], { DOCKER_SAVE_FAIL: "1" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Streaming the images");
    expect(result.stdout).not.toContain("Applying migrations");
    expect(existsSync(path.join(ws.state, "migrator.log"))).toBe(false);
    expect(result.docker).not.toContain("compose");
  });

  it("--app-only refuses without a recorded ref from a full deploy", () => {
    const ws = createWorkspace();
    const result = ws.run(["--yes", "--app-only"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".last-deployed-ref");
    expect(result.docker).not.toContain("build");
    expect(result.docker).not.toContain("save");
  });

  it("--app-only refuses when a guarded path changed since the last full deploy", () => {
    const ws = createWorkspace();
    expect(ws.run(["--yes"]).status).toBe(0);
    ws.commit("prisma/migrations/0002_extra/migration.sql", "-- extra\n");

    const result = ws.run(["--yes", "--app-only"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("prisma/migrations/0002_extra/migration.sql");
    expect(result.stderr).toContain("run a full deploy");
    expect(result.docker).not.toContain("save");
    expect(result.docker).not.toContain("compose");
  });

  it("--app-only ships only sellflow:current when nothing guarded changed", () => {
    const ws = createWorkspace();
    expect(ws.run(["--yes"]).status).toBe(0);
    ws.commit("src/app-change.ts", "export const changed = true;\n");

    const result = ws.run(["--yes", "--app-only"]);

    expect(result.status).toBe(0);
    expect(result.docker).not.toContain("build");
    const saved = result.docker.split("\n").filter((line) => line.startsWith("save "));
    expect(saved).toEqual(["save sellflow:current"]);
    // The migrator still runs: only the build/ship half was skipped.
    expect(countLines(ws.log("migrator.log"), "migrator")).toBe(2);
  });
});
