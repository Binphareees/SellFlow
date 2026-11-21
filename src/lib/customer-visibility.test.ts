import { describe, it, expect } from "vitest";
import {
  resolveCustomerDataPolicy,
  projectCustomerOrderForSupplier,
  type SupplierVisibleCustomerOrder,
} from "./customer-visibility";

const order: SupplierVisibleCustomerOrder = {
  id: "co-1",
  workspaceId: "ws-1",
  orderNumber: "CO-001",
  customer: { name: "Buyer Name", phone: "+2348000000000" },
};

describe("S-08 customer visibility policy resolution", () => {
  it("accepts known policies", () => {
    expect(resolveCustomerDataPolicy("NONE")).toBe("NONE");
    expect(resolveCustomerDataPolicy("ORDER_ONLY")).toBe("ORDER_ONLY");
    expect(resolveCustomerDataPolicy("FULL")).toBe("FULL");
  });

  it("defaults to ORDER_ONLY for null/undefined/unknown", () => {
    expect(resolveCustomerDataPolicy(null)).toBe("ORDER_ONLY");
    expect(resolveCustomerDataPolicy(undefined)).toBe("ORDER_ONLY");
    expect(resolveCustomerDataPolicy("")).toBe("ORDER_ONLY");
    expect(resolveCustomerDataPolicy("GARBAGE")).toBe("ORDER_ONLY");
    expect(resolveCustomerDataPolicy("full")).toBe("ORDER_ONLY");
  });
});

describe("S-08 customer visibility projection", () => {
  it("NONE strips the entire customer order (no PII)", () => {
    expect(projectCustomerOrderForSupplier(order, "NONE")).toBeNull();
  });

  it("ORDER_ONLY keeps order metadata but hides customer PII", () => {
    const out = projectCustomerOrderForSupplier(order, "ORDER_ONLY");
    expect(out).not.toBeNull();
    expect(out!.id).toBe("co-1");
    expect(out!.orderNumber).toBe("CO-001");
    expect(out!.customer).toBeNull();
  });

  it("FULL exposes permitted customer details", () => {
    const out = projectCustomerOrderForSupplier(order, "FULL");
    expect(out).not.toBeNull();
    expect(out!.customer).toEqual({ name: "Buyer Name", phone: "+2348000000000" });
  });

  it("handles null customer order safely", () => {
    expect(projectCustomerOrderForSupplier(null, "FULL")).toBeNull();
    expect(projectCustomerOrderForSupplier(null, "NONE")).toBeNull();
  });

  it("unknown/malformed policy downgrades to ORDER_ONLY (no leak)", () => {
    const out = projectCustomerOrderForSupplier(order, "NOT_A_POLICY");
    expect(out).not.toBeNull();
    expect(out!.customer).toBeNull();
  });

  it("does not mutate the input order", () => {
    const before = JSON.stringify(order);
    projectCustomerOrderForSupplier(order, "ORDER_ONLY");
    expect(JSON.stringify(order)).toBe(before);
  });
});
