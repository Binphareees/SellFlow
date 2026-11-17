import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shell";

/**
 * Authenticated shell. The session check happens on the server for every child
 * page; there is no client-side "is logged in" guess.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const workspace = ctx.workspaceId
    ? await prisma.businessWorkspace.findUnique({
        where: { id: ctx.workspaceId },
        select: { name: true },
      })
    : null;

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
