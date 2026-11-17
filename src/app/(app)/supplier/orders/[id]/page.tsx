import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupplierOrder } from "@/server/supplier";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { Badge, BackLink, Empty, SectionCard } from "@/components/ui";
import {
  ClaimDecision,
  ClaimForm,
  DeliveryForm,
  DispatchForm,
  StockConfirmForm,
} from "@/components/order-actions";

export const dynamic = "force-dynamic";

export default async function SupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  let order;
  try {
    order = await getSupplierOrder(id, ctx.profile.id, ctx.roles);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const { isSupplier, isReseller } = order.viewer;
  const myRole = isSupplier ? "SUPPLIER" : "RESELLER";
  const awaitingMyConfirmation = order.claims.filter(
    (claim) => claim.claimedByRole !== myRole && !["CONFIRMED", "DISPUTED"].includes(claim.status),
  );

  const resellerMargin = order.items.reduce((sum, item) => {
    if (!item.resalePriceKobo) return sum;
    return sum + (item.resalePriceKobo - item.unitPriceKobo) * item.qty;
  }, 0);

  return (
    <>
      <BackLink href={isSupplier ? "/supplier" : "/reseller"}>
        {isSupplier ? "Supplier" : "Reseller"}
      </BackLink>

      <div className="page-head">
        <div>
          <h1>{order.orderNumber}</h1>
          <p>
            {order.resellerProfile.displayName} → {order.supplierProfile.businessName}
          </p>
        </div>
        <Badge status={order.status} />
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <div className="card-sub">Order total</div>
            <div className="money-lg">{formatMoney(order.totalKobo, order.currency)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="card-sub">Stock</div>
            <div className="money">{order.stockStatus.toLowerCase()}</div>
            <div className="tiny muted">Payment: {order.paymentClaimStatus.toLowerCase().replace("_", " ")}</div>
          </div>
        </div>

        {resellerMargin > 0 ? (
          <p className="tiny paid mt-12">Your margin at your set resale prices: {formatMoney(resellerMargin)}</p>
        ) : null}

        {order.customerOrder ? (
          <p className="tiny muted mt-12">
            Linked customer order:{" "}
            <Link href={`/dashboard/orders/${order.customerOrder.id}`}>
              {order.customerOrder.orderNumber}
            </Link>
            {order.customerOrder.customer ? ` — ${order.customerOrder.customer.name}` : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-16">
        <SectionCard title="Items" sub="Unit price is the agreed reseller price for this order">
          <div className="list">
            {order.items.map((item) => (
              <div className="list-item" key={item.id}>
                <div className="grow">
                  <div className="list-title">{item.title}</div>
                  <div className="list-meta">
                    {item.qty} × {formatMoney(item.unitPriceKobo, order.currency)}
                    {item.stockConfirmedQty !== null ? ` · ${item.stockConfirmedQty} confirmed` : ""}
                  </div>
                </div>
                <div className="list-right money">{formatMoney(item.lineTotalKobo, order.currency)}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {isSupplier && ["SUBMITTED", "STOCK_CONFIRMED"].includes(order.status) ? (
        <div className="mt-16">
          <SectionCard title="Confirm stock" sub="Answer before the reseller pays">
            <StockConfirmForm
              orderId={order.id}
              items={order.items.map((item) => ({
                id: item.id,
                title: item.title,
                qty: item.qty,
                confirmedQty: item.stockConfirmedQty,
              }))}
            />
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-16">
        <SectionCard title="Payment claims" sub="What each side says happened">
          {order.claims.length === 0 ? (
            <Empty>No payment claim recorded.</Empty>
          ) : (
            <div className="list">
              {order.claims.map((claim) => (
                <div className="list-item" key={claim.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div className="row-between">
                    <div>
                      <div className="list-title">
                        {formatMoney(claim.amountKobo, order.currency)}{" "}
                        <span className="tiny muted">by {claim.claimedByRole.toLowerCase()}</span>
                      </div>
                      <div className="list-meta">
                        {claim.claimedAt.toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {claim.reference ? ` · ${claim.reference}` : ""}
                      </div>
                    </div>
                    <Badge status={claim.status === "SENT" ? "PENDING" : claim.status} />
                  </div>

                  {awaitingMyConfirmation.some((c) => c.id === claim.id) ? (
                    <div className="mt-12">
                      <ClaimDecision orderId={order.id} claimId={claim.id} />
                    </div>
                  ) : null}

                  <div className="mt-12">
                    <Link
                      className="tiny"
                      href={`/disputes/new?orderId=${order.id}&claimId=${claim.id}`}
                    >
                      Dispute this claim →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {order.status !== "CANCELLED" && order.status !== "COMPLETED" ? (
            <div className="mt-16" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <ClaimForm
                orderId={order.id}
                suggestedAmountKobo={order.totalKobo}
                role={isSupplier ? "SUPPLIER" : "RESELLER"}
              />
            </div>
          ) : null}
        </SectionCard>
      </div>

      {isSupplier && ["STOCK_CONFIRMED", "AWAITING_PAYMENT", "PAID"].includes(order.status) ? (
        <div className="mt-16">
          <SectionCard title="Dispatch" sub="Record what left your shop">
            <DispatchForm orderId={order.id} />
          </SectionCard>
        </div>
      ) : null}

      {isReseller && order.status === "DISPATCHED" ? (
        <div className="mt-16">
          <SectionCard title="Delivery" sub="Only you can confirm you received it">
            <DeliveryForm orderId={order.id} />
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-16">
        <SectionCard title="History">
          <div className="timeline">
            <div className="timeline-item">
              <span className="timeline-dot" />
              <div>
                <div className="tiny">Order submitted</div>
                <div className="list-meta">
                  {order.createdAt.toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
            {order.stockConfirmedAt ? (
              <div className="timeline-item">
                <span className="timeline-dot" />
                <div>
                  <div className="tiny">Stock {order.stockStatus.toLowerCase()}</div>
                  <div className="list-meta">
                    {order.stockConfirmedAt.toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ) : null}
            {order.dispatches.map((dispatch) => (
              <div className="timeline-item" key={dispatch.id}>
                <span className="timeline-dot" />
                <div>
                  <div className="tiny">
                    Dispatched{dispatch.courierName ? ` via ${dispatch.courierName}` : ""}
                    {dispatch.trackingRef ? ` · ${dispatch.trackingRef}` : ""}
                  </div>
                  <div className="list-meta">
                    {dispatch.dispatchedAt.toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
            {order.delivery ? (
              <div className="timeline-item">
                <span className="timeline-dot" />
                <div>
                  <div className="tiny">Delivery confirmed by reseller</div>
                  <div className="list-meta">
                    {order.delivery.confirmedAt.toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ) : null}
            {order.disputes.map((dispute) => (
              <div className="timeline-item" key={dispute.id}>
                <span className="timeline-dot is-muted" />
                <div>
                  <div className="tiny">Dispute {dispute.reference} · {dispute.status.toLowerCase()}</div>
                  <div className="list-meta">
                    <Link href={`/disputes/${dispute.id}`}>Open dispute</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Something went wrong?" sub="A dispute puts it on the record for both sides">
          <div className="btn-row">
            <Link className="btn btn-sm btn-danger" href={`/disputes/new?orderId=${order.id}`}>
              Raise a dispute
            </Link>
            <Link className="btn btn-sm" href="/disputes">
              All disputes
            </Link>
          </div>
          <p className="tiny muted mt-12">
            Disputes never move money and never cancel an order by themselves. They record what each side
            says, and a mediator can decide.
          </p>
        </SectionCard>
      </div>
    </>
  );
}
