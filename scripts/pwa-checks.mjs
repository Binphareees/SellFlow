/**
 * PWA assertions shared by `scripts/verify-api.mjs` (runs against any live
 * deployment) and `scripts/verify-pwa.mjs` (builds and boots the production
 * bundle first).
 *
 * Everything here is checked over HTTP, exactly as a browser or an install
 * prompt would see it: manifest validity, the service worker's cache
 * boundaries, the offline screen, and the PWA tags in the root layout HTML.
 */

const ICON_MINIMUMS = { any: [192, 512], maskable: [512] };

async function get(base, path) {
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    headers: { "cache-control": "no-cache" },
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

function attr(tag, name) {
  const match = new RegExp(`${name}="([^"]*)"`, "i").exec(tag);
  return match ? match[1] : null;
}

/**
 * Extracts `const PRECACHE = [...]` from the worker so we assert its contents,
 * resolving simple constants (PRECACHE lists `OFFLINE_URL`, not a literal).
 */
function precacheList(source) {
  const constants = {};
  for (const match of source.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*["']([^"']+)["']/g)) constants[match[1]] = match[2];

  const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(source);
  if (!list) return [];
  return [...list[1].matchAll(/["']([^"']+)["']|([A-Z_][A-Z0-9_]*)/g)].map(
    (entry) => entry[1] ?? constants[entry[2]] ?? entry[2],
  );
}

export async function runPwaChecks(base, { check, requireProduction = false } = {}) {
  // ── Manifest ───────────────────────────────────────────────────────────────
  const manifestRes = await get(base, "/manifest.json");
  check("manifest.json is served", manifestRes.status === 200, `status ${manifestRes.status}`);
  check(
    "manifest.json is served as JSON",
    (manifestRes.headers.get("content-type") ?? "").includes("application/json"),
    manifestRes.headers.get("content-type") ?? "no content-type",
  );

  let manifest = null;
  try {
    manifest = JSON.parse(manifestRes.text);
  } catch {
    manifest = null;
  }
  check("manifest.json parses as valid JSON", Boolean(manifest));

  if (manifest) {
    check("manifest start_url is app-scoped", typeof manifest.start_url === "string" && manifest.start_url.startsWith("/"), String(manifest.start_url));
    check("manifest declares a standalone display mode", manifest.display === "standalone" || (manifest.display_override ?? []).includes("standalone"));
    check("manifest has a name and short name", Boolean(manifest.name) && Boolean(manifest.short_name));
    check(
      "manifest theme and background colours are set",
      /^#[0-9a-f]{6}$/i.test(manifest.theme_color ?? "") && /^#[0-9a-f]{6}$/i.test(manifest.background_color ?? ""),
      `${manifest.theme_color} / ${manifest.background_color}`,
    );

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const sizesFor = (purpose) =>
      icons
        .filter((icon) => (icon.purpose ?? "any").split(/\s+/).includes(purpose))
        .map((icon) => Number(String(icon.sizes).split("x")[0]))
        .filter(Number.isFinite);
    check(
      "manifest ships 192px and 512px icons",
      ICON_MINIMUMS.any.every((size) => sizesFor("any").includes(size)),
      `sizes: ${sizesFor("any").join(", ") || "none"}`,
    );
    check(
      "manifest ships a maskable 512px icon",
      ICON_MINIMUMS.maskable.every((size) => sizesFor("maskable").includes(size)),
      `maskable: ${sizesFor("maskable").join(", ") || "none"}`,
    );

    // Every declared icon must actually resolve, or the install prompt breaks.
    const iconResults = await Promise.all(
      icons.map(async (icon) => {
        const res = await get(base, icon.src);
        return { src: icon.src, ok: res.status === 200, type: res.headers.get("content-type") ?? "" };
      }),
    );
    const brokenIcons = iconResults.filter((icon) => !icon.ok || !icon.type.startsWith("image/"));
    check(
      "every manifest icon resolves as an image",
      iconResults.length > 0 && brokenIcons.length === 0,
      brokenIcons.length ? brokenIcons.map((i) => `${i.src} (${i.type || "no type"})`).join(", ") : `${iconResults.length} icons`,
    );
  }

  // ── Service worker cache boundaries ────────────────────────────────────────
  const swRes = await get(base, "/sw.js");
  check("sw.js is served", swRes.status === 200, `status ${swRes.status}`);
  check(
    "sw.js is served as JavaScript",
    (swRes.headers.get("content-type") ?? "").includes("javascript"),
    swRes.headers.get("content-type") ?? "no content-type",
  );

  // A long max-age on sw.js delays every future deploy by that long.
  const swCacheControl = swRes.headers.get("cache-control") ?? "";
  const swMaxAge = /max-age=(\d+)/.exec(swCacheControl);
  check("sw.js is not cached past revalidation", !swMaxAge || Number(swMaxAge[1]) <= 60, swCacheControl || "no cache-control");

  const sw = swRes.text;
  const precached = precacheList(sw);
  check(
    "the offline screen is pre-cached on install",
    precached.includes("/offline.html"),
    precached.join(", ") || "no PRECACHE list found",
  );
  check(
    "the manifest and icons are pre-cached",
    precached.includes("/manifest.json") && precached.some((url) => url.startsWith("/icons/")),
  );
  check(
    "API traffic is excluded from the worker",
    sw.includes('startsWith("/api/")'),
  );
  check(
    "navigations are network-first, never cached HTML",
    /async function handleNavigation[\s\S]*?await fetch\(request\)/.test(sw) &&
      sw.includes('request.mode === "navigate"') &&
      !/navigate[\s\S]{0,400}cache\.put/.test(sw),
  );
  check(
    "only static asset paths are cached",
    sw.includes('startsWith("/_next/static/")') &&
      sw.includes('startsWith("/icons/")') &&
      sw.includes('=== "/manifest.json"'),
  );

  // ── Offline screen ─────────────────────────────────────────────────────────
  const offlineRes = await get(base, "/offline.html");
  check("offline.html is served", offlineRes.status === 200, `status ${offlineRes.status}`);
  check(
    "offline.html is standalone HTML",
    (offlineRes.headers.get("content-type") ?? "").includes("text/html") &&
      !/<script[^>]+src=/i.test(offlineRes.text) &&
      !/<link[^>]+rel=["']stylesheet["']/i.test(offlineRes.text),
  );
  check(
    "offline.html offers a retry and is mobile-sized",
    /location\.reload\(\)/.test(offlineRes.text) &&
      /name="viewport"/.test(offlineRes.text) &&
      /min-height: 48px/.test(offlineRes.text),
  );

  // ── Root layout PWA metadata ───────────────────────────────────────────────
  const pageRes = (await get(base, "/login")).status === 200 ? await get(base, "/login") : await get(base, "/marketplace");
  const html = pageRes.text;
  const tags = [...html.matchAll(/<(?:meta|link)\b[^>]*>/gi)].map((m) => m[0]);

  const manifestTag = tags.find((tag) => /rel="manifest"/i.test(tag));
  check("the root layout links the manifest", Boolean(manifestTag) && /href="\/manifest\.json"/.test(manifestTag), manifestTag ?? "missing");
  check(
    "the root layout sets theme-color",
    tags.some((tag) => /name="theme-color"/i.test(tag) && /content="#0f6b4f"/i.test(tag)),
  );
  const appleIcon = tags.find((tag) => /rel="apple-touch-icon"/i.test(tag));
  check("the root layout links an apple-touch-icon", Boolean(appleIcon), appleIcon ?? "missing");
  check(
    "the root layout sets the installed-app name",
    tags.some((tag) => /name="apple-mobile-web-app-title"/i.test(tag)),
  );
  check(
    "the root layout sets a mobile viewport",
    tags.some((tag) => /name="viewport"/i.test(tag) && /width=device-width/i.test(tag)),
  );
  // Next 15 emits the standards-track `mobile-web-app-capable`; older iOS builds
  // read `apple-mobile-web-app-capable`. Either satisfies instalment.
  check(
    "the layout marks itself as an installable web app",
    tags.some((tag) => /name="(?:apple-)?mobile-web-app-capable"/i.test(tag) && /content="yes"/i.test(tag)),
  );

  if (appleIcon) {
    const href = attr(appleIcon, "href");
    const iconRes = href ? await get(base, href) : null;
    check("the apple-touch-icon resolves", Boolean(iconRes) && iconRes.status === 200 && (iconRes.headers.get("content-type") ?? "").includes("image/"), href ?? "no href");
  }

  // ── Build identity ─────────────────────────────────────────────────────────
  const healthRes = await get(base, "/api/health");
  let health = null;
  try {
    health = JSON.parse(healthRes.text);
  } catch {
    health = null;
  }
  check("the health endpoint answers before PWA checks", healthRes.status === 200 && Boolean(health), `status ${healthRes.status}`);

  if (requireProduction) {
    check("the verified bundle is a production build", health?.app?.environment === "production", `environment: ${health?.app?.environment ?? "unknown"}`);
    check("the verified bundle reports a version", typeof health?.app?.version === "string" && health.app.version !== "unknown", `version: ${health?.app?.version ?? "unknown"}`);
  }
}
