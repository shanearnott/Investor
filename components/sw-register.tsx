"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister({ basePath = "" }: { basePath?: string }) {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker
      .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
      .catch(() => {});
  }, [basePath]);
  return null;
}
