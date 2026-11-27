import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SellFlow ships as a mobile-first server-rendered app; no image CDN needed in V1.
  reactStrictMode: true,
  poweredByHeader: false,
  // Ship a self-contained server bundle for the Docker runner stage: .next/standalone
  // contains server.js plus only the traced node_modules it needs.
  output: "standalone",
  // There is an unrelated package-lock.json above this folder; pin the trace root
  // so builds do not wander out of the project.
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    const scriptSrc = isProduction
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: csp },
    ];
    if (isProduction) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000",
      });
    }

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
