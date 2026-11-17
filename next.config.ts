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
};

export default nextConfig;
