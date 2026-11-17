"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, fromKobo, toKobo } from "@/lib/client";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run<T>(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await apiFetch<T>(path, { method: "POST", body });
    setBusy(false);

    if (!result.ok) {
      setError(result.details ? Object.values(result.details)[0] : result.error);
      return false;
    }
    setNote("Saved");
    router.refresh();
    return true;
  }

  return { busy, error, note, run };
}

export function StockConfirmForm({
  orderId,
  items,
}: {
  orderId: string;
  items: { id: string; title: string; qty: number; confirmedQty: number | null }[];
}) {
  const { busy, error, note, run } = useAction();
  const [decision, setDecision] = useState("CONFIRMED");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(items.map((item) => [item.id, String(item.confirmedQty ?? item.qty)])),
  );
  const [comment, setComment] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(`/api/supplier/orders/${orderId}/stock`, {
          decision,
          note: comment || undefined,
          items: items.map((item) => ({
            itemId: item.id,
            confirmedQty: Number(quantities[item.id] ?? 0),
          })),
        });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      {note ? <div className="form-ok">{note}</div> : null}

      {items.map((item) => (
        <div className="row-between" key={item.id}>
          <span className="tiny">
            {item.title} <span className="muted">(ordered {item.qty})</span>
          </span>
          <input
            aria-label={`Confirmed quantity for ${item.title}`}
            inputMode="numeric"
            style={{ maxWidth: 90 }}
            value={quantities[item.id] ?? ""}
            onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
          />
        </div>
      ))}

      <div className="field">
        <label>Stock decision</label>
        <select value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="CONFIRMED">All in stock</option>
          <option value="PARTIAL">Partially available</option>
          <option value="DECLINED">Not available</option>
        </select>
      </div>

      <div className="field">
        <label>Note for the reseller</label>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. 4 left in this colour" />
      </div>

      <button className="btn btn-primary btn-sm" disabled={busy} type="submit">
        {busy ? "Saving…" : "Confirm stock"}
      </button>
    </form>
  );
}

export function ClaimForm({
  orderId,
  suggestedAmountKobo,
  role,
}: {
  orderId: string;
  suggestedAmountKobo: number;
  role: "RESELLER" | "SUPPLIER";
}) {
  const { busy, error, note, run } = useAction();
  const [amount, setAmount] = useState(fromKobo(suggestedAmountKobo));
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const amountKobo = toKobo(amount);
        if (amountKobo === null) return;
        await run(`/api/supplier/orders/${orderId}/claims`, {
          amountKobo,
          method,
          reference: reference || undefined,
          status: role === "RESELLER" ? "SENT" : "RECEIVED",
        });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      {note ? <div className="form-ok">{note}</div> : null}

      <div className="form-grid cols-2">
        <div className="field">
          <label>Amount (₦)</label>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label>Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {["BANK_TRANSFER", "CASH", "POS", "MOBILE_MONEY", "OTHER"].map((value) => (
              <option key={value} value={value}>
                {value.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Reference</label>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer reference" />
      </div>

      <button className="btn btn-sm" disabled={busy} type="submit">
        {busy ? "Saving…" : role === "RESELLER" ? "Mark as sent" : "Mark as received"}
      </button>
      <p className="tiny muted">
        This is a claim, not proof. The other party confirms it, and SellFlow never checks your bank.
      </p>
    </form>
  );
}

export function ClaimDecision({ orderId, claimId }: { orderId: string; claimId: string }) {
  const { busy, error, run } = useAction();
  const [comment, setComment] = useState("");

  return (
    <div className="stack-sm">
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional note"
          aria-label="Note"
        />
      </div>
      <div className="btn-row">
        <button
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => run(`/api/supplier/orders/${orderId}/claims/${claimId}`, { action: "CONFIRM", note: comment || undefined })}
        >
          Confirm received
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={() => run(`/api/supplier/orders/${orderId}/claims/${claimId}`, { action: "DISPUTE", note: comment || undefined })}
        >
          Dispute
        </button>
      </div>
    </div>
  );
}

export function DispatchForm({ orderId }: { orderId: string }) {
  const { busy, error, note, run } = useAction();
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [summary, setSummary] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(`/api/supplier/orders/${orderId}/dispatch`, {
          courierName: courier || undefined,
          trackingRef: tracking || undefined,
          itemSummary: summary || undefined,
        });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      {note ? <div className="form-ok">{note}</div> : null}
      <div className="form-grid cols-2">
        <div className="field">
          <label>Courier</label>
          <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="GIG, Bolt, park bus" />
        </div>
        <div className="field">
          <label>Tracking / waybill</label>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>What was sent?</label>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. 6 wigs, 2 colours" />
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy} type="submit">
        {busy ? "Saving…" : "Mark dispatched"}
      </button>
    </form>
  );
}

export function DeliveryForm({ orderId }: { orderId: string }) {
  const { busy, error, note, run } = useAction();
  const [comment, setComment] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(`/api/supplier/orders/${orderId}/delivery`, { receivedQtyOk: true, note: comment || undefined });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      {note ? <div className="form-ok">{note}</div> : null}
      <div className="field">
        <label>Note</label>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Everything arrived fine" />
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy} type="submit">
        {busy ? "Saving…" : "Confirm delivery received"}
      </button>
    </form>
  );
}
