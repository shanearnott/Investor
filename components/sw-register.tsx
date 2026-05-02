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

    navigator.serviceWorker
      .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
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
