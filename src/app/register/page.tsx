import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { RegisterForm } from "@/components/auth-forms";

export default async function RegisterPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect("/dashboard");

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
          <h1 style={{ marginTop: 14, fontSize: "1.3rem" }}>Create your workspace</h1>
          <p className="tiny muted">
            Every account gets a business workspace. You can add reseller or supplier tools later.
          </p>
        </div>
        <div className="card">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
