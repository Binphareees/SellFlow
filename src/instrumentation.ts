/**
 * Next.js instrumentation hook.
 *
 * The email sender reads RESEND_* lazily (so a build image never needs the
 * secrets), which also means a production deployment with missing email
 * configuration starts normally and then fails every password-reset send — the
 * request route deliberately returns its generic response, so the failure is
 * invisible from outside.
 *
 * This hook logs one clear line at server start when the configuration is not
 * usable. It names no variable and prints no value: the operator gets an
 * actionable error, and the log stays safe to share.
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
}
