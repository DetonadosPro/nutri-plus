'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from 'recharts';
import { api } from '@/lib/client-api';
import { addDays, brazilNow, formatDate } from '@/lib/datetime';
import { formatNumber } from '@/lib/nutrition-format';
import { Button } from '@/components/ui/button';
import {
  ActivityPanel,
  activityChanged,
  activityQuery,
  EnergyMethod,
  listenActivityChanges,
} from './activity-panel';
import type { EnergyHistory } from './activity-types';

export function EnergyProgress({
  patientId,
  professional = false,
}: {
  patientId?: number;
  professional?: boolean;
}) {
  const today = brazilNow().date;
  const storageKey = `nutri:energy-range:${patientId ?? 'self'}`;
  const [range, setRange] = useState(() => {
    const fallback = { from: addDays(today, -6), to: today };
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || '');
      return /^\d{4}-\d{2}-\d{2}$/.test(stored.from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(stored.to)
        ? { from: String(stored.from), to: String(stored.to) }
        : fallback;
    } catch {
      return fallback;
    }
  });
  function navigate(next: Partial<typeof range>) {
    setRange((current) => {
      const value = { ...current, ...next };
      sessionStorage.setItem(storageKey, JSON.stringify(value));
      return value;
    });
  }
  const [data, setData] = useState<EnergyHistory | null>(null),
    [previous, setPrevious] = useState<EnergyHistory | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState('day'),
    [settingOpen, setSettingOpen] = useState(false);
  const query = activityQuery(patientId);
  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const days =
        Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) +
        1;
      if (days < 1 || days > 366 || range.to > today)
        throw new Error(
          'Escolha um período de até 366 dias, sem datas futuras.',
        );
      const prevTo = addDays(range.from, -1),
        prevFrom = addDays(prevTo, 1 - days);
      const [current, prior] = await Promise.all([
        api<EnergyHistory>(
          `/activities/history?${query}from=${range.from}&to=${range.to}`,
        ),
        api<EnergyHistory>(
          `/activities/history?${query}from=${prevFrom}&to=${prevTo}`,
        ),
      ]);
      if (id === requestId.current) {
        setData(current);
        setPrevious(prior);
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [range.from, range.to, query, today]);
  useEffect(() => {
    void reload();
    const stop = listenActivityChanges(() => {
      void reload();
    });
    return stop;
  }, [reload]);
  const average = (h: EnergyHistory | null) =>
    h?.completeDays && h.accumulatedKcal != null
      ? h.accumulatedKcal / h.completeDays
      : null;
  const currentAverage = average(data),
    previousAverage = average(previous);
  return (
    <section className="energy-progress">
      <header>
        <div>
          <p className="eyebrow">Evolução</p>
          <h2>Balanço energético estimado</h2>
        </div>
        {professional && (
          <Button
            variant="outline"
            onClick={() => setSettingOpen(!settingOpen)}
          >
            Configurar cálculo
          </Button>
        )}
      </header>
      <div className="activity-period">
        <div className="activity-row-actions">
          {[
            [7, 'Semana'],
            [30, 'Mês'],
          ].map(([n, label]) => (
            <button
              key={n}
              onClick={() =>
                navigate({ from: addDays(today, 1 - Number(n)), to: today })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          De
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              if (e.target.value) navigate({ from: e.target.value });
            }}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={today}
            onChange={(e) => {
              if (e.target.value) navigate({ to: e.target.value });
            }}
          />
        </label>
      </div>
      {settingOpen && professional && (
        <EnergySettings
          patientId={patientId}
          onSaved={() => {
            setSettingOpen(false);
            activityChanged();
          }}
        />
      )}
      {loading && <output>Atualizando período…</output>}
      {error && (
        <p role="alert" className="activity-error">
          {error}{' '}
          <button onClick={() => void reload()}>Tentar novamente</button>
        </p>
      )}
      {data && !error && (
        <>
          <p className="activity-muted">
            {data.completeDays} de {data.days.length} dias completos com cálculo
            disponível. O acumulado considera somente esses dias; lacunas não
            equivalem a zero.
          </p>
          <div className="energy-period-summary">
            <div>
              <span>Balanço acumulado dos dias completos</span>
              <strong>
                {data.accumulatedKcal == null
                  ? 'Indisponível'
                  : `${formatNumber(Math.abs(data.accumulatedKcal))} kcal · ${Math.abs(data.accumulatedKcal) < 0.5 ? 'neutro' : data.accumulatedKcal > 0 ? 'superávit' : 'déficit'} estimado`}
              </strong>
            </div>
            <div>
              <span>Comparação com período anterior</span>
              <strong>
                {currentAverage == null || previousAverage == null
                  ? 'Sem dias completos suficientes'
                  : `${formatNumber(currentAverage - previousAverage)} kcal/dia de diferença na média`}
              </strong>
              <span>
                {previous?.completeDays ?? 0} dias completos no período anterior
                ({previous?.from} a {previous?.to}). Coberturas diferentes
                limitam a comparação.
              </span>
            </div>
          </div>
          <div className="energy-chart">
            <h3>Ingestão e gasto total estimado (kcal)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.days}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(s) =>
                    s.slice(5).split('-').reverse().join('/')
                  }
                />
                <YAxis width={50} />
                <Tooltip />
                <Legend />
                <Line
                  isAnimationActive={false}
                  name="Ingestão registrada (pode ser parcial)"
                  dataKey="intakeKcal"
                  stroke="#608c78"
                  dot={false}
                />
                <Line
                  isAnimationActive={false}
                  name="Gasto total estimado"
                  dataKey="totalKcal"
                  stroke="#af8356"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="energy-chart">
            <h3>Balanço {tab === 'day' ? 'diário' : 'acumulado'} (kcal)</h3>
            <div className="activity-row-actions">
              <button
                aria-pressed={tab === 'day'}
                onClick={() => setTab('day')}
              >
                Diário
              </button>
              <button
                aria-pressed={tab === 'sum'}
                onClick={() => setTab('sum')}
              >
                Acumulado de dias completos
              </button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.days}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(s) =>
                    s.slice(5).split('-').reverse().join('/')
                  }
                />
                <YAxis width={55} />
                <Tooltip />
                <ReferenceLine y={0} stroke="#888" />
                <Line
                  isAnimationActive={false}
                  name={
                    tab === 'day'
                      ? 'Balanço diário estimado (pode ser parcial)'
                      : 'Acumulado de dias completos'
                  }
                  dataKey={tab === 'day' ? 'balanceKcal' : 'accumulatedKcal'}
                  stroke="#7285a2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="activity-method">
            <summary>Equivalência energética teórica aproximada</summary>
            <p>
              {data.theoreticalKg == null
                ? 'Sem dados adequados para esta equivalência.'
                : `${formatNumber(Math.abs(data.theoreticalKg), 2)} kg de equivalência energética teórica aproximada (${data.accumulatedKcal! > 0 ? 'superávit' : 'déficit'} acumulado ÷ 7.700 kcal/kg).`}
            </p>
            <p>
              Isso não é previsão de peso. Água, glicogênio, composição corporal
              e adaptação metabólica mudam a resposta real. Não use esta
              equivalência para estabelecer metas, déficits ou prazos. Gestação,
              menores e condições clínicas exigem avaliação profissional.
            </p>
          </details>
          <details open>
            <summary>Visão diária e atividades</summary>
            <div className="energy-table-wrap">
              <table className="energy-table">
                <caption>
                  Valores em kcal; selecione uma data para consultar ou editar
                  registros
                </caption>
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Ingestão</th>
                    <th>Base</th>
                    <th>Adicional</th>
                    <th>Total</th>
                    <th>Balanço</th>
                    <th>Registros</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => (
                    <tr key={d.date}>
                      <th>
                        <button
                          onClick={() =>
                            setSelected(selected === d.date ? null : d.date)
                          }
                        >
                          {formatDate(d.date, {
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </button>
                      </th>
                      <td>{formatNumber(d.intakeKcal)}</td>
                      <td>{formatNumber(d.base.baseKcal)}</td>
                      <td>{formatNumber(d.additionalKcal)}</td>
                      <td>{formatNumber(d.totalKcal)}</td>
                      <td>
                        {d.balanceKcal == null
                          ? '—'
                          : `${formatNumber(Math.abs(d.balanceKcal))} · ${d.label}`}
                      </td>
                      <td>
                        {d.foodComplete
                          ? 'Alimentação completa'
                          : 'Alimentação incompleta ou não confirmada'}{' '}
                        ·{' '}
                        {d.activities.length
                          ? `${d.activities.length} atividade(s)`
                          : 'Sem atividade registrada; movimento não avaliado'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {selected && (
            <ActivityPanel
              date={selected}
              patientId={patientId}
              professional={professional}
            />
          )}
          <details>
            <summary>
              Tempo por modalidade · {data.sessions.length} sessões
            </summary>
            {!data.modalities.length ? (
              <p>Nenhuma atividade registrada no período.</p>
            ) : (
              <ul className="activity-list">
                {data.modalities.map((m) => (
                  <li key={m.name}>
                    <strong>{m.name}</strong>
                    <span>
                      {formatNumber(m.minutes)} min · {m.sessions} sessões
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <EnergyMethod />
        </>
      )}
    </section>
  );
}
function EnergySettings({
  patientId,
  onSaved,
}: {
  patientId?: number;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState('habitual_includes_exercise'),
    [factor, setFactor] = useState(''),
    [clinical, setClinical] = useState(false),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const today = brazilNow().date;
    void api<EnergyHistory>(
      `/activities/history?${activityQuery(patientId)}from=${today}&to=${today}`,
    )
      .then((h) => {
        const b = h.days[0].base;
        setMode(b.mode);
        setFactor(b.factor == null ? '' : String(b.factor));
        setClinical(b.clinicalReview);
        setNote(b.note);
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, [patientId]);
  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/activities/settings?${activityQuery(patientId)}`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          factor: Number(factor),
          clinicalReview: clinical,
          note,
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="activity-form energy-settings" onSubmit={save}>
      <h3>Configuração profissional · válida a partir de hoje</h3>
      <label>
        Estratégia
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="habitual_includes_exercise">
            Fator habitual já inclui exercícios
          </option>
          <option value="base_plus_net">
            Base sem exercícios + gasto líquido adicional
          </option>
        </select>
      </label>
      <label>
        Fator de gasto cotidiano
        <input
          required
          type="number"
          min="1"
          max="2.5"
          step="0.001"
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
        />
      </label>
      <p>
        Na segunda opção, configure um fator sem os exercícios que serão
        acrescentados. A aproximação líquida pressupõe substituição de repouso;
        movimento cotidiano já incluído não deve ser somado.
      </p>
      <label className="activity-checkbox">
        <input
          type="checkbox"
          checked={clinical}
          onChange={(e) => setClinical(e.target.checked)}
        />{' '}
        Gestação ou condição clínica que exige avaliação individual: suspender
        estimativa de base e equivalência
      </label>
      <label>
        Justificativa e o que a base inclui
        <textarea
          required
          minLength={5}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p>
        Dias anteriores preservam as configurações e os dados disponíveis quando
        foram consolidados. Nenhuma meta alimentar é alterada.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !ready}>
        {busy ? 'Salvando…' : 'Salvar configuração'}
      </Button>
    </form>
  );
}
