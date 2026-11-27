/**
 * Next.js instrumentation hook.
 *
 * The email sender reads RESEND_* lazily (so a build image never needs the
 * secrets), which also means a production deployment with missing email
 * configuration starts normally and then fails every password-reset send — the
 * request route deliberately returns its generic response, so the failure is
 * invisible from outside.
 *
 * The same is true of the trusted-proxy contract: without it the app cannot
 * see a trustworthy client address, so every IP-based throttle is skipped
 * rather than guessing. That failure is invisible from outside too.
 *
 * This hook logs one clear line per condition at server start. It names no
 * variable and prints no value: the operator gets an actionable error, and the
 * log stays safe to share.
 */
export async function register(): Promise<void> {
  // Runs in the Node.js server only; never in the edge runtime or a build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const { isConfigValid } = await import("./lib/resend");

  if (!isConfigValid()) {
    console.error(
      "[startup] Email is not configured: password-reset emails will fail and locked-out users cannot recover their accounts. Set the email provider variables for this deployment before going live.",
    );
  }

  // No secret means clientIp() returns null, so login, registration and
  // password-reset IP throttling are all skipped. Loud at boot, invisible at
  // the edge.
  if (!process.env.TRUSTED_PROXY_SECRET) {
    console.error(
      "[startup] No trusted proxy is configured: every request looks like it has no client address, so IP-based sign-in, registration and password-reset throttling is disabled. Configure the trusted-proxy contract before exposing this deployment.",
    );
  }
}
