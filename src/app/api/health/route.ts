import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditHealth } from "@/lib/audit";
import pkg from "../../../../package.json";

// Node runtime: the check needs Prisma, which cannot run in the edge runtime.
export const runtime = "nodejs";
// Never prerender or cache a liveness probe.
export const dynamic = "force-dynamic";

const APP_VERSION = typeof pkg.version === "string" ? pkg.version : "unknown";
const DB_TIMEOUT_MS = 3_000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
} as const;

function humanUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
}

/**
 * Version status compares the version this build was compiled from with the
 * version of the package currently deployed. A mismatch means the running
 * build is stale relative to what was shipped.
 */
function versionStatus(): "match" | "mismatch" | "unknown" {
  const running = process.env.npm_package_version;
  if (!running || APP_VERSION === "unknown") return "unknown";
  return running === APP_VERSION ? "match" : "mismatch";
}

/**
 * Cheapest possible round trip to the database. Bounded by a timeout so a
 * locked SQLite file cannot hang the probe and, with it, the uptime monitor.
 */
async function checkDatabase(): Promise<{ up: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("HEALTH_CHECK_TIMEOUT")), DB_TIMEOUT_MS);
      }),
    ]);
    return { up: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    // Keep details in the server log; the response stays generic.
    console.error("[health] database check failed", error);
    const timedOut = error instanceof Error && error.message === "HEALTH_CHECK_TIMEOUT";
    return {
      up: false,
      latencyMs: Date.now() - startedAt,
      error: timedOut ? "Database did not respond in time" : "Database query failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(): Promise<NextResponse> {
  const database = await checkDatabase();
  const uptimeSeconds = Math.round(process.uptime());
  // A silently lost audit trail is a security incident, so the probe reports
  // it and flips the overall status to degraded (S-12).
  const audit = auditHealth();
  const healthy = database.up && audit.status === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checkedAt: new Date().toISOString(),
      uptime: {
        seconds: uptimeSeconds,
        human: humanUptime(uptimeSeconds),
      },
      database: {
        status: database.up ? "up" : "down",
        latencyMs: database.latencyMs,
        ...(database.error ? { error: database.error } : {}),
      },
      audit,
      app: {
        name: process.env.NEXT_PUBLIC_APP_NAME ?? "SellFlow",
        version: APP_VERSION,
        versionStatus: versionStatus(),
        environment: process.env.NODE_ENV ?? "unknown",
        nodeVersion: process.version,
      },
    },
    { status: database.up ? 200 : 503, headers: NO_STORE_HEADERS },
  );
}
