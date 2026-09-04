import { Apple } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${compact ? "size-8" : "size-10"} grid place-items-center rounded-xl bg-primary text-primary-foreground`}
      >
        <Apple className="size-5" aria-hidden="true" />
      </div>
      <span className="font-display text-lg font-semibold tracking-[-0.04em]">Nutri+</span>
    </div>
  );
}
