import Link from "next/link";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shell";

/**
 * Marketplace discovery is public. Signed-in accounts keep the full app shell so
 * they can move between their workspace and the market; guests get a light header.
 */
export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();

  if (ctx?.workspaceId) {
    const workspace = await prisma.businessWorkspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { name: true },
    });
    return (
      <AppShell
        businessName={workspace?.name ?? "My business"}
        displayName={ctx.profile.displayName}
        roles={ctx.roles}
      >
        {children}
      </AppShell>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>
              S
            </span>
            SellFlow
          </Link>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn btn-sm" href="/login">
              Sign in
            </Link>
            <Link className="btn btn-sm btn-primary" href="/register">
              Start free
            </Link>
          </div>
        </div>
      </header>
      <main className="page" style={{ paddingBottom: 48 }}>
        {children}
      </main>
    </div>
  );
}
