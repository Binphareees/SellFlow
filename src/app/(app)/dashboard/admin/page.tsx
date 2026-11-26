import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { isMediator } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { Badge, Empty, SectionCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!isMediator(ctx)) redirect("/dashboard");

  const [
    userCount,
    profileCount,
    workspaceCount,
    supplierCount,
    disputeCounts,
    unverifiedProfiles,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.profile.count(),
    prisma.businessWorkspace.count(),
    prisma.supplierProfile.count(),
    prisma.dispute.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.profile.findMany({
      where: { verificationTier: 0 },
      select: { id: true, displayName: true, city: true, state: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.user.findMany({
      select: { id: true, email: true, createdAt: true, isPlatformAdmin: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const disputeMap: Record<string, number> = { OPEN: 0, UNDER_REVIEW: 0, RESOLVED: 0, CLOSED: 0 };
  let disputeTotal = 0;
  for (const row of disputeCounts) {
    disputeMap[row.status] = row._count._all;
    disputeTotal += row._count._all;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>Platform-level overview. Mediator access only.</p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Users</div>
          <div className="stat-value">{userCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Profiles</div>
          <div className="stat-value">{profileCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Workspaces</div>
          <div className="stat-value">{workspaceCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Suppliers</div>
          <div className="stat-value">{supplierCount}</div>
        </div>
      </div>

      <div className="mt-16">
        <SectionCard title="Disputes" sub={`${disputeTotal} total`}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="badge badge-bad">Open {disputeMap.OPEN}</span>
            <span className="badge badge-warn">Under review {disputeMap.UNDER_REVIEW}</span>
            <span className="badge badge-good">Resolved {disputeMap.RESOLVED}</span>
            <span className="badge badge-neutral">Closed {disputeMap.CLOSED}</span>
          </div>
          <div className="mt-12">
            <Link className="btn btn-sm btn-ghost" href="/disputes">Open disputes queue</Link>
          </div>
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Verification queue" sub={`${unverifiedProfiles.length} unverified (tier 0)`}>
          {unverifiedProfiles.length === 0 ? (
            <Empty>No unverified profiles.</Empty>
          ) : (
            <div className="list">
              {unverifiedProfiles.map((p) => (
                <div className="list-item" key={p.id}>
                  <div className="grow">
                    <div className="list-title">{p.displayName}</div>
                    <div className="list-meta">
                      {p.city ?? "—"}{p.state ? `, ${p.state}` : ""} · joined{" "}
                      {p.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                    </div>
                  </div>
                  <Link className="btn btn-sm btn-ghost" href={`/api/admin/profiles/${p.id}/verification`}>
                    Review
                  </Link>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Recent users" sub="Last 10 sign-ups">
          {recentUsers.length === 0 ? (
            <Empty>No users yet.</Empty>
          ) : (
            <div className="list">
              {recentUsers.map((u) => (
                <div className="list-item" key={u.id}>
                  <div className="grow">
                    <div className="list-title">{u.email}</div>
                    <div className="list-meta">
                      {u.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      {u.isPlatformAdmin ? " · platform admin" : ""}
                    </div>
                  </div>
                  <Badge status={u.isPlatformAdmin ? "PAID" : "PROCESSING"} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
