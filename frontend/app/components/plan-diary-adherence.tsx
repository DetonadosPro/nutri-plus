'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ClipboardCheck, Info } from 'lucide-react';
import { api } from '@/lib/client-api';
import { addDays, brazilNow, formatDate } from '@/lib/datetime';
import { mealDefinition } from '@/lib/meal-types';
import type { AdherenceItem, PlanDiaryAdherence } from '../types';
import { ContentSkeleton, EmptyState } from './page-primitives';
import '../adherence.css';

function portion(item: NonNullable<AdherenceItem['planned'] | AdherenceItem['recorded']>) {
  return `${String(item.amount).replace('.', ',')} ${item.unit}`;
}
function itemLabel(item: AdherenceItem) {
  if (item.state === 'extra_recorded') return 'Alimento adicional registrado';
  if (item.state === 'planned_not_recorded') return 'Sem registro correspondente';
  if (item.state === 'matched_substitution') return 'Substituição aprovada';
  if (item.state === 'matched_quantity_difference') return 'Quantidade diferente da planejada';
  if (item.quantity === 'near_target') return 'Quantidade próxima do plano';
  return 'Compatível com o plano';
}

function AdherenceDetails({ data, simple }: { data: PlanDiaryAdherence; simple: boolean }) {
  const visibleDays = data.days.filter((day) => day.state !== 'no_plan' || day.recordedItems > 0).reverse();
  return (
    <div className="adherence-days">
      {visibleDays.map((day) => (
        <details className="adherence-day" key={day.date}>
          <summary>
            <span><strong>{formatDate(day.date, { day: '2-digit', month: 'short' })}</strong><small>{day.state === 'no_plan' ? 'Sem plano publicado nesta data' : day.state === 'not_evaluable' ? 'Sem registro suficiente para avaliar' : 'Comparação disponível'}</small></span>
            <ChevronDown aria-hidden="true" />
          </summary>
          {day.plan && data.planChangedDuringPeriod && !simple && <p className="adherence-version-note">Plano v{day.plan.version} válido nesta data.</p>}
          {day.meals.map((meal) => (
            <details className="adherence-meal" key={meal.mealType}>
              <summary><strong>{mealDefinition(meal.mealType).label}</strong><span>{meal.state === 'aligned' ? 'Compatível' : meal.state === 'mostly_aligned' ? 'Parcialmente compatível' : meal.state === 'different' ? 'Diferente do planejado' : 'Sem registro suficiente'}</span></summary>
              <div className="adherence-items">
                {meal.items.map((item, index) => (
                  <article className="adherence-item" data-state={item.state} key={`${item.planned?.name ?? 'extra'}-${item.recorded?.name ?? index}-${index}`}>
                    <strong>{item.recorded?.name ?? item.planned?.name}</strong>
                    <span>{itemLabel(item)}</span>
                    {!simple && item.planned && <small>Planejado: {item.planned.name} · {portion(item.planned)}</small>}
                    {item.recorded && <small>Registrado: {item.recorded.name} · {portion(item.recorded)}</small>}
                  </article>
                ))}
              </div>
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}

export function PlanDiaryAdherencePanel({ patientId, simple = false }: { patientId?: number; simple?: boolean }) {
  const today = brazilNow().date;
  const [days, setDays] = useState(7), [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(addDays(today, -6)), [to, setTo] = useState(today);
  const [data, setData] = useState<PlanDiaryAdherence | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const nextFrom = custom ? from : addDays(today, -(days - 1));
    const nextTo = custom ? to : today;
    setLoading(true); setError('');
    const path = patientId ? `/nutritionist/patients/${patientId}/adherence` : '/patient/adherence';
    void api<PlanDiaryAdherence>(`${path}?from=${nextFrom}&to=${nextTo}`).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a comparação.')).finally(() => setLoading(false));
  }, [custom, days, from, patientId, to, today]);
  return (
    <section className={`adherence-panel ${simple ? 'is-simple' : ''}`} aria-labelledby={`adherence-title-${patientId ?? 'self'}`}>
      <header className="adherence-heading">
        <div><p className="eyebrow">Plano × Diário</p><h2 id={`adherence-title-${patientId ?? 'self'}`}>{simple ? 'Como seu diário se aproximou do plano' : 'Aderência ao plano'}</h2><p>{simple ? 'Uma leitura dos registros disponíveis, sem notas ou julgamentos.' : 'Comparação explicável entre a prescrição válida e o que foi registrado.'}</p></div>
        <div className="adherence-period" aria-label="Período da aderência">
          {[7, 30].map((value) => <button key={value} aria-pressed={!custom && days === value} onClick={() => { setCustom(false); setDays(value); }}>{value} dias</button>)}
          <button aria-pressed={custom} onClick={() => setCustom(true)}>Personalizado</button>
        </div>
      </header>
      {custom && <div className="adherence-custom"><label>De<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>Até<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label></div>}
      {loading ? <ContentSkeleton rows={4} /> : error ? <p role="alert" className="adherence-error">{error}</p> : !data ? null : data.summary.eligibleMeals === 0 ? <EmptyState icon={ClipboardCheck} title="Ainda não há plano publicado neste período" description="Datas sem plano não entram na compatibilidade." /> : <>
        {data.planChangedDuringPeriod && <p className="adherence-info"><Info aria-hidden="true" /> O plano mudou durante este período. Cada dia usa a versão válida naquela data.</p>}
        <div className="adherence-metrics">
          <article><span>Cobertura de registros</span><strong>{data.summary.coveredPlannedItems} de {data.summary.eligiblePlannedItems}</strong><small>itens planejados com correspondência registrada</small></article>
          <article><span>Compatibilidade dos registros</span><strong>{data.summary.compatibleItems} de {data.summary.evaluableRecordedItems}</strong><small>registros ligados ao plano ou adicionais</small></article>
          <article><span>Quantidade próxima</span><strong>{data.summary.quantityAlignedItems} de {data.summary.quantityEvaluableItems}</strong><small>itens compatíveis com quantidade avaliável</small></article>
          <article><span>Substituições aprovadas</span><strong>{data.summary.substitutionsUsed}</strong><small>utilizadas no período</small></article>
        </div>
        {!simple && <div className="adherence-secondary"><span>{data.summary.relevantQuantityDifferences} diferenças relevantes de quantidade</span><span>{data.summary.extraRecordedItems} alimentos adicionais</span><span>{data.summary.plannedWithoutRecord} itens sem registro correspondente</span></div>}
        <AdherenceDetails data={data} simple={simple} />
      </>}
    </section>
  );
}
