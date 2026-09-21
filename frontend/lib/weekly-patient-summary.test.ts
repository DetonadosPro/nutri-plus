import { describe, expect, it } from 'vitest';
import type { WeeklyPatientSummary } from '../app/types';
import { weeklySummaryInsights } from './weekly-patient-summary';

function summary(overrides: Partial<WeeklyPatientSummary> = {}): WeeklyPatientSummary {
  return {
    version: 'weekly-patient-summary-v1',
    from: '2026-09-14',
    to: '2026-09-20',
    timezone: 'America/Sao_Paulo',
    registration: { recordedDays: 5, totalDays: 7 },
    plan: {
      available: true,
      coveredItems: 12,
      plannedItems: 20,
      coveragePercent: 60,
      strongestMeal: {
        mealType: 'lunch',
        coveredItems: 6,
        plannedItems: 7,
        coveragePercent: 86,
      },
      attentionMeal: {
        mealType: 'dinner',
        coveredItems: 2,
        plannedItems: 7,
        coveragePercent: 29,
      },
      quantityDifferences: 1,
      changedDuringPeriod: false,
    },
    activity: { sessions: 2, days: 2 },
    weight: { updatedInPeriod: false, latestKg: 70, weighedAt: '2026-09-10', changeKg: null },
    ...overrides,
  };
}

describe('weekly summary copy', () => {
  it('turns plan evidence into one positive and one attention point', () => {
    const insights = weeklySummaryInsights(summary());
    expect(insights.positive.title).toContain('Almoço');
    expect(insights.attention.title).toContain('Jantar');
    expect(JSON.stringify(insights)).not.toMatch(/nota|ruim|falhou|fracasso/i);
  });

  it('prioritizes lack of records without pretending to analyze the patient', () => {
    const base = summary();
    const insights = weeklySummaryInsights(
      summary({ registration: { recordedDays: 0, totalDays: 7 }, plan: { ...base.plan, available: false } }),
    );
    expect(insights.positive.title).toContain('sem registros');
    expect(insights.attention.detail).toContain('não é possível comparar');
  });
});
