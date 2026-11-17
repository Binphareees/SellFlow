import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listCustomers, listProducts } from "@/server/workspace";
import { OrderForm } from "@/components/workspace-actions";
import { BackLink } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");

  const [customers, products] = await Promise.all([
    listCustomers(ctx.workspaceId),
    listProducts(ctx.workspaceId),
  ]);

  return (
    <>
      <BackLink href="/dashboard/orders">Orders</BackLink>
      <div className="page-head">
        <div>
          <h1>New order</h1>
          <p>Record it now, before the chat scrolls away.</p>
        </div>
      </div>

      <OrderForm
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          sellingPriceKobo: p.sellingPriceKobo,
          costPriceKobo: p.costPriceKobo,
          stockQty: p.stockQty,
        }))}
      />
    </>
  );
}
