"use client";

import { useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { Brand } from "./brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";
import type { User } from "../types";

export function LoginScreen({
  onLogin,
  onActivate,
}: {
  onLogin: (session: { user: User; patientId: number | null }) => void;
  onActivate: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"patient" | "nutritionist" | "admin">("patient");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError("Preencha o e-mail e a senha.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Digite um e-mail válido, incluindo o @.");
      return;
    }
    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      onLogin(
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: normalizedEmail, password, role }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  function fill(role: "patient" | "nutritionist" | "admin") {
    setRole(role);
    setEmail(role === "patient" ? "" : role === "admin" ? "admin@local.test" : "nutri@local.test");
    setPassword(role === "patient" ? "" : role === "admin" ? "Admin123!" : "Nutri123!");
    setError("");
  }

  return (
    <main className="login-shell min-h-dvh lg:grid lg:grid-cols-[0.92fr_1.08fr]">
      <section className="login-story relative hidden overflow-hidden border-r px-12 py-10 text-foreground lg:flex lg:flex-col xl:px-16">
        <div className="absolute -right-24 -top-16 size-80 rounded-full border border-primary/8" />
        <div className="absolute -right-4 top-24 size-48 rounded-full border border-primary/8" />
        <Brand />
        <div className="my-auto max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-white/60 px-3 py-1.5 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" /> Acompanhamento que cabe na rotina
          </span>
          <h1 className="font-display mt-6 text-5xl font-semibold leading-[1.06] tracking-[-0.055em] xl:text-6xl">
            Clareza para cuidar.
            <br />
            Calma para acompanhar.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
            Um espaço comum para registros simples do paciente e decisões profissionais mais bem
            contextualizadas.
          </p>
          <div className="mt-10 grid gap-4 text-sm text-foreground/80 sm:grid-cols-2">
            {[
              "TACO 4ª edição com 597 alimentos",
              "Metas definidas pelo nutricionista",
              "Histórico de peso e nutrientes",
              "Dados separados por perfil",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-white text-primary shadow-sm">
                  <Check className="size-3" />
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Versão local de desenvolvimento • dados de demonstração
        </p>
      </section>

      <section className="login-access-panel flex min-h-dvh items-center justify-center px-5 py-8 sm:px-10">
        <div className="login-card w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <p className="text-sm font-semibold text-primary">Bem-vindo de volta</p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.045em]">
            Acesse sua área
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {role === "patient"
              ? "Registre sua rotina e acompanhe as metas definidas pelo nutricionista."
              : role === "nutritionist"
                ? "Acompanhe seus pacientes e transforme registros em decisões claras."
                : "Gerencie somente o acesso dos profissionais ao Nutri+."}
          </p>

          <div
            className="mt-6 grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-1.5"
            aria-label="Preencher acesso de demonstração"
          >
            <button
              type="button"
              aria-pressed={role === "patient"}
              onClick={() => fill("patient")}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${role === "patient" ? "bg-white text-primary shadow-sm" : "hover:bg-white/70"}`}
            >
              Sou paciente
            </button>
            <button
              type="button"
              aria-pressed={role === "nutritionist"}
              onClick={() => fill("nutritionist")}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${role === "nutritionist" ? "bg-white text-primary shadow-sm" : "hover:bg-white/70"}`}
            >
              Sou nutricionista
            </button>
            <button
              type="button"
              aria-pressed={role === "admin"}
              onClick={() => fill("admin")}
              className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition ${role === "admin" ? "bg-white text-primary shadow-sm" : "hover:bg-white/70"}`}
            >
              Administração
            </button>
          </div>

          <form onSubmit={submit} noValidate className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 bg-white px-3"
                autoComplete={role === "patient" ? "off" : "username"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-12 bg-white px-3 pr-11"
                  minLength={8}
                  autoComplete={role === "patient" ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-1 top-1 grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={loading}>
              {loading ? (
                "Entrando…"
              ) : (
                <>
                  Entrar <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>
          {role === "patient" && (
            <button type="button" onClick={onActivate} className="mt-4 w-full text-center text-sm font-semibold text-primary">
              Recebi um código de ativação
            </button>
          )}
          <div className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              O acesso é validado pelo servidor local. Pacientes visualizam somente os próprios
              dados.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
