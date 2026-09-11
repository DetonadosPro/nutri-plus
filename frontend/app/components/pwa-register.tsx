"use client";

import { useEffect } from "react";
import { APP_BUILD_ID, markBoot } from "@/lib/app-boot";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const scriptUrl = `/sw.js?build=${encodeURIComponent(APP_BUILD_ID)}`;
    void navigator.serviceWorker
      .register(scriptUrl, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        void registration.update().catch((error) => console.warn("Atualização do app indisponível.", error));
      })
      .catch((error) => {
        markBoot("boot-error", `service-worker: ${error instanceof Error ? error.message : "registration"}`);
        console.warn("Instalação do app indisponível.", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
