import { route, readBody, json, ApiError, tooManyRequests } from "@/lib/api";
import { loginSchema } from "@/lib/validation";
import { authenticate, getProfileBundle } from "@/server/accounts";
import {
  applySessionCookie,
  clientIp,
  hashIp,
  revokeCurrentSession,
  startSession,
} from "@/lib/auth/session";
import { pruneSessions } from "@/lib/auth/revocation";
import {
  checkLoginThrottle,
  clearLoginFailures,
  recordLoginFailure,
} from "@/lib/auth/throttle";
import { audit, AUDIT } from "@/lib/audit";

const THROTTLED_MESSAGE = "Too many sign-in attempts. Try again later.";

export const POST = route(async (request: Request) => {
  const input = await readBody(request, loginSchema);
  const ip = clientIp(request);

  // Refuse before verifying a password while the account or source IP is
  // locked. The same message is used for unknown and known accounts.
  const current = await checkLoginThrottle(input.email, ip);
  if (current.locked) {
    throw tooManyRequests(THROTTLED_MESSAGE, current.retryAfterSeconds);
  }

  const user = await authenticate(input.email, input.password);

  if (!user) {
    const failure = await recordLoginFailure(input.email, ip);
    if (failure.locked) {
      throw tooManyRequests(THROTTLED_MESSAGE, failure.retryAfterSeconds);
    }
    // One message for every failure mode: unknown email, wrong password, disabled.
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  // A valid sign-in clears this account's failures. IP counters intentionally
  // remain aggregate, so one valid account cannot reset password-spraying state.
  await clearLoginFailures(input.email);

  // Rotation: a token presented with this login is retired before the new one
  // is issued, so a planted or stale cookie cannot survive the sign-in that is
  // meant to replace it (S-14).
  await revokeCurrentSession();

  const bundle = await getProfileBundle(user.id);
  const session = await startSession(user.id, {
    userAgent: request.headers.get("user-agent"),
    ip,
  });
  const ipHash = hashIp(ip);

  await audit({
    actorProfileId: bundle.id,
    action: AUDIT.LOGIN,
    entityType: "Session",
    entityId: user.id,
    metadata: { ipHash },
    ipHash,
  });

  const response = json({
    user: { id: user.id, email: user.email },
    profile: { id: bundle.id, displayName: bundle.displayName, verificationTier: bundle.verificationTier },
    workspace: bundle.ownedWorkspace ? { id: bundle.ownedWorkspace.id, name: bundle.ownedWorkspace.name } : null,
    roles: bundle.roles.map((r) => r.role),
    supplierProfileId: bundle.supplierProfile?.id ?? null,
  });

  applySessionCookie(response, session.token, session.expiresAt);

  // Opportunistic, bounded cleanup: this deployment has no scheduler, so dead
  // rows are swept after a successful sign-in and never block it (S-14).
  await pruneSessions().catch((error) => {
    console.error("[session] cleanup failed", error);
  });

  return response;
});
