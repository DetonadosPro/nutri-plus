'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
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
import type {
  ActivityCatalog,
  ActivitySession,
  StrengthDetail,
} from './activity-types';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
  const [catalog, setCatalog] = useState<ActivityCatalog[]>([]),
    [catalogError, setCatalogError] = useState(''),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [filter, setFilter] = useState('all');
  const [day, setDay] = useState(
      duplicate ? date : (session?.activity_date ?? date),
    ),
    [time, setTime] = useState(
      session?.local_time.slice(0, 5) ?? brazilNow().time,
    ),
    [duration, setDuration] = useState(String(session?.duration_minutes ?? 30)),
    [intensity, setIntensity] = useState(session?.intensity ?? 'unspecified');
  const [code, setCode] = useState(session?.snapshot.code ?? ''),
    [version, setVersion] = useState(session?.snapshot.catalogVersion ?? ''),
    [manual, setManual] = useState(session?.snapshot.method === 'manual'),
    [manualName, setManualName] = useState(
      session?.snapshot.manual?.name ?? '',
    ),
    [kcal, setKcal] = useState(
      session?.snapshot.manual ? String(session.snapshot.manual.kcal) : '',
    ),
    [kind, setKind] = useState(session?.snapshot.manual?.kind ?? 'unknown'),
    [source, setSource] = useState(session?.snapshot.manual?.source ?? '');
  const [outside, setOutside] = useState(session?.outside_base ?? false),
    [note, setNote] = useState(session?.note ?? ''),
    [details, setDetails] = useState<StrengthDetail[]>(session?.details ?? []),
    [detailed, setDetailed] = useState(!!session?.details.length),
    [recalculate, setRecalculate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const query = patientId ? `patientId=${patientId}` : '';
  const selected = catalog.find(
    (c) => c.code === code && c.version === version,
  );
  const visible = useMemo(
    () =>
      catalog
        .filter(
          (c) =>
            (!category || c.category === category) &&
            (filter !== 'favorites' || c.favorite) &&
            (filter !== 'recent' || c.recent) &&
            normalize([c.name, c.description, ...c.aliases].join(' ')).includes(
              normalize(search),
            ),
        )
        .sort((a, b) =>
          filter === 'recent'
            ? (b.recent ?? '').localeCompare(a.recent ?? '')
            : a.name.localeCompare(b.name, 'pt-BR'),
        ),
    [catalog, category, filter, search],
  );
  const load = useCallback(async () => {
    setCatalogError('');
    try {
      setCatalog(await api<ActivityCatalog[]>(`/activities/catalog?${query}`));
    } catch (e) {
      setCatalogError((e as Error).message);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  async function favorite(c: ActivityCatalog) {
    try {
      await api(`/activities/favorites?${query}`, {
        method: 'PUT',
        body: JSON.stringify({
          code: c.code,
          version: c.version,
          favorite: !c.favorite,
        }),
      });
      setCatalog((v) =>
        v.map((x) =>
          x.code === c.code && x.version === c.version
            ? { ...x, favorite: !x.favorite }
            : x,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function detail(i: number, key: keyof StrengthDetail, value: string) {
    setDetails((v) =>
      v.map((d, j) =>
        j === i
          ? {
              ...d,
              [key]:
                key === 'name' ? value : value === '' ? null : Number(value),
            }
          : d,
      ),
    );
  }
  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        `/activities/sessions${session && !duplicate ? `/${session.id}` : ''}?${query}`,
        {
          method: session && !duplicate ? 'PUT' : 'POST',
          body: JSON.stringify({
            date: day,
            time,
            duration: Number(duration),
            intensity,
            outsideBase: outside,
            code: manual ? null : code,
            version: manual ? null : version,
            manual: manual
              ? {
                  name: manualName,
                  kcal: kcal === '' ? null : Number(kcal),
                  kind,
                  source,
                }
              : null,
            details: !manual && selected?.resistance && detailed ? details : [],
            note,
            revision: session?.revision,
            recalculate: duplicate || recalculate,
          }),
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="activity-dialog">
        <DialogHeader>
          <DialogTitle>
            {duplicate
              ? 'Duplicar atividade'
              : session
                ? 'Editar atividade'
                : 'Registrar atividade'}
          </DialogTitle>
          <DialogDescription>
            Escolha a modalidade mais próxima do que realizou. Os valores são
            estimativas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="activity-form">
          <label>
            Origem do gasto
            <select
              value={manual ? 'manual' : 'met'}
              onChange={(e) => setManual(e.target.value === 'manual')}
            >
              <option value="met">Estimar com o catálogo MET</option>
              <option value="manual">Informar gasto de outra fonte</option>
            </select>
          </label>
          {!manual ? (
            <>
              <label>
                Buscar modalidade
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Caminhada, academia, bicicleta…"
                />
              </label>
              <div className="activity-form-grid">
                <label>
                  Categoria
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">Todas as categorias</option>
                    {[...new Set(catalog.map((c) => c.category))]
                      .sort()
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Mostrar
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Todas</option>
                    <option value="favorites">Favoritas</option>
                    <option value="recent">Recentes</option>
                  </select>
                </label>
              </div>
              {catalogError ? (
                <p role="alert">
                  {catalogError}{' '}
                  <button type="button" onClick={() => void load()}>
                    Tentar novamente
                  </button>
                </p>
              ) : !catalog.length ? (
                <output>Carregando catálogo…</output>
              ) : (
                <div
                  className="activity-catalog"
                  aria-label="Atividades disponíveis"
                >
                  {!visible.length && (
                    <p>Nenhuma atividade encontrada. Tente outra busca.</p>
                  )}
                  {visible.map((c) => (
                    <div
                      key={`${c.code}-${c.version}`}
                      data-selected={c.code === code && c.version === version}
                    >
                      <button
                        type="button"
                        aria-pressed={c.code === code && c.version === version}
                        onClick={() => {
                          setCode(c.code);
                          setVersion(c.version);
                        }}
                      >
                        <strong>{c.name}</strong>
                        <span>{c.met} MET</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`${c.favorite ? 'Remover dos' : 'Adicionar aos'} favoritos: ${c.name}`}
                        aria-pressed={c.favorite}
                        onClick={() => void favorite(c)}
                      >
                        <Star
                          size={17}
                          fill={c.favorite ? 'currentColor' : 'none'}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {selected && (
                <p className="activity-selection">
                  <strong>{selected.name}</strong> · {selected.met} MET{' '}
                  <a href={selected.source} target="_blank" rel="noreferrer">
                    Fonte 2024 · {selected.code}
                  </a>
                </p>
              )}
            </>
          ) : (
            <>
              <label>
                Nome da atividade
                <input
                  required
                  maxLength={180}
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
              </label>
              <div className="activity-form-grid">
                <label>
                  Gasto informado (kcal)
                  <input
                    required
                    type="number"
                    min="0"
                    max="20000"
                    step="any"
                    value={kcal}
                    onChange={(e) => setKcal(e.target.value)}
                  />
                </label>
                <label>
                  O valor representa
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="unknown">Não sei / não especificado</option>
                    <option value="net">Calorias ativas (líquidas)</option>
                    <option value="gross">
                      Calorias totais da sessão (brutas)
                    </option>
                  </select>
                </label>
              </div>
              <label>
                Origem do valor
                <input
                  required
                  minLength={2}
                  maxLength={300}
                  placeholder="Ex.: relógio, modelo; avaliação profissional"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <p className="activity-muted">
                Informe somente a sessão, sem incluir o gasto diário inteiro. Se
                o tipo for desconhecido, o adicional ficará indisponível.
              </p>
            </>
          )}
          <div className="activity-form-grid">
            <label>
              Data
              <input
                required
                type="date"
                value={day}
                max={brazilNow().date}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <label>
              Horário de início
              <input
                required
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label>
              Duração total (minutos)
              <input
                required
                type="number"
                min="0.1"
                max="1440"
                step="any"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
            <label>
              Esforço percebido
              <select
                value={intensity}
                onChange={(e) => setIntensity(e.target.value)}
              >
                <option value="unspecified">Não informado</option>
                <option value="light">Leve</option>
                <option value="moderate">Moderado</option>
                <option value="vigorous">Vigoroso</option>
              </select>
            </label>
          </div>
          <p className="activity-muted">
            Horário de São Paulo. O esforço percebido é seu relato e não altera
            automaticamente o MET da modalidade.
          </p>
          {!manual && selected?.resistance && (
            <>
              <label className="activity-checkbox">
                <input
                  type="checkbox"
                  checked={detailed}
                  onChange={(e) => setDetailed(e.target.checked)}
                />{' '}
                Detalhar séries e descansos (opcional)
              </label>
              <p className="activity-muted">
                Inclua aquecimento, execução e descanso na duração total. O MET
                é da sessão completa; intervalos menores não aumentam
                automaticamente a estimativa.
              </p>
              {detailed && (
                <>
                  <div className="strength-details">
                    {details.map((d, i) => (
                      <fieldset key={i}>
                        <legend>Exercício {i + 1}</legend>
                        <label>
                          Nome
                          <input
                            required
                            value={d.name}
                            onChange={(e) => detail(i, 'name', e.target.value)}
                          />
                        </label>
                        <div className="activity-form-grid">
                          {(
                            [
                              ['sets', 'Séries'],
                              ['reps', 'Repetições por série'],
                              ['loadKg', 'Carga (kg)'],
                              ['executionSeconds', 'Execução por série (s)'],
                              ['restSeconds', 'Descanso entre séries (s)'],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <input
                                type="number"
                                required={key === 'sets'}
                                min={key === 'sets' || key === 'reps' ? 1 : 0}
                                step={key === 'loadKg' ? 'any' : '1'}
                                value={d[key] ?? ''}
                                onChange={(e) => detail(i, key, e.target.value)}
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDetails((v) => v.filter((_, j) => j !== i))
                          }
                        >
                          Remover exercício
                        </button>
                      </fieldset>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDetails((v) => [
                        ...v,
                        {
                          name: '',
                          sets: 3,
                          reps: null,
                          loadKg: null,
                          executionSeconds: null,
                          restSeconds: null,
                        },
                      ])
                    }
                  >
                    Adicionar exercício
                  </Button>
                </>
              )}
            </>
          )}
          <label className="activity-checkbox">
            <input
              type="checkbox"
              checked={outside}
              onChange={(e) => setOutside(e.target.checked)}
            />{' '}
            Esta atividade está fora da rotina já incluída no gasto de base
          </label>
          <p className="activity-muted">
            Só haverá acréscimo se o nutricionista tiver configurado uma base
            sem estes exercícios. Não marque tarefas habituais já consideradas
            no fator.
          </p>
          <label>
            Observações
            <textarea
              maxLength={3000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {session && !duplicate && (
            <label className="activity-checkbox">
              <input
                type="checkbox"
                checked={recalculate}
                onChange={(e) => setRecalculate(e.target.checked)}
              />{' '}
              Recalcular explicitamente com o peso disponível na data escolhida
              e o MET selecionado (a versão anterior será preservada)
            </label>
          )}
          {error && (
            <p role="alert" className="activity-error">
              {error}
            </p>
          )}
          <div className="activity-row-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button disabled={busy || (!manual && !selected)} type="submit">
              {busy ? 'Salvando…' : 'Salvar atividade'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
