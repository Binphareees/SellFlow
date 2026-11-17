"use client";

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** Server error code, e.g. SUBSCRIPTION_LIMIT_REACHED. */
      code?: string;
      /** Field errors, or the limit metadata for subscription blocks. */
      details?: Record<string, string>;
      status: number;
    };

/** Thin fetch wrapper for client components: same-origin, cookies included. */
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const details =
        payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
          ? (payload.details as Record<string, string>)
          : undefined;
      return {
        ok: false,
        status: response.status,
        error: typeof payload.error === "string" ? payload.error : "Something went wrong",
        code: typeof payload.code === "string" ? payload.code : undefined,
        details,
      };
    }

    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: "Network error. Check your connection and try again." };
  }
}

/** Converts a form amount ("12,500.50") to integer kobo. Returns null when invalid. */
export function toKobo(value: string): number | null {
  const cleaned = value.trim().replace(/[₦\s,]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function fromKobo(minor: number): string {
  const major = minor / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}
