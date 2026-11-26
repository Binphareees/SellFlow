import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getDashboard } from "@/server/workspace";
import { getEntitlements } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { formatMoney, formatMoneyShort, whatsappReminderText } from "@/lib/money";
import { Badge, Empty, SectionCard, Stat, WhatsappLink } from "@/components/ui";
import { PromiseActions } from "@/components/workspace-actions";
import { UpgradeBanner } from "@/components/upgrade-banner";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");

  const [data, workspace, entitlements] = await Promise.all([
    getDashboard(ctx.workspaceId),
    prisma.businessWorkspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true, currency: true } }),
    getEntitlements(ctx.workspaceId),
  ]);

  const businessName = workspace?.name ?? "My business";
  const currency = workspace?.currency ?? "NGN";
  const { totals } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {totals.orderCount === 0
              ? "Add your first order to start tracking balances."
              : `${totals.debtorCount} customer${totals.debtorCount === 1 ? "" : "s"} still owe you money.`}
          </p>
        </div>
        <Link className="btn btn-primary btn-sm" href="/dashboard/orders/new">
          New order
        </Link>
      </div>

      <UpgradeBanner tier={entitlements.tier} usage={entitlements.usage} limits={entitlements.limits} />

      <div className="stats">
        <Stat label="Outstanding" value={formatMoneyShort(totals.outstandingKobo, currency)} tone="owed" note="Unpaid balances" />
        <Stat label="Collected" value={formatMoneyShort(totals.collectedKobo, currency)} tone="good" note="Manual records" />
        <Stat label="Profit" value={formatMoneyShort(totals.profitKobo, currency)} note="Selling minus cost" />
        <Stat
          label="Promises"
          value={String(totals.promiseCount)}
          note={totals.overduePromiseCount > 0 ? `${totals.overduePromiseCount} due now` : "None due"}
        />
      </div>

      <div className="mt-16">
        <SectionCard
          title="Who owes me"
          sub="Sorted by the largest balance"
          action={
            <Link className="btn btn-sm btn-ghost" href="/dashboard/customers">
              All customers
            </Link>
          }
        >
          {data.topDebtors.length === 0 ? (
            <Empty>Nobody owes you right now. That is a good problem to have.</Empty>
          ) : (
            <div className="list">
              {data.topDebtors.map((debtor) => (
                <div className="list-item" key={debtor.orderId}>
                  <div className="grow">
                    <div className="list-title">{debtor.name}</div>
                    <div className="list-meta">{debtor.phone ?? "No phone saved"}</div>
                  </div>
                  <div className="list-right">
                    <div className="money owed">{formatMoney(debtor.owedKobo, currency)}</div>
                    <div className="mt-12">
                      <WhatsappLink
                        phone={debtor.phone}
                        message={whatsappReminderText({
                          businessName,
                          customerName: debtor.name,
                          balanceMinor: debtor.owedKobo,
                          currency,
                        })}
                        label="Remind"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard
          title="Payment promises"
          sub="What customers said they would do"
          action={
            <Link className="btn btn-sm btn-ghost" href="/dashboard/orders">
              Orders
            </Link>
          }
        >
          {data.promises.length === 0 ? (
            <Empty>No open promises. Log one from an order when a customer gives a date.</Empty>
          ) : (
            <div className="list">
              {data.promises.map((promise) => {
                const late = promise.promisedFor.getTime() < Date.now();
                return (
                  <div className="list-item" key={promise.id}>
                    <div className="grow">
                      <div className="list-title">{promise.customer.name}</div>
                      <div className="list-meta">
                        {late ? "Was due " : "Due "}
                        {promise.promisedFor.toLocaleDateString("en-NG", {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        · {promise.order.orderNumber}
                      </div>
                    </div>
                    <div className="list-right">
                      <div className="money">{formatMoney(promise.amountKobo, currency)}</div>
                      <div className="mt-12">
                        <PromiseActions promiseId={promise.id} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard
          title="Recent orders"
          sub={`${totals.customerCount} customers · ${totals.productCount} products`}
        >
          {data.recentOrders.length === 0 ? (
            <Empty>
              No orders yet. <Link href="/dashboard/orders/new">Create your first one</Link>.
            </Empty>
          ) : (
            <div className="list">
              {data.recentOrders.map((order) => (
                <Link className="list-item" href={`/dashboard/orders/${order.id}`} key={order.id}>
                  <div className="grow">
                    <div className="list-title">{order.customer.name}</div>
                    <div className="list-meta">
                      {order.orderNumber} · {order.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                    </div>
                  </div>
                  <div className="list-right">
                    <div className="money">{formatMoney(order.totalKobo, currency)}</div>
                    <div className="mt-12">
                      {order.balanceKobo > 0 ? (
                        <span className="tiny owed">{formatMoney(order.balanceKobo, currency)} owing</span>
                      ) : (
                        <Badge status="PAID" />
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
