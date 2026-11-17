"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { DISPUTE_OUTCOME, DISPUTE_REASON, DISPUTE_REASON_LABEL } from "@/lib/enums";

export type DisputeOrderOption = {
  id: string;
  orderNumber: string;
  counterparty: string;
  totalKobo: number;
  claims: {
    id: string;
    amountKobo: number;
    reference: string | null;
    status: string;
    claimedByRole: string;
  }[];
};

const OUTCOME_LABEL: Record<string, string> = {
  RESELLER_FAVOUR: "In favour of the reseller",
  SUPPLIER_FAVOUR: "In favour of the supplier",
  MUTUAL: "Resolved between both sides",
  NO_ACTION: "No action needed",
};

export function NewDisputeForm({
  orders,
  presetOrderId,
  presetClaimId,
}: {
  orders: DisputeOrderOption[];
  presetOrderId?: string;
  presetClaimId?: string;
}) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(presetOrderId ?? orders[0]?.id ?? "");
  const [claimId, setClaimId] = useState(presetClaimId ?? "");
  const [reason, setReason] = useState<string>(
    presetClaimId ? "PAYMENT_NOT_RECEIVED" : "NON_DELIVERY",
  );
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => orders.find((order) => order.id === orderId), [orders, orderId]);

  if (orders.length === 0) {
    return (
      <div className="notice">
        You need a supplier order first. Find a supplier in the{" "}
        <a href="/marketplace">marketplace</a> and place an order — disputes attach to that order so
        both sides see the same record.
      </div>
    );
  }

  return (
    <form
      className="stack-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await apiFetch<{ dispute: { id: string } }>("/api/disputes", {
          method: "POST",
          body: {
            supplierOrderId: orderId,
            ...(claimId ? { claimId } : {}),
            reason,
            description,
          },
        });
        setBusy(false);
        if (!result.ok) {
          setError(result.details ? Object.values(result.details)[0] : result.error);
          return;
        }
        router.push(`/disputes/${result.data.dispute.id}`);
        router.refresh();
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label htmlFor="dispute-order">Which order?</label>
        <select
          id="dispute-order"
          value={orderId}
          onChange={(event) => {
            setOrderId(event.target.value);
            setClaimId("");
          }}
        >
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.orderNumber} · {order.counterparty} · {formatMoney(order.totalKobo)}
            </option>
          ))}
        </select>
      </div>

      {selected && selected.claims.length > 0 ? (
        <div className="field">
          <label htmlFor="dispute-claim">Is it about a payment claim?</label>
          <select id="dispute-claim" value={claimId} onChange={(event) => setClaimId(event.target.value)}>
            <option value="">No — the order as a whole</option>
            {selected.claims.map((claim) => (
              <option key={claim.id} value={claim.id}>
                {formatMoney(claim.amountKobo)} marked {claim.status.toLowerCase()} by{" "}
                {claim.claimedByRole.toLowerCase()}
                {claim.reference ? ` · ${claim.reference}` : ""}
              </option>
            ))}
          </select>
          <span className="hint">
            Linking the claim means a mediator&apos;s decision also settles that claim.
          </span>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="dispute-reason">What went wrong?</label>
        <select id="dispute-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          {DISPUTE_REASON.map((value) => (
            <option key={value} value={value}>
              {DISPUTE_REASON_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="dispute-description">What happened?</label>
        <textarea
          id="dispute-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Dates, amounts, what the other side said. Facts travel further than accusations."
          required
          minLength={10}
        />
        <span className="hint">Both sides and any mediator can read this. It cannot be edited later.</span>
      </div>

      <button className="btn btn-primary btn-block" disabled={busy} type="submit">
        {busy ? "Opening dispute…" : "Open dispute"}
      </button>
    </form>
  );
}

export function DisputeMessageForm({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [type, setType] = useState<"MESSAGE" | "EVIDENCE">("MESSAGE");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await apiFetch(`/api/disputes/${disputeId}/events`, {
          method: "POST",
          body: { type, body },
        });
        setBusy(false);
        if (!result.ok) {
          setError(result.details ? Object.values(result.details)[0] : result.error);
          return;
        }
        setBody("");
        router.refresh();
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label htmlFor="dispute-body">Add to the record</label>
        <textarea
          id="dispute-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What happened on your side?"
          required
        />
      </div>
      <div className="row-between">
        <select
          aria-label="Entry type"
          value={type}
          onChange={(event) => setType(event.target.value as "MESSAGE" | "EVIDENCE")}
          style={{ maxWidth: 170 }}
        >
          <option value="MESSAGE">Message</option>
          <option value="EVIDENCE">Evidence note</option>
        </select>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Sending…" : "Post update"}
        </button>
      </div>
    </form>
  );
}

export function DisputeMediatorPanel({
  disputeId,
  status,
  outcome,
}: {
  disputeId: string;
  status: string;
  outcome: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "resolve">("idle");
  const [decision, setDecision] = useState(outcome ?? "MUTUAL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiFetch(path, { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setError(result.details ? Object.values(result.details)[0] : result.error);
      return false;
    }
    setNote("");
    router.refresh();
    return true;
  }

  const closed = status === "CLOSED";

  return (
    <div className="stack-sm">
      {error ? <div className="form-error">{error}</div> : null}

      <div className="btn-row">
        {status !== "UNDER_REVIEW" && !closed ? (
          <button
            className="btn btn-sm"
            disabled={busy}
            type="button"
            onClick={() => call(`/api/disputes/${disputeId}/status`, { status: "UNDER_REVIEW" })}
          >
            Take up for review
          </button>
        ) : null}
        {!closed ? (
          <button
            className="btn btn-sm btn-danger"
            disabled={busy}
            type="button"
            onClick={() => call(`/api/disputes/${disputeId}/status`, { status: "CLOSED" })}
          >
            Close without outcome
          </button>
        ) : null}
        {!closed && mode === "idle" ? (
          <button className="btn btn-sm btn-primary" type="button" onClick={() => setMode("resolve")}>
            Record outcome
          </button>
        ) : null}
      </div>

      {closed ? <p className="tiny muted">This dispute is closed. The trail stays readable.</p> : null}

      {mode === "resolve" && !closed ? (
        <form
          className="stack-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            const done = await call(`/api/disputes/${disputeId}/resolve`, {
              outcome: decision,
              note,
              status: "RESOLVED",
            });
            if (done) setMode("idle");
          }}
        >
          <div className="field">
            <label htmlFor="dispute-outcome">Outcome</label>
            <select
              id="dispute-outcome"
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
            >
              {DISPUTE_OUTCOME.map((value) => (
                <option key={value} value={value}>
                  {OUTCOME_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dispute-note">Reasoning (goes into the audit trail)</label>
            <textarea
              id="dispute-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you check, and what should each side do now?"
              required
              minLength={3}
            />
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Record outcome"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
          <p className="tiny muted">
            Recording an outcome closes the dispute and, when a payment claim was linked, settles that
            claim&apos;s record too. Nothing here moves money.
          </p>
        </form>
      ) : null}
    </div>
  );
}
