import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getOrder } from "@/server/workspace";
import { prisma } from "@/lib/db";
import { formatMoney, whatsappPromiseReminderText, whatsappReminderText } from "@/lib/money";
import { getEntitlements } from "@/lib/subscription";
import { FEATURE, planUnlocks } from "@/lib/plans";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/enums";
import { ApiError } from "@/lib/api";
import { BackLink, Badge, Empty, SectionCard, StickyActions, WhatsappLink } from "@/components/ui";
import { OrderStatusSelect, PaymentForm, PromiseActions, PromiseForm, VoidPayment } from "@/components/workspace-actions";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");
  const { id } = await params;

  let order;
  try {
    order = await getOrder(ctx.workspaceId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [workspace, entitlements] = await Promise.all([
    prisma.businessWorkspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { name: true, currency: true },
    }),
    getEntitlements(ctx.workspaceId),
  ]);
  const currency = order.currency || workspace?.currency || "NGN";
  const businessName = workspace?.name ?? "My business";

  // Promise reminders are a Pro feature; Free keeps the balance reminder only.
  const openPromise = order.promises.find((promise) => promise.status === "OPEN");
  const promiseRemindersUnlocked = planUnlocks(entitlements.tier, FEATURE.PROMISE_REMINDERS);

  return (
    <>
      <BackLink href="/dashboard/orders">Orders</BackLink>

      <div className="page-head">
        <div>
          <h1>{order.orderNumber}</h1>
          <p>
            {order.customer.name} ·{" "}
            {order.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Badge status={order.status} />
          <OrderStatusSelect orderId={order.id} current={order.status} />
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <div className="card-sub">Balance due</div>
            <div className={`money-lg ${order.balanceKobo > 0 ? "owed" : "paid"}`}>
              {formatMoney(order.balanceKobo, currency)}
            </div>
            <div className="tiny muted">
              of {formatMoney(order.totalKobo, currency)} · paid {formatMoney(order.paidKobo, currency)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="card-sub">Profit</div>
            <div className="money paid">{formatMoney(order.profitKobo, currency)}</div>
          </div>
        </div>

        {order.balanceKobo > 0 ? (
          <p className="tiny muted mt-12">
            The reminder button stays at the bottom of this screen, prefilled and one tap away.
          </p>
        ) : (
          <p className="tiny paid mt-12">Fully paid. Nothing to chase.</p>
        )}
      </div>

      <div className="mt-16">
        <SectionCard title="Items">
          <div className="list">
            {order.items.map((item) => (
              <div className="list-item" key={item.id}>
                <div className="grow">
                  <div className="list-title">{item.name}</div>
                  <div className="list-meta">
                    {item.qty} × {formatMoney(item.unitPriceKobo, currency)}
                  </div>
                </div>
                <div className="list-right money">{formatMoney(item.lineTotalKobo, currency)}</div>
              </div>
            ))}
          </div>
          {order.notes ? <p className="tiny muted mt-12">Note: {order.notes}</p> : null}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard
          id="payments"
          title="Payments"
          sub="Manual records — nothing here is a gateway transaction"
        >
          {order.payments.length === 0 ? (
            <Empty>No payment recorded yet.</Empty>
          ) : (
            <div className="list">
              {order.payments.map((payment) => (
                <div className="list-item" key={payment.id}>
                  <div className="grow">
                    <div className={`list-title ${payment.voidedAt ? "muted" : ""}`}>
                      {formatMoney(payment.amountKobo, currency)}
                      {payment.voidedAt ? " (voided)" : ""}
                    </div>
                    <div className="list-meta">
                      {PAYMENT_METHOD_LABEL[payment.method as PaymentMethod] ?? payment.method} ·{" "}
                      {payment.paidAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </div>
                  </div>
                  {!payment.voidedAt ? <VoidPayment paymentId={payment.id} /> : null}
                </div>
              ))}
            </div>
          )}

          {order.balanceKobo > 0 ? (
            <div className="mt-16" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <PaymentForm orderId={order.id} remainingKobo={order.balanceKobo} />
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Payment promises" sub="“I will send it on Friday”">
          {order.promises.length === 0 ? (
            <Empty>No promise logged.</Empty>
          ) : (
            <div className="list">
              {order.promises.map((promise) => (
                <div className="list-item" key={promise.id}>
                  <div className="grow">
                    <div className="list-title">{formatMoney(promise.amountKobo, currency)}</div>
                    <div className="list-meta">
                      {promise.promisedFor.toLocaleDateString("en-NG", { day: "numeric", month: "short" })} ·{" "}
                      {promise.status.toLowerCase()}
                    </div>
                  </div>
                  {promise.status === "OPEN" ? <PromiseActions promiseId={promise.id} /> : <Badge status={promise.status} />}
                </div>
              ))}
            </div>
          )}

          {openPromise ? (
            <div className="mt-12">
              {promiseRemindersUnlocked ? (
                <WhatsappLink
                  phone={order.customer.phone}
                  message={whatsappPromiseReminderText({
                    businessName,
                    customerName: order.customer.name,
                    amountMinor: openPromise.amountKobo,
                    dueDate: openPromise.promisedFor,
                    currency,
                  })}
                  label="Remind about the promise"
                />
              ) : (
                <p className="tiny muted">
                  Promise reminders, with the date already written, come with{" "}
                  <Link href="/settings/billing">Pro</Link>.
                </p>
              )}
            </div>
          ) : null}

          {order.balanceKobo > 0 ? (
            <div className="mt-16" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <PromiseForm orderId={order.id} />
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Supplier order" sub="Linked coordination, if this order was sourced">
          {order.supplierOrder ? (
            <Link className="list-item" href={`/supplier/orders/${order.supplierOrder.id}`}>
              <div className="grow">
                <div className="list-title">{order.supplierOrder.orderNumber}</div>
                <div className="list-meta">
                  {order.supplierOrder.supplierProfile.businessName} · stock {order.supplierOrder.stockStatus.toLowerCase()}
                </div>
              </div>
              <div className="list-right">
                <Badge status={order.supplierOrder.status} />
                <div className="tiny muted mt-12">{formatMoney(order.supplierOrder.totalKobo, currency)}</div>
              </div>
            </Link>
          ) : (
            <p className="tiny muted">
              No supplier order linked. Open a listing in the{" "}
              <Link href="/marketplace">marketplace</Link> to order stock from a supplier and keep the two
              orders connected.
            </p>
          )}
        </SectionCard>
      </div>
      <StickyActions
        note={order.balanceKobo > 0 ? `${formatMoney(order.balanceKobo, currency)} outstanding` : "Settled"}
      >
        {order.balanceKobo > 0 ? (
          <>
            <WhatsappLink
              phone={order.customer.phone}
              message={whatsappReminderText({
                businessName,
                customerName: order.customer.name,
                balanceMinor: order.balanceKobo,
                currency,
              })}
              label="Remind on WhatsApp"
            />
            <a className="btn" href="#payments">
              Record payment
            </a>
          </>
        ) : (
          <Link className="btn btn-primary" href="/dashboard/orders/new">
            New order
          </Link>
        )}
      </StickyActions>
    </>
  );
}
