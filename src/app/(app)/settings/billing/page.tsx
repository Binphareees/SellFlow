import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getBillingSummary } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  PAYMENT_STATUS_LABEL,
  PLANS,
  SUBSCRIPTION_STATUS_LABEL,
  TIER,
  formatLimit,
  isUnlimited,
  subscriptionBillingEnabled,
  usagePercent,
  type TierLimits,
} from "@/lib/plans";
import { BackLink, Badge, SectionCard } from "@/components/ui";
import { CancelPlanButton, PaymentDecision, UpgradeForm } from "@/components/billing-actions";

export const dynamic = "force-dynamic";

const USAGE_ROWS: { key: keyof TierLimits; label: string; unit: string }[] = [
  { key: "customers", label: "Customers", unit: "customers" },
  { key: "activeOrders", label: "Open orders", unit: "open orders" },
  { key: "products", label: "Products", unit: "products" },
  { key: "suppliers", label: "Suppliers", unit: "suppliers" },
];

const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/\D/g, "") ?? "";

export default async function BillingPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");
  if (!subscriptionBillingEnabled()) redirect("/settings");

  const summary = await getBillingSummary(ctx.workspaceId);
  const { plan, tier, usage, limits } = summary;
  const paid = tier !== TIER.FREE;
  const pending = summary.pendingPayment;

  const adminQueue = ctx.user.isPlatformAdmin
    ? await prisma.subscriptionPayment.findMany({
        where: { status: "SUBMITTED" },
        include: {
          workspace: { select: { name: true } },
          subscription: { select: { tier: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
      })
    : [];

  const whatsappHref = SUPPORT_WHATSAPP
    ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
        `Hello SellFlow, I want to upgrade ${ctx.profile.displayName} to ${TIER.PRO}.`,
      )}`
    : null;

  return (
    <>
      <BackLink href="/dashboard">Dashboard</BackLink>

      <div className="page-head">
        <div>
          <h1>Plan and billing</h1>
          <p>Paid manually, confirmed by a person. No card is ever stored.</p>
        </div>
        <span className={`badge ${paid ? "badge-good" : "badge-neutral"}`}>{plan.name}</span>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <div className="card-sub">Current plan</div>
            <div className="plan-name">{plan.name}</div>
            <div className="tiny muted">{plan.tagline}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="tiny muted">{SUBSCRIPTION_STATUS_LABEL[summary.status] ?? summary.status}</div>
            {summary.periodEnd ? (
              <div className="tiny">
                {summary.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                {summary.periodEnd.toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </div>
            ) : (
              <div className="tiny muted">No renewal date on Free</div>
            )}
          </div>
        </div>

        {summary.cancelAtPeriodEnd ? (
          <p className="notice mt-12">
            This plan is set to end{summary.periodEnd ? ` on ${summary.periodEnd.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : ""}.
            Nothing is deleted — records above the Free caps become read-only.
          </p>
        ) : null}

        {paid && !plan.name.includes("Free") ? (
          <div className="mt-12">
            <CancelPlanButton
              periodEnd={
                summary.periodEnd
                  ? summary.periodEnd.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                  : null
              }
            />
          </div>
        ) : null}
      </div>

      {pending ? (
        <div className="notice mt-12">
          <strong>Transfer submitted.</strong> {formatMoney(pending.amountKobo)} for{" "}
          {pending.tier === TIER.PRO ? "Pro" : "Supplier Pro"}
          {pending.reference ? ` · ref ${pending.reference}` : ""}. A person confirms it before the plan
          changes — usually the same working day.
        </div>
      ) : null}

      <div className="mt-16">
        <SectionCard
          title="What you are using"
          sub={isUnlimited(limits.customers) ? "Your plan has no caps" : "Free plan limits"}
        >
          <div className="stack-sm">
            {USAGE_ROWS.map((row) => {
              const limit = limits[row.key];
              const used = usage[row.key];
              const percent = usagePercent(used, limit);
              const atCap = !isUnlimited(limit) && used >= limit;
              return (
                <div className="meter-row" key={row.key}>
                  <div className="row-between">
                    <span className="tiny">{row.label}</span>
                    <span className={`tiny ${atCap ? "owed" : "muted"}`}>
                      {used} / {formatLimit(limit)}
                    </span>
                  </div>
                  {isUnlimited(limit) ? null : (
                    <div className="meter" aria-hidden>
                      <div
                        className={`meter-fill ${atCap ? "is-full" : percent >= 80 ? "is-near" : ""}`}
                        style={{ width: `${Math.max(percent, 2)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!paid ? (
            <p className="tiny muted mt-12">
              Hitting a cap blocks the action that would exceed it — nothing you already recorded is
              removed or hidden.
            </p>
          ) : null}
        </SectionCard>
      </div>

      <div className="mt-16">
        <div className="plan-grid">
          {summary.plans.map((candidate) => {
            const isCurrent = candidate.tier === tier;
            return (
              <div className={`card plan-card ${isCurrent ? "is-current" : ""}`} key={candidate.tier}>
                <div className="row-between">
                  <div className="plan-name">{candidate.name}</div>
                  {isCurrent ? <Badge status="ACTIVE" /> : null}
                </div>
                <div className="plan-price">
                  {candidate.priceKobo === 0 ? "Free" : formatMoney(candidate.priceKobo)}
                  {candidate.priceKobo > 0 ? <span className="tiny muted"> / month</span> : null}
                </div>
                <p className="tiny muted">{candidate.bestFor}</p>
                <ul className="plan-features">
                  {candidate.highlights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>

                {isCurrent ? (
                  <p className="tiny muted">This is your plan.</p>
                ) : candidate.priceKobo === 0 ? (
                  <p className="tiny muted">Downgrades happen when a paid period ends.</p>
                ) : pending ? (
                  <p className="tiny muted">A transfer is already waiting for confirmation.</p>
                ) : (
                  <UpgradeForm tier={candidate.tier} priceKobo={candidate.priceKobo} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-16">
        <SectionCard title="How manual upgrade works" sub="Three steps, no gateway">
          <ol className="steps">
            <li>
              <strong>Submit the transfer details.</strong> Pay for a month, then record the reference
              below the plan you picked.
            </li>
            <li>
              <strong>A person checks it.</strong> A SellFlow moderator confirms the money landed. Your
              plan stays the same until then.
            </li>
            <li>
              <strong>The plan turns on.</strong> You get 30 days from confirmation. We remind you before
              it ends — nothing renews by itself.
            </li>
          </ol>
          <p className="tiny muted mt-12">
            SellFlow never connects to your bank, never charges a card and never holds your money. This
            is a record of a transfer you made yourself.
          </p>
          <div className="btn-row mt-12">
            {whatsappHref ? (
              <a className="btn btn-sm" href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Ask on WhatsApp
              </a>
            ) : null}
            <Link className="btn btn-sm btn-ghost" href="/settings/billing#history">
              Payment history
            </Link>
          </div>
        </SectionCard>
      </div>

      <div className="mt-16" id="history">
        <SectionCard title="Your upgrade requests" sub="Only you and SellFlow moderators see these">
          {summary.payments.length === 0 ? (
            <p className="tiny muted">No upgrade requests yet.</p>
          ) : (
            <div className="list">
              {summary.payments.map((payment) => (
                <div className="list-item" key={payment.id}>
                  <div className="grow">
                    <div className="list-title">
                      {payment.tier === TIER.PRO ? "Pro" : "Supplier Pro"} ·{" "}
                      {formatMoney(payment.amountKobo)}
                    </div>
                    <div className="list-meta">
                      {payment.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                      {payment.decisionNote ? ` · ${payment.decisionNote}` : ""}
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      payment.status === "CONFIRMED"
                        ? "badge-good"
                        : payment.status === "REJECTED"
                          ? "badge-bad"
                          : "badge-warn"
                    }`}
                  >
                    {PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {ctx.user.isPlatformAdmin ? (
        <div className="mt-16">
          <SectionCard title="Moderator queue" sub="Manual payment verification across every workspace">
            {adminQueue.length === 0 ? (
              <p className="tiny muted">No transfers waiting.</p>
            ) : (
              <div className="list">
                {adminQueue.map((payment) => (
                  <div
                    className="list-item"
                    key={payment.id}
                    style={{ flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div className="row-between">
                      <div>
                        <div className="list-title">
                          {payment.workspace.name} · {payment.tier === TIER.PRO ? "Pro" : "Supplier Pro"}
                        </div>
                        <div className="list-meta">
                          {formatMoney(payment.amountKobo)} · {payment.method.toLowerCase().replace("_", " ")}
                          {payment.reference ? ` · ${payment.reference}` : ""}
                        </div>
                      </div>
                      <span className="badge badge-warn">Awaiting</span>
                    </div>
                    {payment.proofNote ? <p className="tiny muted mt-12">{payment.proofNote}</p> : null}
                    <div className="mt-12">
                      <PaymentDecision paymentId={payment.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      <p className="tiny muted mt-16">
        Prices are per month in naira. {PLANS.PRO.name} covers unlimited bookkeeping;{" "}
        {PLANS.SUPPLIER_PRO.name} adds agreement controls for suppliers.
      </p>
    </>
  );
}
