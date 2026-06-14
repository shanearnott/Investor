"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister({ basePath = "" }: { basePath?: string }) {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Register with the build id as a query string. The SW scope is taken
    // from the URL path (so adding ?v=... doesn't change scope), but the
    // *URL itself* is new — Safari's HTTP cache will refetch instead of
    // serving the previous build's SW bytes. Combined with the cache-name
    // stamp inside sw.js this guarantees every deploy reaches viewers
    // without manual cache clears.
    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
    navigator.serviceWorker
      .register(`${basePath}/sw.js?v=${buildId}`, { scope: `${basePath}/` })
      .then((reg) => {
        reg.update().catch(() => {});
        const promote = (sw: ServiceWorker | null) => {
          if (!sw) return;
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            sw.postMessage("SKIP_WAITING");
          }
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              sw.postMessage("SKIP_WAITING");
            }
          });
        };
        promote(reg.waiting);
        reg.addEventListener("updatefound", () => promote(reg.installing));
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [basePath]);
  return null;
}
