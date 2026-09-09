'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/client-api';
import { formatNumber, progressPercent } from '@/lib/nutrition-format';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  activityQuery,
  listenActivityChanges,
} from './activity-panel';
import type { EnergyHistory } from './activity-types';
import type { Summary } from '../types';

export function signedEnergy(value: number | null) {
  if (value == null) return '—';
  return `${Math.abs(value) < 0.5 ? '' : value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
}
export function DailyEnergyCard({
  summary,
  date,
  patientId,
}: {
  summary: Summary;
  date: string;
  patientId?: number;
}) {
  const [data, setData] = useState<EnergyHistory | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false);
  const request = useRef(0);
  const query = activityQuery(patientId);
  const foodRefreshKey = [
    summary.totals.energia_kcal,
    summary.totals.proteina_g,
    summary.totals.carboidrato_g,
    summary.totals.lipideos_g,
  ].join('|');
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const result = await api<EnergyHistory>(
        `/activities/history?${query}from=${date}&to=${date}`,
      );
      if (id === request.current) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (id === request.current) {
        setData(null);
        setError((e as Error).message);
      }
    }
  }, [date, query]);
  useEffect(() => {
    setData(null);
    void load();
    return listenActivityChanges(() => void load());
  }, [load, foodRefreshKey]);
  const day = data?.days[0]?.date === date ? data.days[0] : null;
  const consumed = summary.totals.energia_kcal ?? 0,
    goal = summary.goals?.energy_kcal;
  return (
    <>
      <section
        className="patient-energy-card daily-energy-card"
        aria-label="Energia do dia"
      >
        <div className="daily-energy-split">
          <div>
            <span className="daily-energy-label">Calorias ingeridas</span>
            <p>
              <strong>{formatNumber(consumed)}</strong>
              <span>kcal</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ver detalhes do balanço energético"
            className="daily-balance"
            aria-busy={!day && !error}
          >
            <span className="daily-energy-label">
              {day?.balanceKcal == null ? 'Balanço estimado' : day.label}
            </span>
            <p>
              <strong>{signedEnergy(day?.balanceKcal ?? null)}</strong>
              <span>kcal</span>
            </p>
            <small>
              {error
                ? 'Não foi possível atualizar'
                : !day
                  ? 'Carregando…'
                  : day.balanceKcal == null
                    ? 'Ver o que falta'
                    : 'Atualizado automaticamente'}
              <ArrowUpRight size={14} />
            </small>
          </button>
        </div>
        {goal != null && (
          <div className="daily-energy-goal">
            <span>Meta alimentar · {formatNumber(goal)} kcal</span>
            <div className="patient-energy-track" aria-hidden="true">
              <span style={{ width: `${progressPercent(consumed, goal)}%` }} />
            </div>
          </div>
        )}
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="activity-dialog">
          <DialogHeader>
            <DialogTitle>Seu balanço do dia</DialogTitle>
            <DialogDescription>
              O saldo compara os alimentos registrados com o gasto estimado do
              dia inteiro.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert">
              {error}
              <button onClick={() => void load()}>Tentar novamente</button>
            </p>
          )}
          {day && (
            <>
              <p className="energy-balance-value">
                {day.balanceKcal == null
                  ? 'Faltam dados para estimar o saldo. Verifique seu peso e perfil com o nutricionista.'
                  : `${signedEnergy(day.balanceKcal)} kcal · ${day.label}`}
              </p>
              <section aria-label="Detalhamento do gasto energético">
                <h3 className="font-semibold">Como sua energia foi gasta</h3>
                <dl className="energy-numbers mt-3">
                  {[
                    ['Seu corpo em repouso', day.base.restingKcal],
                    ['Sua rotina cotidiana', day.habitualKcal],
                    ['Digestão dos alimentos', day.tefKcal],
                    ['Exercícios registrados', day.additionalKcal],
                    ['Gasto total estimado', day.totalKcal],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd>
                        {value == null
                          ? 'Indisponível'
                          : `${formatNumber(Number(value))} kcal`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <p className="activity-muted">
                O saldo é atualizado automaticamente conforme você registra ou
                altera alimentos e exercícios. Déficit e superávit não indicam,
                por si só, que o dia foi bom ou ruim.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
