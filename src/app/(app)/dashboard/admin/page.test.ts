import { beforeEach, describe, expect, it, vi } from "vitest";

// The page is a server component; these tests assert its authorisation gate and
// the shape of the verification-queue query, not its markup.

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  db: {
    user: { count: vi.fn(), findMany: vi.fn() },
    profile: { count: vi.fn(), findMany: vi.fn() },
    businessWorkspace: { count: vi.fn() },
    supplierProfile: { count: vi.fn() },
    dispute: { groupBy: vi.fn() },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: vi.fn(async () => hoisted.ctx),
}));

vi.mock("@/lib/auth/rbac", () => ({
  isMediator: (viewer: { user: { isPlatformAdmin: boolean }; roles: string[] }) =>
    viewer.user.isPlatformAdmin || viewer.roles.includes("MEDIATOR"),
}));

vi.mock("@/lib/db", () => ({ prisma: hoisted.db }));

import AdminDashboardPage from "./page";

function viewer(roles: string[], isPlatformAdmin: boolean) {
  return {
    user: { id: "user_1", email: "admin@example.com", isPlatformAdmin },
    profile: { id: "profile_1", displayName: "Admin" },
    roles,
  };
}

describe("admin dashboard access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.db.user.count.mockResolvedValue(1);
    hoisted.db.profile.count.mockResolvedValue(1);
    hoisted.db.businessWorkspace.count.mockResolvedValue(1);
    hoisted.db.supplierProfile.count.mockResolvedValue(1);
    hoisted.db.dispute.groupBy.mockResolvedValue([]);
    hoisted.db.profile.findMany.mockResolvedValue([]);
    hoisted.db.user.findMany.mockResolvedValue([]);
  });

  it("sends a mediator who is not a platform admin to /disputes without reading user emails", async () => {
    hoisted.ctx = viewer(["MEDIATOR"], false);

    await expect(AdminDashboardPage()).rejects.toThrow("REDIRECT:/disputes");
    expect(hoisted.db.user.findMany).not.toHaveBeenCalled();
  });

  it("sends an ordinary account to /dashboard", async () => {
    hoisted.ctx = viewer(["BUSINESS_OWNER"], false);

    await expect(AdminDashboardPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(hoisted.db.user.findMany).not.toHaveBeenCalled();
  });

  it("limits the verification queue to tier-0 supplier/reseller profiles", async () => {
    hoisted.ctx = viewer(["BUSINESS_OWNER"], true);

    await AdminDashboardPage();

    const query = hoisted.db.profile.findMany.mock.calls[0][0] as {
      where: { verificationTier: number; OR: unknown[] };
    };
    expect(query.where.verificationTier).toBe(0);
    expect(query.where.OR).toEqual([
      { roles: { some: { role: { in: ["SUPPLIER", "RESELLER"] } } } },
      { supplierProfile: { isNot: null } },
    ]);
  });
});
