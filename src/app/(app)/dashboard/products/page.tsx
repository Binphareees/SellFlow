import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listProducts } from "@/server/workspace";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Empty, SectionCard } from "@/components/ui";
import { ProductForm } from "@/components/workspace-actions";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");

  const [products, workspace] = await Promise.all([
    listProducts(ctx.workspaceId),
    prisma.businessWorkspace.findUnique({ where: { id: ctx.workspaceId }, select: { currency: true } }),
  ]);
  const currency = workspace?.currency ?? "NGN";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>Cost price stays private and only feeds your profit figures.</p>
        </div>
      </div>

      <SectionCard title="Add a product">
        <ProductForm />
      </SectionCard>

      <div className="mt-16">
        <SectionCard title="Catalogue">
          {products.length === 0 ? (
            <Empty>No products yet. Add one to speed up order entry.</Empty>
          ) : (
            <div className="list">
              {products.map((product) => (
                <div className="list-item" key={product.id}>
                  <div className="grow">
                    <div className="list-title">{product.name}</div>
                    <div className="list-meta">
                      Cost {formatMoney(product.costPriceKobo, currency)} ·{" "}
                      {product.stockQty} in stock
                      {product.stockQty <= product.lowStockAt ? " · low" : ""}
                    </div>
                  </div>
                  <div className="list-right">
                    <div className="money">{formatMoney(product.sellingPriceKobo, currency)}</div>
                    <div className="tiny paid">
                      +{formatMoney(product.sellingPriceKobo - product.costPriceKobo, currency)} margin
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
