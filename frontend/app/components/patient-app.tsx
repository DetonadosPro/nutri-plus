'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Camera,
  ChevronDown,
  CircleUserRound,
  ClipboardList,
  Home,
  LogOut,
  MessageSquareText,
  Plus,
  Scale,
  Utensils,
  Weight,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/client-api';
import { brazilNow, formatDate, formatDateTime } from '@/lib/datetime';
import { useNavigationState } from '@/lib/navigation-state';
import { bmiBand, bmiDistance, formatNumber } from '@/lib/nutrition-format';
import { normalizedGlycemicClassificationLabel } from '@/lib/glycemic';
import { Brand } from './brand';
import { DateNavigator } from './date-navigator';
import { DailyJournal, NutritionSummary } from './daily-journal';
import { EditEntryDialog } from './edit-entry-dialog';
import { FoodEntrySheet } from './food-entry-sheet';
import { MacroDistributionSummary } from './macro-distribution';
import { DailyEnergyCard } from './daily-energy-card';
import {
  ActivityPanel,
  activityChanged,
  listenActivityChanges,
} from './activity-panel';
import { EnergyProgress } from './energy-progress';
import { PatientDayHome } from './patient-day-home';
import { UserIdentity } from './user-identity';
import { ProfileDisclosure } from './profile-disclosure';
import { PatientMealPlan } from './meal-plan';
import {
  ChartPanel,
  ContentSkeleton,
  EmptyState,
  Metric,
  PageHeader,
  SectionHeader,
} from './page-primitives';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import type {
  History,
  Meal,
  MealEntry,
  Orientation,
  OrientationInbox,
  Summary,
  User,
} from '../types';

type PatientArea = 'today' | 'plan' | 'diary' | 'progress' | 'guidance' | 'profile';
const navItems = [
  ['today', 'Diário', Home],
  ['plan', 'Plano', Utensils],
  ['diary', 'Detalhes', ClipboardList],
  ['progress', 'Evolução', BarChart3],
  ['guidance', 'Orientações', MessageSquareText],
  ['profile', 'Perfil', CircleUserRound],
] as const;

export function PatientApp({
  user,
  onLogout,
  professionalMode = false,
  onProfessionalBack,
  selfPatientId,
}: {
  user: User;
  onLogout: () => void;
  professionalMode?: boolean;
  onProfessionalBack?: () => void;
  selfPatientId?: number;
}) {
  const today = brazilNow().date;
  const [navigation, navigate] = useNavigationState(
    professionalMode ? 'nutritionist-self' : 'patient',
    {
      active: 'today' as PatientArea,
      homeDate: today,
      diaryDate: today,
    },
  );
  const { active, homeDate, diaryDate } = navigation;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [homeSummary, setHomeSummary] = useState<Summary | null>(null);
  const [diarySummary, setDiarySummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [orientationInbox, setOrientationInbox] =
    useState<OrientationInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [cameraCapture, setCameraCapture] = useState<{ file: File; token: number }>();
  const cameraInput = useRef<HTMLInputElement>(null);
  const [initialMealType, setInitialMealType] = useState<string>();
  const [homeMealReveal, setHomeMealReveal] = useState<{
    mealType: string;
    token: number;
  } | null>(null);
  const [editing, setEditing] = useState<{
    entry: MealEntry;
    meal: Meal;
  } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [weightOpen, setWeightOpen] = useState(false);
  const [selfGoalsOpen, setSelfGoalsOpen] = useState(false);
  const refreshRequest = useRef(0);

  useEffect(() => {
    if (!homeMealReveal) return;
    const timeout = window.setTimeout(() => setHomeMealReveal(null), 800);
    return () => window.clearTimeout(timeout);
  }, [homeMealReveal]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api<History>(`/patient/history?days=30&to=${today}`));
    } catch {
      setHistory(null);
    }
  }, [today]);

  const refreshPatientData = useCallback(async () => {
    const request = ++refreshRequest.current;
    setLoading(true);
    const dates = [...new Set([today, homeDate, diaryDate])];
    const results = await Promise.allSettled(
      dates.map((nextDate) => api<Summary>(`/patient/today?date=${nextDate}`)),
    );
    if (request !== refreshRequest.current) return;
    let todayLoaded = false;
    let hasError = false;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (dates[index] === today) {
          todayLoaded = true;
          setSummary(result.value);
        }
        if (dates[index] === homeDate) setHomeSummary(result.value);
        if (dates[index] === diaryDate) setDiarySummary(result.value);
      } else {
        hasError = true;
      }
    });
    if (hasError) {
      toast.add({
        title: todayLoaded
          ? 'Alguns dados do diário não foram atualizados.'
          : 'Não foi possível carregar o diário.',
        type: 'error',
      });
    }
    if (request !== refreshRequest.current) return;
    if (active === 'progress') await refreshHistory();
    if (request !== refreshRequest.current) return;
    setLoading(false);
  }, [active, today, homeDate, diaryDate, refreshHistory]);
  useEffect(() => {
    void refreshPatientData();
  }, [refreshPatientData]);
  useEffect(
    () => listenActivityChanges(() => void refreshPatientData()),
    [refreshPatientData],
  );
  useEffect(() => {
    if (professionalMode && active === 'guidance') {
      navigate({ active: 'today' });
    }
  }, [active, navigate, professionalMode]);
  useEffect(() => {
    if (professionalMode) {
      setOrientationInbox({ items: [], unreadCount: 0 });
      return;
    }
    let current = true;
    void (async () => {
      try {
        const inbox = await api<OrientationInbox>('/patient/orientations');
        if (active === 'guidance' && inbox.unreadCount) {
          await api('/patient/orientations/read', { method: 'POST' });
          inbox.unreadCount = 0;
        }
        if (current) setOrientationInbox(inbox);
      } catch {
        if (current) setOrientationInbox({ items: [], unreadCount: 0 });
      }
    })();
    return () => {
      current = false;
    };
  }, [active, professionalMode]);
  function openAdd(mealType?: string) {
    setCameraCapture(undefined);
    setInitialMealType(mealType);
    setAddOpen(true);
  }
  function openCamera() {
    cameraInput.current?.click();
  }
  function success(title: string) {
    activityChanged();
    toast.add({ title, type: 'success' });
  }

  if (!summary && loading) return <PatientLoading />;
  if (!summary)
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-5">
        <EmptyState
          title="O diário não carregou"
          description="Verifique se o servidor local está aberto e tente novamente."
          action={
            <Button onClick={() => refreshPatientData()}>
              Tentar novamente
            </Button>
          }
        />
      </main>
    );

  const unreadOrientations = orientationInbox?.unreadCount ?? 0;

  return (
    <main className="app-canvas patient-app-shell pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
      <header className="mobile-topbar patient-mobile-topbar lg:hidden">
        {professionalMode && onProfessionalBack ? (
          <button
            onClick={onProfessionalBack}
            className="secondary-action"
            aria-label="Voltar à área profissional"
          >
            <ArrowLeft className="size-4" /> Área profissional
          </button>
        ) : (
          <Brand compact />
        )}
        <button onClick={onLogout} className="icon-button" aria-label="Sair">
          <LogOut className="size-4" />
        </button>
      </header>
      <div className="app-frame lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="app-sidebar hidden lg:flex">
          <Brand />
          {professionalMode && onProfessionalBack && (
            <button onClick={onProfessionalBack} className="sidebar-link mt-6">
              <ArrowLeft className="size-[18px]" /> Área profissional
            </button>
          )}
          <nav className="mt-10 space-y-1" aria-label="Navegação do paciente">
            {navItems
              .filter(
                ([id]) =>
                  id !== 'diary' && (!professionalMode || (id !== 'guidance' && id !== 'plan')),
              )
              .map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => navigate({ active: id })}
                  className="sidebar-link relative"
                  aria-current={active === id ? 'page' : undefined}
                >
                  <Icon className="size-[18px]" />
                  {label}
                  {id === 'guidance' && unreadOrientations > 0 && (
                    <span
                      className="ml-auto grid min-w-5 place-items-center rounded-full bg-rose-600 px-1.5 text-[10px] font-bold leading-5 text-white"
                      aria-label={`${unreadOrientations} orientações não lidas`}
                    >
                      {Math.min(unreadOrientations, 99)}
                    </span>
                  )}
                </button>
              ))}
          </nav>
          <button
            type="button"
            className="patient-sidebar-add"
            onClick={() => openAdd()}
          >
            <Plus className="size-5" />
            Registrar alimento
          </button>
          <div className="mt-auto border-t pt-5">
            <UserIdentity
              name={user.name}
              accountType={professionalMode ? 'Nutricionista' : 'Paciente'}
              onLogout={onLogout}
            />
          </div>
        </aside>
        <div className="min-w-0">
          <div className="content-shell">
            {active === 'today' && (
              <>
                {!professionalMode && (
                  <button
                    className="meal-plan-mobile-entry lg:hidden"
                    onClick={() => navigate({ active: 'plan' })}
                  >
                    <span>
                      <Utensils className="size-5" />
                      <strong>Meu plano alimentar</strong>
                    </span>
                    <small>Veja a prescrição do seu nutricionista</small>
                  </button>
                )}
                <PatientDayHome
                summary={homeSummary ?? summary}
                date={homeDate}
                loading={loading}
                revealMealRequest={homeMealReveal}
                onDate={(nextDate) => navigate({ homeDate: nextDate })}
                onAdd={openAdd}
                onEdit={(entry, meal) => setEditing({ entry, meal })}
                onDelete={setDeleteId}
                onCopy={async (meal) => {
                  await api(`/meals/${meal.id}/copy`, {
                    method: 'POST',
                    body: JSON.stringify({ targetDate: homeDate }),
                  });
                  await refreshPatientData();
                  success(`${meal.label} foi repetido.`);
                }}
                onDiary={() =>
                  navigate({ active: 'diary', diaryDate: homeDate })
                }
                onProgress={() => navigate({ active: 'progress' })}
                onWater={async (waterMl) => {
                  await api('/daily-log', {
                    method: 'PATCH',
                    body: JSON.stringify({ date: homeDate, waterMl }),
                  });
                  await refreshPatientData();
                  success('Água atualizada.');
                }}
                />
              </>
            )}
            {active === 'plan' && <PatientMealPlan />}
            {active === 'diary' &&
              (diarySummary?.date === diaryDate ? (
                <DiaryArea
                  summary={diarySummary}
                  date={diaryDate}
                  loading={loading}
                  onDate={(nextDate) => navigate({ diaryDate: nextDate })}
                  onAdd={openAdd}
                  onEdit={(entry, meal) => setEditing({ entry, meal })}
                  onDelete={setDeleteId}
                  onCopy={async (meal) => {
                    await api(`/meals/${meal.id}/copy`, {
                      method: 'POST',
                      body: JSON.stringify({ targetDate: diaryDate }),
                    });
                    await refreshPatientData();
                    success(`${meal.label} foi repetido.`);
                  }}
                  onSaveLog={async (payload) => {
                    await api('/daily-log', {
                      method: 'PATCH',
                      body: JSON.stringify({ date: diaryDate, ...payload }),
                    });
                    await refreshPatientData();
                    success('Registro do dia salvo.');
                  }}
                />
              ) : (
                <ContentSkeleton rows={5} />
              ))}
            {active === 'diary' && (
              <ActivityPanel
                date={diaryDate}
                onProgress={() => navigate({ active: 'progress' })}
              />
            )}
            {active === 'progress' && (
              <>
                <EnergyProgress />
                <NutritionHistory history={history} summary={summary} />
              </>
            )}
            {!professionalMode && active === 'guidance' && (
              <GuidanceArea items={orientationInbox?.items ?? null} />
            )}
            {active === 'profile' && (
              <ProfileArea
                summary={summary}
                onWeight={() => setWeightOpen(true)}
                onGoals={selfPatientId ? () => setSelfGoalsOpen(true) : undefined}
              />
            )}
          </div>
        </div>
      </div>
      <nav
        className="mobile-bottom-nav patient-bottom-nav lg:hidden"
        aria-label="Navegação principal"
      >
        {navItems
          .filter(([id]) => id === 'today' || id === 'progress')
          .slice(0, 2)
          .map(([id, label, Icon]) => (
            <button
              key={id}
              className="relative"
              onClick={() => navigate({ active: id })}
              aria-current={active === id ? 'page' : undefined}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </button>
          ))}
        <button
          type="button"
          className="patient-primary-action"
          onClick={openCamera}
          aria-label="Fotografar alimento"
        >
          <Camera className="size-7" />
          <span>Foto</span>
        </button>
        <input
          ref={cameraInput}
          className="sr-only"
          type="file"
          accept="image/*"
          capture="environment"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setInitialMealType(undefined);
            setCameraCapture({ file, token: Date.now() });
            setAddOpen(true);
          }}
        />
        {navItems
          .filter(
            ([id]) =>
              id === 'profile' || (!professionalMode && id === 'guidance'),
          )
          .map(([id, label, Icon]) => (
            <button
              key={id}
              className="relative"
              onClick={() => navigate({ active: id })}
              aria-current={active === id ? 'page' : undefined}
            >
              <Icon className="size-5" />
              <span>{label}</span>
              {id === 'guidance' && unreadOrientations > 0 && (
                <span
                  className="patient-orientation-dot"
                  aria-label={`${unreadOrientations} orientações não lidas`}
                />
              )}
            </button>
          ))}
      </nav>
      <FoodEntrySheet
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setCameraCapture(undefined);
        }}
        date={
          active === 'diary' ? diaryDate : active === 'today' ? homeDate : today
        }
        catalog={summary.nutrientCatalog}
        initialMealType={initialMealType}
        initialPhoto={cameraCapture}
        onInitialPhotoConsumed={(token) =>
          setCameraCapture((current) =>
            current?.token === token ? undefined : current,
          )
        }
        onAdded={(nextSummary) => {
          const previousSummary =
            homeSummary?.date === nextSummary.date
              ? homeSummary
              : summary.date === nextSummary.date
                ? summary
                : null;
          const previousEntryIds = new Set(
            previousSummary?.meals.flatMap((meal) =>
              meal.entries.map((entry) => entry.id),
            ) ?? [],
          );
          const changedMeal = nextSummary.meals.find((meal) =>
            meal.entries.some((entry) => !previousEntryIds.has(entry.id)),
          );
          if (nextSummary.date === today) setSummary(nextSummary);
          if (nextSummary.date === homeDate) setHomeSummary(nextSummary);
          if (nextSummary.date === diaryDate) setDiarySummary(nextSummary);
          if (active === 'today') {
            const mealType = changedMeal?.meal_type ?? initialMealType;
            if (mealType) {
              setHomeMealReveal({ mealType, token: Date.now() });
            }
            setCameraCapture(undefined);
            setAddOpen(false);
          }
          void refreshPatientData();
          success('Alimento adicionado.');
        }}
      />
      <EditEntryDialog
        value={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          void refreshPatientData();
          success('Registro atualizado.');
        }}
      />
      <DeleteEntryDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={async () => {
          if (deleteId == null) return;
          await api(`/meal-entries/${deleteId}`, { method: 'DELETE' });
          setDeleteId(null);
          await refreshPatientData();
          success('Alimento removido.');
        }}
      />
      <WeightDialog
        open={weightOpen}
        onOpenChange={setWeightOpen}
        onSaved={async () => {
          await refreshPatientData();
          success('Peso registrado.');
        }}
      />
      {selfPatientId && (
        <SelfGoalsDialog
          open={selfGoalsOpen}
          onOpenChange={setSelfGoalsOpen}
          patientId={selfPatientId}
          summary={summary}
          onSaved={async () => {
            await refreshPatientData();
            success('Suas metas foram atualizadas.');
          }}
        />
      )}
    </main>
  );
}

function PatientLoading() {
  return (
    <main className="app-canvas">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="mb-10 flex items-center justify-between">
          <Brand compact />
          <div className="h-10 w-10 rounded-full bg-muted" />
        </div>
        <ContentSkeleton rows={6} />
      </div>
    </main>
  );
}

function DiaryArea({
  summary,
  date,
  loading,
  onDate,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
  onSaveLog,
}: {
  summary: Summary;
  date: string;
  loading: boolean;
  onDate: (date: string) => void;
  onAdd: (mealType?: string) => void;
  onEdit: (entry: MealEntry, meal: Meal) => void;
  onDelete: (id: number) => void;
  onCopy: (meal: Meal) => void;
  onSaveLog: (payload: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState(summary.log.note || '');
  const [training, setTraining] = useState(summary.log.training || '');
  useEffect(() => {
    setNote(summary.log.note || '');
    setTraining(summary.log.training || '');
  }, [summary.date, summary.log.note, summary.log.training]);
  return (
    <div className="animate-content-in">
      <DateNavigator date={date} onChange={onDate} loading={loading} />
      <div className={`day-content-transition ${loading ? 'is-loading' : ''}`}>
        <DailyEnergyCard summary={summary} date={date} />
        <details className="movement-disclosure">
          <summary>Nutrientes do dia</summary>
          <NutritionSummary summary={summary} />
        </details>
        <div className="mt-9 grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <DailyJournal
            summary={summary}
            onAdd={onAdd}
            onEdit={onEdit}
            onDelete={onDelete}
            onCopy={onCopy}
          />
          <aside className="min-w-0 space-y-5">
            <section className="surface-panel">
              <SectionHeader
                title="Como foi o dia?"
                description="Contexto que ajuda seu nutricionista."
              />
              <div className="mt-4 space-y-4">
                {training && (
                  <div>
                    <Label htmlFor="training">
                      Anotação de treino anterior
                    </Label>
                    <Input
                      id="training"
                      value={training}
                      onChange={(event) => setTraining(event.target.value)}
                      className="mt-2"
                      placeholder="Anotação anterior"
                    />
                  </div>
                )}
                <div>
                  <Label htmlFor="day-note">Observação</Label>
                  <Textarea
                    id="day-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="mt-2 min-h-24"
                    placeholder="Fome, rotina, sintomas…"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => onSaveLog({ note, training })}
                >
                  Salvar contexto
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function NutritionHistory({
  history,
  summary,
}: {
  history: History | null;
  summary: Summary;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="movement-disclosure nutrition-history"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Peso e outros indicadores nutricionais</summary>
      {open && <ProgressArea history={history} summary={summary} />}
    </details>
  );
}

function ProgressArea({
  history,
  summary,
}: {
  history: History | null;
  summary: Summary;
}) {
  if (!history)
    return (
      <div>
        <p className="patient-progress-caption">
          Registros reais dos últimos 30 dias.
        </p>
        <ContentSkeleton rows={5} />
      </div>
    );
  const chart = history.days.map((day) => ({
    date: day.date.slice(5).split('-').reverse().join('/'),
    kcal: Math.round(day.totals.energia_kcal ?? 0),
    protein: Math.round(day.totals.proteina_g ?? 0),
    glycemic: day.glycemic.per1000Kcal ?? day.glycemic.normalizedGL,
  }));
  const periodGlycemic = history.glycemic;
  const periodClassification = periodGlycemic.classification
    ? normalizedGlycemicClassificationLabel[periodGlycemic.classification]
    : null;
  const periodDetail = periodGlycemic.coveredDays
    ? `${periodGlycemic.coveredDays} dias calculados${periodClassification ? ` · ${periodClassification}` : ''}`
    : 'Sem CG e energia suficientes';
  return (
    <div className="animate-content-in">
      <p className="patient-progress-caption">
        Registros reais dos últimos 30 dias.
      </p>
      <div className="metric-grid">
        <Metric
          label="Dias registrados"
          value={String(history.registeredDays)}
          detail={`de ${history.totalDays} dias`}
          tone="sage"
        />
        <Metric
          label="Peso atual"
          value={`${formatNumber(summary.weight?.weight_kg, 1)} kg`}
          detail={
            summary.weight
              ? formatDate(summary.weight.weighed_at, {
                  day: '2-digit',
                  month: 'short',
                })
              : 'Sem pesagem'
          }
        />
        <Metric
          label="Proteína hoje"
          value={`${formatNumber(summary.proteinPerKg, 2)} g/kg`}
          detail="Com base no peso atual"
          tone="blue"
        />
        <Metric
          label="CG / 1.000 kcal (período)"
          className="col-span-full lg:col-span-2"
          value={
            (periodGlycemic.per1000Kcal ?? periodGlycemic.normalizedGL) != null
              ? `${formatNumber(periodGlycemic.per1000Kcal ?? periodGlycemic.normalizedGL, 1)} / 1.000 kcal`
              : '—'
          }
          detail={periodDetail}
          tone="amber"
        />
      </div>
      <div className="mt-8 flex flex-col gap-7">
        <ChartPanel
          title="Energia e proteína"
          description="Consumo nos dias em que houve registro"
          hasData={chart.length > 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 8, left: -18 }}>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="energy"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="protein"
                orientation="right"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip />
              <Line
                yAxisId="energy"
                type="monotone"
                dataKey="kcal"
                name="Energia"
                stroke="var(--chart-amber)"
                strokeWidth={2.4}
                dot={{ r: 2 }}
              />
              <Line
                yAxisId="protein"
                type="monotone"
                dataKey="protein"
                name="Proteína"
                stroke="var(--chart-sage)"
                strokeWidth={2.4}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel
          title="Carga glicêmica relativa"
          description="CG por 1.000 kcal nos dias com dados suficientes"
          hasData={chart.some((item) => item.glycemic != null)}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 8, left: -18 }}>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value) => [
                  value == null
                    ? '—'
                    : `${formatNumber(Number(value), 1)} / 1.000 kcal`,
                  'CG / 1.000 kcal',
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="glycemic"
                name="CG / 1.000 kcal"
                stroke="var(--chart-amber)"
                strokeWidth={2.4}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel
          title="Evolução do peso"
          description="Histórico das pesagens"
          className="order-first"
          hasData={history.weights.length > 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={history.weights.map((item) => ({
                date: item.weighed_at.slice(5).split('-').reverse().join('/'),
                peso: item.weight_kg,
              }))}
              margin={{ top: 8, right: 12, left: -18 }}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={['dataMin - 1', 'dataMax + 1']}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="peso"
                name="Peso"
                stroke="var(--chart-sage)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}

function GuidanceArea({ items }: { items: Orientation[] | null }) {
  return (
    <div className="animate-content-in">
      <PageHeader
        eyebrow="Orientações"
        title="Recados do seu nutricionista"
        description="Tudo que foi compartilhado com você, em ordem de envio."
      />
      {items == null ? (
        <ContentSkeleton rows={4} />
      ) : items.length ? (
        <div className="mx-auto max-w-3xl space-y-4">
          {items.map((item, index) => (
            <article
              key={item.id}
              className="guidance-item"
              data-recent={index === 0 ? 'true' : undefined}
            >
              <span className="feature-icon">
                <MessageSquareText className="size-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-semibold">
                    {item.author_name}
                    {index === 0 && (
                      <span className="status-badge" data-tone="shared">
                        Mais recente
                      </span>
                    )}
                  </h2>
                  <time className="text-xs text-muted-foreground">
                    {formatDateTime(item.created_at)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                  {item.content}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={MessageSquareText}
          title="Nenhuma orientação ainda"
          description="Quando seu nutricionista compartilhar uma orientação, ela aparecerá aqui."
        />
      )}
    </div>
  );
}

function ProfileArea({
  summary,
  onWeight,
  onGoals,
}: {
  summary: Summary;
  onWeight: () => void;
  onGoals?: () => void;
}) {
  const p = summary.patient;
  const currentBmiBand = bmiBand(summary.metrics.bmi);
  const bmiRanges = [
    ['Baixo peso', 'abaixo de 18,5'],
    ['Peso adequado', '18,5 a 24,9'],
    ['Sobrepeso', '25,0 a 29,9'],
    ['Obesidade grau I', '30,0 a 34,9'],
    ['Obesidade grau II', '35,0 a 39,9'],
    ['Obesidade grau III', '40,0 ou mais'],
  ];
  return (
    <div className="patient-profile-area animate-content-in">
      <div className="grid gap-7 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="surface-panel patient-weight-card h-fit">
          <span className="feature-icon">
            <Scale className="size-5" />
          </span>
          <p className="mt-5 text-sm text-muted-foreground">Peso atual</p>
          <p className="mt-1 font-display text-4xl font-semibold">
            {formatNumber(summary.weight?.weight_kg, 1)}{' '}
            <span className="text-base text-muted-foreground">kg</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {summary.weight
              ? `Último registro em ${formatDate(summary.weight.weighed_at, { day: '2-digit', month: 'long', year: 'numeric' })}`
              : 'Nenhuma pesagem registrada'}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4">
            <div>
              <p className="text-xs text-muted-foreground">IMC</p>
              <p className="mt-1 font-display text-xl font-semibold">
                {formatNumber(summary.metrics.bmi, 1)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Metabolismo basal</p>
              <p className="mt-1 font-display text-xl font-semibold">
                {formatNumber(summary.metrics.basalKcal)}{' '}
                <span className="text-xs text-muted-foreground">kcal</span>
              </p>
            </div>
          </div>
          {currentBmiBand && (
            <details className="profile-bmi-disclosure">
              <summary>
                <div>
                  <p>{currentBmiBand.label}</p>
                  <small>{bmiDistance(summary.metrics.bmi)}</small>
                </div>
                <span>IMC {currentBmiBand.range}</span>
                <ChevronDown className="size-4" />
              </summary>
              <div className="profile-bmi-ranges">
                {bmiRanges.map(([label, range]) => (
                  <div
                    key={label}
                    data-current={
                      label === currentBmiBand.label ? 'true' : 'false'
                    }
                  >
                    <strong>{label}</strong>
                    <span>{range}</span>
                  </div>
                ))}
                <p>Referência de classificação para adultos.</p>
              </div>
            </details>
          )}
          <Button onClick={onWeight} variant="outline" className="mt-4 w-full">
            <Weight />
            Registrar peso
          </Button>
        </aside>
        <section>
          <section className="mb-7">
            <SectionHeader
              title="Suas metas nutricionais"
              description={
                summary.goals?.energy_kcal
                  ? `${formatNumber(summary.goals.energy_kcal)} kcal por dia, definidas pelo nutricionista.`
                  : 'Seu nutricionista ainda não definiu metas.'
              }
            />
            <MacroDistributionSummary goals={summary.goals} />
            {onGoals && (
              <Button className="mt-4" onClick={onGoals}>
                Alterar minhas metas
              </Button>
            )}
          </section>
          <div className="profile-disclosure-list">
            <ProfileDisclosure
              title="Dados pessoais"
              items={[
                [
                  'Nascimento',
                  p.birth_date
                    ? String(p.birth_date).split('-').reverse().join('/')
                    : 'Não informado',
                ],
                ['Idade', p.age == null ? 'Não informada' : `${p.age} anos`],
                [
                  'Altura',
                  p.height_cm
                    ? `${formatNumber(Number(p.height_cm))} cm`
                    : 'Não informada',
                ],
              ]}
            />
            <ProfileDisclosure
              title="Seu acompanhamento"
              items={[
                ['Objetivo', String(p.objective || 'Não informado')],
                ['Nível de atividade', activityLevelLabel(p.activity_level)],
              ]}
            />
            <ProfileDisclosure
              title="Informações alimentares"
              items={[
                [
                  'Preferências alimentares',
                  String(p.food_preferences || 'Não informadas'),
                ],
                [
                  'Restrições',
                  String(p.food_restrictions || 'Nenhuma informada'),
                ],
                ['Alergias', String(p.allergies || 'Nenhuma informada')],
                ['Rotina alimentar', String(p.meal_routine || 'Não informada')],
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function activityLevelLabel(value: string | number | null) {
  return (
    (
      {
        sedentary: 'Sedentário',
        light: 'Leve',
        moderate: 'Moderado',
        active: 'Ativo',
        very_active: 'Muito ativo',
      } as Record<string, string>
    )[String(value)] ?? String(value || 'Não informado')
  );
}

function SelfGoalsDialog({
  open,
  onOpenChange,
  patientId,
  summary,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number;
  summary: Summary;
  onSaved: () => void | Promise<void>;
}) {
  const goals = summary.goals;
  const [form, setForm] = useState({
    energy: String(goals?.energy_kcal ?? 2000),
    fiber: String(goals?.fiber_g ?? 30),
    carbohydrate: String(goals?.carbohydrate_percent ?? 50),
    protein: String(goals?.protein_percent ?? 20),
    fat: String(goals?.fat_percent ?? 30),
    factor: String(goals?.daily_activity_factor ?? 1),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setForm({
      energy: String(goals?.energy_kcal ?? 2000),
      fiber: String(goals?.fiber_g ?? 30),
      carbohydrate: String(goals?.carbohydrate_percent ?? 50),
      protein: String(goals?.protein_percent ?? 20),
      fat: String(goals?.fat_percent ?? 30),
      factor: String(goals?.daily_activity_factor ?? 1),
    });
    setError('');
  }, [open, goals]);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    const carbohydrate = Number(form.carbohydrate);
    const protein = Number(form.protein);
    const fat = Number(form.fat);
    const energy = Number(form.energy);
    const fiber = Number(form.fiber);
    const factor = Number(form.factor);
    if (
      ![energy, fiber, carbohydrate, protein, fat, factor].every(Number.isFinite) ||
      energy <= 0 ||
      fiber <= 0 ||
      factor < 1 ||
      factor > 2.5 ||
      [carbohydrate, protein, fat].some((value) => value < 0 || value > 100)
    ) {
      setError('Revise os valores informados antes de salvar.');
      return;
    }
    if (Math.abs(carbohydrate + protein + fat - 100) > 0.001) {
      setError('Carboidratos, proteínas e gorduras precisam totalizar 100%.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/nutritionist/patients/${patientId}/goals`, {
        method: 'POST',
        body: JSON.stringify({
          validFrom: brazilNow().date,
          energyKcal: energy,
          fiberG: fiber,
          carbohydratePercent: carbohydrate,
          proteinPercent: protein,
          fatPercent: fat,
          dailyActivityFactor: factor,
        }),
      });
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar suas metas.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Minhas metas</DialogTitle>
          <DialogDescription>
            Ajuste suas metas alimentares e o fator usado para estimar sua rotina diária.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {([
            ['energy', 'Energia diária (kcal)', '1'],
            ['fiber', 'Fibras (g)', '1'],
            ['factor', 'Fator cotidiano', '0.05'],
            ['carbohydrate', 'Carboidratos (%)', '1'],
            ['protein', 'Proteínas (%)', '1'],
            ['fat', 'Gorduras (%)', '1'],
          ] as const).map(([key, label, step]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`self-goal-${key}`}>{label}</Label>
              <Input
                id={`self-goal-${key}`}
                type="number"
                min={key === 'factor' ? 1 : 0}
                max={key === 'factor' ? 2.5 : undefined}
                step={step}
                value={form[key]}
                onChange={(event) => set(key, event.target.value)}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          O fator cotidiano multiplica seu metabolismo basal para representar um dia comum sem exercícios registrados.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar minhas metas'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function WeightDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [weightKg, setWeightKg] = useState('80');
  const [date, setDate] = useState(brazilNow().date);
  const [error, setError] = useState('');
  async function save() {
    const parsedWeight = Number(weightKg);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setError('Informe um peso válido.');
      return;
    }
    try {
      await api('/weights', {
        method: 'POST',
        body: JSON.stringify({ date, weightKg: parsedWeight }),
      });
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível salvar.',
      );
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar peso</DialogTitle>
          <DialogDescription>
            O histórico anterior será preservado.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="weight-date">Data</Label>
            <Input
              id="weight-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-2 h-12"
            />
          </div>
          <div>
            <Label htmlFor="weight-value">Peso (kg)</Label>
            <Input
              id="weight-value"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weightKg}
              onChange={(event) => setWeightKg(event.target.value)}
              className="mt-2 h-12"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={save} disabled={!weightKg}>
          Salvar no histórico
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function DeleteEntryDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover este alimento?</AlertDialogTitle>
          <AlertDialogDescription>
            O registro será retirado do diário. Os demais alimentos da refeição
            serão mantidos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
