#!/usr/bin/env node
/**
 * SellFlow operator privilege script — platform admin and mediator grants.
 *
 * OPERATOR ONLY. This file is a shell tool, not part of the web application:
 * nothing under src/app imports it, no HTTP route can reach it, and it must stay
 * that way. The only way to run it is a shell on the server with the database.
 *
 * What it does:
 *   --platform-admin  sets User.isPlatformAdmin (the flag `requirePlatformAdmin`
 *                     reads) on an existing account
 *   --mediator        adds/removes the MEDIATOR ProfileRole (`isMediator`)
 *   --revoke          removes the privilege instead of granting it
 *
 * Rules enforced here:
 *   - the account must already exist; this script never creates users;
 *   - DATABASE_URL must be a file: URL (a local SQLite database), never a
 *     remote server URL;
 *   - the change must be confirmed by typing "grant" or by passing --yes;
 *   - a no-op is reported as such: no audit row, no session churn;
 *   - every real change writes an AuditLog row (actor "operator-script") and
 *     revokes every live session of the target account in the SAME
 *     transaction, so a stale token can never outlive the privilege change.
 *
 * It prints account identifiers and counts only. It never reads, prints or
 * stores passwords, password hashes or session tokens.
 *
 * Usage:
 *   npm run admin:grant -- --email person@example.com --mediator
 *   npm run admin:grant -- --email person@example.com --platform-admin --revoke
 *   npm run admin:grant -- --email person@example.com --mediator --yes
 *
 * Inside the staging image (same env and bind mount as the app):
 *   docker run --rm --env-file .env.production \
 *     -v /srv/sellflow/data:/app/data \
 *     --entrypoint node sellflow:pilot /app/scripts/manage-privileged.mjs \
 *     --email person@example.com --mediator
 *
 * Exit codes: 0 applied or already in the requested state, 1 unexpected error,
 * 2 refused (bad input, unknown account, wrong database, no confirmation).
 */

import process, { stdin, stdout, stderr } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

export const CONFIRMATION_WORD = "grant";
export const OPERATOR_ACTOR = "operator-script";
export const AUDIT_ACTION = {
  GRANTED: "operator.privilege_granted",
  REVOKED: "operator.privilege_revoked",
};

const PRIVILEGES = {
  "platform-admin": {
    label: "PLATFORM_ADMIN",
    entityType: "User",
    role: "PLATFORM_ADMIN",
  },
  mediator: {
    label: "MEDIATOR",
    entityType: "Profile",
    role: "MEDIATOR",
  },
};

/** A refusal: bad input or an unsafe target. Always exits 2, never writes. */
export class OperatorRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "OperatorRefusal";
  }
}

function fail(message) {
  throw new OperatorRefusal(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing and guards (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = {
    email: null,
    privilege: null,
    revoke: false,
    yes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--revoke") opts.revoke = true;
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--email" || arg.startsWith("--email=")) {
      const value = arg === "--email" ? argv[(i += 1)] : arg.slice("--email=".length);
      if (!value || value.startsWith("--")) fail("--email needs a value");
      opts.email = value.trim();
    } else if (arg === "--platform-admin" || arg === "--mediator") {
      const privilege = arg.slice(2);
      if (opts.privilege && opts.privilege !== privilege) {
        fail("Choose exactly one of --platform-admin or --mediator, not both");
      }
      opts.privilege = privilege;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (opts.help) return opts;
  if (!opts.email || !opts.email.includes("@")) fail("--email is required");
  if (!opts.privilege) fail("Choose exactly one of --platform-admin or --mediator");
  return opts;
}

/**
 * The only database this script will touch. A file: URL is a local SQLite file
 * the operator can see and back up; anything else (postgres://, mysql://, an
 * empty value) is refused rather than guessed at.
 */
export function assertFileDatabaseUrl(url) {
  if (!url || !url.trim()) fail("DATABASE_URL is not set");
  const value = url.trim();
  if (!value.startsWith("file:")) {
    fail("Refusing to run: DATABASE_URL is not a file: URL (this script only manages a local SQLite database)");
  }
  if (value.length <= "file:".length) fail("Refusing to run: DATABASE_URL has no database path");
  return value;
}

export function normaliseEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function privilegeLabel(privilege) {
  const meta = PRIVILEGES[privilege];
  if (!meta) fail(`Unknown privilege: ${privilege}`);
  return meta.label;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database work (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

function selectUser(tx, email) {
  return tx.user.findUnique({
    where: { email },
    include: { profile: { include: { roles: true } } },
  });
}

function requireUser(user, email) {
  if (!user) {
    fail(`No account exists for ${email}. This script never creates accounts; register first.`);
  }
  return user;
}

export function hasPrivilege(user, privilege) {
  if (privilege === "platform-admin") return user.isPlatformAdmin === true;
  return Boolean(user.profile?.roles.some((row) => row.role === PRIVILEGES.mediator.role));
}

/** Read-only plan for the confirmation prompt. Writes nothing. */
export async function previewChange(prisma, { email, privilege, revoke }) {
  const address = normaliseEmail(email);
  const user = requireUser(await selectUser(prisma, address), address);
  if (privilege === "mediator" && !user.profile) {
    fail(`Account ${address} has no profile, so it cannot hold the MEDIATOR role`);
  }
  return {
    email: address,
    privilege,
    label: privilegeLabel(privilege),
    revoke,
    changed: hasPrivilege(user, privilege) !== !revoke,
    userId: user.id,
    profileId: user.profile?.id ?? null,
    liveSessions: await prisma.session.count({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  };
}

/**
 * Applies the change, its audit row and the session revocation in one
 * transaction. Returns `changed: false` (and writes nothing) when the account
 * already has the requested state.
 */
export async function applyPrivilegeChange(prisma, { email, privilege, revoke }) {
  const address = normaliseEmail(email);
  if (!PRIVILEGES[privilege]) fail(`Unknown privilege: ${privilege}`);

  return prisma.$transaction(async (tx) => {
    const user = requireUser(await selectUser(tx, address), address);
    if (privilege === "mediator" && !user.profile) {
      fail(`Account ${address} has no profile, so it cannot hold the MEDIATOR role`);
    }

    const alreadyInState = hasPrivilege(user, privilege) === !revoke;
    if (alreadyInState) {
      return {
        changed: false,
        email: address,
        privilege,
        revoke,
        userId: user.id,
        profileId: user.profile?.id ?? null,
        sessionsRevoked: 0,
        auditId: null,
      };
    }

    if (privilege === "platform-admin") {
      await tx.user.update({
        where: { id: user.id },
        data: { isPlatformAdmin: !revoke },
      });
    } else if (revoke) {
      await tx.profileRole.deleteMany({
        where: { profileId: user.profile.id, role: PRIVILEGES.mediator.role },
      });
    } else {
      await tx.profileRole.create({
        data: { profileId: user.profile.id, role: PRIVILEGES.mediator.role },
      });
    }

    // A privilege change invalidates every token issued under the old rights.
    // Same transaction as the change: both commit, or neither does.
    const sessions = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const audit = await tx.auditLog.create({
      data: {
        actorProfileId: null,
        actorRole: OPERATOR_ACTOR,
        action: revoke ? AUDIT_ACTION.REVOKED : AUDIT_ACTION.GRANTED,
        entityType: PRIVILEGES[privilege].entityType,
        entityId: privilege === "platform-admin" ? user.id : user.profile.id,
        // No email, no password material, no session tokens: just what changed.
        metadataJson: JSON.stringify({
          privilege: PRIVILEGES[privilege].label,
          userId: user.id,
          source: "scripts/manage-privileged.mjs",
        }),
      },
    });

    return {
      changed: true,
      email: address,
      privilege,
      revoke,
      userId: user.id,
      profileId: user.profile?.id ?? null,
      sessionsRevoked: sessions.count,
      auditId: audit.id,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function usage(stream = stdout) {
  stream.write(`SellFlow operator privilege script

Grants or revokes PLATFORM_ADMIN or MEDIATOR on an existing account. Operator
shell only; no HTTP route can call this.

Usage:
  npm run admin:grant -- --email <address> --platform-admin [--revoke] [--yes]
  npm run admin:grant -- --email <address> --mediator       [--revoke] [--yes]

Options:
  --email <address>   Account to change. It must already exist.
  --platform-admin    Set or clear User.isPlatformAdmin.
  --mediator          Add or remove the MEDIATOR ProfileRole.
  --revoke            Remove the privilege instead of granting it.
  --yes, -y           Skip the typed "grant" confirmation (automation only).
  --help, -h          Show this help.

Safety:
  DATABASE_URL must be a file: URL. Every change writes an AuditLog row as
  "operator-script" and revokes the account's live sessions in the same
  transaction. No password or token material is read or printed.
`);
}

function printPlan(stream, plan) {
  stream.write("SellFlow operator privilege change\n");
  stream.write(`  account  : ${plan.email}\n`);
  stream.write(`  ids      : user ${plan.userId}${plan.profileId ? ` / profile ${plan.profileId}` : ""}\n`);
  stream.write(`  change   : ${plan.label} -> ${plan.revoke ? "revoke" : "grant"}\n`);
  stream.write(`  sessions : ${plan.liveSessions} live session(s) will be revoked\n`);
  if (!plan.changed) {
    stream.write("  state    : already in the requested state; nothing will be written\n");
  }
}

function printResult(stream, result) {
  if (!result.changed) {
    stream.write(`[no-op] ${result.label ?? privilegeLabel(result.privilege)} is already ${result.revoke ? "absent" : "present"} for ${result.email}\n`);
    return;
  }
  stream.write(`[changed] ${privilegeLabel(result.privilege)} ${result.revoke ? "revoked" : "granted"} for ${result.email}\n`);
  stream.write(`  audit    : ${result.revoke ? AUDIT_ACTION.REVOKED : AUDIT_ACTION.GRANTED} (${result.auditId})\n`);
  stream.write(`  sessions : ${result.sessionsRevoked} revoked\n`);
}

/**
 * Runs the CLI. `deps` exists so a test can drive it without a real terminal;
 * production uses the defaults.
 */
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? stdout;
  const err = deps.stderr ?? stderr;
  const input = deps.stdin ?? stdin;
  const confirm = deps.confirm;

  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      usage(out);
      return 0;
    }
    assertFileDatabaseUrl(process.env.DATABASE_URL);
  } catch (error) {
    if (error instanceof OperatorRefusal) {
      err.write(`Refused: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const prisma = deps.prisma ?? new PrismaClient({ log: ["error"] });
  const ownsClient = !deps.prisma;

  try {
    const plan = await previewChange(prisma, opts);
    printPlan(out, plan);

    if (!opts.yes) {
      if (!input.isTTY && !confirm) {
        throw new OperatorRefusal(
          `No interactive terminal to confirm on. Re-run with --yes, or type "${CONFIRMATION_WORD}" at a terminal.`,
        );
      }
      const answer = confirm
        ? await confirm(`Type "${CONFIRMATION_WORD}" to apply this change: `)
        : await ask(input, out, `Type "${CONFIRMATION_WORD}" to apply this change: `);
      if (String(answer ?? "").trim().toLowerCase() !== CONFIRMATION_WORD) {
        throw new OperatorRefusal("Confirmation not given; nothing was written");
      }
    }

    const result = await applyPrivilegeChange(prisma, opts);
    printResult(out, result);
    return 0;
  } catch (error) {
    if (error instanceof OperatorRefusal) {
      err.write(`Refused: ${error.message}\n`);
      return 2;
    }
    err.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

async function ask(input, out, question) {
  const rl = createInterface({ input, output: out });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}