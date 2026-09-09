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
          body: JSON.stringify({ email: normalizedEmail, password }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
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
              "TBCA completa com 5.874 alimentos",
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
          Dados protegidos por perfil • acesso individual
        </p>
      </section>

      <section className="login-access-panel flex min-h-dvh items-center justify-center px-5 py-8 sm:px-10">
        <div className="login-card w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <p className="text-sm font-semibold text-primary">Acesso Nutri+</p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.045em]">
            Acesse sua área
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Entre com seus dados. O Nutri+ abrirá automaticamente a área da sua conta.
          </p>

          <form onSubmit={submit} noValidate className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 bg-white px-3"
                autoComplete="username"
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
                  autoComplete="current-password"
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
          <button type="button" onClick={onActivate} className="mt-4 w-full text-center text-sm font-semibold text-primary">
            Primeiro acesso com código de convite
          </button>
          <div className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              O acesso é validado pelo Nutri+. Cada perfil visualiza somente sua própria área.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
