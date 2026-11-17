import { route, readBody, json, conflict } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { registerAccount } from "@/server/accounts";
import { applySessionCookie, clientIp, hashIp, startSession } from "@/lib/auth/session";
import { audit, AUDIT } from "@/lib/audit";

export const POST = route(async (request: Request) => {
  const input = await readBody(request, registerSchema);
  const ip = clientIp(request);

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
