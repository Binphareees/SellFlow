import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPrivilegeChange,
  assertFileDatabaseUrl,
  hasPrivilege,
  main,
  OperatorRefusal,
  parseArgs,
} from "../../scripts/manage-privileged.mjs";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run operator-script tests against prisma/dev.db. Point DATABASE_URL at a disposable database.",
  );
}

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient({ log: ["error"] });
const createdUserIds: string[] = [];
const SCRIPT = "scripts/manage-privileged.mjs";

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorRole: "operator-script" } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function makeAccount(options: { profile?: boolean; sessions?: number } = {}) {
  const email = `t8-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "not-a-real-hash",
      ...(options.profile === false
        ? {}
        : { profile: { create: { displayName: "Operator Test" } } }),
    },
    include: { profile: true },
  });
  createdUserIds.push(user.id);
  for (let i = 0; i < (options.sessions ?? 2); i += 1) {
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `t8-token-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  }
  return user;
}

function liveSessions(userId: string) {
  return prisma.session.count({ where: { userId, revokedAt: null } });
}

function operatorAudit(userId: string) {
  return prisma.auditLog.findMany({
    where: { actorRole: "operator-script", metadataJson: { contains: userId } },
    orderBy: { createdAt: "asc" },
  });
}

async function runCli(args: string[], env: Record<string, string> = {}) {
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("operator script arguments and guards", () => {
  it("requires exactly one privilege flag", () => {
    expect(() => parseArgs(["--email", "a@example.com"])).toThrow(OperatorRefusal);
    expect(() =>
      parseArgs(["--email", "a@example.com", "--mediator", "--platform-admin"]),
    ).toThrow(OperatorRefusal);
    expect(parseArgs(["--email", "a@example.com", "--mediator"])).toMatchObject({
      privilege: "mediator",
      revoke: false,
      yes: false,
    });
    expect(parseArgs(["--email=a@example.com", "--platform-admin", "--revoke", "--yes"])).toMatchObject({
      email: "a@example.com",
      privilege: "platform-admin",
      revoke: true,
      yes: true,
    });
  });

  it("rejects unknown arguments and a missing email value", () => {
    expect(() => parseArgs(["--email", "a@example.com", "--mediator", "--force"])).toThrow(
      /Unknown argument/,
    );
    expect(() => parseArgs(["--email", "--mediator"])).toThrow(/--email needs a value/);
    expect(() => parseArgs(["--platform-admin"])).toThrow(/--email is required/);
  });

  it("refuses every database URL that is not a local file", () => {
    expect(assertFileDatabaseUrl("file:/tmp/test.db")).toBe("file:/tmp/test.db");
    expect(() => assertFileDatabaseUrl("postgresql://user@host/db")).toThrow(/not a file: URL/);
    expect(() => assertFileDatabaseUrl("")).toThrow(/not set/);
    expect(() => assertFileDatabaseUrl(undefined as unknown as string)).toThrow(/not set/);
    expect(() => assertFileDatabaseUrl("file:")).toThrow(/no database path/);
  });
});

describe("privilege changes", () => {
  it("grants platform admin, audits it and revokes live sessions", async () => {
    const user = await makeAccount();

    const result = await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "platform-admin",
      revoke: false,
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.isPlatformAdmin).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.sessionsRevoked).toBe(2);
    expect(await liveSessions(user.id)).toBe(0);

    const rows = await operatorAudit(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("operator.privilege_granted");
    expect(rows[0].actorRole).toBe("operator-script");
    expect(rows[0].actorProfileId).toBeNull();
    expect(rows[0].entityType).toBe("User");
    expect(rows[0].entityId).toBe(user.id);
    expect(rows[0].metadataJson).toContain("PLATFORM_ADMIN");
    // No secret material in the trail.
    expect(rows[0].metadataJson).not.toContain("not-a-real-hash");
    expect(rows[0].metadataJson).not.toContain("t8-token-");
  });

  it("is idempotent: a second grant writes nothing and keeps new sessions", async () => {
    const user = await makeAccount();
    await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "platform-admin",
      revoke: false,
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `t8-token-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const again = await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "platform-admin",
      revoke: false,
    });

    expect(again.changed).toBe(false);
    expect(again.sessionsRevoked).toBe(0);
    expect(await liveSessions(user.id)).toBe(1);
    expect(await operatorAudit(user.id)).toHaveLength(1);
  });

  it("revokes platform admin with its own audit row and session revocation", async () => {
    const user = await makeAccount();
    await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "platform-admin",
      revoke: false,
    });

    const revoked = await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "platform-admin",
      revoke: true,
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.isPlatformAdmin).toBe(false);
    expect(revoked.changed).toBe(true);
    const rows = await operatorAudit(user.id);
    expect(rows.map((row) => row.action)).toEqual([
      "operator.privilege_granted",
      "operator.privilege_revoked",
    ]);
  });

  it("grants and revokes the MEDIATOR role on the profile", async () => {
    const user = await makeAccount({ profile: true });
    expect(user.profile).not.toBeNull();

    await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "mediator",
      revoke: false,
    });
    const granted = await prisma.profile.findUniqueOrThrow({
      where: { id: user.profile!.id },
      include: { roles: true },
    });
    expect(granted.roles.map((row) => row.role)).toContain("MEDIATOR");

    const auditRows = await operatorAudit(user.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityType).toBe("Profile");
    expect(auditRows[0].entityId).toBe(user.profile!.id);

    const result = await applyPrivilegeChange(prisma, {
      email: user.email,
      privilege: "mediator",
      revoke: true,
    });
    expect(result.changed).toBe(true);
    const revoked = await prisma.profile.findUniqueOrThrow({
      where: { id: user.profile!.id },
      include: { roles: true },
    });
    expect(revoked.roles.map((row) => row.role)).not.toContain("MEDIATOR");
    expect(await operatorAudit(user.id)).toHaveLength(2);
  });

  it("refuses an unknown email and writes nothing", async () => {
    const email = `t8-missing-${randomUUID()}@example.com`;
    await expect(
      applyPrivilegeChange(prisma, { email, privilege: "mediator", revoke: false }),
    ).rejects.toThrow(/No account exists/);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorRole: "operator-script", metadataJson: { contains: email } } })).toBe(0);
  });

  it("refuses MEDIATOR for an account without a profile", async () => {
    const user = await makeAccount({ profile: false });
    await expect(
      applyPrivilegeChange(prisma, { email: user.email, privilege: "mediator", revoke: false }),
    ).rejects.toThrow(/no profile/);
  });

  it("reports the current state through hasPrivilege", async () => {
    const user = await makeAccount();
    const full = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { profile: { include: { roles: true } } },
    });
    expect(hasPrivilege(full, "platform-admin")).toBe(false);
    expect(hasPrivilege(full, "mediator")).toBe(false);
  });
});

describe("operator CLI", () => {
  it("grants with --yes, then reports a no-op, printing no secret material", async () => {
    const user = await makeAccount();

    const first = await runCli(["--email", user.email, "--mediator", "--yes"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("[changed] MEDIATOR granted");
    expect(first.stdout).toContain("sessions : 2 revoked");
    expect(first.stdout).not.toContain("not-a-real-hash");
    expect(first.stdout).not.toMatch(/t8-token-/);

    const second = await runCli(["--email", user.email, "--mediator", "--yes"]);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("[no-op]");
    expect(await operatorAudit(user.id)).toHaveLength(1);
  });

  it("refuses an unknown email with exit code 2", async () => {
    const email = `t8-unknown-${randomUUID()}@example.com`;
    const result = await runCli(["--email", email, "--platform-admin", "--yes"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Refused:");
    expect(result.stderr).toContain("No account exists");
  });

  it("refuses a non-file database URL before connecting", async () => {
    const user = await makeAccount();
    const result = await runCli(["--email", user.email, "--platform-admin", "--yes"], {
      DATABASE_URL: "postgresql://user:pass@example.com:5432/sellflow",
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/not a file: URL/);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.isPlatformAdmin).toBe(false);
    expect(await operatorAudit(user.id)).toHaveLength(0);
  });

  it("refuses without --yes when there is no interactive terminal", async () => {
    const user = await makeAccount();
    const result = await runCli(["--email", user.email, "--platform-admin"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/No interactive terminal/);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.isPlatformAdmin).toBe(false);
  });

  it("applies only after the typed confirmation word", async () => {
    const user = await makeAccount();
    const out: string[] = [];
    const err: string[] = [];
    const deps = {
      prisma,
      stdout: { write: (chunk: string) => out.push(chunk) && true },
      stderr: { write: (chunk: string) => err.push(chunk) && true },
    };

    const wrong = await main(["--email", user.email, "--platform-admin"], {
      ...deps,
      confirm: async () => "yes",
    });
    expect(wrong).toBe(2);
    expect(err.join("")).toMatch(/Confirmation not given/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isPlatformAdmin).toBe(false);

    const right = await main(["--email", user.email, "--platform-admin"], {
      ...deps,
      confirm: async () => "grant",
    });
    expect(right).toBe(0);
    expect(out.join("")).toContain("[changed] PLATFORM_ADMIN granted");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isPlatformAdmin).toBe(true);
  });
});

describe("the script is not reachable from the application", () => {
  it("is imported or named by no file under src/ except its test", async () => {
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name !== "manage-privileged.test.ts") {
          const text = await readFile(full, "utf8");
          if (text.includes("manage-privileged") || text.includes("admin:grant")) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    }

    await walk(root);
    expect(offenders).toEqual([]);
  });

  it("has no HTTP route file for operator privileges", async () => {
    const routes = await readdir(path.join(process.cwd(), "src/app/api"), {
      recursive: true,
    });
    expect(routes.filter((entry) => /privileged|admin:grant/i.test(entry))).toEqual([]);
  });
});