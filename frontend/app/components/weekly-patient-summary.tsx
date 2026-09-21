'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarCheck2,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  MessageSquareText,
  Scale,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/client-api';
import { brazilNow, formatDate } from '@/lib/datetime';
import { weeklySummaryInsights } from '@/lib/weekly-patient-summary';
import type { WeeklyPatientSummary } from '../types';
import { ContentSkeleton } from './page-primitives';
import { PlanDiaryAdherencePanel } from './plan-diary-adherence';
import '../weekly-summary.css';

function weightText(data: WeeklyPatientSummary) {
  if (!data.weight.updatedInPeriod) return 'Sem nova pesagem';
  if (data.weight.latestKg == null) return 'Sem nova pesagem';
  if (data.weight.changeKg == null) return `${String(data.weight.latestKg).replace('.', ',')} kg`;
  const direction = data.weight.changeKg > 0 ? '+' : '';
  return `${String(data.weight.latestKg).replace('.', ',')} kg (${direction}${String(data.weight.changeKg).replace('.', ',')} kg)`;
}

export function WeeklyPatientSummaryPanel({
  patientId,
  onOpenDiary,
  onSendOrientation,
}: {
  patientId: number;
  onOpenDiary: () => void;
  onSendOrientation: () => void;
}) {
  const today = brazilNow().date;
  const [data, setData] = useState<WeeklyPatientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    void api<WeeklyPatientSummary>(
      `/nutritionist/patients/${patientId}/weekly-summary?to=${today}`,
    )
      .then(setData)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o resumo.'),
      )
      .finally(() => setLoading(false));
  }, [patientId, today]);

  return (
    <section className="weekly-summary" aria-labelledby={`weekly-summary-title-${patientId}`}>
      <header className="weekly-summary-heading">
        <div>
          <p className="eyebrow">Últimos 7 dias</p>
          <h2 id={`weekly-summary-title-${patientId}`}>Resumo da semana</h2>
          <p>O que aconteceu, o que merece atenção e qual é o próximo passo.</p>
        </div>
        {data && (
          <span className="weekly-summary-period">
            {formatDate(data.from, { day: '2-digit', month: 'short' })} –{' '}
            {formatDate(data.to, { day: '2-digit', month: 'short' })}
          </span>
        )}
      </header>

      {loading ? (
        <ContentSkeleton rows={4} />
      ) : error ? (
        <p role="alert" className="weekly-summary-error">{error}</p>
      ) : data ? (
        <WeeklySummaryContent
          data={data}
          patientId={patientId}
          onOpenDiary={onOpenDiary}
          onSendOrientation={onSendOrientation}
        />
      ) : null}
    </section>
  );
}

function WeeklySummaryContent({
  data,
  patientId,
  onOpenDiary,
  onSendOrientation,
}: {
  data: WeeklyPatientSummary;
  patientId: number;
  onOpenDiary: () => void;
  onSendOrientation: () => void;
}) {
  const insights = weeklySummaryInsights(data);
  return (
    <>
      {data.plan.changedDuringPeriod && (
        <p className="weekly-summary-note">O plano mudou nesta semana; cada dia foi comparado com a versão válida naquela data.</p>
      )}
      <div className="weekly-summary-main">
        <article className="weekly-summary-registration">
          <CalendarCheck2 aria-hidden="true" />
          <span>Dias com registro</span>
          <strong>{data.registration.recordedDays} <small>de {data.registration.totalDays}</small></strong>
          <p>{data.plan.available && data.plan.coveragePercent != null ? `${data.plan.coveragePercent}% dos itens planejados tiveram correspondência no diário.` : 'A leitura usa somente os dados realmente disponíveis.'}</p>
        </article>
        <div className="weekly-summary-insights">
          <article data-tone="positive">
            <CircleCheck aria-hidden="true" />
            <div><span>Ponto positivo</span><strong>{insights.positive.title}</strong><p>{insights.positive.detail}</p></div>
          </article>
          <article data-tone="attention">
            <CircleAlert aria-hidden="true" />
            <div><span>Para olhar agora</span><strong>{insights.attention.title}</strong><p>{insights.attention.detail}</p></div>
          </article>
        </div>
      </div>

      <div className="weekly-summary-context">
        <span><Activity aria-hidden="true" /><span>Atividade<strong>{data.activity.sessions ? `${data.activity.sessions} ${data.activity.sessions === 1 ? 'sessão' : 'sessões'}` : 'Sem atividade registrada'}</strong></span></span>
        <span><Scale aria-hidden="true" /><span>Peso<strong>{weightText(data)}</strong></span></span>
      </div>

      <div className="weekly-summary-actions">
        <Button onClick={onOpenDiary} variant="outline">Abrir os dias <ArrowRight /></Button>
        <Button onClick={onSendOrientation}><MessageSquareText /> Enviar orientação</Button>
      </div>

      <details className="weekly-summary-details">
        <summary>Ver comparação completa <ChevronDown aria-hidden="true" /></summary>
        <PlanDiaryAdherencePanel patientId={patientId} />
      </details>
    </>
  );
}
