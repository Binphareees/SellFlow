import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { ResetPasswordForm } from "@/components/auth-forms";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const ctx = await getAuthContext();
  if (ctx) redirect("/dashboard");
  const { token } = await searchParams;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Link href="/" className="brand" style={{ justifyContent: "center" }}>
            <span className="brand-mark" aria-hidden>
              S
            </span>
            SellFlow
          </Link>
          <h1 style={{ marginTop: 14, fontSize: "1.3rem" }}>
            {token ? "Set a new password" : "Reset your password"}
          </h1>
          <p className="tiny muted">
            {token
              ? "Choose a new password for your account."
              : "We will email you a reset link if an account exists."}
          </p>
        </div>
        <div className="card">
          <ResetPasswordForm token={token} />
        </div>
      </div>
    </div>
  );
}
