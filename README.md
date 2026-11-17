# SellFlow

A business-management and supplier-to-reseller commerce platform for businesses of all kinds and sizes, starting with Nigeria.

**Core promise:** know who still owes you, and remind them in one tap.

> **Project status (2026-11-04):** PRD v0.2 — Approved · **Implementation — AUTHORIZED 2026-11-04** (owner Implementation GO, `STATE.md` D-019) · **Phase 0 validation — still incomplete** · Validation GO — Not granted.
>
> Development resumed on 2026-11-04, when the owner chose to proceed without waiting for the Phase 0 gate. **That authorization is not validation approval.** No interviews, dated commitments or concierge results have been recorded, so demand is still unproven, and the audit findings S-01 to S-15 remain open and tracked. See `STATE.md` (D-019), `PHASE0_READINESS_REPORT.md` (§11), and `VALIDATION_PLAN.md` for what a validation GO still requires. `MVP_SPEC.md`, `TECH_STACK.md`, and parts of `ROADMAP.md` are historical documents superseded by the server implementation.

SellFlow is two products on one account:

1. **A business workspace** — customers, products, orders, manual payments, payment promises and profit (cost price vs selling price).
2. **A marketplace** — suppliers publish listings at retail price, approved resellers see a **private** price per offer, and orders flow through a versioned agreement with stock confirmation, dispatch and delivery.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router, TypeScript), React 19 | One codebase for server-rendered pages and the JSON API |
| Database | Prisma 6 + SQLite (local) | Zero setup for a bootcamp; the schema is portable to Postgres |
| Auth | First-party sessions (bcrypt + hashed session tokens in an httpOnly cookie) | No paid auth service, no keys, full control of roles |
| Styling | Hand-written CSS (`src/app/globals.css`) | No build step, mobile-first, ~10 KB of CSS |

## Quickstart

```bash
npm install
npx prisma migrate dev      # creates prisma/dev.db from prisma/schema.prisma
npm run db:seed             # demo supplier + reseller + listings
npm run dev                 # http://localhost:3000
```

Environment (`.env`, see `.env.example`):

```
DATABASE_URL="file:./dev.db"
SESSION_SECRET="generate-with-openssl-rand-base64-32"
```

Production settings (`NODE_ENV`, `PORT`, `DATABASE_URL`, `SESSION_SECRET`, the public
`NEXT_PUBLIC_*` identity, `MAX_AUTH_ATTEMPTS`, `SESSION_MAX_AGE_DAYS`) are documented in
`.env.production.example`, including how to generate a session secret.

### Docker deployment

```bash
cp .env.production.example .env.production   # at minimum: SESSION_SECRET
docker compose up -d --build                 # app on :3000, SQLite on the sellflow-data volume
./scripts/deploy.sh                          # typecheck → E2E → migrate → build → health-gated swap
```

The image is a multi-stage build (`deps` → `builder` → `migrator` → `runner`, plus a one-off
`pilot` stage) on `node:18-alpine` using Next's standalone output, runs as an unprivileged user,
and stores SQLite at `/app/data/prod.db` on the named volume. Compose health-checks `/api/health`
every 30s.

`npm run test:pwa` builds the production bundle, boots it on a spare port and asserts the PWA
layer: manifest validity and icons, the service worker's cache boundaries, the pre-cached offline
screen, and the manifest/theme-color/apple-touch-icon tags in the rendered layout.

`GET /api/health` is the uptime probe: it reports process uptime, database reachability
(a bounded `SELECT 1`) and the app version, is never cached, and answers **503** when the
database cannot be reached.

### Demo accounts

`npm run db:seed` creates local demo accounts (supplier, approved reseller, mediator and platform admin). Credentials are intentionally not published in this README. Read the local seed file or the seeder output to sign in locally.

**Do not use seeded demo accounts in external demonstrations.** Use separate synthetic demonstration accounts and data. All seeded names, prices and orders are invented.

### Pilot onboarding (real users)

`scripts/seed-pilot.mjs` is the Phase 0 onboarding tool. It creates **real** supplier and reseller
accounts with a 3–5 item catalogue, private wholesale prices and pre-approved agreements. It never
loads demo data.

```bash
npm run pilot:seed                                  # interactive; type "create" to write
npm run pilot:seed -- --config ./pilot-pair.json --dry-run
npm run pilot:seed -- --config ./pilot-pair.json --yes
```

It aborts if either email already exists, writes the whole pair in one transaction, hashes
passwords through `src/lib/auth/password.ts` (bcrypt cost 12), and converts Naira input to integer
kobo through `src/lib/money.ts`. Passwords can come from the config file, from
`PILOT_SUPPLIER_PASSWORD` / `PILOT_RESELLER_PASSWORD`, or from a hidden interactive prompt; they are
never printed. Record the printed IDs and pilot activity in `PILOT_TRACKER.md`.

#### Running onboarding against the live pilot deployment

The seeder writes to whatever `DATABASE_URL` points at. Always run `--dry-run` first and take a
backup of the SQLite file before a real write. For the Docker stack, the `pilot` profile mounts the
same `sellflow-data` volume as the app:

```bash
source .env.production                         # supplies SESSION_SECRET and public identity
docker compose --profile pilot build pilot
docker compose --profile pilot run --rm pilot  # interactive
docker compose --profile pilot run --rm \
  -v "$PWD/pilot-pair.json:/app/pilot-pair.json:ro" pilot \
  --config /app/pilot-pair.json --dry-run
```

Remove `--dry-run` and add `--yes` for the write. Do not run the app and a large onboarding write at
the same moment on SQLite; the transaction is short, but the store is single-writer.

## Project layout

```
prisma/
  schema.prisma          # 33 models: identity, access, workspace, marketplace, network, fulfilment, disputes, billing, audit
  seed.ts                # demo supplier, reseller, listings, offers, agreement
src/
  app/
    (app)/               # authenticated pages: dashboard, orders, customers, products, supplier, reseller, disputes, billing
    marketplace/         # PUBLIC discovery pages (own shell for guests)
    api/                 # JSON API (57 route handlers)
  components/            # mobile UI + client forms
  lib/
    auth/                # session, password, rbac
    api.ts               # error envelope, zod body parsing, route wrapper
    money.ts             # integer money, WhatsApp reminder copy
    validation.ts        # every request body
  server/                # the rules live here
    price-access.ts      # the ONLY place reseller prices are read
    workspace.ts         # customers, products, orders, payments, promises, dashboard
    supplier.ts          # listings, offers, applications, agreements, supplier orders
    disputes.ts          # disputes, events, mediation
    accounts.ts          # registration, login, verification tiers
public/
  manifest.json          # installable PWA: icons, theme colour, shortcuts
  sw.js                  # service worker: static caching + offline fallback
  offline.html           # self-contained offline screen (no app runtime)
  icons/                 # generated PNGs + SVG mark
scripts/
  seed-pilot.mjs         # Phase 0 onboarding: real supplier + catalogue + reseller + agreements
  verify-api.mjs         # end-to-end checks against a running server
  generate-icons.mjs     # regenerates the PNG icons with no image deps
```

## Rules the code enforces

These are enforced on the server, not hidden in the UI.

**Single account, one workspace.** Registration creates `User → Profile → BUSINESS_OWNER role → BusinessWorkspace` in one transaction. There is no account without a workspace.

**Additive marketplace roles.** `ProfileRole` rows add `RESELLER`, `SUPPLIER` or `MEDIATOR` to the same account. Reseller access is self-service; the supplier role is activated by creating a supplier profile; mediator is platform-only.

**Private reseller pricing.**
- Public listing queries use an explicit select that has no access to price columns (`publicListingSelect`).
- `resolveResellerPrice()` is the only reader of `ResellerOfferVersion` / `ResellerAgreementVersion` prices, and it requires: a session → the `RESELLER` role → an `APPROVED` application **for that exact supplier** → an `ACTIVE` agreement on that offer → an active offer.
- Denials are audited (`marketplace.price_access_denied`) and return a reason code, never a price.
- The supplier who owns the listing and platform moderators may read it; moderator reads are logged.
- Verified from outside: a guest's rendered listing HTML contains no trace of the private price.

**Versioned terms.** Editing an offer appends `ResellerOfferVersion`. Approving a reseller creates `ResellerAgreement` + version 1 as `PENDING_ACCEPTANCE`; the price stays locked until the reseller accepts. Supplier order items snapshot `agreementVersionId` and `unitPriceKobo`, so later changes never rewrite history.

**Money is manual.** No gateway, wallet, escrow, transfer or bank verification anywhere. `ManualPayment` is a record of what the seller says they received; balances and profit are recomputed on the server. Overpayment is rejected.

**Party-recorded claims.** `PaymentStatusClaim` (`SENT` by reseller / `RECEIVED` by supplier) must be confirmed by the *other* party. A claimant cannot confirm their own claim. Disputing a claim sets the order to `DISPUTED`.

**One step per party.** Only the supplier confirms stock, dispatches and records terms. Only the reseller confirms delivery received. Violations return 403, not a silent no-op.

**Audit trail.** Every security-relevant action appends to `AuditLog` (registration, logins, price grants/denials, role and tier changes, status transitions, claims, disputes). `DisputeEvent` is a separate append-only mediation trail.

## API map

All responses are `private, no-store`. Errors use `{ error, code, details }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Profile | `POST /api/profile/roles` |
| Workspace | `GET/POST /api/workspace/customers`, `PATCH/DELETE /api/workspace/customers/[id]`, `GET/POST /api/workspace/products`, `PATCH /api/workspace/products/[id]`, `GET/POST /api/workspace/orders`, `GET/PATCH /api/workspace/orders/[id]`, `POST .../payments`, `POST .../promises`, `POST /api/workspace/payments/[id]/void`, `PATCH /api/workspace/promises/[id]`, `GET /api/workspace/dashboard` |
| Marketplace | `GET /api/marketplace/listings` (`q`, `category`, `supplierId`, `minPriceKobo`, `maxPriceKobo`, `stock`, `sort`, `limit`, `offset`), `GET /api/marketplace/listings/[slug]`, `GET /api/marketplace/suppliers`, `GET /api/marketplace/suppliers/[id]`, `GET /api/marketplace/offers/[offerId]/price`, `GET/POST /api/marketplace/applications` |
| Supplier | `POST /api/supplier/profile`, `GET/POST /api/supplier/listings`, `POST /api/supplier/offers/[id]/versions`, `PATCH /api/supplier/offers/[id]`, `POST /api/supplier/applications/[id]`, `GET/POST /api/supplier/orders`, `GET/PATCH /api/supplier/orders/[id]`, `POST .../stock`, `POST .../claims`, `POST .../claims/[claimId]`, `POST .../dispatch`, `POST .../delivery`, `POST /api/supplier/agreements/[id]/versions`, `GET /api/supplier/dashboard` |
| Reseller | `GET /api/reseller/overview`, `POST /api/reseller/agreements/[id]/accept` |
| Negotiation | `POST /api/agreements/[id]/proposals`, `POST /api/agreements/[id]/proposals/[proposalId]/accept` |
| Disputes | `GET/POST /api/disputes` (`?status=`, `?scope=`), `GET /api/disputes/[id]`, `POST /api/disputes/[id]/events`, `POST /api/disputes/[id]/status`, `POST /api/disputes/[id]/resolve` |
| Admin | `PATCH /api/admin/profiles/[id]/verification` |

## Disputes

A dispute is a written record, not a refund. It attaches to a supplier order and optionally to a
specific payment claim, so a mediator's decision can settle that claim's record.

- Anyone can raise one **only** on an order they are a party to (`/disputes/new`, pre-linked from the
  supplier order screen and from each payment claim row).
- Both parties and mediators can add messages and evidence notes. The trail is append-only.
- Mediators `POST /api/disputes/[id]/status` to take a case up for review or close it without an
  outcome, and `POST /api/disputes/[id]/resolve` to record an outcome plus reasoning. A party can never
  resolve their own dispute — the API returns 403, and that is covered by the test suite.
- Every action is written to `DisputeEvent` and `AuditLog`.

## Marketplace discovery

`/marketplace` is a mobile-first search surface: an instant-search field (debounced, server-rendered
results), category chips, and a bottom-sheet filter drawer with retail price bands, stock state and
ordering. Every filter maps to a public column only.

| Filter | Values | Notes |
|---|---|---|
| `q` | free text | title, description, category and supplier name |
| `category` | exact category | also drives the chips |
| `supplierId` | supplier id | used by the storefront catalogue |
| `minPriceKobo` / `maxPriceKobo` | integer kobo | **retail** price only |
| `stock` | `all` \| `in` \| `out` | based on `stockQty` |
| `sort` | `newest` \| `popular` \| `price_asc` \| `price_desc` | see below |

**"Most ordered" is real demand**, not a fake score: it counts supplier order lines that reference a
listing (`SupplierOrderItem.listingId`). It cannot be influenced by a reseller price because that
column is never selected.

Merchants also get `/marketplace/suppliers` (directory with catalogue counts and verification badges)
and `/marketplace/suppliers/[id]` (storefront: about, location, categories, catalogue, and a single
"Apply for reseller agreement" action scoped to that supplier).

**Quick view and comparison keep the privacy rule.** Cards carry retail price, MOQ and stock only. When
a reseller opens quick view or compares listings, the browser calls the existing
`/api/marketplace/offers/[offerId]/price` endpoint per offer; that endpoint still decides access, still
audits denials, and still refuses guests, non-resellers, unapproved resellers and missing agreements.
Comparison shows "Locked" for anything the server declined — the number never reaches the page.

## Mobile behaviour

Every interactive control is at least 48px tall on phones (buttons, chips, bottom-nav items, list
rows), because these screens are used one-handed while a customer waits. Each screen has one sticky
action bar above the bottom nav: **Remind on WhatsApp** plus **Record payment** on an order, and
**Save order** with the running total while creating one. The reminder opens WhatsApp with the
business name, customer name and balance already written.

## Installable PWA

`public/manifest.json` makes SellFlow installable (standalone, portrait, brand green `#0f6b4f`,
shortcuts for New order / Orders / Disputes). `public/sw.js` keeps the app usable on a weak
connection, and it is deliberately conservative because the screen shows private money data:

| Request | Behaviour |
|---|---|
| HTML navigation | Network first, **never cached**. Offline shows `offline.html` with the route and a retry button. |
| `/api/*` | Never intercepted — a stale balance can never be shown as current. |
| `/_next/static/*`, `/icons/*`, `/manifest.json` | Stale-while-revalidate. |

The worker registers **only in production builds**: a service worker fighting hot reload produces
stale-chunk bugs that look like app bugs. Test it with `npm run build && npm start`.

The offline screen is a single self-contained file, so it renders with no app runtime and no cached
session data. Icons are generated (no image dependencies) with `npm run icons`.

## Verification

```bash
npm run typecheck
npm run build
npm run verify            # BASE_URL defaults to http://127.0.0.1:4317
```

`scripts/verify-api.mjs` is the end-to-end suite. Its source contains **450 `check(` call-sites**; that
is a count of call-sites, not of passing assertions. The isolated harness (`npm run test:e2e:clean`)
builds a disposable database and reports one result per executed check. Re-run on 2026-11-17:
**481 PASS, 2 FAIL, 1 SKIP** over 484 executed checks, after which the PWA assertions passed; the
harness exit code was 1 because of the two failures. Both are pre-existing and unrelated to the
baseline work: `outcome is stored` asserts `dispute.outcome` on the response of
`POST /api/disputes/:id/resolve`, which returns only `{ id, status }` while persisting the outcome
correctly, and `the health probe reports a healthy audit store` reads a process-global audit-failure
counter that an earlier fault-injection path had already incremented. Counts in dated reports (135
checks at the 2026-11-04 audit; 500 PASS / 0 FAIL at the 2026-11-06 S-14 acceptance) describe those
runs and are left unchanged. The suite mutates the demo data, so run it only against a disposable
database. It covers: guest and
non-reseller price denial (and that the price string is absent from the response), order totals
ignoring client-supplied prices, overpayment rejection, agreement version locking, the full
supplier-order lifecycle with the wrong-party 403s, and the dispute workflow — non-party rejection,
claim linking, mediator review, outcome logging and claim settlement. It mutates the demo data; run
`npm run db:reset` afterwards for a clean dataset.

## Data model

33 models in `prisma/schema.prisma`. Money is always an integer in kobo — never a float. Enum-like columns are strings validated at the API boundary (`src/lib/enums.ts`), because SQLite has no native enums; they map 1:1 to Postgres enums later.

Key relationships: `BusinessWorkspace → Customer/Product/CustomerOrder → OrderItem/ManualPayment/PaymentPlan/PaymentPromise`; `SupplierProfile → ProductListing → ResellerOffer → ResellerOfferVersion`; `ResellerApplication → ResellerAgreement → ResellerAgreementVersion`; `SupplierOrder → SupplierOrderItem/PaymentStatusClaim/DispatchRecord/DeliveryConfirmation/Dispute`.

## Not in V1

Payment gateways, wallets, escrow, in-app transfers, automatic bank verification, AI features, and a bulk-buyer role. Payments and bookkeeping are manual records by design.

**Out-of-scope implementation present in the codebase:** subscription billing and paid-plan enforcement (`Subscription`, `SubscriptionPayment`, `/api/billing/*`, billing UI). They are not part of the approved V1 boundary and must not be presented as authorized V1 behavior. See `SELLFLOW_V02_AUDIT_REPORT.md`.

The server database is centralized, so older “cloud sync between devices” wording is historical: accounts can sign in from multiple devices, but real-time sync and conflict handling are not a V1 feature.

## Docs

`STATE.md` (current status + decisions), `PRD_V0.2.md` (canonical requirements register; source gaps marked), `VALIDATION_PLAN.md` (Phase 0 plan and gates), `PHASE0_READINESS_REPORT.md` (readiness and open questions), `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` (blank Phase 0 records), `MONETIZATION_AND_LAUNCH.md`, `AI_HANDOFF.md`.

**Historical / superseded:** `MVP_SPEC.md` (local-first MVP), `TECH_STACK.md` (Vite + IndexedDB plan), and the Phase 1 section of `ROADMAP.md`. They are retained for history and must not be used as current build instructions. `templates/` contains the field discovery scripts and blank trackers.
