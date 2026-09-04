"use client";

import { ChevronRight } from "lucide-react";
import type { NutrientCatalogItem, NutrientMap } from "../types";

const groupNames: Record<string, string> = {
  energy: "Energia e macronutrientes",
  macro: "Energia e macronutrientes",
  mineral: "Minerais",
  vitamin: "Vitaminas",
  other: "Outros compostos",
  fatty_acid: "Ácidos graxos",
  amino_acid: "Aminoácidos",
};
const order = [
  "Energia e macronutrientes",
  "Minerais",
  "Vitaminas",
  "Outros compostos",
  "Ácidos graxos",
  "Aminoácidos",
];
const format = (value: number | null | undefined) =>
  value == null
    ? "Não disponível"
    : new Intl.NumberFormat("pt-BR", {
        maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
      }).format(value);

export function NutrientDetails({
  values,
  catalog,
  title = "Análise nutricional",
  description,
}: {
  values: NutrientMap;
  catalog: NutrientCatalogItem[];
  title?: string;
  description?: string;
}) {
  const grouped = new Map<string, NutrientCatalogItem[]>();
  for (const item of catalog) {
    const group = groupNames[item.nutrientGroup] || "Outros compostos";
    grouped.set(group, [...(grouped.get(group) || []), item]);
  }
  return (
    <section className="border-y border-border py-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="mt-3 divide-y divide-border">
        {order
          .filter((group) => grouped.has(group))
          .map((group, index) => (
            <details key={group} open={index === 0} className="group py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
                <span>{group}</span>
                <ChevronRight className="size-4 transition group-open:rotate-90" />
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.get(group)!.map((item) => {
                  const value = values[item.code];
                  return (
                    <div
                      key={item.code}
                      className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 text-sm"
                    >
                      <span className="text-muted-foreground">{item.name}</span>
                      <strong
                        className={value == null ? "text-xs font-medium text-muted-foreground" : ""}
                      >
                        {format(value)}
                        {value == null ? "" : ` ${item.unit}`}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        “Não disponível” significa que ao menos um alimento do período não possui dado confiável
        para esse nutriente; ausência nunca é tratada como zero.
      </p>
    </section>
  );
}
