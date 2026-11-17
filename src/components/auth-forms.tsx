"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(next && next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button className="btn btn-primary btn-block" disabled={busy} type="submit">
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <p className="tiny muted" style={{ textAlign: "center" }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: "",
    businessName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const result = await apiFetch<{ ok: true }>("/api/auth/register", {
      method: "POST",
      body: { ...form, country: "NG" },
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setFieldErrors(result.details ?? {});
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label htmlFor="displayName">Your name</label>
        <input id="displayName" value={form.displayName} onChange={(e) => update("displayName", e.target.value)} required />
        {fieldErrors.displayName ? <span className="error-text">{fieldErrors.displayName}</span> : null}
      </div>

      <div className="field">
        <label htmlFor="businessName">Business name</label>
        <input
          id="businessName"
          value={form.businessName}
          onChange={(e) => update("businessName", e.target.value)}
          placeholder="e.g. Amaka Beauty Store"
          required
        />
        {fieldErrors.businessName ? <span className="error-text">{fieldErrors.businessName}</span> : null}
        <span className="hint">Used on reminders and receipts. You can change it later.</span>
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          required
        />
        {fieldErrors.email ? <span className="error-text">{fieldErrors.email}</span> : null}
      </div>

      <div className="field">
        <label htmlFor="phone">WhatsApp number</label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          placeholder="0803 123 4567"
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
        />
        {fieldErrors.phone ? <span className="error-text">{fieldErrors.phone}</span> : null}
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          required
        />
        {fieldErrors.password ? (
          <span className="error-text">{fieldErrors.password}</span>
        ) : (
          <span className="hint">At least 8 characters.</span>
        )}
      </div>

      <button className="btn btn-primary btn-block" disabled={busy} type="submit">
        {busy ? "Creating…" : "Create account"}
      </button>

      <p className="tiny muted" style={{ textAlign: "center" }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
