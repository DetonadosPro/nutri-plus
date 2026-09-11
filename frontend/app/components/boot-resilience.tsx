"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode, useEffect } from "react";
import { APP_BUILD_ID, attemptChunkRecovery, markBoot } from "@/lib/app-boot";

const surface = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "#f5f2ea",
  color: "#173e31",
  fontFamily: "system-ui, sans-serif",
} as const;

const card = {
  width: "min(100%, 520px)",
  padding: 28,
  border: "1px solid #dbe6df",
  borderRadius: 22,
  background: "white",
  boxShadow: "0 16px 50px rgba(20, 60, 45, .12)",
  textAlign: "center",
} as const;

const primaryButton = {
  minHeight: 44,
  padding: "10px 16px",
  border: 0,
  borderRadius: 12,
  background: "#176b50",
  color: "white",
  fontWeight: 750,
  cursor: "pointer",
} as const;

const secondaryButton = {
  ...primaryButton,
  border: "1px solid #b8ccc2",
  background: "white",
  color: "#275744",
} as const;

export function BootRecoveryScreen({
  title = "Não foi possível iniciar o Nutri+.",
  message = "O aplicativo encontrou um problema antes de concluir a abertura.",
  code = "BOOT-RENDER",
  onRetry,
}: {
  title?: string;
  message?: string;
  code?: string;
  onRetry?: () => void;
}) {
  return (
    <main style={surface} data-nutri-first-ui="true" role="alert">
      <section style={card}>
        <h1 style={{ margin: "0 0 12px", fontSize: 24 }}>{title}</h1>
        <p style={{ margin: "0 0 20px", lineHeight: 1.5, color: "#52665e" }}>{message}</p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
          {onRetry ? (
            <button type="button" style={primaryButton} onClick={onRetry}>
              Tentar novamente
            </button>
          ) : null}
          <button type="button" style={onRetry ? secondaryButton : primaryButton} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
        <p style={{ margin: "16px 0 0", color: "#75847e", fontSize: 12 }}>
          Código: {code} · versão {APP_BUILD_ID.slice(0, 12)}
        </p>
      </section>
    </main>
  );
}
type BoundaryState = { error: Error | null; attempt: number };

export class BootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    markBoot("boot-error", error);
    void attemptChunkRecovery(error);
  }

  render() {
    if (this.state.error) {
      return (
        <BootRecoveryScreen
          code="BOOT-RENDER"
          onRetry={() => this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))}
        />
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

export function BootProvidersMounted() {
  useEffect(() => markBoot("providers-mounted"), []);
  return null;
}

export function FirstUsefulUi({ children, detail }: { children: ReactNode; detail: string }) {
  useEffect(() => markBoot("first-ui-rendered", detail), [detail]);
  return (
    <div style={{ display: "contents" }} data-nutri-first-ui="true">
      {children}
    </div>
  );
}
