"use client";

import { useEffect, useState } from "react";
import { Check, Clock3 } from "lucide-react";
import type { Meal, MealEntry, Summary } from "../types";
import { MEAL_TYPES, type MealType } from "@/lib/meal-types";
import { timeFromTimestamp } from "@/lib/datetime";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  const [grams, setGrams] = useState("");
  const [mealType, setMealType] = useState<MealType>("lunch");
  const [consumedTime, setConsumedTime] = useState("12:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!value) return;
    setGrams(String(value.entry.grams_equivalent));
    setMealType(value.meal.meal_type as MealType);
    setConsumedTime(timeFromTimestamp(value.entry.consumed_at || value.meal.eaten_at) || "12:00");
    setError("");
  }, [value]);
  const gramsValue = Number(grams);
  async function save() {
    if (!value || !Number.isFinite(gramsValue) || gramsValue <= 0) return;
    setLoading(true);
    try {
      const next = await api<Summary>(`/meal-entries/${value.entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ grams: gramsValue, mealType, consumedTime }),
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
          <div className="relative mt-2 max-w-40">
            <Input
              id="edit-grams"
              type="number"
              inputMode="decimal"
              min="1"
              max="5000"
              value={grams}
              onChange={(event) => setGrams(event.target.value)}
              className="h-12 pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              g
            </span>
          </div>
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
        <div className="max-w-48">
          <Label htmlFor="edit-time">Horário</Label>
          <div className="relative mt-2">
            <Clock3 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="edit-time"
              type="time"
              value={consumedTime}
              onChange={(event) => setConsumedTime(event.target.value)}
              className="h-12 pl-10"
            />
          </div>
        </div>
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
