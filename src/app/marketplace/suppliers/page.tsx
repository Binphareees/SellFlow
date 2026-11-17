import Link from "next/link";
import { listPublicSuppliers } from "@/server/price-access";
import { VERIFICATION_LABEL } from "@/lib/enums";
import { BackLink, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SupplierDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const suppliers = await listPublicSuppliers({ q: q?.slice(0, 80) });

  return (
    <>
      <BackLink href="/marketplace">Marketplace</BackLink>

      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p>Wholesale sellers with a live catalogue on SellFlow.</p>
        </div>
      </div>

      <form className="field" style={{ marginBottom: 16 }} action="/marketplace/suppliers">
        <label htmlFor="supplier-q" className="sr-only">
          Search suppliers
        </label>
        <div className="row">
          <input
            id="supplier-q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name, city or what they sell"
            type="search"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </div>
      </form>

      {suppliers.length === 0 ? (
        <Empty>
          No suppliers match. <Link href="/marketplace/suppliers">See all suppliers</Link>.
        </Empty>
      ) : (
        <div className="listing-grid">
          {suppliers.map((supplier) => (
            <Link
              className="card supplier-card"
              href={`/marketplace/suppliers/${supplier.id}`}
              key={supplier.id}
            >
              <div className="supplier-badge" aria-hidden>
                {supplier.businessName.slice(0, 1).toUpperCase()}
              </div>
              <div className="grow">
                <div className="list-title">{supplier.businessName}</div>
                <div className="list-meta">
                  {[supplier.city, supplier.state].filter(Boolean).join(", ") || "Location not set"}
                </div>
                <div className="list-meta">
                  {supplier.publishedListings} listing{supplier.publishedListings === 1 ? "" : "s"}
                  {supplier.verificationTier > 0
                    ? ` · ${VERIFICATION_LABEL[supplier.verificationTier]}`
                    : " · Not yet verified"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
