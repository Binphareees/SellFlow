import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth-forms";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const ctx = await getAuthContext();
  if (ctx) redirect("/dashboard");
  const { next } = await searchParams;

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
          <h1 style={{ marginTop: 14, fontSize: "1.3rem" }}>Welcome back</h1>
          <p className="tiny muted">Sign in to see who still owes you.</p>
        </div>
        <div className="card">
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
