"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, fromKobo, toKobo } from "@/lib/client";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run<T>(path: string, body: unknown, options: { reset?: () => void } = {}) {
    setBusy(true);
    setError(null);
    const result = await apiFetch<T>(path, { method: "POST", body });
    setBusy(false);

    if (!result.ok) {
      setError(result.details ? Object.values(result.details)[0] : result.error);
      return null;
    }
    setDone(true);
    options.reset?.();
    router.refresh();
    return result.data;
  }

  return { busy, error, done, run, setDone };
}

export function SupplierProfileForm() {
  const { busy, error, done, run } = useAction();
  const [form, setForm] = useState({ businessName: "", about: "", city: "", state: "" });
  const update = (key: keyof typeof form, value: string) => setForm((p) => ({ ...p, [key]: value }));

  if (done) {
    return <div className="form-ok">Supplier profile ready. Add your first listing below.</div>;
  }

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run("/api/supplier/profile", form);
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label htmlFor="sp-name">Business name</label>
        <input
          id="sp-name"
          value={form.businessName}
          onChange={(e) => update("businessName", e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="sp-about">What do you supply?</label>
        <textarea id="sp-about" value={form.about} onChange={(e) => update("about", e.target.value)} />
      </div>
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="sp-city">City</label>
          <input id="sp-city" value={form.city} onChange={(e) => update("city", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-state">State</label>
          <input id="sp-state" value={form.state} onChange={(e) => update("state", e.target.value)} />
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy ? "Saving…" : "Activate supplier tools"}
      </button>
    </form>
  );
}

export function ListingForm() {
  const { busy, error, done, run, setDone } = useAction();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    publicPrice: "",
    resellerPrice: "",
    minResale: "",
    moq: "6",
    stock: "0",
    advertising: true,
    visibility: "ORDER_ONLY",
  });
  const update = (key: keyof typeof form, value: string | boolean) => setForm((p) => ({ ...p, [key]: value }));

  if (done) {
    return (
      <div className="stack-sm">
        <div className="form-ok">Listing created.</div>
        <button className="btn btn-sm" onClick={() => setDone(false)} type="button">
          Add another
        </button>
      </div>
    );
  }

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const publicPriceKobo = toKobo(form.publicPrice);
        const resellerPriceKobo = toKobo(form.resellerPrice);
        if (publicPriceKobo === null || resellerPriceKobo === null) return;

        await run("/api/supplier/listings", {
          title: form.title,
          description: form.description || undefined,
          category: form.category || undefined,
          publicPriceKobo,
          moq: Number(form.moq) || 1,
          stockQty: Number(form.stock) || 0,
          isPublished: true,
          offer: {
            resellerPriceKobo,
            ...(toKobo(form.minResale) ? { minResalePriceKobo: toKobo(form.minResale)! } : {}),
            moq: Number(form.moq) || 1,
            stockQty: Number(form.stock) || 0,
            advertisingPermission: form.advertising,
            customerDataVisibility: form.visibility,
          },
        });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label htmlFor="l-title">Product title</label>
        <input id="l-title" value={form.title} onChange={(e) => update("title", e.target.value)} required />
      </div>
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="l-category">Category</label>
          <input id="l-category" value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="Wigs" />
        </div>
        <div className="field">
          <label htmlFor="l-moq">Minimum order (MOQ)</label>
          <input id="l-moq" inputMode="numeric" value={form.moq} onChange={(e) => update("moq", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-public">Public retail price (₦)</label>
          <input id="l-public" inputMode="decimal" value={form.publicPrice} onChange={(e) => update("publicPrice", e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="l-reseller">Private reseller price (₦)</label>
          <input id="l-reseller" inputMode="decimal" value={form.resellerPrice} onChange={(e) => update("resellerPrice", e.target.value)} required />
          <span className="hint">Only approved resellers can ever see this.</span>
        </div>
        <div className="field">
          <label htmlFor="l-minresale">Minimum resale price (₦)</label>
          <input id="l-minresale" inputMode="decimal" value={form.minResale} onChange={(e) => update("minResale", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-stock">Stock available</label>
          <input id="l-stock" inputMode="numeric" value={form.stock} onChange={(e) => update("stock", e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="l-description">Description</label>
        <textarea id="l-description" value={form.description} onChange={(e) => update("description", e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="l-visibility">Customer details your resellers share with you</label>
        <select id="l-visibility" value={form.visibility} onChange={(e) => update("visibility", e.target.value)}>
          <option value="NONE">Nothing</option>
          <option value="ORDER_ONLY">Order details only</option>
          <option value="FULL">Full customer details</option>
        </select>
      </div>

      <label className="row" style={{ gap: 8, fontSize: "0.85rem" }}>
        <input
          type="checkbox"
          checked={form.advertising}
          onChange={(e) => update("advertising", e.target.checked)}
          style={{ width: 18, minHeight: 18 }}
        />
        Resellers may advertise my photos
      </label>

      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy ? "Publishing…" : "Publish listing"}
      </button>
    </form>
  );
}

export function ApplicationDecision({
  applicationId,
  offers,
}: {
  applicationId: string;
  offers: { id: string; label: string }[];
}) {
  const { busy, error, run } = useAction();
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [note, setNote] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(`/api/supplier/applications/${applicationId}`, {
          decision: "APPROVED",
          offerId,
          note: note || undefined,
        });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}

      {offers.length === 0 ? (
        <p className="tiny muted">Publish a listing with a reseller offer first.</p>
      ) : (
        <div className="field">
          <label>Approve for which offer?</label>
          <select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            {offers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Start with 6 pieces" />
      </div>

      <div className="btn-row">
        <button className="btn btn-primary btn-sm" disabled={busy || offers.length === 0} type="submit">
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          className="btn btn-sm btn-danger"
          type="button"
          disabled={busy}
          onClick={() => run(`/api/supplier/applications/${applicationId}`, { decision: "REJECTED", note })}
        >
          Reject
        </button>
      </div>
    </form>
  );
}

export function OfferPriceForm({
  offerId,
  current,
}: {
  offerId: string;
  current: {
    resellerPriceKobo: number;
    minResalePriceKobo: number | null;
    moq: number;
    commissionType: string;
    commissionValue: number;
    paymentTermsDays: number;
    deliveryResponsibility: string;
    advertisingPermission: boolean;
    customerDataVisibility: string;
  };
}) {
  const { busy, error, run } = useAction();
  const [price, setPrice] = useState(fromKobo(current.resellerPriceKobo));
  const [minResale, setMinResale] = useState(current.minResalePriceKobo ? fromKobo(current.minResalePriceKobo) : "");
  const [moq, setMoq] = useState(String(current.moq));

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const resellerPriceKobo = toKobo(price);
        if (resellerPriceKobo === null) return;
        await run(`/api/supplier/offers/${offerId}/versions`, {
          resellerPriceKobo,
          ...(toKobo(minResale) ? { minResalePriceKobo: toKobo(minResale)! } : {}),
          moq: Number(moq) || 1,
          commissionType: current.commissionType,
          commissionValue: current.commissionValue,
          paymentTermsDays: current.paymentTermsDays,
          deliveryResponsibility: current.deliveryResponsibility,
          advertisingPermission: current.advertisingPermission,
          customerDataVisibility: current.customerDataVisibility,
        });
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid cols-2">
        <div className="field">
          <label>Reseller price (₦)</label>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label>Min resale (₦)</label>
          <input inputMode="decimal" value={minResale} onChange={(e) => setMinResale(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>MOQ</label>
        <input inputMode="numeric" value={moq} onChange={(e) => setMoq(e.target.value)} />
      </div>
      <button className="btn btn-sm" disabled={busy} type="submit">
        {busy ? "Saving…" : "Save as new version"}
      </button>
      <p className="tiny muted">
        This creates a new offer version. Existing agreements and existing orders keep the price they were
        made at — new resellers are approved against this version.
      </p>
    </form>
  );
}
