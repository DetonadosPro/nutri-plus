'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Heart,
  Layers3,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { formatNumber } from '@/lib/nutrition-format';
import { MEAL_TYPES, type MealType } from '@/lib/meal-types';
import type { Food, NutrientCatalogItem, Summary } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FoodPhotoReview } from './food-photo-review';
import { foodDisplayName } from '@/lib/food-name';

type Picked = { food: Food; grams: string; measure: import('../../../shared/food-measures').FoodMeasure };
import { MeasureInput, gramMeasure, safeGrams } from './measure-input';

export function FoodEntrySheet({
  open,
  onOpenChange,
  date,
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
  const [search, setSearch] = useState('');
  const [foods, setFoods] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mealType, setMealType] = useState<MealType | ''>('');
  const [error, setError] = useState('');
  const fixedMeal =
    MEAL_TYPES.find((item) => item.value === initialMealType) ?? null;

  useEffect(() => {
    if (!open) return;
    setPhotoMode(Boolean(initialPhoto));
    setError('');
    setMealType(
      MEAL_TYPES.some((item) => item.value === initialMealType)
        ? (initialMealType as MealType)
        : '',
    );
  }, [open, initialMealType, initialPhoto]);

  useEffect(() => {
    if (!open || photoMode) return;
    setSearchLoading(true);
    const timer = window.setTimeout(
      () =>
        api<Food[]>(
          `/foods?search=${encodeURIComponent(search)}&favorites=${favoritesOnly}`,
        )
          .then(setFoods)
          .catch(() => setFoods([]))
          .finally(() => setSearchLoading(false)),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [search, favoritesOnly, open, photoMode]);

  const ids = useMemo(
    () => new Set(picked.map((item) => item.food.id)),
    [picked],
  );
  const quantitiesValid =
    picked.length > 0 &&
    picked.every(
      (item) => safeGrams(item.grams, item.measure) > 0,
    );
  const totals = useMemo(
    () =>
      picked.reduce(
        (sum, item) => {
          const factor = safeGrams(item.grams, item.measure) / 100;
          if (!(factor > 0)) return sum;
          sum.energy += (item.food.nutrients.energia_kcal ?? 0) * factor;
          sum.protein += (item.food.nutrients.proteina_g ?? 0) * factor;
          sum.carb += (item.food.nutrients.carboidrato_g ?? 0) * factor;
          sum.fat += (item.food.nutrients.lipideos_g ?? 0) * factor;
          return sum;
        },
        { energy: 0, protein: 0, carb: 0, fat: 0 },
      ),
    [picked],
  );

  function reset() {
    setSearch('');
    setFoods([]);
    setPicked([]);
    setReviewing(false);
    setPhotoMode(false);
    setFavoritesOnly(false);
    setMealType('');
    setError('');
  }
  function close() {
    reset();
    onOpenChange(false);
  }
  function toggle(food: Food) {
    setPicked((items) =>
      items.some((item) => item.food.id === food.id)
        ? items.filter((item) => item.food.id !== food.id)
        : items.length < 20
          ? [...items, { food, grams: '', measure: food.measures?.find(m => m.isDefault) ?? gramMeasure }]
          : items,
    );
  }
  function grams(foodId: number, value: string, measure: Picked["measure"]) {
    setPicked((items) =>
      items.map((item) =>
        item.food.id === foodId ? { ...item, grams: value, measure } : item,
      ),
    );
  }
  function beginReview() {
    setReviewing(true);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function favorite(food: Food) {
    const result = await api<{ favorite: boolean }>(`/favorites/${food.id}`, {
      method: 'POST',
    });
    setFoods((items) =>
      items.map((item) =>
        item.id === food.id ? { ...item, favorite: result.favorite } : item,
      ),
    );
  }
  async function add() {
    if (!mealType || !quantitiesValid) return;
    setLoading(true);
    setError('');
    try {
      const summary = await api<Summary>('/meals', {
        method: 'POST',
        body: JSON.stringify({
          date,
          mealType,
          items: picked.map((item) => ({
            foodId: item.food.id,
            quantity: Number(item.grams.replace(',', '.')),
            measureId: item.measure.id,
          })),
        }),
      });
      await onAdded(summary);
      close();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível adicionar os alimentos.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="food-entry-sheet left-0 right-0 h-[96dvh] max-h-[96dvh] w-full translate-x-0 gap-0 overflow-hidden rounded-t-[28px] border-x sm:data-[side=bottom]:inset-auto sm:data-[side=bottom]:left-1/2 sm:data-[side=bottom]:top-1/2 sm:data-[side=bottom]:h-[min(720px,calc(100dvh-3rem))] sm:data-[side=bottom]:max-h-[calc(100dvh-3rem)] sm:data-[side=bottom]:w-[min(56rem,calc(100vw-2rem))] sm:data-[side=bottom]:max-w-none sm:data-[side=bottom]:[transform:translate(-50%,-50%)] sm:rounded-[28px] sm:border"
      >
        <SheetHeader className="food-entry-header relative border-b px-5 py-5 pr-16 sm:px-7 sm:pr-16">
          <button
            type="button"
            onClick={close}
            aria-label="Fechar registro de alimentos"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
          <div className="food-entry-title-row">
            <span>
              <Layers3 className="size-5" />
            </span>
            <div>
              <SheetTitle className="font-display text-xl font-semibold">
                {photoMode
                  ? 'Reconhecer por foto'
                  : reviewing
                    ? 'Quantidades e refeição'
                    : 'Registrar alimentos'}
              </SheetTitle>
              <SheetDescription>
                {photoMode
                  ? 'Revise o reconhecimento antes de registrar.'
                  : reviewing
                    ? 'Informe a quantidade de cada alimento selecionado.'
                    : 'Escolha todos os alimentos desta refeição.'}
              </SheetDescription>
            </div>
          </div>
          {!photoMode && (
            <div className="food-entry-steps">
              <span data-active={!reviewing}>
                <b>1</b> Escolher alimentos
              </span>
              <i />
              <span data-active={reviewing}>
                <b>2</b> Informar quantidades
              </span>
            </div>
          )}
        </SheetHeader>
        <div ref={scrollRef} className="food-entry-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {photoMode ? (
            <FoodPhotoReview
              date={date}
              initialMealType={initialMealType}
              initialPhoto={initialPhoto}
              onBack={() => setPhotoMode(false)}
              onAdded={onAdded}
            />
          ) : reviewing ? (
            <div className="food-batch-review animate-content-in">
              <button
                className="secondary-action -ml-2"
                onClick={() => setReviewing(false)}
              >
                <ArrowLeft className="size-4" /> Alterar seleção
              </button>
              <div className="food-batch-heading">
                <div>
                  <small>REVISÃO DA REFEIÇÃO</small>
                  <h3>
                    {picked.length}{' '}
                    {picked.length === 1
                      ? 'alimento selecionado'
                      : 'alimentos selecionados'}
                  </h3>
                </div>
                <span>Preencha todas as quantidades</span>
              </div>
              <div className="food-batch-items">
                {picked.map((item, index) => (
                  <article className="food-batch-item" key={item.food.id}>
                    <span className="food-batch-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="food-batch-info">
                      <p>{foodDisplayName(item.food)}</p>
                      <small>
                        {item.food.category || 'Grupo não informado'} ·{' '}
                        {formatNumber(item.food.nutrients.energia_kcal)}{' '}
                        kcal/100 g
                      </small>
                    </div>
                    <div className="food-grams-field">
                      <Label htmlFor={`grams-${item.food.id}`}>
                        Quantidade
                      </Label>
                      <MeasureInput id={`grams-${item.food.id}`} value={item.grams} measure={item.measure}
                        measures={item.food.measures ?? [gramMeasure]} onChange={(value, measure) => grams(item.food.id,value,measure)} />
                    </div>
                    <div className="food-batch-energy">
                      <small>Porção</small>
                      <strong>
                        {formatNumber(
                          safeGrams(item.grams, item.measure) > 0 &&
                            item.food.nutrients.energia_kcal != null
                            ? (item.food.nutrients.energia_kcal *
                                safeGrams(item.grams, item.measure)) /
                                100
                            : null,
                        )}{' '}
                        kcal
                      </strong>
                    </div>
                    <button
                      className="food-batch-remove"
                      onClick={() => toggle(item.food)}
                      aria-label={`Remover ${foodDisplayName(item.food)}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </article>
                ))}
              </div>
              <section className="food-batch-settings">
                <div className="food-batch-settings-heading">
                  <div>
                    <small>REFEIÇÃO</small>
                    <h3>Qual foi a refeição?</h3>
                  </div>
                  <Layers3 className="size-5" />
                </div>
                {fixedMeal ? (
                  <div className="food-fixed-meal">
                    <fixedMeal.icon className="size-5" />
                    <span>
                      <small>Refeição selecionada</small>
                      <strong>{fixedMeal.label}</strong>
                    </span>
                    <Check className="ml-auto size-4" />
                  </div>
                ) : (
                  <fieldset>
                    <legend>Em qual refeição?</legend>
                    <div className="meal-picker">
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
                            {mealType === meal.value && (
                              <Check className="ml-auto size-3.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </section>
              <div className="food-batch-totals">
                <Preview
                  tone="energy"
                  label="Energia"
                  value={`${formatNumber(totals.energy)} kcal`}
                />
                <Preview
                  tone="protein"
                  label="Proteína"
                  value={`${formatNumber(totals.protein, 1)} g`}
                />
                <Preview
                  tone="carb"
                  label="Carboidrato"
                  value={`${formatNumber(totals.carb, 1)} g`}
                />
                <Preview
                  tone="fat"
                  label="Gordura"
                  value={`${formatNumber(totals.fat, 1)} g`}
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-destructive/8 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="food-batch-search animate-content-in">
              <div className="food-search-hero">
                <div>
                  <small>MONTE SUA REFEIÇÃO</small>
                  <h3>O que você comeu?</h3>
                  <p>Escolha até 20 alimentos e informe as quantidades depois.</p>
                </div>
                <Button variant="outline" onClick={() => setPhotoMode(true)}>
                  <Sparkles /> Reconhecer por foto
                </Button>
              </div>
              <div className="food-search-row flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="food-search-input h-14 rounded-2xl bg-white pl-10 pr-10"
                    placeholder="Busque arroz, feijão, frango…"
                  />
                  {search && (
                    <button
                      className="food-search-clear"
                      onClick={() => setSearch('')}
                      aria-label="Limpar busca"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <button
                  className={`icon-button border ${favoritesOnly ? 'text-rose-600' : 'subtle'}`}
                  aria-pressed={favoritesOnly}
                  aria-label="Mostrar somente favoritos"
                  onClick={() => setFavoritesOnly((v) => !v)}
                >
                  <Heart
                    className={`size-4 ${favoritesOnly ? 'fill-current' : ''}`}
                  />
                </button>
              </div>
              {picked.length > 0 && (
                <div className="food-selected-strip">
                  <div>
                    <Layers3 className="size-4" />
                    <strong>
                      {picked.length} selecionado
                      {picked.length === 1 ? '' : 's'}
                    </strong>
                    <span>Continue buscando ou avance.</span>
                  </div>
                  <button onClick={() => setPicked([])}>Limpar seleção</button>
                </div>
              )}
              <div className="food-result-heading">
                <p>
                  {favoritesOnly
                    ? 'Favoritos'
                    : search
                      ? 'Resultados'
                      : 'Recentes e favoritos'}
                </p>
                {!searchLoading && foods.length > 0 && (
                  <span>{foods.length} encontrados</span>
                )}
              </div>
              <div className="food-result-list">
                {foods.map((food) => {
                  const selected = ids.has(food.id);
                  return (
                    <div
                      className="food-result-row"
                      data-selected={selected}
                      key={food.id}
                    >
                      <button
                        className="food-result-select"
                        aria-pressed={selected}
                        onClick={() => toggle(food)}
                      >
                        <span className="food-result-check">
                          {selected ? <Check className="size-4" /> : <i />}
                        </span>
                        <span>
                          <strong>{foodDisplayName(food)}</strong>
                          <small>
                            {food.category || 'Grupo não informado'} ·{' '}
                            {formatNumber(food.nutrients.energia_kcal)} kcal/100
                            g
                          </small>
                        </span>
                        <em>{selected ? 'Selecionado' : 'Adicionar'}</em>
                      </button>
                      <button
                        className={`food-result-favorite ${food.favorite ? 'is-favorite' : ''}`}
                        onClick={() => favorite(food)}
                        aria-label={
                          food.favorite
                            ? 'Remover dos favoritos'
                            : 'Adicionar aos favoritos'
                        }
                      >
                        <Heart
                          className={`size-4 ${food.favorite ? 'fill-current' : ''}`}
                        />
                      </button>
                    </div>
                  );
                })}
                {searchLoading && (
                  <div className="food-search-state">Buscando alimentos…</div>
                )}
                {!searchLoading && !foods.length && (
                  <div className="food-search-state">
                    <Search className="size-5" />
                    <strong>Nenhum alimento encontrado</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <SheetFooter className="food-entry-footer flex-row items-center justify-between border-t bg-popover px-5 py-4 sm:px-7">
          <Button
            variant="ghost"
            onClick={reviewing ? () => setReviewing(false) : close}
          >
            {reviewing ? 'Voltar' : 'Fechar'}
          </Button>
          {!photoMode && !reviewing && (
            <Button
              onClick={beginReview}
              disabled={!picked.length}
            >
              Informar quantidades {picked.length > 0 && `(${picked.length})`}
            </Button>
          )}
          {!photoMode && reviewing && (
            <Button
              onClick={add}
              disabled={
                !mealType || !quantitiesValid || loading
              }
            >
              {loading
                ? 'Adicionando…'
                : `Adicionar ${picked.length} ${picked.length === 1 ? 'alimento' : 'alimentos'}`}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Preview({
  tone,
  label,
  value,
}: {
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <div data-tone={tone}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
