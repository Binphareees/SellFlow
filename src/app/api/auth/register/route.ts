import { route, readBody, json, conflict, tooManyRequests } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { registerAccount } from "@/server/accounts";
import { applySessionCookie, clientIp, hashIp, startSession } from "@/lib/auth/session";
import {
  checkRegistrationThrottle,
  recordRegistrationAttempt,
} from "@/lib/auth/throttle";
import { audit, AUDIT } from "@/lib/audit";

const THROTTLED_MESSAGE = "Too many registration attempts. Try again later.";

export const POST = route(async (request: Request) => {
  const ip = clientIp(request);
  const throttle = await checkRegistrationThrottle(ip);
  if (throttle.locked) {
    throw tooManyRequests(THROTTLED_MESSAGE, throttle.retryAfterSeconds);
  }
  await recordRegistrationAttempt(ip);

  const input = await readBody(request, registerSchema);

  let account;
  try {
    account = await registerAccount(input);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw conflict(error.message);
    throw error;
  }

  const session = await startSession(account.user.id, {
    userAgent: request.headers.get("user-agent"),
    ip,
  });
  const ipHash = hashIp(ip);

  await audit({
    actorProfileId: account.profile.id,
    action: AUDIT.LOGIN,
    entityType: "Session",
    entityId: account.user.id,
    metadata: { firstSession: true, ipHash },
    ipHash,
  });

  const response = json(
    {
      user: { id: account.user.id, email: account.user.email },
      profile: {
        id: account.profile.id,
        displayName: account.profile.displayName,
        verificationTier: account.profile.verificationTier,
      },
      workspace: { id: account.workspace.id, name: account.workspace.name },
      roles: ["BUSINESS_OWNER"],
    },
    201,
  );

  applySessionCookie(response, session.token, session.expiresAt);
  return response;
});
