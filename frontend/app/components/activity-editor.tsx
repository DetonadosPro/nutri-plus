'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Clock3, Search, Star } from 'lucide-react';
import { api } from '@/lib/client-api';
import { brazilNow } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ActivityCatalog, ActivitySession } from './activity-types';
import {
  activityChoices,
  ActivityGlyph,
  matchesChoice,
  normalizeActivity,
  quickName,
  restChoices,
  type ActivityChoice,
} from './activity-choices';

function legacyRestSeconds(value?: ActivitySession['rest_period']) {
  if (!value) return null;
  return { under30: 30, '30to60': 45, '1to2': 90, '2to3': 150, over3: 240 }[value];
}

export function ActivityEditor({
  date,
  patientId,
  session,
  duplicate,
  onClose,
  onSaved,
}: {
  date: string;
  patientId?: number;
  session?: ActivitySession;
  duplicate?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalog, setCatalog] = useState<ActivityCatalog[]>([]);
  const [recent, setRecent] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [group, setGroup] = useState<ActivityChoice | null>(null);
  const [chosen, setChosen] = useState<{
    code: string;
    version: string;
  } | null>(
    session?.snapshot.code
      ? {
          code: session.snapshot.code,
          version: session.snapshot.catalogVersion!,
        }
      : null,
  );
  const [quick, setQuick] = useState<ActivityChoice | null>(
    () => {
      const match = activityChoices.find((c) =>
        c.efforts.some((effort) => effort.code === session?.snapshot.code),
      );
      return match?.id === 'strength' &&
        session?.snapshot.calculationProfile === 'catalog_specific'
        ? null
        : (match ?? null);
    },
  );
  const [manual, setManual] = useState(session?.snapshot.method === 'manual');
  const [manualName, setManualName] = useState(
    session?.snapshot.manual?.name ?? '',
  );
  const [manualKcal, setManualKcal] = useState(
    String(session?.snapshot.manual?.kcal ?? ''),
  );
  const [manualKind, setManualKind] = useState(
    session?.snapshot.manual?.kind ?? 'unknown',
  );
  const [source, setSource] = useState(session?.snapshot.manual?.source ?? '');
  const [duration, setDuration] = useState(
    String(session?.duration_minutes ?? 30),
  );
  const [intensity, setIntensity] = useState(session?.intensity ?? 'moderate');
  const [rest, setRest] = useState<number | null>(
    session?.rest_seconds ?? legacyRestSeconds(session?.rest_period),
  );
  const [estimatedKcal, setEstimatedKcal] = useState<number | null>(null);
  const [day, setDay] = useState(
    duplicate ? date : (session?.activity_date ?? date),
  );
  const [time] = useState(
    duplicate ? '' : (session?.local_time?.slice(0, 5) ?? ''),
  );
  const [outside, setOutside] = useState(session?.outside_base ?? false);
  const [note] = useState(session?.note ?? '');
  const [busy, setBusy] = useState(false),
    [options, setOptions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlaySession = useRef<string | undefined>(undefined);
  const closing = useRef(false);
  const savedAfterClose = useRef(false);
  const onCloseRef = useRef(onClose);
  const onSavedRef = useRef(onSaved);
  onCloseRef.current = onClose;
  onSavedRef.current = onSaved;
  const query = patientId ? `patientId=${patientId}` : '';
  const selected = catalog.find(
    (c) => c.code === chosen?.code && c.version === chosen.version,
  );
  const editing = !!session && !duplicate;
  const inDetails = !!chosen || manual;
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, history] = await Promise.all([
        api<ActivityCatalog[]>(`/activities/catalog?${query}${query ? '&' : ''}date=${day}`),
        api<ActivitySession[]>(`/activities/recent?${query}`),
      ]);
      setCatalog(rows);
      setRecent(history);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, day]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (overlaySession.current) return;
    const id = (overlaySession.current = crypto.randomUUID());
    const base = { ...window.history.state, nutriOverlayReturn: id };
    window.history.replaceState(base, '');
    window.history.pushState(
      { ...base, nutriActivityEntry: id, nutriOverlayReturn: undefined },
      '',
    );
  }, []);
  useEffect(() => {
    const pop = () => {
      const id = overlaySession.current;
      if (!id) return;
      if (overlaySession.current !== id) return;
      overlaySession.current = undefined;
      closing.current = true;
      const next = { ...window.history.state };
      if (next.nutriOverlayReturn === id) delete next.nutriOverlayReturn;
      window.history.replaceState(next, '');
      if (savedAfterClose.current) onSavedRef.current();
      else onCloseRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [inDetails, group]);
  useEffect(() => {
    if (!selected || !chosen || !(Number(duration) > 0)) {
      setEstimatedKcal(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ kcal: number }>(`/activities/estimate?${query}`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          date: day,
          duration: Number(duration),
          code: chosen.code,
          version: chosen.version,
          restSeconds: quick?.id === 'strength' ? rest : null,
          intensity,
          calculationProfile: quick?.id === 'strength' ? 'quick_strength' : 'catalog_specific',
        }),
      })
        .then((result) => setEstimatedKcal(result.kcal))
        .catch((reason) => {
          if ((reason as Error).name !== 'AbortError') setEstimatedKcal(null);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [chosen, day, duration, intensity, query, quick, rest, selected]);
  const visible = useMemo(
    () =>
      catalog.filter(
        (c) =>
          (!group || matchesChoice(c, group)) &&
          normalizeActivity([c.name, ...c.aliases].join(' ')).includes(
            normalizeActivity(search),
          ),
      ),
    [catalog, group, search],
  );
  function select(row: ActivityCatalog, repeated?: ActivitySession) {
    setChosen({ code: row.code, version: row.version });
    setQuick(null);
    setError('');
    if (repeated) {
      const match = activityChoices.find((c) =>
        c.efforts.some((effort) => effort.code === row.code),
      );
      setQuick(
        match?.id === 'strength' &&
          repeated.snapshot.calculationProfile === 'catalog_specific'
          ? null
          : (match ?? null),
      );
      setDuration(String(repeated.duration_minutes));
      setIntensity(repeated.intensity);
      setRest(repeated.rest_seconds ?? legacyRestSeconds(repeated.rest_period));
      setOutside(repeated.outside_base);
    } else {
      setOutside(
        ![
          'Atividades domésticas',
          'Jardinagem',
          'Trabalho ativo',
          'Transporte ativo',
          'Música',
        ].includes(row.category),
      );
      setRest(null);
    }
  }
  function chooseGroup(c: ActivityChoice) {
    if (c.efforts.length) {
      const initial = c.efforts.find((effort) => effort.value === 'moderate') ?? c.efforts[0];
      const row = catalog.find((r) => r.code === initial.code);
      if (row) {
        select(row);
        setQuick(c);
        setIntensity(initial.value);
        return;
      }
    }
    setSearch('');
    setGroup(c);
  }
  function effort(selectedEffort: ActivityChoice['efforts'][number]) {
    setIntensity(selectedEffort.value);
    if (quick) {
      const row = catalog.find((r) => r.code === selectedEffort.code);
      if (row) setChosen({ code: row.code, version: row.version });
    }
  }
  async function favorite() {
    if (!selected) return;
    try {
      await api(`/activities/favorites?${query}`, {
        method: 'PUT',
        body: JSON.stringify({
          code: selected.code,
          version: selected.version,
          favorite: !selected.favorite,
        }),
      });
      setCatalog((v) =>
        v.map((c) => (c === selected ? { ...c, favorite: !c.favorite } : c)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function close(saved = false) {
    if (closing.current) return;
    savedAfterClose.current = saved;
    const id = overlaySession.current;
    if (id && window.history.state?.nutriActivityEntry === id) {
      closing.current = true;
      window.history.back();
      return;
    }
    closing.current = true;
    if (saved) onSaved();
    else onClose();
  }
  function back() {
    setError('');
    setOptions(false);
    if (inDetails) {
      setChosen(null);
      setManual(false);
      setQuick(null);
    } else if (group || search) {
      setGroup(null);
      setSearch('');
    } else close();
  }
  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/activities/sessions${editing ? `/${session.id}` : ''}?${query}`,
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            date: day,
            time: time || null,
            duration: Number(duration),
            intensity,
            outsideBase: outside,
            code: manual ? null : chosen?.code,
            version: manual ? null : chosen?.version,
            manual: manual
              ? {
                  name: manualName,
                  kcal: Number(manualKcal),
                  kind: manualKind,
                  source,
                }
              : null,
            details:
              !manual &&
              selected?.resistance &&
              session &&
              chosen?.code === session.snapshot.code
                ? session.details
                : [],
            restSeconds: quick?.id === 'strength' ? rest : null,
            calculationProfile:
              quick?.id === 'strength' ? 'quick_strength' : 'catalog_specific',
            note,
            revision: session?.revision,
            recalculate: true,
            preserveWeight: editing,
          }),
        },
      );
      setBusy(false);
      close(true);
    } catch (e) {
      setError((e as Error).message);
      setOptions(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) close();
      }}
    >
      <DialogContent className="movement-dialog" centered={false}>
        <DialogHeader className="movement-dialog-heading">
          <button
            type="button"
            className="movement-back"
            onClick={back}
            disabled={busy}
            aria-label="Voltar"
          >
            <ArrowLeft size={21} />
          </button>
          <div>
            <DialogTitle>
              {editing
                ? 'Editar atividade'
                : inDetails
                  ? (quick?.name ??
                    (selected ? quickName(selected) : 'Gasto informado'))
                  : (group?.name ?? 'O que você fez?')}
            </DialogTitle>
            <DialogDescription>
              {inDetails
                ? 'Um registro, e pronto.'
                : 'Escolha uma atividade para registrar.'}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="movement-dialog-scroll" ref={scrollRef}>
          {error && (
            <p role="alert" className="activity-error">
              {error}
              {!catalog.length && (
                <button onClick={() => void load()}>Tentar novamente</button>
              )}
            </p>
          )}
          {loading ? (
            <output>Carregando atividades…</output>
          ) : !inDetails ? (
            <>
              <label className="movement-search">
                <Search size={19} />
                <input
                  aria-label="Buscar atividade"
                  placeholder="Buscar atividade"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {!group && !search ? (
                <>
                  {!!recent.length && (
                    <section className="movement-recents">
                      <h3>
                        <Clock3 size={15} /> Recentes
                      </h3>
                      <div>
                        {recent.slice(0, 5).map((s) => {
                          const row = catalog.find(
                            (c) =>
                              c.code === s.snapshot.code &&
                              c.version === s.snapshot.catalogVersion,
                          );
                          return row ? (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => select(row, s)}
                            >
                              <ActivityGlyph
                                category={row.category}
                                code={row.code}
                              />
                              <span>
                                {quickName(row)}
                                <small>{s.duration_minutes} min</small>
                              </span>
                            </button>
                          ) : null;
                        })}
                      </div>
                    </section>
                  )}
                  <div className="movement-category-grid">
                    {activityChoices.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        data-tone={c.tone}
                        onClick={() => chooseGroup(c)}
                      >
                        <span>
                          <c.Icon size={32} strokeWidth={1.65} />
                        </span>
                        <strong>{c.name}</strong>
                        {c.id === 'home' && (
                          <small>Atividades domésticas</small>
                        )}
                      </button>
                    ))}
                  </div>
                  {!!catalog.filter((c) => c.favorite).length && (
                    <details className="movement-disclosure">
                      <summary>Favoritos</summary>
                      <div className="movement-results">
                        {catalog
                          .filter((c) => c.favorite)
                          .map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => select(c)}
                            >
                              <ActivityGlyph
                                category={c.category}
                                code={c.code}
                              />
                              <span>{c.name}</span>
                            </button>
                          ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <div className="movement-results">
                  {visible.map((c) => (
                    <button
                      type="button"
                      key={`${c.code}-${c.version}`}
                      onClick={() => select(c)}
                    >
                      <ActivityGlyph category={c.category} code={c.code} />
                      <span>{c.name}</span>
                      <ArrowLeft className="movement-forward" size={17} />
                    </button>
                  ))}
                  {!visible.length && (
                    <p>Nenhuma atividade encontrada. Tente outro nome.</p>
                  )}
                </div>
              )}
              {group?.id === 'other' && (
                <button
                  className="movement-text-button"
                  type="button"
                  onClick={() => {
                    setManual(true);
                    setOutside(false);
                  }}
                >
                  Informar calorias do relógio ou de outra fonte
                </button>
              )}
            </>
          ) : (
            <form
              id="movement-entry-form"
              onSubmit={save}
              className="movement-entry-form"
            >
              {!manual && selected && (
                <div className="movement-selected">
                  <ActivityGlyph
                    category={selected.category}
                    code={selected.code}
                  />
                  <span>{quick?.name ?? quickName(selected)}</span>
                  <button
                    type="button"
                    onClick={() => void favorite()}
                    aria-label={
                      selected.favorite
                        ? 'Remover dos favoritos'
                        : 'Adicionar aos favoritos'
                    }
                    aria-pressed={selected.favorite}
                  >
                    <Star
                      size={21}
                      fill={selected.favorite ? 'currentColor' : 'none'}
                    />
                  </button>
                </div>
              )}
              {manual && (
                <>
                  <label>
                    Atividade
                    <input
                      required
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      maxLength={180}
                    />
                  </label>
                  <label>
                    Calorias da atividade
                    <input
                      required
                      type="number"
                      min="0"
                      max="20000"
                      value={manualKcal}
                      onChange={(e) => setManualKcal(e.target.value)}
                    />
                  </label>
                  <label>
                    Origem
                    <input
                      required
                      minLength={2}
                      maxLength={300}
                      placeholder="Ex.: relógio, avaliação profissional"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </label>
                  <label>
                    Tipo de calorias
                    <select
                      value={manualKind}
                      onChange={(e) =>
                        setManualKind(e.target.value as typeof manualKind)
                      }
                    >
                      <option value="unknown">Não sei</option>
                      <option value="net">Ativas</option>
                      <option value="gross">Totais da atividade</option>
                    </select>
                  </label>
                </>
              )}
              <fieldset className="movement-duration">
                <legend>
                  {selected?.resistance ? 'Tempo de treino' : 'Quanto tempo?'}
                </legend>
                <div>
                  <input
                    aria-label="Duração em minutos"
                    required
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1440"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                  <span>minutos</span>
                </div>
                <div className="movement-duration-presets">
                  {[15, 30, 45, 60].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={Number(duration) === n}
                      onClick={() => setDuration(String(n))}
                    >
                      {n} min
                    </button>
                  ))}
                </div>
              </fieldset>
              {!manual && quick && (
                <fieldset>
                  <legend>Intensidade</legend>
                  <div className="movement-effort" data-count={quick?.efforts.length ?? 0}>
                    {(quick?.efforts ?? []).map((item, i) =>
                      (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={intensity === item.value}
                        onClick={() => effort(item)}
                      >
                        <span
                          className="movement-effort-bars"
                          aria-hidden="true"
                        >
                          {quick.efforts.length === 4
                            ? [0, 1, 2, 3].map((b) => (
                                <i key={b} data-active={b <= i} />
                              ))
                            : [0, 1, 2].map((b) => (
                            <i key={b} data-active={b <= i} />
                              ))}
                        </span>
                        <strong>
                          {item.label}
                        </strong>
                        {item.hint && <small>{item.hint}</small>}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {quick && (
                <button
                  type="button"
                  className="movement-text-button movement-change-activity"
                  onClick={() => {
                    setGroup(quick);
                    setChosen(null);
                    setQuick(null);
                  }}
                >
                  Escolher outra modalidade
                </button>
              )}
              {quick?.id === 'strength' && (
                <fieldset>
                  <legend>
                    Descanso entre séries <small>opcional</small>
                  </legend>
                  <div className="movement-rest">
                    {restChoices.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={rest === value}
                        onClick={() => setRest(rest === value ? null : value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="activity-muted">
                    O intervalo entre as séries ajuda a estimar a intensidade e a densidade do treino.
                  </p>
                </fieldset>
              )}
              {!manual && estimatedKcal != null && (
                <output className="movement-calorie-preview">
                  Gasto estimado · ≈ {Math.round(estimatedKcal)} kcal
                </output>
              )}
              <details
                className="movement-disclosure"
                open={options}
                onToggle={(e) => setOptions(e.currentTarget.open)}
              >
                <summary>Mais opções</summary>
                <div className="movement-options">
                  <label>
                    Data
                    <input
                      required
                      type="date"
                      max={brazilNow().date}
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </label>
                </div>
              </details>
            </form>
          )}
        </div>
        {inDetails && (
          <footer className="movement-dialog-footer">
            <Button
              form="movement-entry-form"
              type="submit"
              disabled={busy || loading || (!manual && !selected)}
            >
              <Check size={20} />
              {busy ? 'Salvando…' : 'Salvar atividade'}
            </Button>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
