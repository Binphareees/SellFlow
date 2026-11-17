import { route, json } from "@/lib/api";
import { requireAuth } from "@/lib/auth/session";
import { listSessionsForUser } from "@/lib/auth/revocation";

/**
 * The signed-in account's own sessions (S-14). Owner-scoped by the session that
 * authenticates the request — never by a client-supplied id — and deliberately
 * free of token material: only metadata, plus which row is this request.
 */
export const GET = route(async () => {
  const ctx = await requireAuth();
  const sessions = await listSessionsForUser(ctx.user.id);

  return json({
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent,
      ipHash: session.ipHash,
      current: session.id === ctx.sessionId,
    })),
  });
});
