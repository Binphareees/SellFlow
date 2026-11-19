import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth-forms";
import { BackLink } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  return (
    <>
      <BackLink href="/dashboard">Dashboard</BackLink>

      <div className="page-head">
        <div>
          <h1>Security</h1>
          <p>Change the password for your account.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <ChangePasswordForm />
      </div>

      <p className="tiny muted mt-16">
        <Link href="/settings/billing">Plan and billing</Link>
      </p>
    </>
  );
}
