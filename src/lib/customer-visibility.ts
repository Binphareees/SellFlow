import { CUSTOMER_DATA_VISIBILITY, type CustomerDataVisibility } from "@/lib/enums";

/**
 * The linked customer order as a supplier is allowed to see it.
 *
 * `ResellerAgreementVersion.customerDataVisibility` fixes how much of the
 * reseller's end customer a supplier may receive (PRD RE-05). The PRD names the
 * three values but not their field mapping, so the mapping is defined once here
 * and applied by every supplier-facing projection:
 *
 *   NONE       → no linked customer order at all (no order number, no identity)
 *   ORDER_ONLY → order metadata only; the customer object is withheld
 *   FULL       → the stored customer name and phone
 *
 * The reseller owns the customer record, so its own view is never projected.
 */
export type SupplierVisibleCustomerOrder = {
  id: string;
  workspaceId: string;
  orderNumber: string;
  customer: { name: string; phone: string | null } | null;
};

/**
 * Normalizes a stored value. Missing or unrecognized configuration falls back to
 * the schema default (`ORDER_ONLY`), which shares no identity — a bad value can
 * never widen visibility.
 */
export function resolveCustomerDataPolicy(raw: string | null | undefined): CustomerDataVisibility {
  return (CUSTOMER_DATA_VISIBILITY as readonly string[]).includes(raw ?? "")
    ? (raw as CustomerDataVisibility)
    : "ORDER_ONLY";
}

export function projectCustomerOrderForSupplier(
  customerOrder: SupplierVisibleCustomerOrder | null,
  visibility: string | null | undefined,
): SupplierVisibleCustomerOrder | null {
  if (!customerOrder) return null;

  switch (resolveCustomerDataPolicy(visibility)) {
    case "FULL":
      return customerOrder;
    case "ORDER_ONLY":
      return { ...customerOrder, customer: null };
    case "NONE":
    default:
      return null;
  }
}
