'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Copy,
  History,
  Plus,
  Search,
  Trash2,
  Utensils,
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

function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : 'Não foi possível salvar o plano alimentar.';
}
function PlanTotals({ plan }: { plan: MealPlan }) {
  const metrics = [
    ['Energia', 'energia_kcal', 'energy_kcal', 'kcal'],
    ['Proteína', 'proteina_g', 'protein_g', 'g'],
    ['Carboidratos', 'carboidrato_g', 'carbohydrate_g', 'g'],
    ['Gorduras', 'lipideos_g', 'fat_g', 'g'],
    ['Fibras', 'fibra_alimentar_g', 'fiber_g', 'g'],
  ] as const;
  return (
    <section
      className="meal-plan-totals"
      aria-label="Resumo nutricional do plano"
    >
      {metrics.map(([label, code, goalCode, unit]) => {
        const value = nutrientValue(plan.totals, code);
        const goal = plan.goals?.[goalCode] as
          | number
          | null
          | undefined;
        const percent = goalPercent(value, goal);
        return (
          <div key={code}>
            <small>{label}</small>
            <strong>
              {formatNumber(value, 1)} {unit}
            </strong>
            {goal != null && (
              <span>
                {formatNumber(percent, 0)}% da meta · {formatNumber(goal, 1)}{' '}
                {unit}
              </span>
            )}
            {code === 'proteina_g' && plan.goals?.protein_gkg_min_grams != null && (
              <span>
                Mín. por peso: {formatNumber(plan.goals.protein_gkg_min_grams, 1)} g
              </span>
            )}
          </div>
        );
      })}
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
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="meal-plan-item">
      <div>
        <strong>{item.display_name}</strong>
        <small>
          {formatNumber(item.nutrients.energia_kcal, 0)} kcal ·{' '}
          {formatNumber(item.nutrients.proteina_g, 1)} g proteína
        </small>
      </div>
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
        placeholder="Observação"
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
        <Button size="sm" variant="outline" disabled={busy} onClick={save}>
          {busy ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
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
    [mealName, setMealName] = useState(''),
    [mealTime, setMealTime] = useState(''),
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
  async function addMeal() {
    if (!mealName.trim()) return;
    const result = await mutate(`/meal-plans/${plan.id}/meals`, {
      method: 'POST',
      body: JSON.stringify({ name: mealName, time: mealTime || null }),
    });
    if (result) {
      setMealName('');
      setMealTime('');
    }
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
              <small>REFEIÇÃO {meal.position + 1}</small>
              {editable ? (
                <div
                  className="meal-plan-meal-fields"
                  key={`${meal.id}:${meal.name}:${meal.time ?? ''}`}
                >
                  <Input
                    aria-label={`Nome da refeição ${meal.position + 1}`}
                    defaultValue={meal.name}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name && name !== meal.name)
                        void mutate(`/meal-plan-meals/${meal.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ name }),
                        });
                    }}
                  />
                  <Input
                    aria-label={`Horário de ${meal.name}`}
                    type="time"
                    defaultValue={meal.time ?? ''}
                    onBlur={(event) => {
                      const time = event.target.value || null;
                      if (time !== (meal.time ?? null))
                        void mutate(`/meal-plan-meals/${meal.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ time }),
                        });
                    }}
                  />
                </div>
              ) : (
                <>
                  <h3>{meal.name}</h3>
                  {meal.time && (
                    <span>
                      <Clock3 /> {meal.time}
                    </span>
                  )}
                </>
              )}
            </div>
            <strong>
              {formatNumber(meal.totals.energia_kcal, 0)} kcal ·{' '}
              {formatNumber(meal.totals.proteina_g, 1)} g proteína
            </strong>
            {editable && (
              <div>
                <button
                  aria-label={`Mover ${meal.name} para cima`}
                  onClick={() => moveMeal(meal.id, -1)}
                >
                  <ArrowUp />
                </button>
                <button
                  aria-label={`Mover ${meal.name} para baixo`}
                  onClick={() => moveMeal(meal.id, 1)}
                >
                  <ArrowDown />
                </button>
                <button
                  aria-label={`Excluir ${meal.name}`}
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
          <h3>Adicionar refeição</h3>
          <div>
            <Label htmlFor="meal-plan-meal-name">Nome</Label>
            <Input
              id="meal-plan-meal-name"
              value={mealName}
              onChange={(e) => setMealName(e.target.value)}
              placeholder="Ex.: Café da manhã"
            />
          </div>
          <div>
            <Label htmlFor="meal-plan-meal-time">Horário opcional</Label>
            <Input
              id="meal-plan-meal-time"
              type="time"
              value={mealTime}
              onChange={(e) => setMealTime(e.target.value)}
            />
          </div>
          <Button disabled={busy || !mealName.trim()} onClick={addMeal}>
            <Plus /> Adicionar refeição
          </Button>
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
        title="Crie o primeiro plano alimentar deste paciente."
        description="O plano ficará separado do diário e só será visível ao paciente depois da publicação."
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
          <p className="eyebrow">Prescrição alimentar</p>
          <h2>{plan.title || `Plano alimentar v${plan.version}`}</h2>
          <p>
            {editable
              ? 'Rascunho editável'
              : plan.status === 'active'
                ? 'Plano ativo'
                : 'Versão arquivada'}{' '}
            · versão {plan.version}
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
          {!editable && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => action(`/meal-plans/${plan.id}/duplicate`)}
            >
              <Copy /> Duplicar
            </Button>
          )}
          {editable && (
            <Button
              disabled={busy}
              onClick={() => action(`/meal-plans/${plan.id}/publish`)}
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
        <section
          className="meal-plan-metadata"
          key={`${plan.id}:${plan.lock_version}`}
        >
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
          <span className="meal-plan-save-status" aria-live="polite">
            {busy ? 'Salvando…' : 'Alterações salvas'}
          </span>
        </section>
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
        title="Seu plano alimentar ainda não foi publicado."
        description="Quando seu nutricionista publicar a prescrição, ela aparecerá aqui."
      />
    );
  return (
    <div className="meal-plan-page patient-meal-plan">
      <header className="meal-plan-hero">
        <div>
          <p className="eyebrow">Plano alimentar</p>
          <h1>{plan.title || 'Seu plano alimentar'}</h1>
          <p>
            Atualizado em{' '}
            {plan.published_at ? formatDateTime(plan.published_at) : '—'}
          </p>
        </div>
        <Utensils className="size-7" />
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
