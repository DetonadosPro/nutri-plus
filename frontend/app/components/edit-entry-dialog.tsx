"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { Meal, MealEntry, Summary } from "../types";
import { MEAL_TYPES, type MealType } from "@/lib/meal-types";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MeasureInput, gramMeasure, safeGrams } from './measure-input';
import type { FoodMeasure } from '../../../shared/food-measures';
import { Label } from "@/components/ui/label";
import { foodDisplayName } from "@/lib/food-name";

export function EditEntryDialog({
  value,
  onOpenChange,
  onSaved,
}: {
  value: { entry: MealEntry; meal: Meal } | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (summary: Summary) => void | Promise<void>;
}) {
  const [measure, setMeasure] = useState<FoodMeasure>(gramMeasure);
  const [measures, setMeasures] = useState<FoodMeasure[]>([gramMeasure]);
  const [grams, setGrams] = useState("");
  const [mealType, setMealType] = useState<MealType>("lunch");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!value) return;
    const original = value.entry.measure_snapshot ?? gramMeasure;
    setMeasure(original);
    setMeasures(original.id ? [original,gramMeasure] : [gramMeasure]);
    setGrams(String(value.entry.measure_snapshot ? value.entry.amount : value.entry.grams_equivalent));
    let live = true;
    api<FoodMeasure[]>(`/foods/${value.entry.food_id}/measures`).then(rows => {
      if (live) setMeasures(original.id ? [original,...rows.filter(m => m.id !== original.id)] : rows);
    }).catch(() => {});
    setMealType(value.meal.meal_type as MealType);
    setError("");
    return () => { live = false; };
  }, [value]);
  const gramsValue = safeGrams(grams,measure);
  async function save() {
    if (!value || !Number.isFinite(gramsValue) || gramsValue <= 0) return;
    setLoading(true);
    try {
      const next = await api<Summary>(`/meal-entries/${value.entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: Number(grams.replace(',', '.')), measureId: measure.id, mealType }),
      });
      await onSaved(next);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog open={Boolean(value)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar registro</DialogTitle>
          <DialogDescription>{value?.entry ? foodDisplayName(value.entry) : ""}</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="edit-grams">Quantidade</Label>
          <MeasureInput id="edit-grams" value={grams} measure={measure} measures={measures}
            onChange={(value,next) => { setGrams(value); setMeasure(next); }} />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Refeição</legend>
          <div className="meal-picker mt-2">
            {MEAL_TYPES.slice(0, 6).map((meal) => {
              const Icon = meal.icon;
              return (
                <button
                  key={meal.value}
                  type="button"
                  aria-pressed={mealType === meal.value}
                  onClick={() => setMealType(meal.value)}
                >
                  <Icon className="size-4" />
                  <span>{meal.short}</span>
                  {mealType === meal.value && <Check className="ml-auto size-3.5" />}
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={save}
          disabled={loading || !Number.isFinite(gramsValue) || gramsValue <= 0}
        >
          {loading ? "Salvando…" : "Salvar alterações"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
