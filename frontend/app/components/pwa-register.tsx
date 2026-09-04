"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        void registration.update().catch((error) => console.warn("Atualização do app indisponível.", error));
      })
      .catch((error) => console.warn("Instalação do app indisponível.", error));
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
