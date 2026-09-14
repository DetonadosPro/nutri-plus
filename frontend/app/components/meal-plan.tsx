'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  History,
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
import { EmptyState } from './page-primitives';
import { MeasureInput, gramMeasure, safeGrams } from './measure-input';
import { formatServing, type FoodMeasure } from '../../../shared/food-measures';
import type { Food, MealPlan, MealPlanItem, MealPlanListItem } from '../types';
import { MEAL_TYPES, mealDefinition, type MealType } from '@/lib/meal-types';

function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : 'Não foi possível salvar o plano alimentar.';
}
function PlanTotals({ plan }: { plan: MealPlan }) {
  const metrics = [
    ['Proteína', 'proteina_g', 'g'],
    ['Carboidratos', 'carboidrato_g', 'g'],
    ['Gorduras', 'lipideos_g', 'g'],
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
        <small>Resumo do plano</small>
        <strong>{formatNumber(energy, 0)} kcal</strong>
        {energyGoal != null && (
          <span>
            de {formatNumber(energyGoal, 0)} kcal
            {energyPercent != null ? ` · ${formatNumber(energyPercent, 0)}%` : ''}
          </span>
        )}
      </div>
      <div className="meal-plan-macro-list">
        {metrics.map(([label, code, unit]) => {
        const value = nutrientValue(plan.totals, code);
        return (
          <div key={code}>
            <small>{label}</small>
            <strong>
              {formatNumber(value, 1)} {unit}
            </strong>
          </div>
        );
      })}
      </div>
      {nutrientValue(plan.totals, 'fibra_alimentar_g') > 0 && (
        <small className="meal-plan-fiber-total">
          Fibras: {formatNumber(nutrientValue(plan.totals, 'fibra_alimentar_g'), 1)} g
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
    [error, setError] = useState('');
  useEffect(() => {
    if (!query.trim()) {
      setFoods([]);
      return;
    }
    const timer = window.setTimeout(
      () =>
        void api<Food[]>(`/foods?search=${encodeURIComponent(query)}`)
          .then(setFoods)
          .catch(() => setFoods([])),
      180,
    );
    return () => window.clearTimeout(timer);
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
        <button aria-label="Fechar busca" onClick={onClose}>
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
        onClick={() => setEditing((value) => !value)}
      >
        <span>
          <strong>{item.display_name}</strong>
          {item.notes && <small>{item.notes}</small>}
        </span>
        <span>{formatServing(item)}</span>
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
              aria-label={`Mover ${item.display_name} para cima`}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </button>
            <button
              aria-label={`Mover ${item.display_name} para baixo`}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </button>
            <button aria-label={`Remover ${item.display_name}`} onClick={onRemoved}>
              <Trash2 />
            </button>
            <Button size="sm" disabled={busy} onClick={save}>
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
      <PlanTotals plan={plan} />
      {plan.meals.map((meal) => (
        <section className="meal-plan-meal" key={meal.id}>
          <header>
            <div>
              <h3>{mealDefinition(meal.meal_type).label}</h3>
            </div>
            <strong>
              {formatNumber(meal.totals.energia_kcal, 0)} kcal ·{' '}
              {formatNumber(meal.totals.proteina_g, 1)} g proteína
            </strong>
            {editable && (
              <div>
                <button
                  aria-label={`Mover ${mealDefinition(meal.meal_type).label} para cima`}
                  onClick={() => moveMeal(meal.id, -1)}
                >
                  <ArrowUp />
                </button>
                <button
                  aria-label={`Mover ${mealDefinition(meal.meal_type).label} para baixo`}
                  onClick={() => moveMeal(meal.id, 1)}
                >
                  <ArrowDown />
                </button>
                <button
                  aria-label={`Excluir ${mealDefinition(meal.meal_type).label}`}
                  disabled={busy}
                  onClick={() => void remove(`/meal-plan-meals/${meal.id}`)}
                >
                  <Trash2 />
                </button>
              </div>
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
                    onRemoved={() => void remove(`/meal-plan-items/${item.id}`)}
                  />
                ) : (
                  <article className="meal-plan-read-item" key={item.id}>
                    <div>
                      <strong>{item.display_name}</strong>
                      {item.notes && <small>{item.notes}</small>}
                    </div>
                    <span>{formatServing(item)}</span>
                  </article>
                ),
              )
            ) : (
              <p className="meal-plan-empty-row">
                Nenhum alimento nesta refeição.
              </p>
            )}
          </div>
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
      ))}
      {editable && (
        <section className="meal-plan-add-meal">
          {choosingMeal ? (
            <>
              <div className="meal-plan-picker-head">
                <h3>Qual refeição deseja adicionar?</h3>
                <button aria-label="Fechar opções de refeição" onClick={() => setChoosingMeal(false)}>
                  <X className="size-4" />
                </button>
              </div>
              <div className="meal-plan-type-options">
                {MEAL_TYPES.map((definition) => {
                  const alreadyAdded = plan.meals.some(
                    (meal) => meal.meal_type === definition.value,
                  );
                  return (
                    <button
                      key={definition.value}
                      disabled={busy || alreadyAdded}
                      onClick={() => void addMeal(definition.value)}
                    >
                      {definition.label}
                      {alreadyAdded && <small>Já adicionada</small>}
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
    [historyOpen, setHistoryOpen] = useState(false);
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
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return <div className="meal-plan-loading">Carregando plano alimentar…</div>;
  if (!plan)
    return (
      <EmptyState
        title="Este paciente ainda não tem um plano alimentar."
        description="Crie o plano e publique quando estiver pronto."
        action={
          <Button
            onClick={() =>
              action(`/nutritionist/patients/${patientId}/meal-plans`)
            }
          >
            <Plus /> Criar plano alimentar
          </Button>
        }
      />
    );
  const editable = plan.status === 'draft';
  return (
    <div className="meal-plan-page">
      <header className="meal-plan-hero">
        <div>
          <p className="eyebrow">Prescrição</p>
          <h2>Plano alimentar</h2>
          <p>
            {editable
              ? 'Rascunho'
              : plan.status === 'active'
                ? 'Plano atual do paciente'
                : 'Versão anterior'}
          </p>
        </div>
        <div className="meal-plan-actions">
          <Button variant="outline" onClick={() => setHistoryOpen((v) => !v)}>
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
            <Button
              disabled={busy}
              onClick={() => {
                const replacesCurrent = plans.some((item) => item.status === 'active');
                const message = replacesCurrent
                  ? 'Publicar este plano? A versão atual do paciente será arquivada.'
                  : 'Publicar este plano? A versão atual ficará disponível para o paciente.';
                if (window.confirm(message))
                  void action(`/meal-plans/${plan.id}/publish`);
              }}
            >
              <Check /> Publicar plano
            </Button>
          )}
        </div>
      </header>
      {historyOpen && (
        <section className="meal-plan-history">
          <h3>Histórico de versões</h3>
          {plans.map((item) => (
            <button
              key={item.id}
              aria-current={item.id === plan.id}
              onClick={() =>
                void api<MealPlan>(`/meal-plans/${item.id}`).then(setPlan)
              }
            >
              <span>
                v{item.version} ·{' '}
                {item.status === 'active'
                  ? 'ativo'
                  : item.status === 'draft'
                    ? 'rascunho'
                    : 'arquivado'}
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
      {editable && (
        <details
          className="meal-plan-metadata"
          key={`${plan.id}:${plan.lock_version}`}
        >
          <summary>Orientações e título do plano</summary>
          <div className="meal-plan-metadata-fields">
            <div>
              <Label htmlFor="plan-title">Título opcional</Label>
              <Input
                id="plan-title"
                defaultValue={plan.title ?? ''}
                onBlur={(e) =>
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
                defaultValue={plan.notes ?? ''}
                onBlur={(e) =>
                  action(`/meal-plans/${plan.id}`, 'PATCH', {
                    notes: e.target.value.trim() || null,
                    lockVersion: plan.lock_version,
                  })
                }
              />
            </div>
          </div>
          <span className="meal-plan-save-status" aria-live="polite">
            {busy ? 'Salvando…' : 'Salvo'}
          </span>
        </details>
      )}
      <PlanContent plan={plan} editable={editable} onChange={setPlan} />
      {error && (
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      )}
    </div>
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
  if (plan === undefined)
    return <div className="meal-plan-loading">Carregando plano alimentar…</div>;
  if (!plan)
    return (
      <EmptyState
        title="Seu plano alimentar ainda não está disponível."
        description="Quando estiver pronto, ele aparecerá aqui."
      />
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
      {plan.notes && <p className="meal-plan-patient-note">{plan.notes}</p>}
      <PlanContent plan={plan} editable={false} />
      {error && (
        <p role="alert" className="meal-plan-error">
          {error}
        </p>
      )}
    </div>
  );
}
