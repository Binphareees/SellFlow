"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker and surfaces a reload prompt when a new version
 * takes over. Registration is skipped in development: hot reload and a
 * long-lived cache fight each other, and stale chunks look like app bugs.
 */
export function ServiceWorkerRegistration() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    // On a first visit there is no controller yet. That install is not an update,
    // so the banner must stay hidden.
    const hadController = Boolean(navigator.serviceWorker.controller);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;

        if (registration.waiting && hadController) setUpdateReady(true);

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && hadController) setUpdateReady(true);
          });
        });
      } catch (error) {
        console.warn("[pwa] service worker registration failed", error);
      }
    };

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    const onControllerChange = () => {
      if (hadController) setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div className="update-banner" role="status">
      <span className="tiny">A new version of SellFlow is ready.</span>
      <button
        className="btn btn-sm btn-primary"
        type="button"
        onClick={() => {
          setUpdateReady(false);
          window.location.reload();
        }}
      >
        Reload
      </button>
    </div>
  );
}
