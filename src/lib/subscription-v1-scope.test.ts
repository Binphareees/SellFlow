import { describe, it, expect } from "vitest";
import { subscriptionBillingEnabled, planUnlocks, limitFor, UNLIMITED } from "./plans";
import { POST as upgrade } from "@/app/api/billing/upgrade/route";
import { POST as cancel } from "@/app/api/billing/cancel/route";
import { POST as decide } from "@/app/api/billing/payments/[id]/decision/route";

describe("C-03 V1 scope isolation", () => {
  it("subscription billing is disabled by default", () => {
    expect(subscriptionBillingEnabled()).toBe(false);
  });

  it("plan caps are unlimited when billing is disabled", () => {
    expect(limitFor("FREE", "customers")).toBe(UNLIMITED);
    expect(limitFor("FREE", "activeOrders")).toBe(UNLIMITED);
    expect(limitFor("FREE", "products")).toBe(UNLIMITED);
    expect(limitFor("FREE", "suppliers")).toBe(UNLIMITED);
  });

  it("plan features are unlocked when billing is disabled", () => {
    expect(planUnlocks("FREE", "multi_supplier")).toBe(true);
    expect(planUnlocks("FREE", "payment_plans")).toBe(true);
    expect(planUnlocks("FREE", "agreement_versioning")).toBe(true);
  });

  it("mutating billing routes reject when disabled", async () => {
    const req = (body: unknown) =>
      new Request("http://localhost/api/billing/x", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });

    const r1 = await upgrade(req({ tier: "PRO", method: "transfer" }), {} as any);
    expect(r1.status).toBe(404);

    const r2 = await cancel(req({}), {} as any);
    expect(r2.status).toBe(404);

    const r3 = await decide(req({ action: "CONFIRM" }), { params: { id: "x" } } as any);
    expect(r3.status).toBe(404);
  });
});
