"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { LoginScreen } from "./components/login-screen";
import { AccountAccessScreen } from "./components/account-access-screen";
import type { User } from "./types";

const PatientApp = lazy(() =>
  import("./components/patient-app").then((module) => ({
    default: module.PatientApp,
  })),
);
const NutritionistApp = lazy(() =>
  import("./components/nutritionist-app").then((module) => ({
    default: module.NutritionistApp,
  })),
);
const AdminApp = lazy(() => import("./components/admin-app").then((module) => ({ default: module.AdminApp })));

type Session = { user: User; patientId: number | null };
type AccountFlow = { type: "activate" } | { type: "verify"; token: string } | { type: "reset"; token: string };

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [accountFlow, setAccountFlow] = useState<AccountFlow | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verify = params.get("verify");
    const reset = params.get("reset");
    if (verify || reset) {
      setAccountFlow(verify ? { type: "verify", token: verify } : { type: "reset", token: reset! });
      setChecking(false);
      return;
    }
    api<Session>("/auth/me")
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setChecking(false));
  }, []);

  function closeAccountFlow() {
    window.history.replaceState({}, "", window.location.pathname);
    setAccountFlow(null);
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    sessionStorage.removeItem("nutri:navigation:patient");
    sessionStorage.removeItem("nutri:navigation:nutritionist");
    sessionStorage.removeItem("nutri:food-entry-draft");
    window.history.replaceState({}, "");
    setSession(null);
  }

  if (checking) return <LoadingScreen />;
  if (accountFlow) return <AccountAccessScreen flow={accountFlow} onBack={closeAccountFlow} />;
  if (!session) return <LoginScreen onLogin={setSession} onActivate={() => setAccountFlow({ type: "activate" })} />;
  return (
    <Suspense fallback={<LoadingScreen />}>
      {session.user.role === "patient" ? (
        <PatientApp user={session.user} onLogout={logout} />
      ) : session.user.role === "admin" ? (
        <AdminApp user={session.user} onLogout={logout} />
      ) : (
        <NutritionistApp user={session.user} onLogout={logout} />
      )}
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <main className="min-h-dvh bg-[#f5f2ea]" aria-label="Carregando Nutri+" aria-busy="true">
      <div className="mx-auto grid min-h-dvh max-w-[1480px] lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="hidden border-r border-black/5 bg-white/55 p-7 lg:block">
          <div className="h-8 w-28 animate-pulse rounded-xl bg-black/8" />
          <div className="mt-12 space-y-3">
            <div className="h-11 animate-pulse rounded-xl bg-black/6" />
            <div className="h-11 animate-pulse rounded-xl bg-black/5" />
            <div className="h-11 animate-pulse rounded-xl bg-black/5" />
          </div>
        </aside>
        <section className="p-5 sm:p-8 lg:p-12">
          <div className="h-4 w-24 animate-pulse rounded bg-black/6" />
          <div className="mt-4 h-10 max-w-md animate-pulse rounded-xl bg-black/8" />
          <div className="mt-3 h-5 max-w-xl animate-pulse rounded bg-black/5" />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="h-36 animate-pulse rounded-[24px] bg-white/70" />
            <div className="h-36 animate-pulse rounded-[24px] bg-white/70" />
            <div className="h-36 animate-pulse rounded-[24px] bg-white/70" />
          </div>
          <div className="mt-5 h-80 animate-pulse rounded-[28px] bg-white/70" />
        </section>
      </div>
    </main>
  );
}
