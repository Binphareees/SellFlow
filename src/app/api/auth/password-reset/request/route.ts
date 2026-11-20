import { route, readBody, json } from "@/lib/api";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createResetToken, invalidateUnusedResetTokens } from "@/lib/auth/reset-token";
import { sendTemplatedEmail } from "@/lib/resend";
import { applicationOrigin } from "@/lib/app-origin";
import { clientIp } from "@/lib/auth/client-ip";
import { hashIp } from "@/lib/auth/session";
import {
  checkResetRequestThrottle,
  recordResetRequestAttempt,
} from "@/lib/auth/reset-request-throttle";
import { audit, AUDIT } from "@/lib/audit";

const RESET_REQUEST_FIELDS = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(5, "Enter your email")
    .max(254)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/, "Enter a valid email address"),
});

/**
 * Password reset request (unauthenticated).
 *
 * Returns the same generic response whether the email belongs to an account or not,
 * so the endpoint cannot be used for account enumeration. When a matching account
 * exists and the reset email can be prepared, a short-lived reset token is created
 * and a reset link is sent using the existing Resend template path.
 */
export const POST = route(async (request: Request) => {
  const body = await readBody(request, RESET_REQUEST_FIELDS);
  const email = body.email;
  const ip = clientIp(request);
  const ipHash = hashIp(ip);

  // Always return the same generic response for a valid request.
  const response = json({
    ok: true,
    message: "If that email belongs to an account, we sent a reset link.",
  });

  const before = await checkResetRequestThrottle(email, ip);
  if (before.locked) {
    await audit({
      actorProfileId: undefined,
      action: AUDIT.PASSWORD_RESET_REQUEST_THROTTLED,
      entityType: "User",
      entityId: "password-reset-request",
      metadata: { throttled: true, issued: false },
      ipHash,
    });
    return response;
  }

  const attempt = await recordResetRequestAttempt(email, ip);
  if (attempt.locked) {
    await audit({
      actorProfileId: undefined,
      action: AUDIT.PASSWORD_RESET_REQUEST_THROTTLED,
      entityType: "User",
      entityId: "password-reset-request",
      metadata: { throttled: true, issued: false },
      ipHash,
    });
    return response;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    await audit({
      actorProfileId: undefined,
      action: AUDIT.PASSWORD_RESET_REQUESTED,
      entityType: "User",
      entityId: "password-reset-request",
      metadata: { issued: false, accountExists: false },
      ipHash,
    });
    return response;
  }

  try {
    const { rawToken } = await prisma.$transaction(async (tx) => {
      // Only one unused reset token may be active for an account at a time.
      await invalidateUnusedResetTokens(user.id, tx);
      return createResetToken(user.id, undefined, tx);
    });

    const origin = applicationOrigin(request);
    const resetUrl = origin
      ? `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`
      : null;

    try {
      await sendTemplatedEmail({
        to: { email },
        subject: "Your SellFlow password reset link",
        template: "password_reset",
        templateParameters: {
          resetUrl: resetUrl ?? "",
          // Never include the raw token in the message body either: the link is the
          // only token-bearing surface, and it is short-lived.
        },
      });
    } catch (emailError) {
      console.error("[auth] password reset email delivery failed", emailError);
      // Delivery failures must never reveal provider diagnostics to the client and
      // must not change the enumeration-resistant response.
      return response;
    }

    await audit({
      actorProfileId: undefined,
      action: AUDIT.PASSWORD_RESET_REQUESTED,
      entityType: "User",
      entityId: user.id,
      metadata: { issued: true, accountExists: true },
      ipHash,
    });
  } catch (tokenError) {
    console.error("[auth] password reset token creation failed", tokenError);
    return response;
  }

  return response;
});
