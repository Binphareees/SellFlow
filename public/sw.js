/*
 * SellFlow service worker.
 *
 * Deliberately conservative, because this app shows private money data:
 *   - HTML is NEVER cached. Every navigation goes to the network first, and the
 *     last resort is a static offline page with a retry button.
 *   - /api/* is never touched, so a stale balance can never be shown as current.
 *   - Only same-origin static assets (hashed Next.js chunks, icons, manifest)
 *     are cached, stale-while-revalidate.
 *
 * Bump VERSION when the caching rules change; old caches are dropped on activate.
 */
const VERSION = "v2";
const STATIC_CACHE = `sellflow-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // addAll fails the whole install if one URL 404s, so add them one by one.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("sellflow-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Refresh in the background; serve the cached copy immediately.
    void network;
    return cached;
  }

  const fresh = await network;
  return fresh ?? Response.error();
}

async function handleNavigation(request) {
  try {
    // Network first: balances and prices must never come from a stale copy.
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Offline</title><p>You are offline. Reopen SellFlow when you have signal.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache or reinterpret API traffic.
  if (url.pathname.startsWith("/api/")) return;
  // Let the dev server's HMR channel through untouched.
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
