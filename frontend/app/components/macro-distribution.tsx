import type { Goals } from "../types";
import { formatNumber } from "@/lib/nutrition-format";

const macroItems = [
  {
    key: "carbohydrate",
    label: "Carboidratos",
    percent: "carbohydrate_percent",
    grams: "carbohydrate_g",
    tone: "carb",
  },
  {
    key: "protein",
    label: "Proteínas",
    percent: "protein_percent",
    grams: "protein_g",
    tone: "protein",
  },
  {
    key: "fat",
    label: "Gorduras",
    percent: "fat_percent",
    grams: "fat_g",
    tone: "fat",
  },
] as const;

export function MacroDistributionSummary({ goals }: { goals: Goals | null }) {
  if (!goals) {
    return (
      <p className="text-sm text-muted-foreground">
        A distribuição será exibida quando as metas forem definidas.
      </p>
    );
  }
  return (
    <div className="macro-distribution-summary">
      <div className="macro-distribution-bar" aria-hidden="true">
        {macroItems.map((item) => (
          <span
            key={item.key}
            data-tone={item.tone}
            style={{ width: `${Number(goals[item.percent] ?? 0)}%` }}
          />
        ))}
      </div>
      <dl>
        {macroItems.map((item) => (
          <div key={item.key} data-tone={item.tone}>
            <dt>
              <i aria-hidden="true" /> {item.label}
            </dt>
            <dd>
              {formatNumber(goals[item.percent])}%
              <small>{formatNumber(goals[item.grams], 1)} g</small>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
