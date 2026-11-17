import Link from "next/link";
import { TIER, type TierLimits } from "@/lib/plans";

const ROWS: { key: keyof TierLimits; label: string }[] = [
  { key: "customers", label: "customers" },
  { key: "activeOrders", label: "open orders" },
  { key: "products", label: "products" },
  { key: "suppliers", label: "suppliers" },
];

/**
 * A quiet prompt, not a wall. It appears once a free workspace is near a cap and
 * gets firmer at the cap itself. Paid plans render nothing.
 */
export function UpgradeBanner({
  tier,
  usage,
  limits,
}: {
  tier: string;
  usage: Record<keyof TierLimits, number>;
  limits: TierLimits;
}) {
  if (tier !== TIER.FREE) return null;

  const ranked = ROWS.filter((row) => Number.isFinite(limits[row.key]))
    .map((row) => {
      const used = usage[row.key];
      const limit = limits[row.key];
      return { ...row, used, limit, percent: limit > 0 ? (used / limit) * 100 : 100 };
    })
    .sort((a, b) => b.percent - a.percent);

  const worst = ranked[0];
  if (!worst || worst.percent < 70) return null;

  const atCap = worst.used >= worst.limit;

  return (
    <div className={`upgrade-banner ${atCap ? "is-blocked" : ""}`} role="status">
      <div className="grow">
        <strong>
          {atCap
            ? `Free plan limit reached: ${worst.used} of ${worst.limit} ${worst.label}`
            : `Free plan: ${worst.used} of ${worst.limit} ${worst.label} used`}
        </strong>
        <div className="tiny">
          {atCap
            ? "New records of this kind are blocked. Nothing already saved is hidden."
            : "Upgrade before a busy day pushes you over the cap."}
        </div>
      </div>
      <Link className="btn btn-sm btn-primary" href="/settings/billing">
        See plans
      </Link>
    </div>
  );
}
