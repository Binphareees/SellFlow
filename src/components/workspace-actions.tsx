"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiFetch, toKobo } from "@/lib/client";
import { formatMoney } from "@/lib/money";

type ProductOption = {
  id: string;
  name: string;
  sellingPriceKobo: number;
  costPriceKobo: number;
  stockQty: number;
};

type CustomerOption = { id: string; name: string };

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run<T>(
    path: string,
    body: unknown,
    options: { method?: string; success?: string; redirectTo?: string; reset?: () => void } = {},
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setCode(null);
    setDone(null);
    const result = await apiFetch<T>(path, { method: options.method ?? "POST", body });
    setBusy(false);

    if (!result.ok) {
      const firstField = firstFieldOf(result.details);
      setError(firstField ?? result.error);
      setCode(result.code ?? null);
      return false;
    }

    setDone(options.success ?? "Saved");
    options.reset?.();
    if (options.redirectTo) router.push(options.redirectTo);
    router.refresh();
    return true;
  }

  return { busy, error, code, done, run, setError };
}

function firstFieldOf(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const value = Object.values(details).find((entry) => typeof entry === "string");
  return typeof value === "string" ? value : undefined;
}

/**
 * Server-side plan blocks arrive as 403 SUBSCRIPTION_LIMIT_REACHED /
 * SUBSCRIPTION_FEATURE_LOCKED. The form keeps the server's wording and offers the
 * one useful next step instead of a dead end.
 */
function FormError({ error, code }: { error: string | null; code?: string | null }) {
  if (!error) return null;
  if (code && code.startsWith("SUBSCRIPTION_")) {
    return (
      <div className="notice">
        <div className="row-between">
          <span className="tiny grow">{error}</span>
          <Link className="btn btn-sm btn-primary" href="/settings/billing">
            See plans
          </Link>
        </div>
      </div>
    );
  }
  return <div className="form-error">{error}</div>;
}

// ── Customers ───────────────────────────────────────────────────────────────

export function CustomerForm() {
  const { busy, error, code, run } = useAction();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        await run("/api/workspace/customers", { name, phone }, { reset: () => { setName(""); setPhone(""); } });
      }}
    >
      <FormError error={error} code={code} />
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="customer-name">Name</label>
          <input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="customer-phone">WhatsApp number</label>
          <input id="customer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803…" />
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy ? "Adding…" : "Add customer"}
      </button>
    </form>
  );
}

// ── Products ────────────────────────────────────────────────────────────────

export function ProductForm() {
  const { busy, error, code, run } = useAction();
  const [form, setForm] = useState({ name: "", cost: "", price: "", stock: "0" });

  const update = (key: keyof typeof form, value: string) => setForm((p) => ({ ...p, [key]: value }));

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const costPriceKobo = toKobo(form.cost || "0");
        const sellingPriceKobo = toKobo(form.price);
        if (costPriceKobo === null || sellingPriceKobo === null) {
          return;
        }
        await run(
          "/api/workspace/products",
          {
            name: form.name,
            costPriceKobo,
            sellingPriceKobo,
            stockQty: Number(form.stock) || 0,
          },
          { reset: () => setForm({ name: "", cost: "", price: "", stock: "0" }) },
        );
      }}
    >
      <FormError error={error} code={code} />
      <div className="field">
        <label htmlFor="product-name">Product name</label>
        <input id="product-name" value={form.name} onChange={(e) => update("name", e.target.value)} required />
      </div>
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="cost">Cost price (₦)</label>
          <input id="cost" inputMode="decimal" value={form.cost} onChange={(e) => update("cost", e.target.value)} placeholder="0" />
          <span className="hint">Private. Used for profit only.</span>
        </div>
        <div className="field">
          <label htmlFor="price">Selling price (₦)</label>
          <input id="price" inputMode="decimal" value={form.price} onChange={(e) => update("price", e.target.value)} required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="stock">Stock quantity</label>
        <input id="stock" inputMode="numeric" value={form.stock} onChange={(e) => update("stock", e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy ? "Saving…" : "Add product"}
      </button>
    </form>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────

type Line = { key: string; productId: string | null; name: string; qty: number; price: string; cost: string };

export function OrderForm({
  customers,
  products,
}: {
  customers: CustomerOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "new");
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [channel, setChannel] = useState("WHATSAPP");
  const [lines, setLines] = useState<Line[]>([
    { key: "l1", productId: null, name: "", qty: 1, price: "", cost: "" },
  ]);
  const [deposit, setDeposit] = useState("");
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + (toKobo(line.price) ?? 0) * (line.qty || 0), 0),
    [lines],
  );

  function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setLines((prev) => [
      ...prev.filter((l) => l.name || l.price),
      {
        key: `p-${productId}-${Date.now()}`,
        productId: product.id,
        name: product.name,
        qty: 1,
        price: String(product.sellingPriceKobo / 100),
        cost: String(product.costPriceKobo / 100),
      },
    ]);
  }

  function addCustom() {
    setLines((prev) => [
      ...prev,
      { key: `c-${Date.now()}`, productId: null, name: "", qty: 1, price: "", cost: "" },
    ]);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setErrorCode(null);

    const usable = lines.filter((l) => l.name.trim() && (toKobo(l.price) ?? 0) >= 0);
    if (usable.length === 0) {
      setError("Add at least one item with a name and price");
      return;
    }

    setBusy(true);

    let targetCustomer = customerId;
    if (customerId === "new") {
      const created = await apiFetch<{ customer: { id: string } }>("/api/workspace/customers", {
        method: "POST",
        body: { name: newCustomer.name, phone: newCustomer.phone || undefined },
      });
      if (!created.ok) {
        setBusy(false);
        setError(firstFieldOf(created.details) ?? created.error);
        setErrorCode(created.code ?? null);
        return;
      }
      targetCustomer = created.data.customer.id;
    }

    const promiseKobo = toKobo(promiseAmount);
    const payload = {
      customerId: targetCustomer,
      channel,
      notes: notes || undefined,
      items: usable.map((line) => ({
        ...(line.productId ? { productId: line.productId } : {}),
        name: line.name.trim(),
        qty: line.qty,
        unitPriceKobo: toKobo(line.price) ?? 0,
        unitCostKobo: toKobo(line.cost || "0") ?? 0,
      })),
      ...(toKobo(deposit) ? { depositKobo: toKobo(deposit)!, depositMethod: "BANK_TRANSFER" } : {}),
      ...(promiseKobo && promiseDate
        ? { promise: { amountKobo: promiseKobo, promisedFor: new Date(promiseDate).toISOString() } }
        : {}),
    };

    const result = await apiFetch<{ order: { id: string } }>("/api/workspace/orders", {
      method: "POST",
      body: payload,
    });
    setBusy(false);

    if (!result.ok) {
      setError(firstFieldOf(result.details) ?? result.error);
      setErrorCode(result.code ?? null);
      return;
    }

    router.push(`/dashboard/orders/${result.data.order.id}`);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <FormError error={error} code={errorCode} />

      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}>
          Customer
        </div>
        <div className="field">
          <label htmlFor="customer">Who is this order for?</label>
          <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
            <option value="new">+ New customer</option>
          </select>
        </div>

        {customerId === "new" ? (
          <div className="form-grid cols-2 mt-12">
            <div className="field">
              <label htmlFor="new-name">Name</label>
              <input
                id="new-name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-phone">WhatsApp number</label>
              <input
                id="new-phone"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))}
                placeholder="0803…"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Items</div>
          <button type="button" className="btn btn-sm" onClick={addCustom}>
            + Custom item
          </button>
        </div>

        {products.length > 0 ? (
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="add-product">Add from your products</label>
            <select
              id="add-product"
              value=""
              onChange={(e) => {
                if (e.target.value) addProduct(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">Choose a product…</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} — ₦{(product.sellingPriceKobo / 100).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="stack-sm">
          {lines.map((line) => (
            <div key={line.key} className="card" style={{ padding: 12, boxShadow: "none" }}>
              <div className="form-grid cols-2">
                <div className="field">
                  <label>Item</label>
                  <input
                    value={line.name}
                    onChange={(e) => updateLine(line.key, { name: e.target.value })}
                    placeholder="e.g. Body wave wig 18in"
                  />
                </div>
                <div className="field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="field">
                  <label>Unit price (₦)</label>
                  <input
                    inputMode="decimal"
                    value={line.price}
                    onChange={(e) => updateLine(line.key, { price: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="field">
                  <label>Cost price (₦)</label>
                  <input
                    inputMode="decimal"
                    value={line.cost}
                    onChange={(e) => updateLine(line.key, { cost: e.target.value })}
                    placeholder="optional"
                  />
                </div>
              </div>
              {lines.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost mt-12"
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  Remove item
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="row-between mt-12">
          <span className="tiny muted">Order total</span>
          <span className="money">{total > 0 ? `₦${(total / 100).toLocaleString()}` : "—"}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}>
          Payment (all optional)
        </div>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="deposit">Deposit received (₦)</label>
            <input id="deposit" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            <span className="hint">Recorded as a manual payment.</span>
          </div>
          <div className="field">
            <label htmlFor="promise-amount">Promised amount (₦)</label>
            <input
              id="promise-amount"
              inputMode="decimal"
              value={promiseAmount}
              onChange={(e) => setPromiseAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="promise-date">Promised date</label>
            <input
              id="promise-date"
              type="date"
              value={promiseDate}
              onChange={(e) => setPromiseDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="channel">Where did the order come from?</label>
            <select id="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {["WHATSAPP", "INSTAGRAM", "WALK_IN", "PHONE", "REFERRAL", "OTHER"].map((value) => (
                <option key={value} value={value}>
                  {value.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field mt-12">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember" />
        </div>
      </div>

      <div className="action-bar-spacer" aria-hidden />
      <div className="action-bar" role="region" aria-label="Save order">
        <div className="action-bar-inner">
          <span className="action-bar-note">
            Total
            <br />
            <strong className="money">{total > 0 ? formatMoney(total) : "—"}</strong>
          </span>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save order"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Payments & promises ─────────────────────────────────────────────────────

export function PaymentForm({ orderId, remainingKobo }: { orderId: string; remainingKobo: number }) {
  const { busy, error, code, run } = useAction();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const amountKobo = toKobo(amount);
        if (amountKobo === null) return;
        await run(
          `/api/workspace/orders/${orderId}/payments`,
          {
            amountKobo,
            method,
            reference: reference || undefined,
            paidAt: new Date().toISOString(),
          },
          { reset: () => { setAmount(""); setReference(""); } },
        );
      }}
    >
      <FormError error={error} code={code} />
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="pay-amount">Amount received (₦)</label>
          <input
            id="pay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(remainingKobo / 100)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pay-method">How?</label>
          <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {["BANK_TRANSFER", "CASH", "POS", "MOBILE_MONEY", "OTHER"].map((value) => (
              <option key={value} value={value}>
                {value.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="pay-ref">Reference (optional)</label>
        <input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer ref or POS slip" />
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy ? "Recording…" : "Record payment"}
      </button>
      <p className="tiny muted">
        SellFlow records what you tell it. It does not connect to your bank and cannot verify a transfer.
      </p>
    </form>
  );
}

export function PromiseForm({ orderId }: { orderId: string }) {
  const { busy, error, code, run } = useAction();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");

  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const amountKobo = toKobo(amount);
        if (!amountKobo || !date) return;
        await run(
          `/api/workspace/orders/${orderId}/promises`,
          { amountKobo, promisedFor: new Date(date).toISOString() },
          { reset: () => { setAmount(""); setDate(""); } },
        );
      }}
    >
      <FormError error={error} code={code} />
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="promise-new-amount">Amount promised (₦)</label>
          <input id="promise-new-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="promise-new-date">For when?</label>
          <input id="promise-new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Saving…" : "Log payment promise"}
      </button>
    </form>
  );
}

export function PromiseActions({ promiseId }: { promiseId: string }) {
  const { busy, run } = useAction();
  return (
    <div className="btn-row">
      <button
        className="btn btn-sm"
        disabled={busy}
        onClick={() => run(`/api/workspace/promises/${promiseId}`, { status: "KEPT" }, { method: "PATCH" })}
      >
        Kept
      </button>
      <button
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={() => run(`/api/workspace/promises/${promiseId}`, { status: "BROKEN" }, { method: "PATCH" })}
      >
        Did not pay
      </button>
    </div>
  );
}

export function VoidPayment({ paymentId }: { paymentId: string }) {
  const { busy, run } = useAction();
  return (
    <button
      className="btn btn-sm btn-ghost"
      disabled={busy}
      onClick={() => run(`/api/workspace/payments/${paymentId}/void`, { reason: "Recorded by mistake" })}
      title="Voids the record but keeps it in history"
    >
      Void
    </button>
  );
}

export function OrderStatusSelect({ orderId, current }: { orderId: string; current: string }) {
  const { busy, run } = useAction();
  return (
    <select
      value={current}
      disabled={busy}
      onChange={(e) => run(`/api/workspace/orders/${orderId}`, { status: e.target.value }, { method: "PATCH" })}
      aria-label="Order status"
      style={{ maxWidth: 190 }}
    >
      {["PENDING", "CONFIRMED", "PROCESSING", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"].map((status) => (
        <option key={status} value={status}>
          {status.replace("_", " ").toLowerCase()}
        </option>
      ))}
    </select>
  );
}
