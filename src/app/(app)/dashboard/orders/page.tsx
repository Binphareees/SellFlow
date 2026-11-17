import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listOrders } from "@/server/workspace";
import { getEntitlements } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Badge, Empty, StickyActions } from "@/components/ui";
import { UpgradeBanner } from "@/components/upgrade-banner";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "All" },
  { key: "UNPAID", label: "Unpaid" },
  { key: "PART_PAID", label: "Part paid" },
  { key: "PAID", label: "Paid" },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; status?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");

  const params = await searchParams;
  const payment = (params.payment as "UNPAID" | "PART_PAID" | "PAID" | undefined) ?? undefined;

  const [orders, workspace, entitlements] = await Promise.all([
    listOrders(ctx.workspaceId, { ...(payment ? { payment } : {}), ...(params.status ? { status: params.status } : {}) }),
    prisma.businessWorkspace.findUnique({ where: { id: ctx.workspaceId }, select: { currency: true } }),
    getEntitlements(ctx.workspaceId),
  ]);
  const currency = workspace?.currency ?? "NGN";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>{orders.length} order{orders.length === 1 ? "" : "s"} in this view</p>
        </div>
        <Link className="btn btn-primary btn-sm" href="/dashboard/orders/new">
          + New
        </Link>
      </div>

      <UpgradeBanner tier={entitlements.tier} usage={entitlements.usage} limits={entitlements.limits} />

      <div className="chips" style={{ marginBottom: 14, marginTop: 12 }}>
        {FILTERS.map((filter) => (
          <Link
            key={filter.key}
            href={filter.key ? `/dashboard/orders?payment=${filter.key}` : "/dashboard/orders"}
            className="chip"
            data-active={payment === filter.key || (!payment && !filter.key)}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <Empty>No orders in this view.</Empty>
      ) : (
        <div className="card">
          <div className="list">
            {orders.map((order) => (
              <Link className="list-item" href={`/dashboard/orders/${order.id}`} key={order.id}>
                <div className="grow">
                  <div className="list-title">{order.customer.name}</div>
                  <div className="list-meta">
                    {order.orderNumber} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"} ·{" "}
                    {order.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                  </div>
                </div>
                <div className="list-right">
                  <div className="money">{formatMoney(order.totalKobo, currency)}</div>
                  <div className="mt-12 row" style={{ justifyContent: "flex-end", gap: 6 }}>
                    <Badge status={order.status} />
                    {order.balanceKobo > 0 ? (
                      <span className="tiny owed">{formatMoney(order.balanceKobo, currency)}</span>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <StickyActions note={`${orders.length} order${orders.length === 1 ? "" : "s"} in view`}>
        <Link className="btn btn-primary" href="/dashboard/orders/new">
          + New order
        </Link>
      </StickyActions>
    </>
  );
}
