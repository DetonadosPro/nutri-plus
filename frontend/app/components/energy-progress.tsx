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
import { signedEnergy } from './daily-energy-card';
import { ActivityGlyph, quickName } from './activity-choices';
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
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || '');
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(saved.from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(saved.to)
      )
        return { from: String(saved.from), to: String(saved.to) };
    } catch {
      /* Preference is optional. */
    }
    return { from: addDays(today, -6), to: today };
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(range));
    } catch {
      /* Storage may be disabled. */
    }
  }, [range, storageKey]);
  const [custom, setCustom] = useState(
      () =>
        range.to !== today ||
        ![addDays(today, -6), addDays(today, -29)].includes(range.from),
    ),
    [data, setData] = useState<EnergyHistory | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [settingOpen, setSettingOpen] = useState(false);
  const request = useRef(0),
    query = activityQuery(patientId);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const days =
        Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) +
        1;
      if (!Number.isFinite(days) || days < 1 || days > 366 || range.to > today)
        throw Error('Escolha até 366 dias, sem datas futuras.');
      const result = await api<EnergyHistory>(
        `/activities/history?${query}from=${range.from}&to=${range.to}`,
      );
      if (id === request.current) setData(result);
    } catch (e) {
      if (id === request.current) {
        setData(null);
        setError((e as Error).message);
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [query, range.from, range.to, today]);
  useEffect(() => {
    void load();
    return listenActivityChanges(() => void load());
  }, [load]);
  const complete =
    data?.days.filter((d) => d.foodComplete && d.balanceKcal != null) ?? [];
  const aggregate = data?.accumulatedKcal ?? null;
  const chart =
    data?.days.map((d) => ({
      ...d,
      confirmedBalance: d.foodComplete ? d.balanceKcal : null,
    })) ?? [];
  return (
    <section className="energy-progress movement-progress">
      <header>
        <div>
          <p className="eyebrow">Um dia de cada vez</p>
          <h2>Seu balanço energético</h2>
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
      <div className="movement-range" aria-label="Período">
        {[7, 30].map((n) => (
          <button
            key={n}
            aria-pressed={
              !custom &&
              range.from === addDays(today, 1 - n) &&
              range.to === today
            }
            onClick={() => {
              setCustom(false);
              setRange({ from: addDays(today, 1 - n), to: today });
              setSelected(null);
            }}
          >
            {n} dias
          </button>
        ))}
        <button aria-pressed={custom} onClick={() => setCustom(!custom)}>
          Personalizado
        </button>
      </div>
      {custom && (
        <div className="activity-period">
          <label>
            De
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                if (e.target.value)
                  setRange({ ...range, from: e.target.value });
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
                if (e.target.value) setRange({ ...range, to: e.target.value });
              }}
            />
          </label>
        </div>
      )}
      {settingOpen && professional && (
        <EnergySettings
          patientId={patientId}
          onSaved={() => {
            setSettingOpen(false);
            activityChanged();
          }}
        />
      )}
      {loading && (
        <output className="activity-muted">Atualizando período…</output>
      )}
      {error && (
        <p role="alert" className="activity-error">
          {error}
          <button onClick={() => void load()}>Tentar novamente</button>
        </p>
      )}
      {data && !error && (
        <div aria-busy={loading}>
          <div className="movement-period-total">
            <span>Saldo acumulado no período</span>
            <p>
              <strong>{signedEnergy(aggregate)}</strong> kcal
            </p>
            <small>
              {aggregate == null
                ? 'Registre alimentos para começar.'
                : `${Math.abs(aggregate) < 0.5 ? 'Equilíbrio' : aggregate > 0 ? 'Superávit' : 'Déficit'} estimado · ${complete.length} dias somados`}
            </small>
          </div>
          <div
            className="energy-chart"
            aria-label="Gráfico de balanço energético dos dias registrados"
          >
            <ResponsiveContainer
              width="100%"
              height={220}
              minWidth={0}
              debounce={100}
              initialDimension={{ width: 300, height: 220 }}
            >
              <LineChart
                data={chart}
                margin={{ top: 15, right: 22, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#e5ebe8"
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(s) =>
                    s.slice(5).split('-').reverse().join('/')
                  }
                  minTickGap={30}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <YAxis
                  width={55}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <Tooltip
                  labelFormatter={(v) => formatDate(String(v))}
                  formatter={(v) => [
                    `${signedEnergy(Number(v))} kcal`,
                    'Saldo estimado',
                  ]}
                />
                <ReferenceLine y={0} stroke="#a6b6ad" />
                <Line
                  isAnimationActive={false}
                  type="linear"
                  dataKey="confirmedBalance"
                  name="Saldo estimado"
                  stroke="#567d78"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="activity-muted">
            Dias sem alimentação registrada ficam em aberto no gráfico.
          </p>
          <details className="movement-disclosure">
            <summary>
              Ver dias e atividades · {data.sessions.length} registros
            </summary>
            <div className="movement-history-days">
              {[...data.days].reverse().map((d) => (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={selected === d.date}
                  onClick={() =>
                    setSelected(selected === d.date ? null : d.date)
                  }
                >
                  <span>
                    {formatDate(d.date, { day: '2-digit', month: 'short' })}
                    <small>
                      {d.activities.length} atividades
                      {!d.foodComplete ? ' · sem alimentação' : ''}
                    </small>
                  </span>
                  <strong>{signedEnergy(d.balanceKcal)} kcal</strong>
                </button>
              ))}
            </div>
            {selected && (
              <ActivityPanel
                date={selected}
                patientId={patientId}
                professional={professional}
              />
            )}
          </details>
          <details className="movement-disclosure">
            <summary>Resumo do período</summary>
            <dl className="movement-period-details">
              <div>
                <dt>Ingestão média</dt>
                <dd>
                  {complete.length
                    ? formatNumber(
                        complete.reduce((s, d) => s + d.intakeKcal!, 0) /
                          complete.length,
                      )
                    : '—'}{' '}
                  kcal
                </dd>
              </div>
              <div>
                <dt>Gasto médio estimado</dt>
                <dd>
                  {complete.length
                    ? formatNumber(
                        complete.reduce((s, d) => s + d.totalKcal!, 0) /
                          complete.length,
                      )
                    : '—'}{' '}
                  kcal
                </dd>
              </div>
              <div>
                <dt>Tempo de atividade</dt>
                <dd>
                  {formatNumber(
                    data.sessions.reduce((s, a) => s + a.duration_minutes, 0),
                  )}{' '}
                  min
                </dd>
              </div>
            </dl>
            <p className="activity-muted">
              As médias e o saldo usam dias com alimentação registrada. O tempo inclui
              todas as atividades do período.
            </p>
            <ul className="movement-period-activities">
              {data.sessions.map((s) => (
                <li key={s.id}>
                  <ActivityGlyph
                    category={s.snapshot.category}
                    code={s.snapshot.code}
                  />
                  <span>
                    {quickName(s.snapshot)}
                    <small>
                      {formatDate(s.activity_date)} · {s.duration_minutes} min
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
          {professional && <EnergyMethod />}
        </div>
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
      <p>
        O fator cotidiano é definido em Metas. Na segunda estratégia, os
        exercícios registrados são acrescentados pelo gasto líquido estimado.
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
