import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/enums";

export function Badge({ status, tone }: { status: string; tone?: "neutral" | "good" | "warn" | "bad" | "accent" }) {
  const derived =
    tone ??
    (["PAID", "DELIVERED", "COMPLETED", "APPROVED", "ACTIVE", "KEPT", "RESOLVED", "CONFIRMED"].includes(status)
      ? "good"
      : ["CANCELLED", "STOCK_DECLINED", "REJECTED", "DISPUTED", "BROKEN", "TERMINATED"].includes(status)
        ? "bad"
        : ["PART_PAID", "UNPAID", "PENDING", "PENDING_ACCEPTANCE", "AWAITING_PAYMENT", "OPEN", "UNDER_REVIEW"].includes(
              status,
            )
          ? "warn"
          : "neutral");

  return <span className={`badge badge-${derived}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Money({
  minor,
  currency = "NGN",
  className = "",
}: {
  minor: number;
  currency?: string;
  className?: string;
}) {
  return <span className={`money ${className}`}>{formatMoney(minor, currency)}</span>;
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "owed" | "good";
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone === "owed" ? "is-owed" : ""}`}>{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function SectionCard({
  title,
  sub,
  action,
  id,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card" id={id}>
      <div className="card-head">
        <div>
          <div className="card-title">{title}</div>
          {sub ? <div className="card-sub">{sub}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WhatsappLink({
  phone,
  message,
  label = "Remind on WhatsApp",
}: {
  phone: string | null;
  message: string;
  label?: string;
}) {
  if (!phone) return <span className="tiny muted">No phone saved</span>;
  const href = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  return (
    <a className="btn btn-sm" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/**
 * The one action a screen exists for, pinned above the mobile bottom nav.
 * Renders a spacer in flow so the bar never hides the last card.
 */
export function StickyActions({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <>
      <div className="action-bar-spacer" aria-hidden />
      <div className="action-bar" role="region" aria-label="Primary actions">
        <div className="action-bar-inner">
          {note ? <span className="action-bar-note">{note}</span> : null}
          {children}
        </div>
      </div>
    </>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="tiny muted" style={{ display: "inline-block", marginBottom: 10 }}>
      ← {children}
    </Link>
  );
}
