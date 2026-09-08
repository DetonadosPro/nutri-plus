'use client';

import {
  ChevronDown,
  Droplets,
  Flame,
  Minus,
  Plus,
  Utensils,
} from 'lucide-react';
import { formatNumber, progressPercent } from '@/lib/nutrition-format';
import {
  normalizedGlycemicClassificationDescription,
  normalizedGlycemicClassificationLabel,
} from '@/lib/glycemic';
import type { Meal, MealEntry, Summary } from '../types';
import { PatientDaySwitcher } from './patient-day-switcher';
import { DailyEnergyCard } from './daily-energy-card';
import { ActivityPanel } from './activity-panel';
import { PatientMealList } from './patient-meal-list';

type PatientDayHomeProps = {
  summary: Summary;
  date: string;
  loading: boolean;
  revealMealRequest?: { mealType: string; token: number } | null;
  onDate: (date: string) => void;
  onAdd: (mealType?: string) => void;
  onEdit: (entry: MealEntry, meal: Meal) => void;
  onDelete: (entryId: number) => void;
  onCopy: (meal: Meal) => void;
  onWater: (value: number) => void;
  onDiary: () => void;
  onProgress: () => void;
};

export function PatientDayHome({
  summary,
  date,
  loading,
  revealMealRequest,
  onDate,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
  onWater,
  onDiary,
  onProgress,
}: PatientDayHomeProps) {
  const goals = summary.goals ?? {};
  const waterMl = summary.log.water_ml ?? 0;
  const weightKg = summary.weight?.weight_kg;
  const waterGoal =
    summary.waterGoalMl ??
    (weightKg != null && weightKg > 0 ? weightKg * 40 : null);
  const glycemic = summary.glycemic;
  const normalizedLoad = glycemic.per1000Kcal ?? glycemic.normalizedGL;
  const classification = glycemic.classification;

  const macros = [
    {
      label: 'Proteína',
      shortLabel: 'P',
      value: summary.totals.proteina_g ?? 0,
      goal: goals.protein_g,
      kcal: summary.energy.proteinKcal,
      kcalPercent: summary.energy.proteinPercent,
      tone: 'protein',
      supporting:
        summary.proteinPerKg == null
          ? null
          : `${formatNumber(summary.proteinPerKg, 2)} g/kg`,
    },
    {
      label: 'Carbo',
      shortLabel: 'C',
      value: summary.totals.carboidrato_g ?? 0,
      goal: goals.carbohydrate_g,
      kcal: summary.energy.carbohydrateKcal,
      kcalPercent: summary.energy.carbohydratePercent,
      tone: 'carb',
      supporting: null,
    },
    {
      label: 'Gordura',
      shortLabel: 'G',
      value: summary.totals.lipideos_g ?? 0,
      goal: goals.fat_g,
      kcal: summary.energy.fatKcal,
      kcalPercent: summary.energy.fatPercent,
      tone: 'fat',
      supporting: null,
    },
  ] as const;

  return (
    <div className="patient-day-home animate-content-in">
      <PatientDaySwitcher
        date={date}
        patientName={String(summary.patient.name ?? '')}
        loading={loading}
        onChange={onDate}
        onProgress={onProgress}
      />

      <div
        className={`patient-day-dashboard day-content-transition${loading ? ' is-loading' : ''}`}
        aria-busy={loading}
      >
        <DailyEnergyCard summary={summary} date={date} />

        <section className="patient-macro-grid" aria-label="Macronutrientes">
          {macros.map((macro) => {
            const over = macro.goal != null && macro.value > macro.goal;
            return (
              <details
                key={macro.label}
                className="patient-macro-card"
                data-tone={macro.tone}
                data-over={over ? 'true' : 'false'}
              >
                <summary aria-label={`Ver detalhes de ${macro.label}`}>
                  <div className="patient-macro-label">
                    <span className="patient-macro-letter" aria-hidden="true">
                      {macro.shortLabel}
                    </span>
                    <span>{macro.label}</span>
                    <ChevronDown className="patient-macro-chevron size-3" />
                  </div>
                  <p>
                    <strong>{formatNumber(macro.value, 1)}</strong>
                    <span>
                      {macro.goal == null
                        ? ' g'
                        : ` / ${formatNumber(macro.goal)} g`}
                    </span>
                  </p>
                  <div className="patient-macro-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${progressPercent(macro.value, macro.goal)}%`,
                      }}
                    />
                  </div>
                  <small>
                    {macro.supporting ??
                      (macro.goal == null
                        ? 'Sem meta'
                        : over
                          ? 'Meta ultrapassada'
                          : `${formatNumber((macro.value / macro.goal) * 100)}% da meta`)}
                  </small>
                </summary>
                <div className="patient-macro-expanded">
                  <span className="patient-macro-kcal-icon">
                    <Flame className="size-3.5" />
                  </span>
                  <div>
                    <small>Energia deste macro</small>
                    <p>
                      <strong>{formatNumber(macro.kcal)}</strong> kcal
                    </p>
                  </div>
                  <div className="patient-macro-energy-share">
                    <strong>{formatNumber(macro.kcalPercent)}%</strong>
                    <small>das kcal calculadas</small>
                  </div>
                </div>
              </details>
            );
          })}
        </section>

        <aside className="patient-day-insights">
          <article className="patient-insight-card glycemic">
            <div className="patient-insight-heading">
              <span className="patient-insight-icon">CG</span>
              <div>
                <p>Carga glicêmica</p>
                <small>por 1.000 kcal</small>
              </div>
            </div>
            <div className="patient-insight-value">
              <strong>{formatNumber(normalizedLoad, 1)}</strong>
              {classification && (
                <span data-level={classification.replace(' ', '-')}>
                  {normalizedGlycemicClassificationLabel[classification]}
                </span>
              )}
            </div>
            <p className="patient-insight-detail">
              {classification
                ? normalizedGlycemicClassificationDescription[classification]
                : glycemic.coveredEntries
                  ? 'Energia insuficiente para normalizar a CG.'
                  : 'Aparece quando houver alimentos com IG disponível.'}
            </p>
          </article>

          <article className="patient-insight-card water">
            <div className="patient-insight-heading">
              <span className="patient-insight-icon">
                <Droplets className="size-[18px]" />
              </span>
              <div>
                <p>Água</p>
                <small>
                  {waterGoal == null ? 'registre seu peso' : 'meta · 40 ml/kg'}
                </small>
              </div>
            </div>
            <div className="patient-water-row">
              <p>
                <strong>{formatNumber(waterMl / 1000, 1)}</strong>
                <span>
                  {waterGoal == null
                    ? ' L · meta indisponível'
                    : ` / ${formatNumber(waterGoal / 1000, 1)} L`}
                </span>
              </p>
              <div className="patient-water-actions">
                <button
                  type="button"
                  onClick={() => onWater(Math.max(0, waterMl - 200))}
                  aria-label="Remover 200 ml"
                  disabled={waterMl <= 0}
                >
                  <Minus className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onWater(waterMl + 200)}
                  aria-label="Adicionar 200 ml"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
            <div className="patient-water-track" aria-hidden="true">
              <span
                style={{
                  width: `${progressPercent(waterMl, waterGoal ?? undefined)}%`,
                }}
              />
            </div>
          </article>
        </aside>

        <section className="patient-meals-section">
          <header className="patient-section-heading">
            <div>
              <p className="patient-section-kicker">Seu dia</p>
              <h2>Refeições</h2>
            </div>
            <button type="button" onClick={onDiary}>
              <Utensils className="size-4" />
              Detalhes do dia
            </button>
          </header>
          <PatientMealList
            summary={summary}
            revealRequest={revealMealRequest}
            onAdd={onAdd}
            onEdit={onEdit}
            onDelete={onDelete}
            onCopy={onCopy}
          />
        </section>

        <ActivityPanel date={date} compact onProgress={onProgress} />
      </div>
    </div>
  );
}
