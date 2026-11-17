"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { apiFetch } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { VERIFICATION_LABEL } from "@/lib/enums";

export type DiscoveryFilters = {
  q: string;
  category: string;
  minPriceKobo?: number;
  maxPriceKobo?: number;
  stock: "all" | "in" | "out";
  sort: "newest" | "popular" | "price_asc" | "price_desc";
};

export type DiscoveryListing = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  publicPriceKobo: number;
  currency: string;
  moq: number;
  stockQty: number;
  images: string[];
  supplier: { id: string; businessName: string; city: string | null; tier: number };
  offerId: string | null;
};

const PRICE_BANDS = [
  { key: "", label: "Any price" },
  { key: "0-1000000", label: "Under ₦10k" },
  { key: "1000000-2500000", label: "₦10k – ₦25k" },
  { key: "2500000-5000000", label: "₦25k – ₦50k" },
  { key: "5000000-", label: "₦50k and up" },
] as const;

const SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "popular", label: "Most ordered" },
  { key: "price_asc", label: "Price: low to high" },
  { key: "price_desc", label: "Price: high to low" },
] as const;

const STOCK_OPTIONS = [
  { key: "all", label: "Any stock" },
  { key: "in", label: "In stock" },
  { key: "out", label: "Sold out" },
] as const;

type PriceState =
  | { status: "loading" }
  | { status: "locked"; message: string }
  | {
      status: "allowed";
      priceKobo: number;
      moq: number;
      minResaleKobo: number | null;
      source: string;
      deliveryResponsibility: string;
    };

function bandToParams(band: string): { minPriceKobo?: number; maxPriceKobo?: number } {
  if (!band) return {};
  const [min, max] = band.split("-");
  return {
    ...(min ? { minPriceKobo: Number(min) } : {}),
    ...(max ? { maxPriceKobo: Number(max) } : {}),
  };
}

function paramsToBand(filters: DiscoveryFilters): string {
  if (filters.minPriceKobo === undefined && filters.maxPriceKobo === undefined) return "";
  return `${filters.minPriceKobo ?? ""}-${filters.maxPriceKobo ?? ""}`;
}

export function MarketplaceDiscovery({
  listings,
  total,
  categories,
  filters,
  signedIn,
}: {
  listings: DiscoveryListing[];
  total: number;
  categories: string[];
  filters: DiscoveryFilters;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [band, setBand] = useState(paramsToBand(filters));
  const [stock, setStock] = useState(filters.stock);
  const [sort, setSort] = useState(filters.sort);

  const [quickView, setQuickView] = useState<DiscoveryListing | null>(null);
  const [prices, setPrices] = useState<Record<string, PriceState>>({});
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const firstRender = useRef(true);

  function hrefWith(patch: Partial<DiscoveryFilters>): string {
    const merged = { ...filters, q: query, ...patch };
    const sp = new URLSearchParams();
    if (merged.q) sp.set("q", merged.q);
    if (merged.category) sp.set("category", merged.category);
    if (merged.minPriceKobo !== undefined) sp.set("minPriceKobo", String(merged.minPriceKobo));
    if (merged.maxPriceKobo !== undefined) sp.set("maxPriceKobo", String(merged.maxPriceKobo));
    if (merged.stock && merged.stock !== "all") sp.set("stock", merged.stock);
    if (merged.sort && merged.sort !== "newest") sp.set("sort", merged.sort);
    const qs = sp.toString();
    return `/marketplace${qs ? `?${qs}` : ""}`;
  }

  // Instant search: the list re-renders on the server as you type.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (query === filters.q) return;
    const timer = setTimeout(() => {
      startTransition(() => router.replace(hrefWith({ q: query }), { scroll: false }));
    }, 320);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function loadPrice(offerId: string) {
    const cached = prices[offerId];
    if (cached && cached.status !== "locked") return;
    setPrices((prev) => ({ ...prev, [offerId]: { status: "loading" } }));
    const result = await apiFetch<{
      terms: {
        priceKobo: number;
        moq: number;
        minResaleKobo: number | null;
        deliveryResponsibility: string;
      };
      source: string;
    }>(`/api/marketplace/offers/${offerId}/price`);

    setPrices((prev) => ({
      ...prev,
      [offerId]: result.ok
        ? {
            status: "allowed",
            priceKobo: result.data.terms.priceKobo,
            moq: result.data.terms.moq,
            minResaleKobo: result.data.terms.minResaleKobo,
            source: result.data.source,
            deliveryResponsibility: result.data.terms.deliveryResponsibility,
          }
        : { status: "locked", message: result.error },
    }));
  }

  function openQuickView(listing: DiscoveryListing) {
    setQuickView(listing);
    if (listing.offerId) void loadPrice(listing.offerId);
  }

  function toggleCompare(listing: DiscoveryListing) {
    setCompare((prev) =>
      prev.includes(listing.id)
        ? prev.filter((id) => id !== listing.id)
        : prev.length >= 3
          ? prev
          : [...prev, listing.id],
    );
  }

  const compared = useMemo(
    () => compare.map((id) => listings.find((listing) => listing.id === id)).filter(Boolean) as DiscoveryListing[],
    [compare, listings],
  );

  function openCompare() {
    setCompareOpen(true);
    for (const listing of compared) {
      if (listing.offerId) void loadPrice(listing.offerId);
    }
  }

  const activeFilterCount =
    (filters.category ? 1 : 0) +
    (filters.minPriceKobo !== undefined || filters.maxPriceKobo !== undefined ? 1 : 0) +
    (filters.stock !== "all" ? 1 : 0) +
    (filters.sort !== "newest" ? 1 : 0);

  function applyDrawer() {
    setDrawerOpen(false);
    startTransition(() =>
      router.replace(hrefWith({ ...bandToParams(band), stock, sort }), { scroll: false }),
    );
  }

  function resetDrawer() {
    setBand("");
    setStock("all");
    setSort("newest");
    setDrawerOpen(false);
    startTransition(() =>
      router.replace(hrefWith({ minPriceKobo: undefined, maxPriceKobo: undefined, stock: "all", sort: "newest" }), {
        scroll: false,
      }),
    );
  }

  return (
    <>
      <div className="discovery-bar">
        <div className="search-row">
          <input
            aria-label="Search listings and suppliers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search wigs, oils, suppliers…"
            type="search"
          />
          {query ? (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setQuery("");
                startTransition(() => router.replace(hrefWith({ q: "" }), { scroll: false }));
              }}
            >
              Clear
            </button>
          ) : null}
          <button
            className={`btn btn-sm ${activeFilterCount > 0 ? "btn-primary" : ""}`}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          >
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
          </button>
        </div>

        {categories.length > 0 ? (
          <div className="chips" role="tablist" aria-label="Categories">
            <Link className="chip" href={hrefWith({ category: "" })} data-active={!filters.category}>
              All
            </Link>
            {categories.map((category) => (
              <Link
                className="chip"
                key={category}
                href={hrefWith({ category })}
                data-active={filters.category === category}
                role="tab"
                aria-selected={filters.category === category}
              >
                {category}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="result-line">
          <span className="tiny muted">
            {pending ? "Searching…" : `${total} listing${total === 1 ? "" : "s"}`}
            {filters.q ? ` for “${filters.q}”` : ""}
          </span>
          <select
            aria-label="Sort listings"
            className="sort-select"
            value={filters.sort}
            onChange={(event) => {
              const next = event.target.value as DiscoveryFilters["sort"];
              setSort(next);
              startTransition(() => router.replace(hrefWith({ sort: next }), { scroll: false }));
            }}
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {listings.length === 0 ? (
        <div className="empty">
          Nothing matches yet.{" "}
          <Link href="/marketplace">Clear filters</Link> or try a different word.
        </div>
      ) : (
        <div className="listing-grid" data-pending={pending}>
          {listings.map((listing) => {
            const selected = compare.includes(listing.id);
            return (
              <div className={`card listing-card ${selected ? "is-selected" : ""}`} key={listing.id}>
                <Link className="listing-thumb" href={`/marketplace/${listing.slug}`}>
                  {listing.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={listing.images[0]} alt="" />
                  ) : (
                    <span>{listing.category ?? "Product"}</span>
                  )}
                </Link>

                <div>
                  <Link className="list-title" href={`/marketplace/${listing.slug}`}>
                    {listing.title}
                  </Link>
                  <div className="list-meta">
                    <Link href={`/marketplace/suppliers/${listing.supplier.id}`}>
                      {listing.supplier.businessName}
                    </Link>
                    {listing.supplier.city ? ` · ${listing.supplier.city}` : ""}
                  </div>
                </div>

                <div className="row-between">
                  <div>
                    <div className="money">{formatMoney(listing.publicPriceKobo, listing.currency)}</div>
                    <div className="tiny muted">Retail · MOQ {listing.moq}</div>
                  </div>
                  <span className={`badge ${listing.stockQty > 0 ? "badge-good" : "badge-warn"}`}>
                    {listing.stockQty > 0 ? `${listing.stockQty} in stock` : "Sold out"}
                  </span>
                </div>

                <div className="btn-row">
                  <button className="btn btn-sm" type="button" onClick={() => openQuickView(listing)}>
                    Quick view
                  </button>
                  <button
                    className={`btn btn-sm ${selected ? "btn-primary" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCompare(listing)}
                    disabled={!selected && compare.length >= 3}
                    title={!selected && compare.length >= 3 ? "Compare up to 3 listings" : undefined}
                  >
                    {selected ? "Added" : "Compare"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {compare.length > 0 ? (
        <div className="compare-bar" role="region" aria-label="Comparison">
          <span className="tiny">{compare.length} selected</span>
          <div className="btn-row">
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setCompare([])}>
              Clear
            </button>
            <button className="btn btn-sm btn-primary" type="button" onClick={openCompare}>
              Compare
            </button>
          </div>
        </div>
      ) : null}

      {drawerOpen ? (
        <div className="sheet-backdrop" onClick={() => setDrawerOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-head">
              <strong>Filters</strong>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setDrawerOpen(false)}>
                Close
              </button>
            </div>

            <div className="sheet-body">
              <div className="field">
                <label>Retail price</label>
                <div className="chips wrap-chips">
                  {PRICE_BANDS.map((option) => (
                    <button
                      key={option.key || "any"}
                      className="chip"
                      type="button"
                      data-active={band === option.key}
                      onClick={() => setBand(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Stock</label>
                <div className="chips wrap-chips">
                  {STOCK_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className="chip"
                      type="button"
                      data-active={stock === option.key}
                      onClick={() => setStock(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label htmlFor="sort-sheet">Order by</label>
                <select id="sort-sheet" value={sort} onChange={(event) => setSort(event.target.value as DiscoveryFilters["sort"])}>
                  {SORTS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sheet-actions">
              <button className="btn btn-ghost" type="button" onClick={resetDrawer}>
                Reset
              </button>
              <button className="btn btn-primary" type="button" onClick={applyDrawer}>
                Show results
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quickView ? (
        <div className="sheet-backdrop" onClick={() => setQuickView(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${quickView.title} quick view`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-head">
              <strong>{quickView.title}</strong>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setQuickView(null)}>
                Close
              </button>
            </div>

            <div className="sheet-body">
              <p className="tiny muted">
                <Link href={`/marketplace/suppliers/${quickView.supplier.id}`}>
                  {quickView.supplier.businessName}
                </Link>
                {quickView.supplier.tier > 0 ? ` · ${VERIFICATION_LABEL[quickView.supplier.tier]}` : ""}
                {quickView.category ? ` · ${quickView.category}` : ""}
              </p>

              <div className="quick-facts">
                <div>
                  <div className="tiny muted">Retail price</div>
                  <div className="money">{formatMoney(quickView.publicPriceKobo, quickView.currency)}</div>
                </div>
                <div>
                  <div className="tiny muted">Minimum order</div>
                  <div className="money">{quickView.moq}</div>
                </div>
                <div>
                  <div className="tiny muted">Stock</div>
                  <div className="money">{quickView.stockQty}</div>
                </div>
              </div>

              <div className="mt-16">
                {!quickView.offerId ? (
                  <div className="price-locked">This supplier has no reseller offer on this listing.</div>
                ) : !signedIn ? (
                  <div className="price-locked">
                    <span aria-hidden>🔒</span>
                    <span>Sign in as an approved reseller to see your price.</span>
                  </div>
                ) : (
                  <QuickPrice
                    state={prices[quickView.offerId]}
                    currency={quickView.currency}
                  />
                )}
              </div>
            </div>

            <div className="sheet-actions">
              <Link className="btn btn-primary" href={`/marketplace/${quickView.slug}`}>
                Open listing
              </Link>
              <Link className="btn" href={`/marketplace/suppliers/${quickView.supplier.id}`}>
                Supplier
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {compareOpen && compared.length > 0 ? (
        <div className="sheet-backdrop" onClick={() => setCompareOpen(false)}>
          <div
            className="sheet sheet-wide"
            role="dialog"
            aria-modal="true"
            aria-label="Compare listings"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-head">
              <strong>Compare</strong>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setCompareOpen(false)}>
                Close
              </button>
            </div>

            <div className="sheet-body">
              <div className="compare-scroll">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th scope="col">Listing</th>
                      {compared.map((listing) => (
                        <th scope="col" key={listing.id}>
                          <Link href={`/marketplace/${listing.slug}`}>{listing.title}</Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Supplier</th>
                      {compared.map((listing) => (
                        <td key={listing.id}>
                          <Link href={`/marketplace/suppliers/${listing.supplier.id}`}>
                            {listing.supplier.businessName}
                          </Link>
                          {listing.supplier.tier > 0 ? (
                            <div className="tiny muted">{VERIFICATION_LABEL[listing.supplier.tier]}</div>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Retail</th>
                      {compared.map((listing) => (
                        <td className="money" key={listing.id}>
                          {formatMoney(listing.publicPriceKobo, listing.currency)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Your price</th>
                      {compared.map((listing) => {
                        const state = listing.offerId ? prices[listing.offerId] : undefined;
                        return (
                          <td key={listing.id}>
                            {!listing.offerId ? (
                              <span className="tiny muted">No offer</span>
                            ) : !state || state.status === "loading" ? (
                              <span className="tiny muted">…</span>
                            ) : state.status === "allowed" ? (
                              <span className="money paid">
                                {formatMoney(state.priceKobo, listing.currency)}
                              </span>
                            ) : (
                              <span className="tiny muted">Locked</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <th scope="row">MOQ</th>
                      {compared.map((listing) => (
                        <td key={listing.id}>{listing.moq}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Stock</th>
                      {compared.map((listing) => (
                        <td key={listing.id}>
                          {listing.stockQty > 0 ? listing.stockQty : <span className="tiny muted">Sold out</span>}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Category</th>
                      {compared.map((listing) => (
                        <td key={listing.id}>{listing.category ?? "—"}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              {!signedIn ? (
                <p className="tiny muted mt-12">
                  <Link href="/login?next=/marketplace">Sign in</Link> to check reseller prices for these
                  listings.
                </p>
              ) : null}
            </div>

            <div className="sheet-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setCompare([])}>
                Clear selection
              </button>
              <button className="btn" type="button" onClick={() => setCompareOpen(false)}>
                Keep browsing
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One price block, one state union — keeps the private price read in a single place. */
function QuickPrice({ state, currency }: { state?: PriceState; currency: string }) {
  if (!state || state.status === "loading") {
    return <p className="tiny muted">Checking your price…</p>;
  }

  if (state.status === "locked") {
    return (
      <div className="price-locked">
        <span aria-hidden>🔒</span>
        <span>{state.message}</span>
      </div>
    );
  }

  return (
    <div className="quick-price">
      <div className="tiny muted">Your reseller price</div>
      <div className="money-lg paid">{formatMoney(state.priceKobo, currency)}</div>
      <div className="tiny muted">
        MOQ {state.moq}
        {state.minResaleKobo ? ` · resell from ${formatMoney(state.minResaleKobo, currency)}` : ""}
        {state.deliveryResponsibility === "SUPPLIER" ? " · supplier delivers" : " · you deliver"}
      </div>
    </div>
  );
}
