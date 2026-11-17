"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, fromKobo, toKobo } from "@/lib/client";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(path: string, body: unknown, options: { redirectTo?: string } = {}) {
    setBusy(true);
    setError(null);
    const result = await apiFetch<T>(path, { method: "POST", body });
    setBusy(false);

    if (!result.ok) {
      setError(firstMessage(result.details) ?? result.error);
      return null;
    }
    if (options.redirectTo) router.push(options.redirectTo);
    router.refresh();
    return result.data;
  }

  return { busy, error, run };
}

/** Plan blocks return numeric metadata in details; only strings belong on screen. */
function firstMessage(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const value = Object.values(details).find((entry) => typeof entry === "string");
  return typeof value === "string" ? value : undefined;
}

export function ApplyToSupplier({
  supplierProfileId,
  offerId,
}: {
  supplierProfileId: string;
  offerId?: string;
}) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return <div className="form-ok">Application sent. The supplier will review it.</div>;
  }

  if (!open) {
    return (
      <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>
        Apply for reseller price
      </button>
    );
  }

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = await run<{ application: { id: string } }>("/api/marketplace/applications", {
          supplierProfileId,
          offerId,
          message: message || undefined,
          businessSummary: summary || undefined,
        });
        if (data) setSent(true);
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label htmlFor="apply-summary">What do you sell, and where?</label>
        <input
          id="apply-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="e.g. Hair products on Instagram, Enugu"
        />
      </div>
      <div className="field">
        <label htmlFor="apply-message">Message to the supplier</label>
        <textarea
          id="apply-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="How many pieces you can move per month"
        />
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy ? "Sending…" : "Send application"}
      </button>
    </form>
  );
}

export function PlaceSupplierOrderForm({
  listingId,
  supplierProfileId,
  moq,
  resellerPriceKobo,
  minResaleKobo,
  customerOrders,
}: {
  listingId: string;
  supplierProfileId: string;
  moq: number;
  resellerPriceKobo: number;
  minResaleKobo: number | null;
  customerOrders: { id: string; label: string }[];
}) {
  const { busy, error, run } = useAction();
  const [qty, setQty] = useState(String(moq));
  const [resale, setResale] = useState(minResaleKobo ? fromKobo(minResaleKobo) : "");
  const [customerOrderId, setCustomerOrderId] = useState("");

  const quantity = Number(qty) || 0;
  const cost = quantity * resellerPriceKobo;
  const resaleTotal = (toKobo(resale) ?? 0) * quantity;

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(
          "/api/supplier/orders",
          {
            supplierProfileId,
            items: [
              {
                listingId,
                qty: quantity,
                ...(toKobo(resale) ? { resalePriceKobo: toKobo(resale)! } : {}),
              },
            ],
            ...(customerOrderId ? { customerOrderId } : {}),
          },
          { redirectTo: "/reseller" },
        );
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}

      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="qty">Quantity (min {moq})</label>
          <input id="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="resale">Your selling price per unit (₦)</label>
          <input
            id="resale"
            inputMode="decimal"
            value={resale}
            onChange={(e) => setResale(e.target.value)}
            placeholder={minResaleKobo ? `min ${fromKobo(minResaleKobo)}` : "optional"}
          />
        </div>
      </div>

      {customerOrders.length > 0 ? (
        <div className="field">
          <label htmlFor="link-order">Link to a customer order (optional)</label>
          <select id="link-order" value={customerOrderId} onChange={(e) => setCustomerOrderId(e.target.value)}>
            <option value="">No link</option>
            {customerOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="row-between">
        <span className="tiny muted">
          {quantity} × {fromKobo(resellerPriceKobo)}
        </span>
        <span className="money">{cost ? `₦${(cost / 100).toLocaleString()}` : "—"}</span>
      </div>

      {resaleTotal > 0 ? (
        <p className="tiny muted">
          Your revenue at that price: ₦{(resaleTotal / 100).toLocaleString()} — margin ₦
          {((resaleTotal - cost) / 100).toLocaleString()}
        </p>
      ) : null}

      <button className="btn btn-primary" disabled={busy || quantity < moq} type="submit">
        {busy ? "Submitting…" : "Submit supplier order"}
      </button>
      <p className="tiny muted">
        The price on this order comes from your agreement, not from this form. If the supplier changes their
        terms later, this order keeps its price.
      </p>
    </form>
  );
}

export function ActivateResellerButton() {
  const { busy, error, run } = useAction();
  return (
    <div className="stack-sm">
      {error ? <div className="form-error">{error}</div> : null}
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={() => run("/api/profile/roles", { role: "RESELLER" })}
      >
        {busy ? "Activating…" : "Activate reseller tools"}
      </button>
    </div>
  );
}

export function AcceptAgreementButton({ agreementId }: { agreementId: string }) {
  const { busy, error, run } = useAction();
  return (
    <div className="stack-sm">
      {error ? <div className="form-error">{error}</div> : null}
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => run(`/api/reseller/agreements/${agreementId}/accept`, {})}
      >
        {busy ? "Accepting…" : "Accept terms"}
      </button>
    </div>
  );
}
