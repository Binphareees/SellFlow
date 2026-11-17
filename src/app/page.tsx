import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";

export default async function LandingPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect("/dashboard");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <span className="brand-mark" aria-hidden>
              S
            </span>
            SellFlow
          </span>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn btn-sm" href="/login">
              Sign in
            </Link>
            <Link className="btn btn-sm btn-primary" href="/register">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main className="page" style={{ paddingBottom: 48 }}>
        <section className="hero">
          <span className="badge badge-accent">Built for WhatsApp sellers</span>
          <h1 style={{ marginTop: 14 }}>
            Know who still owes you.
            <br />
            Remind them in one tap.
          </h1>
          <p>
            SellFlow keeps your orders, deposits and balances in one list instead of five chats and a
            notebook. Add manual payments as they come, track promises to pay, and see your real profit per
            order — cost price against selling price.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/register">
              Start free
            </Link>
            <Link className="btn" href="/marketplace">
              Browse the marketplace
            </Link>
          </div>
        </section>

        <section className="hero-grid">
          <div className="card">
            <div className="card-title">Manual money, honestly recorded</div>
            <p className="tiny muted mt-12">
              No payment gateway, no wallet, no escrow. You record what you received — cash, transfer, POS —
              exactly as it happened.
            </p>
          </div>
          <div className="card">
            <div className="card-title">Private reseller pricing</div>
            <p className="tiny muted mt-12">
              Suppliers publish a retail price. Reseller prices only unlock for resellers they approved, per
              offer, through a versioned agreement.
            </p>
          </div>
          <div className="card">
            <div className="card-title">Orders that stay linked</div>
            <p className="tiny muted mt-12">
              A customer order and its supplier order stay connected, so stock confirmation, dispatch and
              payment claims are in one place.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
