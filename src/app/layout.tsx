import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/pwa";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "SellFlow";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — know who still owes you`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "SellFlow keeps your orders, manual payments and reseller prices in one place. Built for Nigerian small businesses and supplier-reseller networks.",
  applicationName: APP_NAME,
  manifest: "/manifest.json",
  metadataBase: new URL(APP_URL),
  // Installed-app behaviour on iOS, which ignores most of the manifest.
  appleWebApp: {
    capable: true,
    title: "SellFlow",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icons/icon-192.png",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    other: [{ rel: "mask-icon", url: "/icons/icon.svg", color: "#0f6b4f" }],
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} — know who still owes you`,
    description:
      "Orders, manual payments, payment promises and private reseller prices for Nigerian small businesses.",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0f6b4f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
