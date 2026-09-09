"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Clock3, Heart, Search, Sparkles, UtensilsCrossed, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { brazilNow } from "@/lib/datetime";
import { formatNumber } from "@/lib/nutrition-format";
import { MEAL_TYPES, type MealType } from "@/lib/meal-types";
import type { Food, NutrientCatalogItem, Summary } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NutrientDetails } from "./nutrient-details";
import { FoodPhotoReview } from './food-photo-review';
import { foodDisplayName } from '@/lib/food-name';

type FoodEntryHistory = { session: string; step: 'search' | 'details' };

export function FoodEntrySheet({
  open,
  onOpenChange,
  date,
  catalog,
  initialMealType,
  initialPhoto,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  catalog: NutrientCatalogItem[];
  initialMealType?: string;
  initialPhoto?: { file: File; token: number };
  onAdded: (summary: Summary) => void | Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyReady = useRef(false);
  const closing = useRef(false);
  const historySession = useRef('');
  const [search, setSearch] = useState("");
  const [photoMode, setPhotoMode] = useState(false);
  const [foods, setFoods] = useState<Food[]>([]);
  const [selected, setSelected] = useState<Food | null>(null);
  const [grams, setGrams] = useState("");
  const [mealType, setMealType] = useState<MealType | "">("");
  const [consumedTime, setConsumedTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const gramsValue = Number(grams);
  const fixedMeal = MEAL_TYPES.find((item) => item.value === initialMealType) ?? null;

  useEffect(() => {
    if (!open) return;
    setPhotoMode(Boolean(initialPhoto));
    setConsumedTime(brazilNow().time);
    setMealType(
      MEAL_TYPES.some((item) => item.value === initialMealType)
        ? (initialMealType as MealType)
        : "",
    );
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setError("");
  }, [open, initialMealType, initialPhoto]);

  useEffect(() => {
    if (!open) {
      historyReady.current = false;
      return;
    }
    if (!historyReady.current) {
      const baseState = { ...window.history.state };
      delete baseState.nutriFoodEntry;
      historySession.current = crypto.randomUUID();
      baseState.nutriOverlayReturn = historySession.current;
      window.history.replaceState(baseState, '');
      window.history.pushState({
        ...baseState,
        nutriFoodEntry: { session: historySession.current, step: 'search' },
      }, '');
      historyReady.current = true;
    }
  }, [open]);

  useEffect(() => {
    if (
      open &&
      selected &&
      historyReady.current &&
      (window.history.state?.nutriFoodEntry as FoodEntryHistory | undefined)?.step !== 'details'
    ) {
      window.history.pushState({
        ...window.history.state,
        nutriFoodEntry: { session: historySession.current, step: 'details' },
      }, '');
    }
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const onPopState = (event: PopStateEvent) => {
      const entry = event.state?.nutriFoodEntry as FoodEntryHistory | undefined;
      if (entry?.session === historySession.current && entry.step === 'search') {
        closing.current = false;
        setSelected(null);
        return;
      }
      resetTransientState();
      if (event.state?.nutriOverlayReturn === historySession.current) {
        const cleanState = { ...event.state };
        delete cleanState.nutriOverlayReturn;
        window.history.replaceState(cleanState, '');
      }
      closing.current = false;
      historyReady.current = false;
      historySession.current = '';
      onOpenChange(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, onOpenChange]);

  function closeSheet() {
    if (closing.current) return;
    const entry = window.history.state?.nutriFoodEntry as FoodEntryHistory | undefined;
    resetTransientState();
    if (historyReady.current && entry?.session === historySession.current) {
      closing.current = true;
      window.history.go(entry.step === 'details' ? -2 : -1);
    } else {
      historyReady.current = false;
      historySession.current = '';
      onOpenChange(false);
    }
  }

  function returnToSearch() {
    const entry = window.history.state?.nutriFoodEntry as FoodEntryHistory | undefined;
    if (entry?.session === historySession.current && entry.step === 'details') window.history.back();
    else setSelected(null);
  }

  function resetTransientState() {
    setPhotoMode(false);
    setSearch("");
    setFoods([]);
    setSelected(null);
    setGrams("");
    setMealType("");
    setConsumedTime("");
    setFavoritesOnly(false);
    setLoading(false);
    setError("");
    sessionStorage.removeItem("nutri:food-entry-draft");
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }

  useEffect(() => {
    if (!selected) return;
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    setSearchLoading(true);
    const timer = window.setTimeout(
      () =>
        api<Food[]>(`/foods?search=${encodeURIComponent(search)}&favorites=${favoritesOnly}`)
          .then(setFoods)
          .catch(() => setFoods([]))
          .finally(() => setSearchLoading(false)),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [search, favoritesOnly, open]);

  const calculated = useMemo(
    () =>
      selected
        ? {
            energy:
              selected.nutrients.energia_kcal == null
                ? null
                : (selected.nutrients.energia_kcal * gramsValue) / 100,
            protein:
              selected.nutrients.proteina_g == null
                ? null
                : (selected.nutrients.proteina_g * gramsValue) / 100,
            carbohydrate:
              selected.nutrients.carboidrato_g == null
                ? null
                : (selected.nutrients.carboidrato_g * gramsValue) / 100,
            fat:
              selected.nutrients.lipideos_g == null
                ? null
                : (selected.nutrients.lipideos_g * gramsValue) / 100,
            nutrients: Object.fromEntries(
              Object.entries(selected.nutrients).map(([code, value]) => [
                code,
                value == null ? null : (value * gramsValue) / 100,
              ]),
            ),
          }
        : null,
    [selected, gramsValue],
  );

  async function add() {
    if (!selected || !mealType || !consumedTime || !Number.isFinite(gramsValue) || gramsValue <= 0)
      return;
    setLoading(true);
    setError("");
    try {
      const summary = await api<Summary>("/meals", {
        method: "POST",
        body: JSON.stringify({
          date,
          mealType,
          consumedTime,
          foodId: selected.id,
          grams: gramsValue,
        }),
      });
      await onAdded(summary);
      resetTransientState();
      const entry = window.history.state?.nutriFoodEntry as FoodEntryHistory | undefined;
      if (entry?.session === historySession.current && entry.step === 'details') window.history.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível adicionar o alimento.");
    } finally {
      setLoading(false);
    }
  }

  async function favorite(food: Food) {
    const result = await api<{ favorite: boolean }>(`/favorites/${food.id}`, {
      method: "POST",
    });
    setFoods((items) =>
      items.map((item) => (item.id === food.id ? { ...item, favorite: result.favorite } : item)),
    );
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : closeSheet())}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="food-entry-sheet left-0 right-0 h-[96dvh] max-h-[96dvh] w-full max-w-2xl translate-x-0 gap-0 overflow-hidden rounded-t-[28px] border-x sm:data-[side=bottom]:inset-auto sm:data-[side=bottom]:left-1/2 sm:data-[side=bottom]:top-1/2 sm:data-[side=bottom]:h-[min(760px,calc(100dvh-3rem))] sm:data-[side=bottom]:max-h-[calc(100dvh-3rem)] sm:data-[side=bottom]:w-[min(48rem,calc(100vw-3rem))] sm:data-[side=bottom]:max-w-none sm:data-[side=bottom]:[transform:translate(-50%,-50%)] sm:rounded-[28px] sm:border"
      >
        <SheetHeader className="relative border-b px-5 py-5 pr-16 sm:px-7 sm:pr-16">
          <button
            type="button"
            onClick={closeSheet}
            aria-label="Fechar registro de alimento"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:right-5"
          >
            <X className="size-5" />
          </button>
          <SheetTitle className="font-display text-xl font-semibold">{photoMode ? 'Reconhecer por foto' : 'Registrar alimento'}</SheetTitle>
          <SheetDescription>
            {fixedMeal
              ? `Refeição selecionada: ${fixedMeal.label}.`
              : selected
                ? "Complete os detalhes do consumo."
                : "Encontre o alimento na base de alimentos."}
          </SheetDescription>
        </SheetHeader>
        <div ref={scrollRef} className="food-entry-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {photoMode ? <FoodPhotoReview date={date} initialMealType={initialMealType} initialPhoto={initialPhoto} onBack={() => setPhotoMode(false)} onAdded={onAdded} /> : !selected ? (
            <div className="animate-content-in">
              <Button className="mb-4 h-14 w-full rounded-2xl" variant="outline" onClick={() => setPhotoMode(true)}><Sparkles /> Reconhecer por foto</Button>
              <div className="food-search-row flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="food-search-input h-14 rounded-2xl bg-white pl-10 pr-10"
                    placeholder="Busque arroz, banana, frango…"
                  />
                  {search && (
                    <button type="button" className="food-search-clear" onClick={() => setSearch('')} aria-label="Limpar busca">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className={`icon-button border ${favoritesOnly ? "text-rose-600" : "subtle"}`}
                  aria-pressed={favoritesOnly}
                  aria-label="Mostrar somente favoritos"
                  onClick={() => setFavoritesOnly((value) => !value)}
                >
                  <Heart className={`size-4 ${favoritesOnly ? "fill-current" : ""}`} />
                </button>
              </div>
              <p className="mt-5 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {favoritesOnly ? "Favoritos" : search ? "Resultados" : "Recentes e favoritos"}
                {!searchLoading && foods.length > 0 && <span className="font-medium normal-case tracking-normal">{foods.length} encontrados</span>}
              </p>
              <div className="food-result-list mt-2 divide-y">
                {foods.map((food) => (
                  <div key={food.id} className="food-result-row flex items-center gap-2 py-1">
                    <button
                      onClick={() => setSelected(food)}
                      className="min-h-14 min-w-0 flex-1 rounded-xl px-2 py-2 text-left transition hover:bg-muted"
                    >
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">
                        {foodDisplayName(food)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {food.category || "Grupo não informado"} ·{" "}
                        {formatNumber(food.nutrients.energia_kcal)} kcal/100 g
                      </p>
                    </button>
                    <button
                      onClick={() => favorite(food)}
                      className={`icon-button ${food.favorite ? "text-rose-600" : "subtle"}`}
                      aria-label={
                        food.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"
                      }
                    >
                      <Heart className={`size-4 ${food.favorite ? "fill-current" : ""}`} />
                    </button>
                  </div>
                ))}
                {searchLoading && <div className="food-search-state">Buscando alimentos…</div>}
                {!searchLoading && !foods.length && (
                  <div className="food-search-state">
                    <Search className="size-5" />
                    <strong>Nenhum alimento encontrado</strong>
                    <span>Tente um nome mais curto ou retire o filtro de favoritos.</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="animate-content-in">
              <button className="secondary-action -ml-2" onClick={returnToSearch}>
                <ArrowLeft className="size-4" />
                Trocar alimento
              </button>
              <div className="food-selected-card mt-4">
                <span><UtensilsCrossed className="size-5" /></span>
                <div>
                  <small>Alimento selecionado</small>
                  <p>{foodDisplayName(selected)}</p>
                  <em>{selected.category || 'Grupo não informado'} · código {selected.source_code}</em>
                </div>
              </div>
              {fixedMeal ? (
                <div className="mt-6 grid gap-5 sm:grid-cols-[180px_220px_max-content] sm:items-end sm:gap-3">
                  <div>
                    <Label htmlFor="food-grams">Quantidade em gramas</Label>
                    <div className="relative mt-2">
                      <Input
                        id="food-grams"
                        type="number"
                        inputMode="decimal"
                        min="1"
                        max="5000"
                        value={grams}
                        onChange={(event) => setGrams(event.target.value)}
                        className="h-12 rounded-xl bg-white pr-9"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        g
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] items-end gap-3 sm:contents">
                    <div className="min-w-0">
                      <Label htmlFor="consumed-time">Horário do consumo</Label>
                      <div className="relative mt-2">
                        <Clock3 className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground sm:left-3.5" />
                        <Input
                          id="consumed-time"
                          type="time"
                          value={consumedTime}
                          onChange={(event) => setConsumedTime(event.target.value)}
                          className="h-12 rounded-xl bg-white pl-8 sm:pl-10"
                        />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <Label>Refeição selecionada</Label>
                      <div className="mt-2 flex h-12 w-fit max-w-full items-center gap-2 whitespace-nowrap rounded-xl border bg-secondary/45 px-3 text-sm font-semibold">
                        <fixedMeal.icon className="size-4 shrink-0 text-primary" />
                        <span className="truncate">{fixedMeal.label}</span>
                        <Check className="ml-1 size-4 shrink-0 text-primary" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-6 grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <div>
                      <Label htmlFor="food-grams">Quantidade em gramas</Label>
                      <div className="relative mt-2">
                        <Input
                          id="food-grams"
                          type="number"
                          inputMode="decimal"
                          min="1"
                          max="5000"
                          value={grams}
                          onChange={(event) => setGrams(event.target.value)}
                          className="h-12 rounded-xl bg-white pr-9"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          g
                        </span>
                      </div>
                    </div>
                    <fieldset>
                      <legend className="text-sm font-medium">Em qual refeição?</legend>
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
                  </div>
                  <div className="mt-5 max-w-[220px]">
                    <Label htmlFor="consumed-time">Horário do consumo</Label>
                    <div className="relative mt-2">
                      <Clock3 className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="consumed-time"
                        type="time"
                        value={consumedTime}
                        onChange={(event) => setConsumedTime(event.target.value)}
                        className="h-12 rounded-xl bg-white pl-10"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Preenchido com o horário atual de Brasília; você pode alterar.
                    </p>
                  </div>
                </>
              )}
              <div className="food-macro-preview mt-6 grid grid-cols-2 gap-2.5 rounded-[22px] border bg-surface-soft p-2.5 sm:grid-cols-4 sm:gap-3 sm:p-3">
                <Preview label="Energia" value={`${formatNumber(calculated?.energy)} kcal`} />
                <Preview label="Proteína" value={`${formatNumber(calculated?.protein, 1)} g`} />
                <Preview label="IG" value={formatNumber(selected.glycemicIndex)} />
                <Preview
                  label="CG"
                  value={formatNumber(
                    selected.glycemicIndex != null && calculated?.carbohydrate != null
                      ? (selected.glycemicIndex * calculated.carbohydrate) / 100
                      : null,
                    1,
                  )}
                />
              </div>
              <details className="group mt-4">
                <summary className="secondary-action list-none">
                  <Sparkles className="size-4" />
                  Ver composição completa
                </summary>
                <div className="mt-2">
                  <NutrientDetails
                    values={calculated?.nutrients ?? {}}
                    catalog={catalog}
                    title="Detalhes desta porção"
                  />
                </div>
              </details>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-destructive/8 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
        <SheetFooter className="food-entry-footer flex-row items-center justify-between border-t bg-popover px-5 py-4 sm:px-7">
          <Button variant="ghost" onClick={closeSheet}>
            {selected ? 'Cancelar' : 'Fechar'}
          </Button>
          {!photoMode && selected && <Button
            onClick={add}
            disabled={
              !selected ||
              !mealType ||
              !consumedTime ||
              !Number.isFinite(gramsValue) ||
              gramsValue <= 0 ||
              loading
            }
            className="min-w-36"
          >
            {loading ? "Adicionando…" : "Adicionar alimento"}
          </Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Preview({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-3 py-3 shadow-[0_1px_2px_oklch(0.25_0.02_160/.025)] sm:px-4 sm:py-4">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-2 truncate font-display text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
