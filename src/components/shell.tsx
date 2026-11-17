"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client";

const NAV = [
  { href: "/dashboard", label: "Home", glyph: "◉" },
  { href: "/dashboard/orders", label: "Orders", glyph: "▤" },
  { href: "/marketplace", label: "Market", glyph: "◈" },
  { href: "/supplier", label: "Supply", glyph: "▦" },
  { href: "/reseller", label: "Resell", glyph: "◇" },
  { href: "/disputes", label: "Disputes", glyph: "⚑" },
];

export function AppShell({
  children,
  businessName,
  displayName,
  roles,
}: {
  children: React.ReactNode;
  businessName: string;
  displayName: string;
  roles: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  async function logout() {
    setBusy(true);
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark" aria-hidden>
              S
            </span>
            <span>
              SellFlow
              <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
                {businessName}
              </span>
            </span>
          </Link>

          <nav className="nav-desktop" aria-label="Main">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="row" style={{ gap: 8 }}>
            <Link className="btn btn-sm btn-ghost" href="/settings/billing">
              Plan
            </Link>
            <span className="tiny muted" title={roles.join(", ")}>
              {displayName.split(" ")[0]}
            </span>
            <button className="btn btn-sm" onClick={logout} disabled={busy} type="button">
              {busy ? "…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="page">{children}</main>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
            <span className="glyph" aria-hidden>
              {item.glyph}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
