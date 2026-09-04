"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { timeFromTimestamp } from "@/lib/datetime";
import { formatNumber } from "@/lib/nutrition-format";
import { MEAL_TYPES, mealDefinition } from "@/lib/meal-types";
import type { Meal, MealEntry, Summary } from "../types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const primaryMealTypes = MEAL_TYPES.slice(0, 6);

export function PatientMealList({
  summary,
  revealRequest,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
}: {
  summary: Summary;
  revealRequest?: { mealType: string; token: number } | null;
  onAdd?: (mealType?: string) => void;
  onEdit?: (entry: MealEntry, meal: Meal) => void;
  onDelete?: (entryId: number) => void;
  onCopy?: (meal: Meal) => void;
}) {
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);
  const mealsByType = useMemo(
    () => new Map(summary.meals.map((meal) => [meal.meal_type, meal])),
    [summary.meals],
  );
  const extraMeals = summary.meals.filter(
    (meal) => !primaryMealTypes.some((item) => item.value === meal.meal_type),
  );

  useEffect(() => setExpandedMeal(null), [summary.date]);
  useEffect(() => {
    if (!revealRequest) return;
    const definition = primaryMealTypes.find((item) => item.value === revealRequest.mealType);
    const meal = mealsByType.get(revealRequest.mealType);
    if (!meal) return;
    setExpandedMeal(definition?.value ?? `meal-${meal.id}`);
    const timeout = window.setTimeout(() => {
      document.querySelector(`[data-patient-meal="${revealRequest.mealType}"]`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [mealsByType, revealRequest]);

  const slots = [
    ...primaryMealTypes.map((definition) => ({
      key: definition.value,
      definition,
      meal: mealsByType.get(definition.value),
    })),
    ...extraMeals.map((meal) => ({
      key: `meal-${meal.id}`,
      definition: mealDefinition(meal.meal_type),
      meal,
    })),
  ];

  return (
    <div className="patient-meal-list">
      {slots.map(({ key, definition, meal }) => (
        <PatientMealCard
          key={key}
          meal={meal}
          definition={definition}
          expanded={expandedMeal === key}
          onToggle={() => meal && setExpandedMeal((current) => (current === key ? null : key))}
          onAdd={onAdd ? () => onAdd(definition.value) : undefined}
          onEdit={onEdit}
          onDelete={onDelete}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

function PatientMealCard({
  meal,
  definition,
  expanded,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
}: {
  meal?: Meal;
  definition: ReturnType<typeof mealDefinition>;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onEdit?: (entry: MealEntry, meal: Meal) => void;
  onDelete?: (entryId: number) => void;
  onCopy?: (meal: Meal) => void;
}) {
  const MealIcon = definition.icon;
  const entryCount = meal?.entries.length ?? 0;
  const energy = meal?.totals.energia_kcal ?? 0;
  const time = meal
    ? timeFromTimestamp(meal.eaten_at) || timeFromTimestamp(meal.entries[0]?.consumed_at)
    : "";

  return (
    <article
      className={`patient-meal-card${expanded ? " is-expanded" : ""}`}
      data-tone={mealTone(definition.value)}
      data-patient-meal={definition.value}
    >
      <div className="patient-meal-summary">
        <button
          type="button"
          className="patient-meal-toggle"
          onClick={meal ? onToggle : onAdd}
          disabled={!meal && !onAdd}
          aria-expanded={meal ? expanded : undefined}
          aria-label={
            meal
              ? `${expanded ? "Recolher" : "Ver"} ${meal.label || definition.label}`
              : onAdd
                ? `Adicionar alimento em ${definition.label}`
                : `${definition.label} sem alimentos`
          }
        >
          <span className="patient-meal-icon">
            <MealIcon className="size-5" />
          </span>
          <span className="patient-meal-name">
            <span>{meal?.label || definition.label}</span>
            <small>
              {meal
                ? `${entryCount} ${entryCount === 1 ? "alimento" : "alimentos"}${time ? ` · ${time}` : ""}`
                : "Nenhum alimento"}
            </small>
          </span>
          <span className="patient-meal-energy">
            <strong>{formatNumber(energy)}</strong>
            <small>kcal</small>
          </span>
          {meal && (
            <ChevronDown
              className={`size-4 shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          )}
        </button>
        {onAdd ? (
          <button
            type="button"
            className="patient-meal-add-button"
            onClick={onAdd}
            aria-label={`Adicionar alimento em ${meal?.label || definition.label}`}
          >
            <Plus className="size-5" />
          </button>
        ) : (
          <button
            type="button"
            className="patient-meal-readonly"
            onClick={meal ? onToggle : undefined}
            disabled={!meal}
            aria-label={
              meal
                ? `${expanded ? "Recolher" : "Expandir"} ${meal.label || definition.label}`
                : `${definition.label} sem alimentos`
            }
          >
            <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {meal && expanded && (
        <div className="patient-meal-details">
          <div className="patient-meal-macros" aria-label="Resumo da refeição">
            <MealMacro label="Proteína" value={meal.totals.proteina_g} unit="g" />
            <MealMacro label="Carboidrato" value={meal.totals.carboidrato_g} unit="g" />
            <MealMacro label="Gordura" value={meal.totals.lipideos_g} unit="g" />
          </div>

          <div className="patient-meal-foods">
            {meal.entries.map((entry) => (
              <div key={entry.id} className="patient-meal-food-row">
                <div className="min-w-0 flex-1">
                  <p>{entry.description}</p>
                  <span>
                    {formatNumber(entry.grams_equivalent)} g ·{" "}
                    {formatNumber(entry.nutrients.energia_kcal)} kcal
                  </span>
                  <div className="patient-food-nutrients">
                    {entry.nutrients.proteina_g != null && (
                      <small>P {formatNumber(entry.nutrients.proteina_g, 1)} g</small>
                    )}
                    {entry.nutrients.carboidrato_g != null && (
                      <small>C {formatNumber(entry.nutrients.carboidrato_g, 1)} g</small>
                    )}
                    {entry.nutrients.lipideos_g != null && (
                      <small>G {formatNumber(entry.nutrients.lipideos_g, 1)} g</small>
                    )}
                    {entry.glycemicIndex != null && (
                      <small>IG {formatNumber(entry.glycemicIndex)}</small>
                    )}
                    {entry.glycemicLoad != null && (
                      <small>CG {formatNumber(entry.glycemicLoad, 1)}</small>
                    )}
                  </div>
                </div>
                {(onEdit || onDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="patient-food-actions"
                      aria-label={`Ações de ${entry.description}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {onEdit && (
                        <DropdownMenuItem onClick={() => onEdit(entry, meal)}>
                          <Pencil />
                          Editar registro
                        </DropdownMenuItem>
                      )}
                      {onDelete && (
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(entry.id)}>
                          <Trash2 />
                          Excluir
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>

          {(onCopy || onAdd) && (
            <div className="patient-meal-footer">
              {onCopy && (
                <button type="button" onClick={() => onCopy(meal)}>
                  <Copy className="size-4" />
                  Repetir refeição
                </button>
              )}
              {onAdd && (
                <button type="button" onClick={onAdd}>
                  <Plus className="size-4" />
                  Adicionar alimento
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function MealMacro({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong>
        {formatNumber(value, 1)} {unit}
      </strong>
    </div>
  );
}

function mealTone(mealType: string) {
  if (mealType === "breakfast") return "amber";
  if (mealType === "morning_snack") return "mint";
  if (mealType === "lunch") return "coral";
  if (mealType === "afternoon_snack") return "peach";
  if (mealType === "dinner") return "blue";
  return "violet";
}
