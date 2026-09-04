import type { LucideIcon } from "lucide-react";
import { BarChart3, Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2 className="section-title">{title}</h2>
        {description && <p className="section-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ContentSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-label="Carregando conteúdo">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-11 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: "neutral" | "sage" | "amber" | "blue";
  className?: string;
}) {
  return (
    <div className={`metric${className ? ` ${className}` : ""}`} data-tone={tone}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {detail && <p className="metric-detail">{detail}</p>}
    </div>
  );
}

export function ChartPanel({
  title,
  description,
  className,
  hasData = true,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  hasData?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`surface-panel${className ? ` ${className}` : ""}`}>
      <SectionHeader title={title} description={description} />
      {hasData ? (
        <div className="h-64">{children}</div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Ainda não há dados suficientes"
          description="O gráfico aparecerá automaticamente conforme novos registros forem feitos."
        />
      )}
    </section>
  );
}
