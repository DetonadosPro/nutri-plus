import { describe, expect, it } from 'vitest';
import { buildWeeklyPatientSummary } from './weekly-patient-summary';

function adherence() {
  return {
    from: '2026-09-14',
    to: '2026-09-20',
    planChangedDuringPeriod: false,
    summary: {
      eligiblePlannedItems: 6,
      coveredPlannedItems: 4,
      relevantQuantityDifferences: 1,
    },
    days: [
      {
        recordedItems: 2,
        meals: [
          {
            mealType: 'breakfast' as const,
            planned: true,
            items: [
              { state: 'matched_original', planned: {}, recorded: {} },
              { state: 'planned_not_recorded', planned: {}, recorded: null },
            ],
          },
          {
            mealType: 'lunch' as const,
            planned: true,
            items: [{ state: 'matched_original', planned: {}, recorded: {} }],
          },
        ],
      },
      {
        recordedItems: 1,
        meals: [
          {
            mealType: 'breakfast' as const,
            planned: true,
            items: [
              { state: 'planned_not_recorded', planned: {}, recorded: null },
              { state: 'matched_original', planned: {}, recorded: {} },
            ],
          },
          {
            mealType: 'lunch' as const,
            planned: true,
            items: [{ state: 'matched_substitution', planned: {}, recorded: {} }],
          },
        ],
      },
      ...Array.from({ length: 5 }, () => ({ recordedItems: 0, meals: [] })),
    ],
  };
}

describe('weekly patient summary', () => {
  it('reduces the week to registration, plan, activity and weight signals', () => {
    const result = buildWeeklyPatientSummary(
      adherence(),
      { sessions: 3, days: 2 },
      [
        { weighed_at: '2026-09-19', weight_kg: 70.2 },
        { weighed_at: '2026-09-10', weight_kg: 71 },
      ],
    );

    expect(result).toMatchObject({
      version: 'weekly-patient-summary-v1',
      registration: { recordedDays: 2, totalDays: 7 },
      plan: {
        coveragePercent: 67,
        strongestMeal: { mealType: 'lunch', coveragePercent: 100 },
        attentionMeal: { mealType: 'breakfast', coveragePercent: 50 },
        quantityDifferences: 1,
      },
      activity: { sessions: 3, days: 2 },
      weight: { updatedInPeriod: true, latestKg: 70.2, changeKg: -0.8 },
    });
  });

  it('keeps missing plan and weight data explicit instead of inventing a score', () => {
    const input = adherence();
    input.summary = {
      eligiblePlannedItems: 0,
      coveredPlannedItems: 0,
      relevantQuantityDifferences: 0,
    };
    input.days = Array.from({ length: 7 }, () => ({ recordedItems: 0, meals: [] }));
    const result = buildWeeklyPatientSummary(input, { sessions: 0, days: 0 }, []);

    expect(result.plan).toMatchObject({
      available: false,
      coveragePercent: null,
      strongestMeal: null,
      attentionMeal: null,
    });
    expect(result.weight).toEqual({
      updatedInPeriod: false,
      latestKg: null,
      weighedAt: null,
      changeKg: null,
    });
    expect(result).not.toHaveProperty('score');
  });
});
