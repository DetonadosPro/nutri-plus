import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goalPercent, moveId, preferredPlan } from './meal-plan';

const component = readFileSync(
  join(import.meta.dirname, '../app/components/meal-plan.tsx'),
  'utf8',
);
const css = readFileSync(
  join(import.meta.dirname, '../app/globals.css'),
  'utf8',
);

describe('meal plan view model', () => {
  it('prioritizes a draft that can be continued, then the active plan', () => {
    expect(
      preferredPlan([
        { id: 1, version: 1, status: 'active' },
        { id: 2, version: 2, status: 'draft' },
      ])?.id,
    ).toBe(2);
    expect(
      preferredPlan([
        { id: 1, version: 1, status: 'archived' },
        { id: 2, version: 2, status: 'active' },
      ])?.id,
    ).toBe(2);
  });
  it('moves meals and items without losing or duplicating ids', () => {
    expect(moveId([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
  });
  it('calculates informative goal progress without blocking absent goals', () => {
    expect(goalPercent(142, 150)).toBeCloseTo(94.67, 1);
    expect(goalPercent(142, null)).toBeNull();
  });
  it('has the nutritionist empty state and draft creation action', () => {
    expect(component).toContain(
      'Este paciente ainda não tem um plano alimentar.',
    );
    expect(component).toContain('Criar plano alimentar');
  });
  it('adds canonical meals and food through the existing catalog search', () => {
    expect(component).toContain('Adicionar refeição');
    expect(component).toContain('MEAL_TYPES.map');
    expect(component).toContain('body: JSON.stringify({ mealType })');
    expect(component).not.toContain('meal-plan-meal-name');
    expect(component).not.toContain('type="time"');
    expect(component).toContain('/foods?search=');
    expect(component).toContain('Adicionar alimento');
  });
  it('uses MeasureInput for household, volume and count measures', () => {
    expect(component).toContain('<MeasureInput');
    expect(component).toContain('safeGrams');
  });
  it('saves quantity and notes without a page reload', () => {
    expect(component).toMatch(/method:\s*'PATCH'/);
    expect(component).toContain("{busy ? 'Salvando…' : 'Salvo'}");
  });
  it('exposes explicit remove and reorder controls', () => {
    expect(component).toContain('Mover ${item.display_name} para cima');
    expect(component).toContain('Remover ${item.display_name}');
    expect(component).toMatch(/method:\s*'DELETE'/);
  });
  it('shows nutrition totals and goal comparisons', () => {
    expect(component).toContain('Resumo nutricional do plano');
    expect(component).toContain('energyPercent');
    expect(component).toContain("nutrientValue(plan.totals, 'energia_kcal')");
    expect(component).toContain("['Proteína', 'proteina_g', 'g']");
    expect(component).not.toContain('Mín. por peso');
  });
  it('does not expose free-form meal names or schedules', () => {
    expect(component).toContain('mealDefinition(meal.meal_type).label');
    expect(component).not.toContain('Nome da refeição');
    expect(component).not.toContain('Horário');
  });
  it('publishes, duplicates and opens immutable history', () => {
    expect(component).toContain('Publicar plano');
    expect(component).toContain('/duplicate');
    expect(component).toContain('Histórico de versões');
  });
  it('loads the patient read-only endpoint and welcoming empty state', () => {
    expect(component).toMatch(/api<MealPlan\s*\|\s*null>\('\/patient\/meal-plan'\)/);
    expect(component).toContain('Seu plano alimentar ainda não está disponível.');
  });
  it('formats publication timestamps without treating them as calendar-only dates', () => {
    expect(component).toContain('formatDateTime(plan.published_at)');
    expect(component).not.toContain('formatDate(plan.published_at)');
  });
  it('announces errors and saving state accessibly', () => {
    expect(component).toContain('role="alert"');
    expect(component).toContain('aria-live="polite"');
  });
  it('contains narrow mobile and bounded desktop layouts', () => {
    expect(css).toContain('width: min(100%, 58rem)');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('min-height: 44px');
  });
});
