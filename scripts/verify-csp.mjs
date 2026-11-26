#!/usr/bin/env node
/**
 * Verifies the production Content-Security-Policy in a real browser.
 *
 * Start a production server first, then run:
 *
 *   npm run build
 *   PORT=3001 npm run start        # in another terminal
 *   BASE_URL=http://127.0.0.1:3001 npm run verify:csp
 *
 * Checks, for `/` and `/login`:
 *   - no securitypolicyviolation event fires;
 *   - every font response is served from /_next/static/media;
 *   - the service worker registers (production registers it on load).
 */
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
const ROUTES = ["/", "/login"];
const FONT_PREFIX = "/_next/static/media/";

async function verifyRoute(browser, route) {
  const page = await browser.newPage();
  const violations = [];
  const fontResponses = [];
  const pageErrors = [];

  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });

  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (contentType.includes("font")) {
      fontResponses.push(new URL(response.url()).pathname);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  if (!response || !response.ok()) {
    throw new Error(`${route} returned ${response ? response.status() : "no response"}`);
  }

  // Give deferred font loads and the load-time registration a moment.
  await page.waitForTimeout(1500);

  const serviceWorker = await page.evaluate(async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        return {
          scope: registration.scope,
          active: Boolean(registration.active),
          installing: Boolean(registration.installing),
          waiting: Boolean(registration.waiting),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  });

  const collected = await page.evaluate(() => window.__cspViolations ?? []);
  violations.push(...collected);

  const problems = [];
  if (violations.length > 0) {
    problems.push(`CSP violations: ${JSON.stringify(violations)}`);
  }
  if (fontResponses.length === 0) {
    problems.push("no font responses observed");
  }
  const externalFonts = fontResponses.filter((path) => !path.startsWith(FONT_PREFIX));
  if (externalFonts.length > 0) {
    problems.push(`fonts not served from ${FONT_PREFIX}: ${externalFonts.join(", ")}`);
  }
  if (!serviceWorker) {
    problems.push("service worker did not register within 15s");
  }
  if (pageErrors.length > 0) {
    problems.push(`page errors: ${pageErrors.join(" | ")}`);
  }

  await page.close();

  return {
    route,
    ok: problems.length === 0,
    problems,
    fonts: [...new Set(fontResponses)],
    serviceWorker,
  };
}

async function main() {
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (const route of ROUTES) {
      let result;
      try {
        result = await verifyRoute(browser, route);
      } catch (error) {
        result = { route, ok: false, problems: [error.message], fonts: [], serviceWorker: null };
      }
      const label = result.ok ? "PASS" : "FAIL";
      console.log(`${label} ${route}`);
      console.log(`     fonts: ${result.fonts.join(", ") || "none"}`);
      console.log(
        `     service worker: ${
          result.serviceWorker ? `registered (${result.serviceWorker.scope})` : "not registered"
        }`,
      );
      for (const problem of result.problems) console.log(`     - ${problem}`);
      if (!result.ok) failed = true;
    }
  } finally {
    await browser.close();
  }

  if (failed) {
    console.error("CSP verification failed.");
    process.exit(1);
  }
  console.log("CSP verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
