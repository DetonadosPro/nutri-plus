'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Plus } from 'lucide-react';
import { api } from '@/lib/client-api';
import { brazilNow, formatDate } from '@/lib/datetime';
import { formatNumber } from '@/lib/nutrition-format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ActivityEditor } from './activity-editor';
import { ActivityGlyph, quickName, restChoices } from './activity-choices';
import type {
  ActivitySession,
  EnergyDay,
  EnergyHistory,
} from './activity-types';

export function activityChanged() {
  window.dispatchEvent(new Event('nutri-activities-changed'));
  try {
    localStorage.setItem('nutri:activities-updated', String(Date.now()));
  } catch {
    /* Storage can be disabled. */
  }
}
export function listenActivityChanges(reload: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === 'nutri:activities-updated') reload();
  };
  window.addEventListener('nutri-activities-changed', reload);
  window.addEventListener('focus', reload);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener('nutri-activities-changed', reload);
    window.removeEventListener('focus', reload);
    window.removeEventListener('storage', storage);
  };
}
export function activityQuery(patientId?: number) {
  return patientId ? `patientId=${patientId}&` : '';
}
export function EnergyMethod() {
  return (
    <details className="activity-method">
      <summary>Como estimamos o gasto</summary>
      <p>
        Repouso estimado por Mifflin–St Jeor × fator definido pelo nutricionista
        = gasto de base. A meta alimentar é uma prescrição distinta do gasto.
      </p>
      <p>
        Se o fator já inclui exercícios, os registros não são somados. Na base
        sem exercícios, somente atividades marcadas como fora da base
        acrescentam o gasto líquido: (MET − 1) × peso × horas. Tarefas habituais
        devem permanecer dentro da base.
      </p>
      <p>
        O gasto bruto é MET × peso × horas. Valores manuais ativos já são
        líquidos; valores totais descontam o repouso uma única vez. Tipo
        desconhecido não permite estimar o adicional.
      </p>
      <p>
        Musculação usa o MET da sessão inteira, com aquecimento e descansos.
        Intervalos e cargas descrevem o treino; não determinam sozinhos o MET.
        Não acrescentamos calorias de recuperação após o treino.
      </p>
      <p>
        Estimativas populacionais, não calorimetria individual. O catálogo
        adulto cobre 19–59 anos. Fora dessa faixa, ou quando houver necessidade
        de avaliação clínica, o gasto de base fica indisponível.
      </p>
      <a
        href="https://pacompendium.com/adult-compendium/"
        target="_blank"
        rel="noreferrer"
      >
        Compendium 2024
      </a>
    </details>
  );
}
export function EnergyNumbers({ day }: { day: EnergyDay }) {
  return (
    <>
      <dl className="energy-numbers">
        {[
          ['Ingestão registrada', day.intakeKcal],
          ['Repouso estimado', day.base.restingKcal],
          ['Rotina habitual além do repouso', day.habitualKcal],
          ['Gasto de base', day.base.baseKcal],
          ['Adicional contabilizado', day.additionalKcal],
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
      <p className="energy-balance-value">
        <strong>
          {day.balanceKcal == null
            ? 'Balanço indisponível'
            : `${formatNumber(Math.abs(day.balanceKcal))} kcal · ${day.label}`}
        </strong>
        <span>
          {day.foodComplete
            ? 'Alimentação marcada como completa.'
            : 'Balanço parcial: alimentação ainda não confirmada como completa.'}
        </span>
      </p>
      {day.missingFoodEnergy > 0 && (
        <output>
          Há alimentos sem informação de energia. O balanço permanece
          indisponível.
        </output>
      )}
      <p className="activity-muted">
        {day.base.mode === 'habitual_includes_exercise'
          ? 'O fator habitual já inclui exercícios; os registros não aumentam o gasto total.'
          : 'Somente atividades explicitamente fora da base somam gasto líquido.'}
      </p>
    </>
  );
}
export function ActivityPanel({
  date,
  patientId,
  professional = false,
  onProgress,
}: {
  date: string;
  patientId?: number;
  professional?: boolean;
  compact?: boolean;
  onProgress?: () => void;
}) {
  const [data, setData] = useState<EnergyHistory | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<{
      session?: ActivitySession;
      duplicate?: boolean;
    } | null>(null),
    [removing, setRemoving] = useState<ActivitySession | null>(null),
    [details, setDetails] = useState<ActivitySession | null>(null),
    [baseOpen, setBaseOpen] = useState(false),
    [baseReason, setBaseReason] = useState('');
  const query = activityQuery(patientId);
  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setError('');
    try {
      const result = await api<EnergyHistory>(
        `/activities/history?${query}from=${date}&to=${date}`,
      );
      if (id === requestId.current) setData(result);
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    }
  }, [query, date]);
  useEffect(() => {
    setData(null);
    void reload();
    const stop = listenActivityChanges(() => {
      void reload();
    });
    return stop;
  }, [reload]);
  const day = data?.days[0];
  async function recalculateBase(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/activities/recalculate-base?${query}`, {
        method: 'POST',
        body: JSON.stringify({ date, reason: baseReason }),
      });
      setBaseOpen(false);
      setBaseReason('');
      activityChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(
        `/activities/sessions/${removing.id}?${query}revision=${removing.revision}`,
        { method: 'DELETE' },
      );
      setRemoving(null);
      activityChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    if (!day) return;
    setBusy(true);
    try {
      await api(`/activities/food-status?${query}`, {
        method: 'PUT',
        body: JSON.stringify({ date, complete: !day.foodComplete }),
      });
      activityChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="activity-panel">
      <header>
        <div>
          <p className="eyebrow">Seu movimento</p>
          <h2>
            <Activity size={19} /> Atividades do dia
          </h2>
        </div>
      </header>
      {error && (
        <p role="alert" className="activity-error">
          {error}{' '}
          <button onClick={() => void reload()}>Tentar novamente</button>
        </p>
      )}
      {!data && !error && <output>Carregando atividades…</output>}
      {day && (
        <>
          {!day.activities.length ? (
            <p className="activity-muted">
              Caminhou, treinou, dançou? Registre aqui.
            </p>
          ) : (
            <ul className="activity-list">
              {day.activities.map((s) => (
                <li key={s.id}>
                  <button
                    className="activity-session-title"
                    onClick={() => setDetails(s)}
                  >
                    <ActivityGlyph
                      category={s.snapshot.category}
                      code={s.snapshot.code}
                    />
                    <strong>{quickName(s.snapshot)}</strong>
                    <span>
                      {formatNumber(s.duration_minutes)} min · ≈{' '}
                      {formatNumber(s.snapshot.grossKcal ?? s.snapshot.netKcal)}{' '}
                      kcal
                    </span>
                  </button>
                  <details className="movement-session-actions">
                    <summary aria-label={`Opções de ${quickName(s.snapshot)}`}>
                      •••
                    </summary>
                    <div className="activity-row-actions">
                      <button onClick={() => setEditor({ session: s })}>
                        Editar
                      </button>
                      <button
                        onClick={() =>
                          setEditor({ session: s, duplicate: true })
                        }
                      >
                        Duplicar
                      </button>
                      <button onClick={() => setRemoving(s)}>Excluir</button>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <Button className="movement-add" onClick={() => setEditor({})}>
            <Plus /> Adicionar atividade
          </Button>
          {onProgress && (
            <button className="movement-text-button" onClick={onProgress}>
              Ver meu histórico →
            </button>
          )}
          <details className="movement-disclosure">
            <summary>
              {professional
                ? 'Resumo energético e opções'
                : 'Sobre os registros do dia'}
            </summary>
            {professional && <EnergyNumbers day={day} />}
            <div className="activity-footer">
              <label>
                <input
                  type="checkbox"
                  checked={day.foodComplete}
                  disabled={busy || day.missingFoodEnergy > 0}
                  onChange={() => void complete()}
                />{' '}
                Registrei toda a alimentação deste dia
              </label>
            </div>
            <EnergyMethod />
          </details>
          {professional && (
            <p className="activity-muted">
              Você está consultando os mesmos registros do paciente.
            </p>
          )}
          {professional && date < brazilNow().date && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError('');
                setBaseOpen(true);
              }}
            >
              Recalcular base deste dia
            </Button>
          )}
        </>
      )}
      {editor && (
        <ActivityEditor
          date={date}
          patientId={patientId}
          session={editor.session}
          duplicate={editor.duplicate}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            activityChanged();
          }}
        />
      )}
      <Dialog
        open={baseOpen}
        onOpenChange={(o) => {
          if (!busy) setBaseOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recalcular a base histórica?</DialogTitle>
            <DialogDescription>
              Usaremos peso disponível até {formatDate(date)}, altura e dados
              atuais do perfil, com a configuração vigente naquele dia. A base
              anterior ficará preservada para auditoria. As sessões não serão
              recalculadas.
            </DialogDescription>
          </DialogHeader>
          <form className="activity-form" onSubmit={recalculateBase}>
            <label>
              Motivo da correção
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={baseReason}
                onChange={(e) => setBaseReason(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="activity-row-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setBaseOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Confirmar recálculo da base
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(o) => {
          if (!o && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir atividade?</DialogTitle>
            <DialogDescription>
              {removing?.snapshot.name}. O gasto será retirado dos totais do
              diário e da Evolução.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="activity-error">
              {error}
            </p>
          )}
          <div className="activity-row-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Cancelar
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              Excluir atividade
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!details}
        onOpenChange={(o) => {
          if (!o) setDetails(null);
        }}
      >
        <DialogContent className="activity-dialog">
          <DialogHeader>
            <DialogTitle>{details?.snapshot.name}</DialogTitle>
            <DialogDescription>
              Dados preservados no momento do cálculo
            </DialogDescription>
          </DialogHeader>
          {details && (
            <>
              <p>
                {formatDate(details.activity_date)}
                {details.local_time
                  ? ` às ${details.local_time.slice(0, 5)}`
                  : ''}{' '}
                · {details.duration_minutes} min
              </p>
              {details.rest_period && (
                <p>
                  Descanso entre séries:{' '}
                  {restChoices.find(([v]) => v === details.rest_period)?.[1]}
                </p>
              )}
              <div className="activity-row-actions">
                <Button
                  onClick={() => {
                    setEditor({ session: details });
                    setDetails(null);
                  }}
                >
                  Editar atividade
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRemoving(details);
                    setDetails(null);
                  }}
                >
                  Excluir
                </Button>
              </div>
              <details className="movement-disclosure">
                <summary>Como calculamos isso?</summary>
                <p>
                  Esforço percebido:{' '}
                  {
                    {
                      light: 'leve',
                      moderate: 'moderado',
                      vigorous: 'vigoroso',
                      unspecified: 'não informado',
                    }[details.intensity]
                  }
                  .{' '}
                  {details.outside_base
                    ? 'Marcada como fora da base.'
                    : 'Incluída na rotina habitual.'}
                </p>
                <p>
                  Bruto: {formatNumber(details.snapshot.grossKcal)} kcal ·
                  Líquido: {formatNumber(details.snapshot.netKcal)} kcal
                </p>
                <p>
                  Peso:{' '}
                  {details.snapshot.weight
                    ? `${details.snapshot.weight.weight_kg} kg, registrado em ${formatDate(details.snapshot.weight.weighed_at)}`
                    : 'não disponível'}
                  . MET: {details.snapshot.met ?? 'não utilizado'}.
                </p>
                <p>
                  {details.snapshot.method === 'met' ? (
                    <a
                      href={details.snapshot.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Compendium · {details.snapshot.catalogVersion} · código{' '}
                      {details.snapshot.code}
                    </a>
                  ) : (
                    `Origem informada: ${details.snapshot.source} (${details.snapshot.manual?.kind === 'gross' ? 'total' : details.snapshot.manual?.kind === 'net' ? 'ativo' : 'tipo desconhecido'})`
                  )}
                </p>
                {details.details.map((d, i) => (
                  <p key={i}>
                    {d.name}: {d.sets} séries · {d.reps ?? '—'} repetições ·{' '}
                    {d.loadKg ?? '—'} kg · execução/série{' '}
                    {d.executionSeconds ?? '—'} s · descanso{' '}
                    {d.restSeconds ?? '—'} s
                  </p>
                ))}
                <p className="whitespace-pre-wrap">{details.note}</p>
                <EnergyMethod />
              </details>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
