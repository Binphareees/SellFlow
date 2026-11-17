/**
 * All money in SellFlow is an integer in the smallest unit (kobo for NGN).
 * Nothing in this codebase may store or compute money as a float.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

/** Display currency for the deployment; amounts are still stored as minor units. */
export const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.trim().toUpperCase() || "NGN";

const CURRENCY_LOCALE: Record<string, string> = {
  NGN: "en-NG",
  GHS: "en-GH",
  KES: "en-KE",
  USD: "en-US",
  GBP: "en-GB",
};

export function formatMoney(minor: number, currency = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(minor)) return "—";
  const major = minor / MINOR_UNITS_PER_MAJOR;
  const hasFraction = minor % MINOR_UNITS_PER_MAJOR !== 0;
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? "en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString("en-NG")}`;
  }
}

/** Compact form for dashboards: ₦1.2m, ₦45k. */
export function formatMoneyShort(minor: number, currency = DEFAULT_CURRENCY): string {
  const major = minor / MINOR_UNITS_PER_MAJOR;
  const symbol = currency === "NGN" ? "₦" : `${currency} `;
  if (Math.abs(major) >= 1_000_000) return `${symbol}${trim(major / 1_000_000)}m`;
  if (Math.abs(major) >= 10_000) return `${symbol}${trim(major / 1_000)}k`;
  return formatMoney(minor, currency);
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
}

/**
 * Accepts "1,200", "1200.50", "₦1 200", 1200.
 * Returns kobo, or null when the input is not a sane amount.
 * Rejects negatives, more than 2 decimal places and non-numeric noise.
 */
export function parseMoneyToMinor(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * MINOR_UNITS_PER_MAJOR);
  }
  const cleaned = input
    .trim()
    .replace(/[₦$£€]/g, "")
    .replace(/\s|,/g, "")
    .replace(/^\+/, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * MINOR_UNITS_PER_MAJOR + Number(frac.padEnd(2, "0"));
}

/** For prefilling an <input> from stored kobo. */
export function minorToInput(minor: number): string {
  const major = minor / MINOR_UNITS_PER_MAJOR;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

/** Balance can never be trusted from the client; always recomputed server-side. */
export function balanceOf(totalMinor: number, paidMinor: number): number {
  return Math.max(0, totalMinor - paidMinor);
}

export function paymentState(totalMinor: number, paidMinor: number): "UNPAID" | "PART_PAID" | "PAID" {
  if (paidMinor <= 0) return "UNPAID";
  if (paidMinor >= totalMinor) return "PAID";
  return "PART_PAID";
}

/**
 * Pro reminder: the same human tone, but anchored to the date the customer gave.
 * Kept separate from the balance reminder so a Free account never sends it.
 */
export function whatsappPromiseReminderText(params: {
  businessName: string;
  customerName: string;
  amountMinor: number;
  dueDate: Date | string;
  currency?: string;
}): string {
  const amount = formatMoney(params.amountMinor, params.currency ?? DEFAULT_CURRENCY);
  const due = new Date(params.dueDate);
  const when = due.toLocaleDateString("en-NG", { day: "numeric", month: "long" });
  return `Good day ${params.customerName}, this is ${params.businessName}. You mentioned ${amount} would come in by ${when}. Just checking in on it — no pressure, let me know how it is going. Thank you.`;
}

/** Chases should look like a person asking, not a dunning letter. */
export function whatsappReminderText(params: {
  businessName: string;
  customerName: string;
  balanceMinor: number;
  currency?: string;
}): string {
  const amount = formatMoney(params.balanceMinor, params.currency ?? DEFAULT_CURRENCY);
  return `Good day ${params.customerName}, this is ${params.businessName}. Trust you are well. Just a gentle reminder about the balance of ${amount} on your order. Kindly let me know when you can complete it. Thank you.`;
}
