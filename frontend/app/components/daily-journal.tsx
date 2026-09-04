'use client';

import {
  ChevronDown,
  Copy,
  FlaskConical,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Utensils,
} from 'lucide-react';
import type { Meal, MealEntry, Summary } from '../types';
import { timeFromTimestamp } from '@/lib/datetime';
import { formatNumber } from '@/lib/nutrition-format';
import { mealDefinition } from '@/lib/meal-types';
import {
  normalizedGlycemicClassificationDescription,
  normalizedGlycemicClassificationLabel,
} from '@/lib/glycemic';
import { EmptyState, Metric, SectionHeader } from './page-primitives';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NutrientDetails } from './nutrient-details';

export function NutritionSummary({
  summary,
  compact = false,
  narrow = false,
  home = false,
}: {
  summary: Summary;
  compact?: boolean;
  narrow?: boolean;
  home?: boolean;
}) {
  const goals = summary.goals ?? {};
  const proteinValue = (
    <>
      {formatNumber(summary.totals.proteina_g, 1)} g
      <span className="ml-2 inline-block align-baseline text-[0.75em] font-medium text-muted-foreground">
        ·{' '}
        {summary.proteinPerKg == null
          ? '—'
          : formatNumber(summary.proteinPerKg, 2)}{' '}
        g/kg
      </span>
    </>
  );
  const standardItems: Array<{
    label: string;
    value: React.ReactNode;
    detail: string;
    tone: 'neutral' | 'sage' | 'amber' | 'blue';
  }> = [
    {
      label: 'Energia',
      value: `${formatNumber(summary.totals.energia_kcal)} kcal`,
      detail: goals.energy_kcal
        ? `de ${formatNumber(goals.energy_kcal)} kcal`
        : 'Sem meta definida',
      tone: 'sage',
    },
    {
      label: 'Proteína',
      value: proteinValue,
      detail: goals.protein_g
        ? `meta ${formatNumber(goals.protein_g)} g`
        : 'Sem meta definida',
      tone: 'blue',
    },
    {
      label: 'Carboidratos',
      value: `${formatNumber(summary.totals.carboidrato_g, 1)} g`,
      detail: goals.carbohydrate_g
        ? `de ${formatNumber(goals.carbohydrate_g)} g`
        : 'Sem meta definida',
      tone: 'amber',
    },
    {
      label: 'Gorduras',
      value: `${formatNumber(summary.totals.lipideos_g, 1)} g`,
      detail: goals.fat_g
        ? `de ${formatNumber(goals.fat_g)} g`
        : 'Sem meta definida',
      tone: 'neutral',
    },
  ];
  const items = home
    ? [
        {
          ...standardItems[1],
          value: `${formatNumber(summary.totals.proteina_g, 1)} g`,
        },
        {
          label: 'Proteína/kg',
          value:
            summary.proteinPerKg == null
              ? '— g/kg'
              : `${formatNumber(summary.proteinPerKg, 2)} g/kg`,
          detail: summary.weight?.weight_kg
            ? `peso de ${formatNumber(summary.weight.weight_kg, 1)} kg`
            : 'Sem peso registrado',
          tone: 'blue' as const,
        },
        standardItems[2],
        standardItems[3],
      ]
    : standardItems;
  return (
    <>
      <div
        className={`metric-grid ${compact ? 'metric-grid-compact' : ''} ${narrow ? 'metric-grid-narrow' : ''}`}
      >
        {items.map((item) => (
          <Metric key={item.label} {...item} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MacroEnergyBreakdown summary={summary} />
        <DailyGlycemicSummary summary={summary} />
      </div>
    </>
  );
}

export function MacroEnergyBreakdown({ summary }: { summary: Summary }) {
  const items = [
    [
      'Proteínas',
      summary.energy.proteinKcal,
      summary.energy.proteinPercent,
      'blue',
    ],
    [
      'Carboidratos',
      summary.energy.carbohydrateKcal,
      summary.energy.carbohydratePercent,
      'amber',
    ],
    ['Gorduras', summary.energy.fatKcal, summary.energy.fatPercent, 'neutral'],
  ] as const;
  return (
    <section className="macro-energy-card rounded-2xl border bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold">Energia por macronutriente</p>
        <p className="text-xs text-muted-foreground">Cálculo 4/4/9</p>
      </div>
      <div className="macro-energy-grid mt-3 grid">
        {items.map(([label, kcal, percent, tone]) => (
          <div
            key={label}
            className="macro-energy-item min-w-0 px-1.5 py-2 first:pt-0 last:pb-0"
          >
            <p className="truncate text-xs text-muted-foreground">{label}</p>
            <p
              className={`mt-1 font-display text-base font-semibold leading-tight ${tone === 'blue' ? 'text-[#5b9aaa]' : tone === 'amber' ? 'text-[#b7791f]' : ''}`}
            >
              <span className="inline-flex max-w-full items-baseline whitespace-nowrap">
                <span>{formatNumber(kcal)} kcal</span>
                <span className="ml-1 text-[0.68em] font-medium text-muted-foreground">
                  · {formatNumber(percent)}%
                </span>
              </span>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DailyGlycemicSummary({ summary }: { summary: Summary }) {
  const glycemic = summary.glycemic ?? {
    index: null,
    load: null,
    rawGL: null,
    totalKcal: null,
    normalizedGL: null,
    per1000Kcal: null,
    classification: null,
    coveredEntries: 0,
    unavailableEntries: 0,
  };
  const unavailable = glycemic.unavailableEntries;
  const detail = unavailable
    ? `${unavailable} ${unavailable === 1 ? 'alimento sem IG/CG' : 'alimentos sem IG/CG'}`
    : glycemic.coveredEntries
      ? `${glycemic.coveredEntries} ${glycemic.coveredEntries === 1 ? 'alimento calculado' : 'alimentos calculados'}`
      : 'Sem carboidratos com IG disponível';
  const classification = glycemic.classification;
  const classificationLabel = classification
    ? normalizedGlycemicClassificationLabel[classification]
    : null;
  const classificationDescription = classification
    ? normalizedGlycemicClassificationDescription[classification]
    : null;
  const rawLoad = glycemic.rawGL ?? glycemic.load;
  const normalizedLoad = glycemic.per1000Kcal ?? glycemic.normalizedGL;
  const normalizedUnavailable =
    rawLoad == null
      ? detail
      : glycemic.totalKcal == null || glycemic.totalKcal <= 0
        ? 'Energia insuficiente para normalizar a CG'
        : 'CG ajustada pela energia consumida';
  return (
    <section className="rounded-2xl border bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold">Impacto glicêmico diário</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            CG / 1.000 kcal
            <span
              title="Carga glicêmica por 1.000 kcal. Ajusta a carga glicêmica total pela quantidade de energia consumida no dia, permitindo comparar dias com diferentes ingestões calóricas."
              aria-label="Sobre a carga glicêmica por 1.000 kcal"
              className="inline-flex cursor-help"
            >
              <Info className="size-3.5" />
            </span>
          </p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums text-[#b7791f] sm:text-2xl">
            {normalizedLoad == null ? (
              '—'
            ) : (
              <>
                {formatNumber(normalizedLoad, 1)}{' '}
                <span className="text-[0.58em] font-medium text-muted-foreground">
                  / 1.000 kcal
                </span>
              </>
            )}
          </p>
        </div>
        {classificationLabel && (
          <span
            className="glycemic-classification"
            data-level={classification?.replace(' ', '-')}
            title={classificationDescription ?? undefined}
          >
            {classificationLabel}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {classificationDescription ?? normalizedUnavailable}
      </p>
      {(glycemic.index != null || rawLoad != null) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {glycemic.index != null && (
            <span>IG médio: {formatNumber(glycemic.index, 1)}</span>
          )}
          {rawLoad != null && (
            <span>
              CG total: {formatNumber(rawLoad, 1)}
              {glycemic.totalKcal != null &&
                ` · ${formatNumber(glycemic.totalKcal)} kcal`}
            </span>
          )}
        </div>
      )}
      {classification && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Faixas exibidas como referência nutricional, não como diagnóstico
          clínico.
        </p>
      )}
    </section>
  );
}

export function DailyNutrientComposition({ summary }: { summary: Summary }) {
  const entryCount = summary.meals.reduce(
    (total, meal) => total + meal.entries.length,
    0,
  );
  const availableCount = summary.nutrientCatalog.filter(
    (item) => summary.totals[item.code] != null,
  ).length;
  return (
    <details className="daily-nutrient-disclosure group">
      <summary>
        <span className="daily-nutrient-icon">
          <FlaskConical className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <strong>Composição nutricional do dia</strong>
          <small>
            Macros, minerais, vitaminas e demais componentes consumidos
          </small>
        </span>
        <span className="daily-nutrient-count">
          {entryCount
            ? `${availableCount} de ${summary.nutrientCatalog.length}`
            : 'Sem registros'}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="daily-nutrient-content">
        {entryCount ? (
          <NutrientDetails
            values={summary.totals}
            catalog={summary.nutrientCatalog}
            title="Totais consumidos no dia"
            description="Soma de todos os alimentos registrados nesta data, considerando as quantidades consumidas."
          />
        ) : (
          <p className="py-5 text-sm leading-relaxed text-muted-foreground">
            A composição detalhada ficará disponível assim que houver algum
            alimento registrado nesta data.
          </p>
        )}
      </div>
    </details>
  );
}

type JournalProps = {
  summary: Summary;
  onAdd?: (mealType?: string) => void;
  onEdit?: (entry: MealEntry, meal: Meal) => void;
  onDelete?: (entryId: number) => void;
  onCopy?: (meal: Meal) => void;
  dense?: boolean;
};

export function MealTimeline({
  summary,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
  dense = false,
}: JournalProps) {
  if (!summary.meals.length)
    return (
      <EmptyState
        icon={Utensils}
        title="Este dia ainda está em branco"
        description="Nenhum alimento foi registrado. Comece pela refeição que fizer sentido para você."
        action={
          onAdd ? (
            <Button onClick={() => onAdd()}>
              <Plus />
              Adicionar alimento
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <div className={`meal-timeline ${dense ? 'meal-timeline-dense' : ''}`}>
      {summary.meals.map((meal) => {
        const definition = mealDefinition(meal.meal_type);
        const MealIcon = definition.icon;
        const time =
          timeFromTimestamp(meal.eaten_at) ||
          timeFromTimestamp(meal.entries[0]?.consumed_at);
        return (
          <article key={meal.id} className="meal-group">
            <header className="meal-group-header">
              <span className="meal-icon">
                <MealIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="meal-title">
                    {meal.label || definition.label}
                  </h3>
                  {time && <time className="meal-time">{time}</time>}
                </div>
                <p className="meal-subtitle">
                  {formatNumber(meal.totals.energia_kcal)} kcal ·{' '}
                  {formatNumber(meal.totals.proteina_g, 1)} g proteína
                </p>
              </div>
              {onCopy && (
                <button
                  className="icon-button subtle"
                  onClick={() => onCopy(meal)}
                  aria-label={`Repetir ${meal.label}`}
                >
                  <Copy className="size-4" />
                </button>
              )}
            </header>
            <div className="meal-entries">
              {meal.entries.map((entry) => (
                <div key={entry.id} className="meal-entry">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="meal-entry-title">{entry.description}</p>
                      {entry.consumed_at && (
                        <time className="meal-entry-time">
                          {timeFromTimestamp(entry.consumed_at)}
                        </time>
                      )}
                    </div>
                    <p className="meal-entry-meta">
                      {formatNumber(entry.grams_equivalent)} g ·{' '}
                      {formatNumber(entry.nutrients.energia_kcal)} kcal ·{' '}
                      {formatNumber(entry.nutrients.proteina_g, 1)} g proteína
                    </p>
                  </div>
                  {(onEdit || onDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="icon-button subtle"
                        aria-label={`Ações de ${entry.description}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onEdit && (
                          <DropdownMenuItem onClick={() => onEdit(entry, meal)}>
                            <Pencil />
                            Editar registro
                          </DropdownMenuItem>
                        )}
                        {onDelete && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onDelete(entry.id)}
                          >
                            <Trash2 />
                            Excluir
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
            {onAdd && (
              <button
                className="meal-add"
                onClick={() => onAdd(meal.meal_type)}
              >
                <Plus className="size-3.5" />
                Adicionar a{' '}
                {String(meal.label || definition.label).toLowerCase()}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function DailyJournal({
  summary,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
  dense,
}: JournalProps) {
  const entries = summary.meals.reduce(
    (total, meal) => total + meal.entries.length,
    0,
  );
  const description = `${entries} ${entries === 1 ? 'alimento' : 'alimentos'} em ${summary.meals.length} ${summary.meals.length === 1 ? 'refeição' : 'refeições'}`;
  return (
    <section className="min-w-0">
      <SectionHeader
        title="Refeições"
        description={description}
        action={
          onAdd ? (
            <Button variant="outline" onClick={() => onAdd()}>
              <Plus />
              Adicionar
            </Button>
          ) : undefined
        }
      />
      <MealTimeline
        summary={summary}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
        onCopy={onCopy}
        dense={dense}
      />
      <DailyNutrientComposition summary={summary} />
    </section>
  );
}
