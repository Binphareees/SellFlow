"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { formatMoney } from "@/lib/money";

function firstField(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const value = Object.values(details).find((entry) => typeof entry === "string");
  return typeof value === "string" ? value : undefined;
}

export function UpgradeForm({
  tier,
  priceKobo,
  disabled,
  disabledNote,
}: {
  tier: string;
  priceKobo: number;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (disabled) {
    return <p className="tiny muted">{disabledNote ?? "Switch plans from the active plan first."}</p>;
  }

  if (done) {
    return (
      <div className="form-ok">
        Submitted. Your plan stays the same until a person confirms the transfer — usually the same
        working day.
      </div>
    );
  }

  if (!open) {
    return (
      <button className="btn btn-primary btn-block" type="button" onClick={() => setOpen(true)}>
        Request {tier === "PRO" ? "Pro" : "Supplier Pro"} · {formatMoney(priceKobo)}
      </button>
    );
  }

  return (
    <form
      className="stack-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await apiFetch("/api/billing/upgrade", {
          method: "POST",
          body: { tier, method, reference: reference || undefined, proofNote: proofNote || undefined },
        });
        setBusy(false);
        if (!result.ok) {
          setError(firstField(result.details) ?? result.error);
          if (result.code === "SUBSCRIPTION_PAYMENT_PENDING") router.refresh();
          return;
        }
        setDone(true);
        router.refresh();
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label htmlFor={`method-${tier}`}>How did you pay?</label>
        <select
          id={`method-${tier}`}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          {["BANK_TRANSFER", "POS", "MOBILE_MONEY", "CASH", "OTHER"].map((value) => (
            <option key={value} value={value}>
              {value.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`reference-${tier}`}>Transfer reference</label>
        <input
          id={`reference-${tier}`}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="e.g. GTB 8821 or POS slip number"
        />
      </div>

      <div className="field">
        <label htmlFor={`note-${tier}`}>Anything we should know?</label>
        <textarea
          id={`note-${tier}`}
          value={proofNote}
          onChange={(event) => setProofNote(event.target.value)}
          placeholder="Bank, time of transfer, sender name"
        />
        <span className="hint">
          SellFlow stores this note, not bank documents. We never check your bank automatically.
        </span>
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Sending…" : "Submit for confirmation"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CancelPlanButton({ periodEnd }: { periodEnd: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button className="btn btn-sm btn-danger" type="button" onClick={() => setConfirming(true)}>
        Cancel plan
      </button>
    );
  }

  return (
    <div className="stack-sm">
      {error ? <div className="form-error">{error}</div> : null}
      <p className="tiny muted">
        Your data stays exactly as it is. The plan simply returns to Free
        {periodEnd ? ` on ${periodEnd}` : " at the end of the paid period"}, and anything above the Free
        caps becomes read-only.
      </p>
      <div className="btn-row">
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          type="button"
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await apiFetch("/api/billing/cancel", { method: "POST", body: {} });
            setBusy(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          }}
        >
          {busy ? "Saving…" : "Yes, cancel at period end"}
        </button>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirming(false)}>
          Keep plan
        </button>
      </div>
    </div>
  );
}

export function PaymentDecision({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "CONFIRM" | "REJECT") {
    setBusy(action);
    setError(null);
    const result = await apiFetch(`/api/billing/payments/${paymentId}/decision`, {
      method: "POST",
      body: { action, note: note || undefined },
    });
    setBusy(null);
    if (!result.ok) {
      setError(firstField(result.details) ?? result.error);
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <div className="stack-sm">
      {error ? <div className="form-error">{error}</div> : null}
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Reference checked / reason for rejection"
        aria-label="Decision note"
      />
      <div className="btn-row">
        <button
          className="btn btn-sm btn-primary"
          type="button"
          disabled={busy !== null}
          onClick={() => decide("CONFIRM")}
        >
          {busy === "CONFIRM" ? "Activating…" : "Confirm transfer"}
        </button>
        <button
          className="btn btn-sm btn-danger"
          type="button"
          disabled={busy !== null}
          onClick={() => decide("REJECT")}
        >
          {busy === "REJECT" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
