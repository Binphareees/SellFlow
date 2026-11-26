"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

/**
 * Review action for the admin verification queue.
 *
 * The endpoint only exports PATCH, so this cannot be a link. The server
 * validates the same shape (verificationSchema); this form only mirrors it so
 * the administrator gets an error before the request when the reason is empty.
 */
export function VerificationReview({
  profileId,
  profileName,
}: {
  profileId: string;
  profileName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState(1);
  const [reason, setReason] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setOpen(false);
    setTier(1);
    setReason("");
    setEvidenceRef("");
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError("Give a reason of at least 3 characters.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/admin/profiles/${profileId}/verification`, {
      method: "PATCH",
      body: {
        tier,
        reason: reason.trim(),
        evidenceRef: evidenceRef.trim() || undefined,
      },
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    reset();
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => setOpen(true)}>
        Review
      </button>
    );
  }

  return (
    <form
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}
      onSubmit={submit}
      aria-label={`Review verification for ${profileName}`}
    >
      <label className="tiny" htmlFor={`tier-${profileId}`}>
        Verification tier
      </label>
      <select
        id={`tier-${profileId}`}
        className="input"
        value={tier}
        onChange={(event) => setTier(Number(event.target.value))}
        disabled={busy}
      >
        <option value={1}>1 — contact verified</option>
        <option value={2}>2 — business reviewed</option>
        <option value={3}>3 — documents verified</option>
      </select>

      <label className="tiny" htmlFor={`reason-${profileId}`}>
        Reason (required)
      </label>
      <input
        id={`reason-${profileId}`}
        className="input"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        minLength={3}
        maxLength={300}
        required
        disabled={busy}
      />

      <label className="tiny" htmlFor={`evidence-${profileId}`}>
        Evidence reference (optional)
      </label>
      <input
        id={`evidence-${profileId}`}
        className="input"
        value={evidenceRef}
        onChange={(event) => setEvidenceRef(event.target.value)}
        maxLength={300}
        disabled={busy}
      />

      {error ? (
        <p className="tiny" role="alert" style={{ color: "var(--danger, #b42318)" }}>
          {error}
        </p>
      ) : null}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save tier"}
        </button>
        <button className="btn btn-sm" type="button" onClick={reset} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
