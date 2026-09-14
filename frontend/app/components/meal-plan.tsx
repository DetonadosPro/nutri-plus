'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  History,
  MoreHorizontal,
  Pencil,
  Utensils,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { formatDateTime } from '@/lib/datetime';
import { formatNumber } from '@/lib/nutrition-format';
import {
  goalPercent,
  moveId,
  nutrientValue,
  preferredPlan,
} from '@/lib/meal-plan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState, ContentSkeleton } from './page-primitives';
import { MeasureInput, gramMeasure, safeGrams } from './measure-input';
import { formatServing, type FoodMeasure } from '../../../shared/food-measures';
import type { Food, MealPlan, MealPlanItem, MealPlanListItem } from '../types';
import { MEAL_TYPES, mealDefinition, type MealType } from '@/lib/meal-types';
import '../meal-plan.css';

function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : 'Não foi possível salvar o plano alimentar.';
}
function PlanTotals({ plan }: { plan: MealPlan }) {
  const metrics = [
    ['Proteína', 'proteina_g', 'protein_g', 'protein'],
    ['Carboidratos', 'carboidrato_g', 'carbohydrate_g', 'carb'],
    ['Gorduras', 'lipideos_g', 'fat_g', 'fat'],
  ] as const;
  const energy = nutrientValue(plan.totals, 'energia_kcal');
  const energyGoal = plan.goals?.energy_kcal;
  const energyPercent = goalPercent(energy, energyGoal);
  return (
    <section
      className="meal-plan-totals"
      aria-label="Resumo nutricional do plano"
    >
      <div className="meal-plan-energy-total">
        <small>Energia do plano</small>
        <strong>
          {formatNumber(energy, 0)} <span>kcal</span>
        </strong>
        {energyGoal != null && (
          <span>
            Meta de {formatNumber(energyGoal, 0)} kcal
            {energyPercent != null
              ? ` · ${formatNumber(energyPercent, 0)}%`
              : ''}
          </span>
        )}
        {energyPercent != null && (
          <div
            className="meal-plan-progress"
            aria-hidden="true"
            data-above={energyPercent > 100}
          >
            <span
              style={{ width: `${Math.min(100, Math.max(0, energyPercent))}%` }}
            />
          </div>
        )}
      </div>
      <div className="meal-plan-macro-list">
        {metrics.map(([label, code, goalKey, tone]) => {
          const value = nutrientValue(plan.totals, code);
          const goal = plan.goals?.[goalKey];
          return (
            <div key={code} data-nutrient={tone}>
              <small>
                <i aria-hidden="true" />
                {label}
              </small>
              <p>
                <strong>{formatNumber(value, 1)} g</strong>
                {goal != null && <span> / {formatNumber(goal, 0)} g</span>}
              </p>
            </div>
          );
        })}
      </div>
      {nutrientValue(plan.totals, 'fibra_alimentar_g') > 0 && (
        <small className="meal-plan-fiber-total">
          Fibras:{' '}
          {formatNumber(nutrientValue(plan.totals, 'fibra_alimentar_g'), 1)} g
        </small>
      )}
    </section>
  );
}

function FoodPicker({
  mealId,
  onSaved,
  onClose,
}: {
  mealId: number;
  onSaved: (plan: MealPlan) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [foods, setFoods] = useState<Food[]>([]),
    [selected, setSelected] = useState<Food | null>(null);
  const [quantity, setQuantity] = useState(''),
    [measure, setMeasure] = useState<FoodMeasure>(gramMeasure),
    [notes, setNotes] = useState(''),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setError('');
    setFoods([]);
    if (!query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(
      () =>
        void api<Food[]>(`/foods?search=${encodeURIComponent(query)}`)
          .then((results) => {
            if (current) setFoods(results);
          })
          .catch((reason) => {
            if (current) setError(errorMessage(reason));
          })
          .finally(() => {
            if (current) setSearching(false);
          }),
      180,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  function pick(food: Food) {
    setSelected(food);
    setMeasure(food.measures?.find((item) => item.isDefault) ?? gramMeasure);
    setQuantity('');
    setError('');
  }
  async function add() {
    if (!selected || safeGrams(quantity, measure) <= 0) return;
    setBusy(true);
    setError('');
    try {
      onSaved(
        await api(`/meal-plan-meals/${mealId}/items`, {
          method: 'POST',
          body: JSON.stringify({
            foodId: selected.id,
            quantity: Number(quantity.replace(',', '.')),
            measureId: measure.id,
            notes: notes.trim() || null,
          }),
        }),
      );
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="meal-plan-picker">
      <div className="meal-plan-picker-head">
        <strong>Adicionar alimento</strong>
        <button aria-label="Fechar busca" disabled={busy} onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      {!selected ? (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar alimento"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busque arroz, leite, omelete…"
              className="pl-9"
            />
          </div>
          <output className="meal-plan-search-status">
            {searching
              ? 'Buscando alimentos…'
              : query.trim() && !foods.length && !error
                ? 'Nenhum alimento encontrado. Tente outro nome.'
                : !query.trim()
                  ? 'Busque no catálogo e escolha a porção.'
                  : ''}
          </output>
          <div className="meal-plan-search-results">
            {foods.slice(0, 8).map((food) => (
              <button key={food.id} onClick={() => pick(food)}>
                <strong>{food.displayName ?? food.description}</strong>
                <small>
                  {formatNumber(food.nutrients.energia_kcal)} kcal/100 g
                </small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="meal-plan-picked">
          <strong>{selected.displayName ?? selected.description}</strong>
          <Label htmlFor={`plan-quantity-${mealId}`}>Quantidade e medida</Label>
          <MeasureInput
            id={`plan-quantity-${mealId}`}
            value={quantity}
            measure={measure}
            measures={selected.measures ?? [gramMeasure]}
            onChange={(value, next) => {
              setQuantity(value);
              setMeasure(next);
            }}
          />
          <Label htmlFor={`plan-item-note-${mealId}`}>
            Observação opcional
          </Label>
          <Input
            id={`plan-item-note-${mealId}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: sem açúcar"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>
              Voltar
            </Button>
            <Button
              disabled={busy || safeGrams(quantity, measure) <= 0}
              onClick={add}
            >
              {busy ? 'Salvando…' : 'Adicionar'}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      )}
    </div>
  );
}

function DraftItem({
  item,
  onSaved,
  onRemoved,
  onMove,
}: {
  item: MealPlanItem;
  onSaved: (plan: MealPlan) => void;
  onRemoved: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const initial = item.measure_snapshot ?? gramMeasure;
  const [quantity, setQuantity] = useState(
      String(item.amount).replace('.', ','),
    ),
    [measure, setMeasure] = useState<FoodMeasure>(initial),
    [notes, setNotes] = useState(item.notes ?? ''),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    if (safeGrams(quantity, measure) <= 0) return;
    setBusy(true);
    setError('');
    try {
      onSaved(
        await api(`/meal-plan-items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            quantity: Number(quantity.replace(',', '.')),
            measureId: measure.id,
            notes: notes.trim() || null,
          }),
        }),
      );
      setEditing(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="meal-plan-item">
      <button
        className="meal-plan-item-summary"
        aria-expanded={editing}
        disabled={busy}
        onClick={() => setEditing((value) => !value)}
      >
        <span>
          <strong>{item.display_name}</strong>
          <span className="meal-plan-portion">{formatServing(item)}</span>
          {item.notes && <small>{item.notes}</small>}
        </span>
        <Pencil className="meal-plan-edit-hint" aria-hidden="true" />
      </button>
      {editing && (
        <div className="meal-plan-item-editor">
          <MeasureInput
            id={`plan-item-${item.id}`}
            value={quantity}
            measure={measure}
            measures={item.measures ?? [gramMeasure]}
            onChange={(value, next) => {
              setQuantity(value);
              setMeasure(next);
            }}
          />
          <Input
            aria-label={`Observação de ${item.display_name}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observação opcional"
          />
          <div className="meal-plan-item-actions">
            <button
              disabled={busy}
              aria-label={`Mover ${item.display_name} para cima`}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </button>
            <button
              disabled={busy}
              aria-label={`Mover ${item.display_name} para baixo`}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </button>
            <button
              disabled={busy}
              aria-label={`Remover ${item.display_name}`}
              onClick={onRemoved}
            >
              <Trash2 />
            </button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setQuantity(String(item.amount).replace('.', ','));
                setMeasure(initial);
                setNotes(item.notes ?? '');
                setError('');
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={busy || safeGrams(quantity, measure) <= 0}
              onClick={save}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      )}
    </article>
  );
}

function PlanContent({
  plan,
  editable,
  onChange,
}: {
  plan: MealPlan;
  editable: boolean;
  onChange?: (plan: MealPlan) => void;
}) {
  const [adding, setAdding] = useState<number | null>(null),
    [choosingMeal, setChoosingMeal] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const change = onChange ?? (() => {});
  async function mutate(path: string, options: RequestInit = {}) {
    setBusy(true);
    setError('');
    try {
      const result = await api<MealPlan>(path, options);
      change(result);
      return result;
    } catch (reason) {
      setError(errorMessage(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function remove(path: string) {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'DELETE' });
      change(await api<MealPlan>(`/meal-plans/${plan.id}`));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function addMeal(mealType: MealType) {
    const result = await mutate(`/meal-plans/${plan.id}/meals`, {
      method: 'POST',
      body: JSON.stringify({ mealType }),
    });
    if (result) setChoosingMeal(false);
  }
  async function moveMeal(mealId: number, direction: -1 | 1) {
    const current = plan.meals.map((meal) => meal.id);
    const ids = moveId(current, mealId, direction);
    if (ids === current) return;
    await mutate(`/meal-plans/${plan.id}/meals/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
  }
  async function moveItem(mealId: number, itemId: number, direction: -1 | 1) {
    const meal = plan.meals.find((m) => m.id === mealId)!;
    const current = meal.items.map((item) => item.id);
    const ids = moveId(current, itemId, direction);
    if (ids === current) return;
    await mutate(`/meal-plan-meals/${mealId}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
  }
  return (
    <div className="meal-plan-content">
      {!plan.meals.length && editable && (
        <div className="meal-plan-first-meal">
          <span className="meal-plan-empty-icon">
            <Utensils />
          </span>
          <h3>Vamos montar este plano?</h3>
          <p>Comece por uma refeição e adicione os alimentos.</p>
        </div>
      )}
      {plan.meals.map((meal, mealIndex) => {
        const Icon = mealDefinition(meal.meal_type).icon;
        return (
          <section
            className="meal-plan-meal"
            data-meal-type={meal.meal_type}
            id={`plan-meal-${meal.id}`}
            key={meal.id}
            aria-labelledby={`plan-meal-title-${meal.id}`}
          >
            <header>
              <span className="meal-plan-meal-icon">
                <Icon aria-hidden="true" />
              </span>
              <div className="meal-plan-meal-heading">
                <h3 id={`plan-meal-title-${meal.id}`}>
                  {mealDefinition(meal.meal_type).label}
                </h3>
                <p>
                  {meal.items.length}{' '}
                  {meal.items.length === 1 ? 'alimento' : 'alimentos'}
                </p>
              </div>
              {editable && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="meal-plan-menu-trigger"
                    aria-label={`Opções de ${mealDefinition(meal.meal_type).label}`}
                    disabled={busy}
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="meal-plan-menu">
                    <DropdownMenuItem
                      aria-label={`Mover ${mealDefinition(meal.meal_type).label} para cima`}
                      disabled={busy || mealIndex === 0}
                      onClick={() => moveMeal(meal.id, -1)}
                    >
                      <ArrowUp /> Mover para cima
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      aria-label={`Mover ${mealDefinition(meal.meal_type).label} para baixo`}
                      disabled={busy || mealIndex === plan.meals.length - 1}
                      onClick={() => moveMeal(meal.id, 1)}
                    >
                      <ArrowDown /> Mover para baixo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      aria-label={`Excluir ${mealDefinition(meal.meal_type).label}`}
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void remove(`/meal-plan-meals/${meal.id}`)}
                    >
                      <Trash2 /> Excluir refeição
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </header>
            <div className="meal-plan-items">
              {meal.items.length ? (
                meal.items.map((item) =>
                  editable ? (
                    <DraftItem
                      key={item.id}
                      item={item}
                      onSaved={change}
                      onMove={(d) => moveItem(meal.id, item.id, d)}
                      onRemoved={() =>
                        void remove(`/meal-plan-items/${item.id}`)
                      }
                    />
                  ) : (
                    <article className="meal-plan-read-item" key={item.id}>
                      <div>
                        <strong>{item.display_name}</strong>
                        <span className="meal-plan-portion">
                          {formatServing(item)}
                        </span>
                        {item.notes && <small>{item.notes}</small>}
                      </div>
                    </article>
                  ),
                )
              ) : (
                <p className="meal-plan-empty-row">
                  Nenhum alimento nesta refeição.
                </p>
              )}
            </div>
            {meal.items.length > 0 && (
              <footer className="meal-plan-meal-nutrition">
                <span>{formatNumber(meal.totals.energia_kcal, 0)} kcal</span>
                <span>
                  {formatNumber(meal.totals.proteina_g, 1)} g proteína
                </span>
              </footer>
            )}
            {editable &&
              (adding === meal.id ? (
                <FoodPicker
                  mealId={meal.id}
                  onSaved={change}
                  onClose={() => setAdding(null)}
                />
              ) : (
                <button
                  className="meal-plan-add-food"
                  onClick={() => setAdding(meal.id)}
                >
                  <Plus /> Adicionar alimento
                </button>
              ))}
          </section>
        );
      })}
      {editable && (
        <section className="meal-plan-add-meal">
          {choosingMeal ? (
            <>
              <div className="meal-plan-picker-head">
                <h3>Qual refeição deseja adicionar?</h3>
                <button
                  aria-label="Fechar opções de refeição"
                  onClick={() => setChoosingMeal(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="meal-plan-type-options">
                {MEAL_TYPES.map((definition) => {
                  const Icon = definition.icon;
                  const alreadyAdded = plan.meals.some(
                    (meal) => meal.meal_type === definition.value,
                  );
                  return (
                    <button
                      key={definition.value}
                      data-meal-type={definition.value}
                      disabled={busy || alreadyAdded}
                      onClick={() => void addMeal(definition.value)}
                    >
                      <Icon aria-hidden="true" />
                      <span>
                        {definition.label}
                        {alreadyAdded && <small>Já adicionada</small>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <Button variant="outline" onClick={() => setChoosingMeal(true)}>
              <Plus /> Adicionar refeição
            </Button>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function NutritionistMealPlan({ patientId }: { patientId: number }) {
  const [plans, setPlans] = useState<MealPlanListItem[]>([]),
    [plan, setPlan] = useState<MealPlan | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [publishOpen, setPublishOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api<MealPlanListItem[]>(
        `/nutritionist/patients/${patientId}/meal-plans`,
      );
      setPlans(list);
      const preferred = preferredPlan(list);
      setPlan(preferred ? await api(`/meal-plans/${preferred.id}`) : null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [patientId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(path: string, method = 'POST', body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const next = await api<MealPlan>(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      setPlan(next);
      await api<MealPlanListItem[]>(
        `/nutritionist/patients/${patientId}/meal-plans`,
      ).then(setPlans);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="meal-plan-page meal-plan-loading" aria-busy="true">
        <output>Carregando plano alimentar…</output>
        <ContentSkeleton rows={3} />
      </div>
    );
  if (!plan)
    return (
      <div className="meal-plan-page meal-plan-welcome">
        <EmptyState
          icon={Utensils}
          title="Este paciente ainda não tem um plano alimentar."
          description="Crie o plano e publique quando estiver pronto."
          action={
            <Button
              disabled={busy || !!error}
              onClick={() =>
                action(`/nutritionist/patients/${patientId}/meal-plans`)
              }
            >
              <Plus /> {busy ? 'Criando…' : 'Criar plano'}
            </Button>
          }
        />
        {error && (
          <p role="alert" className="meal-plan-error">
            {error}{' '}
            <button onClick={() => void load()}>Tentar novamente</button>
          </p>
        )}
      </div>
    );
  const editable = plan.status === 'draft';
  return (
    <div className="meal-plan-page nutritionist-meal-plan">
      <header className="meal-plan-hero">
        <div>
          <h2>Plano alimentar</h2>
          <p className="meal-plan-state" data-draft={editable}>
            {editable
              ? 'Rascunho'
              : plan.status === 'active'
                ? 'Plano atual do paciente'
                : 'Versão anterior · somente leitura'}
          </p>
        </div>
        <div className="meal-plan-actions">
          <Button
            variant="ghost"
            aria-expanded={historyOpen}
            disabled={busy}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History /> Histórico
          </Button>
          {plan.status === 'active' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => action(`/meal-plans/${plan.id}/duplicate`)}
            >
              <Plus /> Nova versão
            </Button>
          )}
          {plan.status === 'archived' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => action(`/meal-plans/${plan.id}/duplicate`)}
            >
              Usar como base
            </Button>
          )}
          {editable && (
            <Button disabled={busy} onClick={() => setPublishOpen(true)}>
              <Check /> Publicar plano
            </Button>
          )}
        </div>
      </header>
      <Dialog
        open={publishOpen}
        onOpenChange={(open) => {
          if (!busy) setPublishOpen(open);
        }}
      >
        <DialogContent
          className="meal-plan-publish-dialog"
          showCloseButton={!busy}
        >
          <span className="meal-plan-empty-icon">
            <Check />
          </span>
          <DialogTitle>Publicar este plano?</DialogTitle>
          <DialogDescription>
            {plans.some((item) => item.status === 'active')
              ? 'O paciente passará a ver este plano. A versão atual será preservada no histórico.'
              : 'O plano ficará disponível para o paciente. Para alterar depois, você poderá criar uma nova versão.'}
          </DialogDescription>
          {error && (
            <p role="alert" className="meal-plan-error">
              {error}
            </p>
          )}
          <div className="meal-plan-publish-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPublishOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await action(`/meal-plans/${plan.id}/publish`))
                  setPublishOpen(false);
              }}
            >
              {busy ? 'Publicando…' : 'Confirmar publicação'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {historyOpen && (
        <section className="meal-plan-history">
          <h3>Histórico de versões</h3>
          {plans.map((item) => (
            <button
              key={item.id}
              aria-current={item.id === plan.id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  setPlan(await api<MealPlan>(`/meal-plans/${item.id}`));
                } catch (reason) {
                  setError(errorMessage(reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span>
                {item.status === 'active'
                  ? 'Plano atual'
                  : item.status === 'draft'
                    ? 'Em edição'
                    : 'Anterior'}
                <small>
                  Versão {item.version}
                  {item.id === plan.id ? ' · visualizando' : ''}
                </small>
              </span>
              <small>
                {item.published_at
                  ? formatDateTime(item.published_at)
                  : formatDateTime(item.updated_at)}
              </small>
            </button>
          ))}
        </section>
      )}
      <div className="meal-plan-workbench">
        <aside className="meal-plan-planning" aria-label="Resumo e orientações">
          <PlanTotals plan={plan} />
          {editable && (
            <details className="meal-plan-metadata" key={plan.id}>
              <summary>Orientações e título do plano</summary>
              <div className="meal-plan-metadata-fields">
                <div>
                  <Label htmlFor="plan-title">Título opcional</Label>
                  <Input
                    id="plan-title"
                    key={plan.title ?? ''}
                    defaultValue={plan.title ?? ''}
                    disabled={busy}
                    onBlur={(e) =>
                      (e.target.value.trim() || null) !==
                        (plan.title ?? null) &&
                      action(`/meal-plans/${plan.id}`, 'PATCH', {
                        title: e.target.value.trim() || null,
                        lockVersion: plan.lock_version,
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="plan-notes">Orientações gerais</Label>
                  <Textarea
                    id="plan-notes"
                    key={plan.notes ?? ''}
                    defaultValue={plan.notes ?? ''}
                    disabled={busy}
                    onBlur={(e) =>
                      (e.target.value.trim() || null) !==
                        (plan.notes ?? null) &&
                      action(`/meal-plans/${plan.id}`, 'PATCH', {
                        notes: e.target.value.trim() || null,
                        lockVersion: plan.lock_version,
                      })
                    }
                  />
                </div>
              </div>
              <span
                className="meal-plan-save-status"
                data-error={Boolean(error)}
                aria-live="polite"
              >
                {error ? 'Alterações não salvas' : busy ? 'Salvando…' : 'Salvo'}
              </span>
            </details>
          )}
          {!editable && plan.notes && <PlanNotes notes={plan.notes} />}
        </aside>
        <PlanContent
          key={plan.id}
          plan={plan}
          editable={editable}
          onChange={setPlan}
        />
      </div>
      {error && (
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      )}
    </div>
  );
}

function PlanNotes({ notes }: { notes: string }) {
  return (
    <section className="meal-plan-patient-note">
      <h3>Orientações do nutricionista</h3>
      <p>{notes}</p>
    </section>
  );
}

export function PatientMealPlan() {
  const [plan, setPlan] = useState<MealPlan | null | undefined>(undefined),
    [error, setError] = useState('');
  useEffect(() => {
    void api<MealPlan | null>('/patient/meal-plan')
      .then(setPlan)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  if (error)
    return (
      <div className="meal-plan-page">
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      </div>
    );
  if (plan === undefined)
    return (
      <div className="meal-plan-page meal-plan-loading" aria-busy="true">
        <output>Carregando plano alimentar…</output>
        <ContentSkeleton rows={3} />
      </div>
    );
  if (!plan)
    return (
      <div className="meal-plan-page meal-plan-welcome">
        <EmptyState
          icon={Utensils}
          title="Seu plano alimentar ainda não está disponível."
          description="Quando estiver pronto, ele aparecerá aqui."
        />
      </div>
    );
  return (
    <div className="meal-plan-page patient-meal-plan">
      <header className="meal-plan-hero">
        <div>
          <h1>Plano alimentar</h1>
          <p>
            Atualizado em{' '}
            {plan.published_at ? formatDateTime(plan.published_at) : '—'}
          </p>
        </div>
      </header>
      <PlanContent plan={plan} editable={false} />
      {plan.notes && <PlanNotes notes={plan.notes} />}
      <details className="meal-plan-patient-summary">
        <summary>
          Resumo nutricional do plano{' '}
          <span>
            {formatNumber(nutrientValue(plan.totals, 'energia_kcal'), 0)} kcal
          </span>
        </summary>
        <PlanTotals plan={plan} />
      </details>
    </div>
  );
}
