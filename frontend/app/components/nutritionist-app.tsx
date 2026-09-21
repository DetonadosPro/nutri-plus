'use client';

import { ActivityPanel } from './activity-panel';
import { EnergyProgress } from './energy-progress';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CircleUserRound,
  FileLock2,
  Goal,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UsersRound,
  Utensils,
  Weight,
} from 'lucide-react';
import {
  Bar,
  BarChart,
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
import {
  bmiBand,
  formatNumber,
  initials,
  progressPercent,
} from '@/lib/nutrition-format';
import { normalizedGlycemicClassificationLabel } from '@/lib/glycemic';
import { Brand } from './brand';
import { DateNavigator } from './date-navigator';
import { DailyNutrientComposition } from './daily-journal';
import {
  ChartPanel,
  ContentSkeleton,
  EmptyState,
  Metric,
  PageHeader,
  SectionHeader,
} from './page-primitives';
import { NutrientDetails } from './nutrient-details';
import { MacroDistributionSummary } from './macro-distribution';
import { PatientMealList } from './patient-meal-list';
import { UserIdentity } from './user-identity';
import { useIsMobile } from '@/hooks/use-mobile';
import { NutritionistMealPlan } from './meal-plan';
import { WeeklyPatientSummaryPanel } from './weekly-patient-summary';

import { PatientApp } from './patient-app';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import type {
  NutritionistDetail,
  PatientListItem,
  Summary,
  User,
} from '../types';

type MainArea = 'overview' | 'patients' | 'profile';
type WorkspaceArea = 'overview' | 'plan' | 'diary' | 'progress' | 'analysis' | 'notes';
const nutritionistNav = [
  ['overview', 'Visão geral', LayoutDashboard],
  ['patients', 'Pacientes', UsersRound],
  ['profile', 'Meu diário', CircleUserRound],
] as const;
const workspaceTabs = [
  ['overview', 'Visão geral', LayoutDashboard],
  ['plan', 'Plano', Utensils],
  ['diary', 'Diário', ClipboardList],
  ['progress', 'Evolução', BarChart3],
  ['analysis', 'Resumo', Sparkles],
  ['notes', 'Orientações', MessageSquareText],
] as const;

export function NutritionistApp({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const today = brazilNow().date;
  const [navigation, navigate] = useNavigationState('nutritionist', {
    area: 'overview' as MainArea,
    selected: null as number | null,
    range: 14,
    search: '',
    workspaceTab: 'overview' as WorkspaceArea,
  });
  const { area, selected, range, search, workspaceTab } = navigation;
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [detail, setDetail] = useState<NutritionistDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordPatient, setPasswordPatient] = useState<{
    id: number;
    name: string;
    email: string | null;
    accessStatus: PatientListItem['accessStatus'];
  } | null>(null);
  const [deletePatient, setDeletePatient] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const detailRequest = useRef(0);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      setPatients(await api('/nutritionist/patients'));
    } catch {
      toast.add({
        title: 'Não foi possível carregar os pacientes.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);
  const loadDetail = useCallback(
    async (patientId = selected, nextRange = range) => {
      if (!patientId) return;
      const request = ++detailRequest.current;
      setLoading(true);
      try {
        const nextDetail = await api<NutritionistDetail>(
          `/nutritionist/patients/${patientId}?days=${nextRange}&to=${today}`,
        );
        if (request === detailRequest.current) setDetail(nextDetail);
      } catch {
        if (request === detailRequest.current)
          toast.add({
            title: 'Não foi possível carregar o paciente.',
            type: 'error',
          });
      } finally {
        if (request === detailRequest.current) setLoading(false);
      }
    },
    [selected, range, today],
  );
  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);
  useEffect(() => {
    if (selected) void loadDetail(selected, range);
    else {
      detailRequest.current += 1;
      setDetail(null);
      setLoading(false);
    }
  }, [selected, range, loadDetail]);
  const filtered = useMemo(
    () =>
      patients.filter((patient) =>
        `${patient.name} ${patient.email ?? ''} ${patient.objective || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [patients, search],
  );
  function success(title: string) {
    toast.add({ title, type: 'success' });
  }
  function openPatient(id: number) {
    navigate({ selected: id, workspaceTab: 'overview' });
    setDetail(null);
  }
  function closePatient() {
    detailRequest.current += 1;
    navigate({ selected: null });
    setDetail(null);
  }
  const refreshNutritionistData = useCallback(
    async (options: { patients?: boolean; workspace?: boolean } = {}) => {
      const tasks: Promise<unknown>[] = [];
      if (options.patients) tasks.push(loadPatients());
      if (options.workspace && selected)
        tasks.push(loadDetail(selected, range));
      await Promise.all(tasks);
    },
    [loadDetail, loadPatients, range, selected],
  );

  if (!selected && area === 'profile')
    return (
      <SelfDiaryPortal
        user={user}
        onLogout={onLogout}
        onBack={() => navigate({ area: 'overview' })}
      />
    );

  return (
    <main className="app-canvas nutritionist-app-shell pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <header className="mobile-topbar lg:hidden">
        <Brand compact />
        <nav className="flex items-center gap-1">
          <button onClick={onLogout} className="icon-button" aria-label="Sair">
            <LogOut className="size-4" />
          </button>
        </nav>
      </header>
      <div className="app-frame lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="app-sidebar hidden lg:flex">
          <Brand />
          <nav
            className="mt-10 space-y-1"
            aria-label="Navegação do nutricionista"
          >
            <button
              className="sidebar-link"
              aria-current={
                !selected && area === 'overview' ? 'page' : undefined
              }
              onClick={() => {
                setDetail(null);
                navigate({ selected: null, area: 'overview' });
              }}
            >
              <LayoutDashboard className="size-[18px]" />
              Visão geral
            </button>
            <button
              className="sidebar-link"
              aria-current={
                !selected && area === 'patients' ? 'page' : undefined
              }
              onClick={() => {
                setDetail(null);
                navigate({ selected: null, area: 'patients' });
              }}
            >
              <UsersRound className="size-[18px]" />
              Pacientes
            </button>
            <button
              className="sidebar-link"
              aria-current={!selected && area === 'profile' ? 'page' : undefined}
              onClick={() => {
                setDetail(null);
                navigate({ selected: null, area: 'profile' });
              }}
            >
              <CircleUserRound className="size-[18px]" />
              Meu diário
            </button>
          </nav>
          <div className="mt-auto border-t pt-5">
            <UserIdentity
              name={user.name}
              accountType="Nutricionista"
              onLogout={onLogout}
            />
          </div>
        </aside>
        <div className="min-w-0">
          <div className="content-shell">
            {selected ? (
              detail ? (
                <PatientWorkspace
                  detail={detail}
                  loading={loading}
                  range={range}
                  onRange={(value) => navigate({ range: value })}
                  tab={workspaceTab}
                  onTab={(value) => {
                    navigate({ workspaceTab: value });
                    void refreshNutritionistData({ workspace: true });
                  }}
                  onBack={closePatient}
                  onGoals={() => setGoalOpen(true)}
                  onEditProfile={() => setProfileOpen(true)}
                  onReload={() => refreshNutritionistData({ workspace: true })}
                />
              ) : (
                <>
                  <PageHeader eyebrow="Paciente" title="Abrindo workspace…" />
                  <ContentSkeleton rows={6} />
                </>
              )
            ) : area === 'overview' ? (
              <NutritionistOverview
                user={user}
                patients={patients}
                today={today}
                loading={loading}
                onCreate={() => setCreateOpen(true)}
                onAll={() => navigate({ area: 'patients' })}
                onSelect={openPatient}
              />
            ) : area === 'patients' ? (
              <PatientsArea
                patients={filtered}
                search={search}
                onSearch={(value) =>
                  navigate({ search: value }, { replace: true })
                }
                loading={loading}
                onCreate={() => setCreateOpen(true)}
                onSelect={openPatient}
                onPassword={(patient) => setPasswordPatient(patient)}
                onDelete={(patient) => setDeletePatient(patient)}
              />
            ) : null}
          </div>
        </div>
      </div>
      {!selected && (
        <nav
          className="mobile-bottom-nav nutritionist-bottom-nav lg:hidden"
          aria-label="Navegação principal do nutricionista"
        >
          {nutritionistNav.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => navigate({ area: id })}
              aria-current={area === id ? 'page' : undefined}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      <CreatePatientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async () => {
          await refreshNutritionistData({ patients: true });
          success('Paciente criado. Entregue o código para ativar o acesso.');
        }}
      />
      {selected && detail && (
        <PatientProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          patientId={selected}
          profile={detail.profile}
          onSaved={async () => {
            await refreshNutritionistData({ patients: true, workspace: true });
            success('Dados do acompanhamento atualizados.');
          }}
        />
      )}
      {selected && detail && (
        <GoalsDialog
          open={goalOpen}
          onOpenChange={setGoalOpen}
          patientId={selected}
          goals={detail.today.goals}
          weightKg={detail.today.weight?.weight_kg ?? null}
          onSaved={async () => {
            await refreshNutritionistData({ workspace: true });
            success('Metas atualizadas.');
          }}
        />
      )}
      {passwordPatient && (
        <PatientPasswordDialog
          patient={passwordPatient}
          onOpenChange={(open) => {
            if (!open) setPasswordPatient(null);
          }}
          onSaved={() => {
            setPasswordPatient(null);
            void refreshNutritionistData({ patients: true });
          }}
        />
      )}
      {deletePatient && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeletePatient(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {deletePatient.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Essa ação remove permanentemente o acesso, diário, metas, peso,
                orientações e favoritos deste paciente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  try {
                    await api(`/nutritionist/patients/${deletePatient.id}`, {
                      method: 'DELETE',
                    });
                    setDeletePatient(null);
                    closePatient();
                    await refreshNutritionistData({ patients: true });
                    success('Paciente excluído.');
                  } catch (reason) {
                    toast.add({
                      title:
                        reason instanceof Error
                          ? reason.message
                          : 'Não foi possível excluir o paciente.',
                      type: 'error',
                    });
                  }
                }}
              >
                Excluir paciente
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </main>
  );
}

function NutritionistOverview({
  user,
  patients,
  today,
  loading,
  onCreate,
  onAll,
  onSelect,
}: {
  user: User;
  patients: PatientListItem[];
  today: string;
  loading: boolean;
  onCreate: () => void;
  onAll: () => void;
  onSelect: (id: number) => void;
}) {
  const registeredToday = patients.filter(
    (patient) =>
      patient.last_log_date === today && patient.today.meals.length > 0,
  ).length;
  const withoutGoal = patients.filter((patient) => !patient.today.goals).length;
  const withoutDiary = patients.filter(
    (patient) => !patient.last_log_date,
  ).length;
  const recent = [...patients]
    .sort((a, b) =>
      String(b.last_log_date || '').localeCompare(
        String(a.last_log_date || ''),
      ),
    )
    .slice(0, 5);
  return (
    <div className="animate-content-in">
      <PageHeader
        eyebrow="Visão geral"
        title={`Bom trabalho, ${user.name.replace(/^Dr\.?\s*/i, '').split(' ')[0]}.`}
        description="Acompanhe registros recentes e acesse rapidamente cada paciente."
        action={
          <Button onClick={onCreate}>
            <Plus />
            Novo paciente
          </Button>
        }
      />
      <div className="metric-grid">
        <Metric
          label="Pacientes ativos"
          value={String(patients.length)}
          detail="vinculados a você"
          tone="sage"
        />
        <Metric
          label="Registraram hoje"
          value={String(registeredToday)}
          detail={`de ${patients.length} pacientes`}
          tone="blue"
        />
        <Metric
          label="Com meta ativa"
          value={String(
            patients.filter((patient) => patient.today.goals).length,
          )}
          detail="referências individuais"
        />
        <Metric
          label="Base TBCA"
          value="5.874"
          detail="alimentos cadastrados"
          tone="amber"
        />
      </div>
      <div className="mt-9 grid gap-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <section>
          <SectionHeader
            title="Atividade recente"
            description="Ordenada pelo último dia registrado."
            action={
              <button className="secondary-action" onClick={onAll}>
                Ver pacientes
              </button>
            }
          />
          {loading ? (
            <ContentSkeleton />
          ) : recent.length ? (
            <PatientList patients={recent} onSelect={onSelect} compact />
          ) : (
            <EmptyState
              icon={UsersRound}
              title="Nenhum paciente cadastrado"
              description="Cadastre o primeiro paciente para começar o acompanhamento."
              action={
                <Button onClick={onCreate}>
                  <Plus />
                  Novo paciente
                </Button>
              }
            />
          )}
        </section>
        <aside className="surface-panel h-fit">
          <SectionHeader
            title="Atenção hoje"
            description="Pendências que merecem uma verificação rápida."
          />
          <div className="attention-list">
            <button onClick={onAll}>
              <span className="feature-icon blue">
                <ClipboardList className="size-4" />
              </span>
              <span>
                <strong>{patients.length - registeredToday}</strong>
                <small>sem registro alimentar hoje</small>
              </span>
              <ChevronRight className="ml-auto size-4" />
            </button>
            <button onClick={onAll}>
              <span className="feature-icon">
                <Goal className="size-4" />
              </span>
              <span>
                <strong>{withoutGoal}</strong>
                <small>sem metas definidas</small>
              </span>
              <ChevronRight className="ml-auto size-4" />
            </button>
            <button onClick={onAll}>
              <span className="feature-icon">
                <UsersRound className="size-4" />
              </span>
              <span>
                <strong>{withoutDiary}</strong>
                <small>ainda sem primeiro diário</small>
              </span>
              <ChevronRight className="ml-auto size-4" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PatientsArea({
  patients,
  search,
  onSearch,
  loading,
  onCreate,
  onSelect,
  onPassword,
  onDelete,
}: {
  patients: PatientListItem[];
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onCreate: () => void;
  onSelect: (id: number) => void;
  onPassword: (patient: Pick<PatientListItem, 'id' | 'name' | 'email' | 'accessStatus'>) => void;
  onDelete: (patient: { id: number; name: string }) => void;
}) {
  return (
    <div className="animate-content-in">
      <PageHeader
        eyebrow="Pacientes"
        title="Acompanhamentos"
        description="Busque por nome, e-mail ou objetivo e abra o workspace individual."
        action={
          <Button onClick={onCreate}>
            <Plus />
            Novo paciente
          </Button>
        }
      />
      <div className="relative mb-5 max-w-xl">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="h-12 rounded-2xl bg-white pl-10"
          placeholder="Buscar paciente…"
        />
      </div>
      {loading ? (
        <ContentSkeleton rows={6} />
      ) : patients.length ? (
        <PatientList
          patients={patients}
          onSelect={onSelect}
          onPassword={onPassword}
          onDelete={onDelete}
        />
      ) : (
        <EmptyState
          icon={search ? Search : UsersRound}
          title={
            search ? 'Nenhum paciente encontrado' : 'Sua lista está pronta'
          }
          description={
            search
              ? 'Tente outro nome, e-mail ou termo de busca.'
              : 'Cadastre o primeiro paciente para iniciar o acompanhamento.'
          }
          action={
            search ? undefined : (
              <Button onClick={onCreate}>
                <Plus /> Novo paciente
              </Button>
            )
          }
        />
      )}
    </div>
  );
}

function PatientList({
  patients,
  onSelect,
  onPassword,
  onDelete,
}: {
  patients: PatientListItem[];
  onSelect: (id: number) => void;
  compact?: boolean;
  onPassword?: (patient: Pick<PatientListItem, 'id' | 'name' | 'email' | 'accessStatus'>) => void;
  onDelete?: (patient: { id: number; name: string }) => void;
}) {
  return (
    <div className="patient-list">
      <div className="patient-list-head">
        <span>Paciente</span>
        <span>Peso</span>
        <span>Último diário</span>
        <span>Registro</span>
        <span />
      </div>
      {patients.map((patient) => (
        <div key={patient.id} className="patient-row">
          <button
            onClick={() => onSelect(patient.id)}
            className="patient-row-open"
            aria-label={`Abrir prontuário de ${patient.name}`}
          >
          <span className="flex min-w-0 items-center gap-3">
            <span className="avatar-mark">{initials(patient.name)}</span>
            <span className="min-w-0">
              <strong className="block truncate text-sm">{patient.name}</strong>
              <small className="mt-0.5 block truncate text-muted-foreground">
                {patient.objective || patient.email || 'Aguardando ativação'}
              </small>
              <small className="mt-1 block text-[11px] font-semibold text-primary">
                {patient.accessStatus === 'active'
                  ? 'Acesso ativo'
                  : patient.accessStatus === 'pending_verification'
                    ? 'Aguardando confirmação do e-mail'
                    : 'Aguardando ativação'}
              </small>
              <small className="mt-1 block text-xs text-muted-foreground md:hidden">
                {formatNumber(patient.weight_kg, 1)} kg ·{' '}
                {patient.last_log_date
                  ? `registro em ${formatDate(patient.last_log_date, { day: '2-digit', month: 'short' })}`
                  : 'sem diário registrado'}
              </small>
            </span>
          </span>
          <span className="patient-cell">
            <small>Peso</small>
            <strong>{formatNumber(patient.weight_kg, 1)} kg</strong>
          </span>
          <span className="patient-cell">
            <small>Último diário</small>
            <strong>
              {formatNumber(patient.today.totals.energia_kcal)} kcal
            </strong>
          </span>
          <span className="patient-cell">
            <small>Registro</small>
            <strong>
              {patient.last_log_date
                ? formatDate(patient.last_log_date, {
                    day: '2-digit',
                    month: 'short',
                  })
                : 'Nenhum'}
            </strong>
          </span>
          </button>
          {onPassword || onDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="icon-button subtle size-9"
                aria-label={`Ações de ${patient.name}`}
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onPassword && (
                  <DropdownMenuItem
                    onClick={() =>
                      onPassword({ id: patient.id, name: patient.name, email: patient.email, accessStatus: patient.accessStatus })
                    }
                  >
                    <KeyRound />
                    {patient.accessStatus === 'active'
                      ? 'Enviar restauração de senha'
                      : patient.accessStatus === 'pending_verification'
                        ? 'Reenviar confirmação'
                        : 'Gerar novo código'}
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      onDelete({ id: patient.id, name: patient.name })
                    }
                  >
                    <Trash2 />
                    Excluir paciente
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  );
}

function PatientWorkspace({
  detail,
  loading,
  range,
  tab,
  onTab,
  onRange,
  onBack,
  onGoals,
  onEditProfile,
  onReload,
}: {
  detail: NutritionistDetail;
  loading: boolean;
  range: number;
  tab: WorkspaceArea;
  onTab: (value: WorkspaceArea) => void;
  onRange: (value: number) => void;
  onBack: () => void;
  onGoals: () => void;
  onEditProfile: () => void;
  onReload: () => void;
}) {
  const profile = detail.profile;
  return (
    <div className="nutritionist-workspace pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <div className="animate-content-in">
        <header className="patient-workspace-header">
          <button
            onClick={onBack}
            className="workspace-back"
            aria-label="Voltar para pacientes"
            title="Voltar para pacientes"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="patient-workspace-avatar">
            {initials(String(profile.name))}
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Prontuário nutricional</p>
            <h1 className="page-title">{String(profile.name)}</h1>
            <p className="page-description line-clamp-2 sm:line-clamp-none">
              {detail.today.patient.age == null
                ? 'Idade não informada'
                : `${detail.today.patient.age} anos`}{' '}
              · {formatNumber(detail.today.weight?.weight_kg, 1)} kg ·{' '}
              {formatNumber(Number(profile.height_cm))} cm ·{' '}
              {String(profile.objective || 'Objetivo não informado')}
            </p>
          </div>
          <div className="workspace-actions">
            <Button variant="outline" onClick={onEditProfile}>
              Editar dados
            </Button>
            <Button variant="outline" onClick={onGoals}>
              <Goal />
              Ajustar metas
            </Button>
          </div>
        </header>
        <nav
          className="workspace-tabs hidden lg:flex"
          aria-label="Áreas do paciente"
        >
          {workspaceTabs.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={tab === id ? 'page' : undefined}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          {tab === 'overview' && (
            <PatientOverview
              detail={detail}
              onFeedback={() => onTab('notes')}
            />
          )}
          {tab === 'overview' && (
            <ActivityPanel
              date={detail.today.date}
              patientId={Number(profile.id)}
              professional
              compact
              onProgress={() => onTab('progress')}
            />
          )}
          {tab === 'diary' && <PatientDiary detail={detail} />}
          {tab === 'plan' && (
            <NutritionistMealPlan patientId={Number(profile.id)} />
          )}
          {tab === 'progress' && (
            <>
              <EnergyProgress patientId={Number(profile.id)} professional />
              <PatientProgress detail={detail} range={range} onRange={onRange} />
            </>
          )}
          {tab === 'analysis' && (
            <>
              <WeeklyPatientSummaryPanel
                patientId={Number(profile.id)}
                onOpenDiary={() => onTab('diary')}
                onSendOrientation={() => onTab('notes')}
              />
              <details className="mx-auto mt-4 max-w-[76rem] rounded-2xl border bg-background px-4">
                <summary className="flex min-h-12 cursor-pointer items-center justify-center font-semibold text-sm text-muted-foreground">
                  Ver análise nutricional completa
                </summary>
                <PatientAnalysis detail={detail} range={range} onRange={onRange} />
              </details>
            </>
          )}
          {tab === 'notes' && (
            <PatientFeedback detail={detail} onSaved={onReload} />
          )}
        </div>
      </div>
      <nav
        className="mobile-bottom-nav lg:hidden"
        aria-label="Áreas do paciente"
      >
        {workspaceTabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            <Icon className="size-5" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function RangePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="range-picker" aria-label="Período da análise">
      {[7, 14, 30].map((days) => (
        <button
          key={days}
          onClick={() => onChange(days)}
          aria-pressed={value === days}
        >
          {days} dias
        </button>
      ))}
    </div>
  );
}

function PatientOverview({
  detail,
  onFeedback,
}: {
  detail: NutritionistDetail;
  onFeedback: () => void;
}) {
  const today = detail.today;
  const lastNote = detail.notes[0];
  const profile = detail.profile;
  const goals = today.goals;
  const recentDays = detail.period.days.slice(-10);
  const maxEnergy = Math.max(
    Number(goals?.energy_kcal ?? 0),
    ...recentDays.map((day) => Number(day.totals.energia_kcal ?? 0)),
    1,
  );
  return (
    <div className="patient-record-layout">
      <section className="patient-clinical-sheet">
        <header className="clinical-sheet-heading">
          <div>
            <p className="eyebrow">Ficha resumida</p>
            <h2>Ficha do paciente</h2>
          </div>
          <div className="clinical-objective">
            <small>Objetivo atual</small>
            <strong>{String(profile.objective || 'Não informado')}</strong>
          </div>
        </header>

        <div className="clinical-vitals">
          <span className="clinical-section-icon"><Weight className="size-5" /></span>
          <dl>
            <ClinicalValue
              label="Idade"
              value={today.patient.age == null ? '—' : `${today.patient.age} anos`}
            />
            <ClinicalValue
              label="Peso atual"
              value={`${formatNumber(today.weight?.weight_kg, 1)} kg`}
              detail={today.weight ? formatDate(today.weight.weighed_at, { day: '2-digit', month: 'short' }) : 'Sem pesagem'}
            />
            <ClinicalValue
              label="Altura"
              value={`${formatNumber(Number(profile.height_cm))} cm`}
            />
            <ClinicalValue
              label="IMC"
              value={formatNumber(today.metrics.bmi, 1)}
              detail={bmiBand(today.metrics.bmi)?.label ?? 'Indisponível'}
            />
            <ClinicalValue
              label="Metabolismo basal"
              value={`${formatNumber(today.metrics.basalKcal)} kcal`}
              detail="Mifflin-St Jeor"
            />
          </dl>
        </div>

        <div className="clinical-sheet-columns">
          <section className="clinical-planning">
            <header>
              <div>
                <p className="clinical-kicker">Planejamento nutricional</p>
                <h3>Distribuição planejada</h3>
              </div>
              <p className="planned-energy">
                <strong>{formatNumber(goals?.energy_kcal)}</strong>
                <span>kcal / dia</span>
              </p>
            </header>
            <MacroDistributionSummary goals={goals} />
            <div className="planning-macro-energy" aria-label="Energia planejada por macronutriente">
              <span>{formatNumber(goals?.carbohydrate_g == null ? null : goals.carbohydrate_g * 4)} kcal</span>
              <span>{formatNumber(goals?.protein_g == null ? null : goals.protein_g * 4)} kcal</span>
              <span>{formatNumber(goals?.fat_g == null ? null : goals.fat_g * 9)} kcal</span>
            </div>
          </section>

          <section className="clinical-context">
            <header>
              <span className="clinical-section-icon"><ShieldAlert className="size-5" /></span>
              <div>
                <p className="clinical-kicker">Contexto clínico</p>
                <h3>Cuidados alimentares</h3>
              </div>
            </header>
            <dl>
              <div>
                <dt>Restrições alimentares</dt>
                <dd>{String(profile.food_restrictions || 'Nenhuma informada')}</dd>
              </div>
              <div>
                <dt>Alergias</dt>
                <dd>{String(profile.allergies || 'Nenhuma informada')}</dd>
              </div>
            </dl>
          </section>
        </div>

        <footer className="clinical-feedback">
          <div>
            <p className="clinical-kicker">Último feedback</p>
            {lastNote ? (
              <p>
                <strong>{formatDateTime(lastNote.created_at)}</strong>
                <span>{lastNote.content}</span>
              </p>
            ) : (
              <p><span>Nenhuma anotação registrada.</span></p>
            )}
          </div>
          <button className="secondary-action" onClick={onFeedback}>Ver feedbacks</button>
        </footer>
      </section>

      <section className="patient-history-flow">
        <header>
          <div>
            <p className="eyebrow">Evolução recente</p>
            <h2>Ritmo de registros</h2>
          </div>
          <p>
            <strong>{detail.period.registeredDays}</strong> dias registrados de{' '}
            {detail.period.totalDays}
          </p>
        </header>
        <div className="history-energy-bars" aria-label="Energia registrada nos dias recentes">
          {recentDays.map((day) => {
            const energy = Number(day.totals.energia_kcal ?? 0);
            return (
              <div key={day.date} title={`${formatDate(day.date, { day: '2-digit', month: 'short' })}: ${formatNumber(energy)} kcal`}>
                <span style={{ height: `${Math.max(energy ? 10 : 2, (energy / maxEnergy) * 100)}%` }} />
                <small>{formatDate(day.date, { weekday: 'narrow' })}</small>
              </div>
            );
          })}
        </div>
        <p className="history-caption">
          Energia diária registrada · a análise completa permanece na aba Evolução.
        </p>
      </section>
    </div>
  );
}

function ClinicalValue({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function PatientDiary({ detail }: { detail: NutritionistDetail }) {
  const [date, setDate] = useState(detail.today.date);
  const [summary, setSummary] = useState<Summary>(detail.today);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api<Summary>(
      `/patient/today?patientId=${detail.profile.id}&date=${date}`,
    )
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, detail.profile.id]);
  const weightKg = summary.weight?.weight_kg;
  const waterGoal =
    summary.waterGoalMl ??
    (weightKg != null && weightKg > 0 ? weightKg * 40 : null);
  const goals = summary.goals ?? {};
  const consumedEnergy = Number(summary.totals.energia_kcal ?? 0);
  const remainingEnergy = goals.energy_kcal == null
    ? null
    : goals.energy_kcal - consumedEnergy;
  const macros = [
    ['Proteína', summary.totals.proteina_g, goals.protein_g, 'protein', summary.energy.proteinKcal, summary.energy.proteinPercent],
    ['Carboidrato', summary.totals.carboidrato_g, goals.carbohydrate_g, 'carb', summary.energy.carbohydrateKcal, summary.energy.carbohydratePercent],
    ['Gordura', summary.totals.lipideos_g, goals.fat_g, 'fat', summary.energy.fatKcal, summary.energy.fatPercent],
  ] as const;
  return (
    <div className="nutritionist-diary">
      <DateNavigator date={date} onChange={setDate} loading={loading} />
      <ActivityPanel date={date} patientId={Number(detail.profile.id)} professional />
      <div className={`day-content-transition ${loading ? 'is-loading' : ''}`}>
        <div className="nutritionist-day-grid">
          <section className="day-composition-panel">
            <header>
              <div>
                <p className="clinical-kicker">Leitura rápida</p>
                <h3>Composição nutricional do dia</h3>
              </div>
              <span>{summary.meals.reduce((sum, meal) => sum + meal.entries.length, 0)} alimentos</span>
            </header>
            <div className="day-energy-row">
              <div>
                <strong>{formatNumber(consumedEnergy)}</strong>
                <span>kcal consumidas</span>
              </div>
              <p>
                {remainingEnergy == null
                  ? 'Sem meta energética'
                  : remainingEnergy >= 0
                    ? `${formatNumber(remainingEnergy)} kcal restantes`
                    : `${formatNumber(Math.abs(remainingEnergy))} kcal acima da meta`}
              </p>
            </div>
            <div className="day-energy-track" data-over={remainingEnergy != null && remainingEnergy < 0 ? 'true' : 'false'}>
              <span style={{ width: `${progressPercent(consumedEnergy, goals.energy_kcal)}%` }} />
            </div>
            <div className="day-macro-lines">
              {macros.map(([label, value, goal, tone, kcal, percent]) => (
                <details key={label} data-tone={tone} className="day-macro-disclosure">
                  <summary aria-label={`Ver energia de ${label}`}>
                    <p>
                      <strong>{label}</strong>
                      <span>{formatNumber(value, 1)} / {formatNumber(goal, 1)} g</span>
                      <ChevronDown className="day-macro-chevron size-3" />
                    </p>
                    <i><span style={{ width: `${progressPercent(Number(value ?? 0), goal)}%` }} /></i>
                  </summary>
                  <div className="day-macro-expanded">
                    <strong>{formatNumber(kcal)} kcal</strong>
                    <span>{formatNumber(percent)}% das calorias consumidas</span>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>

        <section className="nutritionist-meals-flow">
          <header>
            <div>
              <p className="clinical-kicker">Diário alimentar</p>
              <h3>Refeições</h3>
            </div>
            <p>Abra uma refeição para ver alimentos, quantidades e nutrientes.</p>
          </header>
          <PatientMealList summary={summary} />
          <DailyNutrientComposition summary={summary} />
        </section>

        <section className="day-context-panel day-context-footer">
          <header>
            <div>
              <p className="clinical-kicker">Registros complementares</p>
              <h3>Contexto do dia</h3>
            </div>
          </header>
          <dl>
            <div>
              <dt>Hidratação</dt>
              <dd>{formatNumber(summary.log.water_ml)} ml</dd>
              <small>{waterGoal == null ? 'Meta indisponível' : `de ${formatNumber(waterGoal)} ml`}</small>
            </div>
            <div>
              <dt>Treino</dt>
              <dd>{summary.log.training || 'Não informado'}</dd>
            </div>
            <div className="day-context-note">
              <dt>Observação do paciente</dt>
              <dd>{summary.log.note || 'Nenhuma observação neste dia.'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function PatientProgress({
  detail,
  range,
  onRange,
}: {
  detail: NutritionistDetail;
  range: number;
  onRange: (value: number) => void;
}) {
  const chart = detail.period.days.map((day) => ({
    date: day.date.slice(5).split('-').reverse().join('/'),
    kcal: Math.round(day.totals.energia_kcal ?? 0),
    protein: Math.round(day.totals.proteina_g ?? 0),
    glycemic: day.glycemic.per1000Kcal ?? day.glycemic.normalizedGL,
  }));
  const periodGlycemic = detail.period.glycemic;
  const periodClassification = periodGlycemic.classification
    ? normalizedGlycemicClassificationLabel[periodGlycemic.classification]
    : null;
  return (
    <div className="workspace-tab-body">
      <div className="flex justify-end">
        <RangePicker value={range} onChange={onRange} />
      </div>
      <div className="metric-grid mt-5">
        <Metric
          label="CG / 1.000 kcal (período)"
          className="col-span-full lg:col-span-2"
          value={
            (periodGlycemic.per1000Kcal ?? periodGlycemic.normalizedGL) != null
              ? `${formatNumber(periodGlycemic.per1000Kcal ?? periodGlycemic.normalizedGL, 1)} / 1.000 kcal`
              : '—'
          }
          detail={
            periodGlycemic.coveredDays
              ? `${periodGlycemic.coveredDays} dias calculados${periodClassification ? ` · ${periodClassification}` : ''}`
              : 'Sem CG e energia suficientes'
          }
          tone="amber"
        />
      </div>
      <div className="grid gap-7 xl:grid-cols-2">
        <ChartPanel title="Energia e proteína" hasData={chart.length > 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 5, right: 6, left: -18 }}>
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
              <Bar
                yAxisId="energy"
                dataKey="kcal"
                name="Energia"
                fill="var(--chart-amber)"
                radius={[5, 5, 0, 0]}
              />
              <Line
                yAxisId="protein"
                type="monotone"
                dataKey="protein"
                name="Proteína"
                stroke="var(--chart-sage)"
                strokeWidth={2.4}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel
          title="Carga glicêmica relativa"
          description="CG por 1.000 kcal nos dias com dados suficientes"
          hasData={chart.some((item) => item.glycemic != null)}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 6, right: 8, left: -18 }}>
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
          className="order-first"
          hasData={detail.weights.length > 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={detail.weights.map((item) => ({
                date: item.weighed_at.slice(5).split('-').reverse().join('/'),
                peso: item.weight_kg,
              }))}
              margin={{ top: 6, right: 12, left: -18 }}
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

function PatientAnalysis({
  detail,
  range,
  onRange,
}: {
  detail: NutritionistDetail;
  range: number;
  onRange: (value: number) => void;
}) {
  const avg = detail.period.average;
  const goals = detail.today.goals;
  const periodGlycemic = detail.period.glycemic;
  const periodClassification = periodGlycemic.classification
    ? normalizedGlycemicClassificationLabel[periodGlycemic.classification]
    : null;
  return (
    <div className="workspace-tab-body">
      <div className="flex justify-end">
        <RangePicker value={range} onChange={onRange} />
      </div>
      <div className="metric-grid">
        <Metric
          label="Energia média"
          value={`${formatNumber(avg.energia_kcal)} kcal`}
          detail={
            goals?.energy_kcal
              ? `${formatNumber(progressPercent(avg.energia_kcal ?? 0, goals.energy_kcal))}% da meta`
              : 'sem meta'
          }
          tone="sage"
        />
        <Metric
          label="Proteína média"
          value={`${formatNumber(avg.proteina_g, 1)} g`}
          detail={
            goals?.protein_g
              ? `meta ${formatNumber(goals.protein_g)} g`
              : 'sem meta'
          }
          tone="blue"
        />
        <Metric
          label="Carboidrato médio"
          value={`${formatNumber(avg.carboidrato_g, 1)} g`}
          detail={
            goals?.carbohydrate_g
              ? `meta ${formatNumber(goals.carbohydrate_g)} g`
              : 'sem meta'
          }
          tone="amber"
        />
        <Metric
          label="Fibra média"
          value={`${formatNumber(avg.fibra_g, 1)} g`}
          detail={
            goals?.fiber_g
              ? `meta ${formatNumber(goals.fiber_g)} g`
              : 'sem meta'
          }
        />
        <Metric
          label="CG / 1.000 kcal"
          className="col-span-full lg:col-span-2"
          value={
            (periodGlycemic.per1000Kcal ?? periodGlycemic.normalizedGL) != null
              ? `${formatNumber(periodGlycemic.per1000Kcal ?? periodGlycemic.normalizedGL, 1)} / 1.000 kcal`
              : '—'
          }
          detail={
            periodGlycemic.coveredDays
              ? `${periodGlycemic.coveredDays} dias calculados${periodClassification ? ` · ${periodClassification}` : ''}`
              : 'Sem CG e energia suficientes'
          }
          tone="amber"
        />
      </div>
      <div className="mt-8">
        <NutrientDetails
          values={avg}
          catalog={detail.today.nutrientCatalog}
          title="Composição média detalhada"
          description="Ausências permanecem indisponíveis e nunca são convertidas em zero."
        />
      </div>
    </div>
  );
}

function PatientFeedback({
  detail,
  onSaved,
}: {
  detail: NutritionistDetail;
  onSaved: () => void | Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'patient'>('patient');
  const [loading, setLoading] = useState(false);
  async function addNote() {
    if (!note.trim()) return;
    setLoading(true);
    try {
      await api(`/nutritionist/patients/${detail.profile.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: note, visibility }),
      });
      setNote('');
      toast.add({
        title:
          visibility === 'private'
            ? 'Anotação privada salva.'
            : 'Orientação enviada ao paciente.',
        type: 'success',
      });
      await onSaved();
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="workspace-tab-body">
      <div className="grid gap-7 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="surface-panel h-fit">
          <div className="segmented-control">
            <button
              onClick={() => setVisibility('private')}
              aria-pressed={visibility === 'private'}
            >
              <FileLock2 className="size-4" />
              Privada
            </button>
            <button
              onClick={() => setVisibility('patient')}
              aria-pressed={visibility === 'patient'}
            >
              <MessageSquareText className="size-4" />
              Paciente
            </button>
          </div>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-4 min-h-36"
            placeholder={
              visibility === 'private'
                ? 'Observação clínica que somente você verá…'
                : 'Orientação que ficará visível para o paciente…'
            }
          />
          <Button
            onClick={addNote}
            disabled={!note.trim() || loading}
            className="mt-4 w-full"
          >
            {loading
              ? 'Salvando…'
              : visibility === 'private'
                ? 'Salvar anotação'
                : 'Compartilhar orientação'}
          </Button>
        </section>
        <section>
          <SectionHeader
            title="Histórico"
            description={`${detail.notes.length} registros`}
          />
          {detail.notes.length ? (
            <div className="space-y-3">
              {detail.notes.map((item) => (
                <article key={item.id} className="feedback-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="status-badge"
                      data-tone={
                        item.visibility === 'private' ? 'private' : 'shared'
                      }
                    >
                      {item.visibility === 'private'
                        ? 'Privada'
                        : 'Visível ao paciente'}
                    </span>
                    <time className="text-xs text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </time>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7">
                    {item.content}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={MessageSquareText}
              title="Nenhum feedback registrado"
              description="Use o painel ao lado para criar a primeira anotação ou orientação."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PatientProfileDialog({
  open,
  onOpenChange,
  patientId,
  profile,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number;
  profile: Record<string, string | number | null>;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    birthDate: '',
    heightCm: '',
    objective: '',
    activityLevel: 'moderate',
    foodPreferences: '',
    foodRestrictions: '',
    allergies: '',
    mealRoutine: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setForm({
      birthDate: String(profile.birth_date || ''),
      heightCm: String(profile.height_cm || ''),
      objective: String(profile.objective || ''),
      activityLevel: String(profile.activity_level || 'moderate'),
      foodPreferences: String(profile.food_preferences || ''),
      foodRestrictions: String(profile.food_restrictions || ''),
      allergies: String(profile.allergies || ''),
      mealRoutine: String(profile.meal_routine || ''),
    });
    setError('');
  }, [open, profile]);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    const heightCm = Number(form.heightCm);
    if (
      !form.birthDate ||
      !Number.isFinite(heightCm) ||
      heightCm <= 0 ||
      !form.objective.trim() ||
      !form.foodPreferences.trim() ||
      !form.foodRestrictions.trim() ||
      !form.allergies.trim() ||
      !form.mealRoutine.trim()
    ) {
      setError('Preencha todos os campos do acompanhamento.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api(`/nutritionist/patients/${patientId}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, heightCm }),
      });
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar os dados.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar acompanhamento</DialogTitle>
          <DialogDescription>
            Atualize os dados pessoais e alimentares usados no prontuário.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nascimento">
            <Input type="date" value={form.birthDate} onChange={(event) => set('birthDate', event.target.value)} />
          </Field>
          <Field label="Altura (cm)">
            <Input type="number" value={form.heightCm} onChange={(event) => set('heightCm', event.target.value)} />
          </Field>
          <Field label="Nível de atividade">
            <select
              value={form.activityLevel}
              onChange={(event) => set('activityLevel', event.target.value)}
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm"
            >
              <option value="sedentary">Sedentário</option>
              <option value="light">Leve</option>
              <option value="moderate">Moderado</option>
              <option value="active">Ativo</option>
              <option value="very_active">Muito ativo</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Objetivo">
              <Textarea value={form.objective} onChange={(event) => set('objective', event.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Preferências alimentares">
              <Textarea value={form.foodPreferences} onChange={(event) => set('foodPreferences', event.target.value)} />
            </Field>
          </div>
          <Field label="Restrições alimentares">
            <Textarea value={form.foodRestrictions} onChange={(event) => set('foodRestrictions', event.target.value)} />
          </Field>
          <Field label="Alergias">
            <Textarea value={form.allergies} onChange={(event) => set('allergies', event.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Rotina alimentar">
              <Textarea value={form.mealRoutine} onChange={(event) => set('mealRoutine', event.target.value)} />
            </Field>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={save} disabled={loading}>
          {loading ? 'Salvando…' : 'Salvar dados'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function SelfDiaryPortal({
  user,
  onLogout,
  onBack,
}: {
  user: User;
  onLogout: () => void;
  onBack: () => void;
}) {
  const [patientId, setPatientId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api<{ patientId: number }>('/nutritionist/self-diary', { method: 'POST' })
      .then((result) => {
        if (active) setPatientId(result.patientId);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Não foi possível abrir seu diário.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error)
    return (
      <EmptyState
        title="Seu diário não abriu"
        description={error}
        action={<Button onClick={onBack}>Voltar à área profissional</Button>}
      />
    );
  if (patientId == null) return <ContentSkeleton rows={6} />;
  return (
    <div className="nutritionist-self-diary-portal">
      <PatientApp
        user={user}
        onLogout={onLogout}
        professionalMode
        selfPatientId={patientId}
        onProfessionalBack={onBack}
      />
    </div>
  );
}

function CreatePatientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreated: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: '',
    birthDate: '',
    sex: 'male',
    heightCm: '170',
    weightKg: '70',
    energyKcal: '2000',
    dailyActivityFactor: '1',
    carbohydratePercent: '50',
    proteinPercent: '20',
    fatPercent: '30',
    objective: '',
    activityLevel: 'moderate',
    foodPreferences: '',
    foodRestrictions: '',
    allergies: '',
    mealRoutine: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [step, setStep] = useState(0);
  const isMobile = useIsMobile();
  const steps = ['Dados pessoais', 'Acompanhamento', 'Alimentação', 'Planejamento'];
  const basalKcal = useMemo(() => {
    const [birthYear, birthMonth, birthDay] = form.birthDate.split('-').map(Number);
    const [currentYear, currentMonth, currentDay] = brazilNow().date.split('-').map(Number);
    const heightCm = Number(form.heightCm);
    const weightKg = Number(form.weightKg);
    if (
      !birthYear ||
      !birthMonth ||
      !birthDay ||
      !Number.isFinite(heightCm) ||
      heightCm <= 0 ||
      !Number.isFinite(weightKg) ||
      weightKg <= 0
    )
      return null;
    let age = currentYear - birthYear;
    if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) age--;
    const sexConstant = form.sex === 'male' ? 5 : form.sex === 'female' ? -161 : null;
    if (age < 0 || sexConstant == null) return null;
    return 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant;
  }, [form.birthDate, form.heightCm, form.sex, form.weightKg]);
  const everydayKcal = useMemo(() => {
    const factor = Number(form.dailyActivityFactor);
    return basalKcal != null && Number.isFinite(factor) && factor >= 1
      ? basalKcal * factor
      : null;
  }, [basalKcal, form.dailyActivityFactor]);
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  function advance() {
    const numeric = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0;
    const valid = [
      Boolean(form.name.trim() && form.birthDate && form.sex && numeric(form.heightCm)),
      Boolean(form.objective.trim() && form.activityLevel && numeric(form.weightKg)),
      Boolean(form.foodPreferences.trim() && form.foodRestrictions.trim() && form.allergies.trim() && form.mealRoutine.trim()),
      Boolean(
        numeric(form.energyKcal) &&
          Number(form.dailyActivityFactor) >= 1 &&
          Number(form.dailyActivityFactor) <= 2.5 &&
          Math.abs(Number(form.carbohydratePercent) + Number(form.proteinPercent) + Number(form.fatPercent) - 100) <= 0.001,
      ),
    ][step];
    if (!valid) {
      setError(
        step === 3
          ? 'Informe uma meta energética válida e ajuste os macros para totalizar 100%.'
          : 'Preencha os campos desta etapa antes de continuar.',
      );
      return;
    }
    setError('');
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }
  async function create() {
    const heightCm = Number(form.heightCm);
    const weightKg = Number(form.weightKg);
    const energyKcal = Number(form.energyKcal);
    const dailyActivityFactor = Number(form.dailyActivityFactor);
    const carbohydratePercent = Number(form.carbohydratePercent);
    const proteinPercent = Number(form.proteinPercent);
    const fatPercent = Number(form.fatPercent);
    const macroTotal = carbohydratePercent + proteinPercent + fatPercent;
    if (
      !Number.isFinite(heightCm) ||
      heightCm <= 0 ||
      !Number.isFinite(weightKg) ||
      weightKg <= 0 ||
      !Number.isFinite(energyKcal) ||
      energyKcal <= 0 ||
      !Number.isFinite(dailyActivityFactor) ||
      dailyActivityFactor < 1 ||
      dailyActivityFactor > 2.5
    ) {
      setError('Informe altura, peso e meta energética válidos.');
      return;
    }
    if (Math.abs(macroTotal - 100) > 0.001) {
      setError('A distribuição dos macronutrientes precisa totalizar 100%.');
      return;
    }
    if (
      !form.birthDate ||
      !form.objective.trim() ||
      !form.foodPreferences.trim() ||
      !form.foodRestrictions.trim() ||
      !form.allergies.trim() ||
      !form.mealRoutine.trim()
    ) {
      setError('Preencha todos os dados pessoais e alimentares do acompanhamento.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api<{ activationCode: string }>('/nutritionist/patients', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          heightCm,
          weightKg,
          energyKcal,
          dailyActivityFactor,
          carbohydratePercent,
          proteinPercent,
          fatPercent,
          birthDate: form.birthDate,
        }),
      });
      setActivationCode(result.activationCode);
      await onCreated();
      setForm({
        name: '',
        birthDate: '',
        sex: 'male',
        heightCm: '170',
        weightKg: '70',
        energyKcal: '2000',
        dailyActivityFactor: '1',
        carbohydratePercent: '50',
        proteinPercent: '20',
        fatPercent: '30',
        objective: '',
        activityLevel: 'moderate',
        foodPreferences: '',
        foodRestrictions: '',
        allergies: '',
        mealRoutine: '',
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível criar.',
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) { setActivationCode(''); setStep(0); } onOpenChange(value); }}>
      <DialogContent className="patient-create-dialog max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo paciente</DialogTitle>
          <DialogDescription>
            O cadastro cria também um acesso exclusivo para o paciente.
          </DialogDescription>
        </DialogHeader>
        {activationCode ? (
          <div className="space-y-5 py-2">
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 text-center">
              <p className="text-sm font-semibold text-primary">Código de ativação do paciente</p>
              <strong className="mt-3 block font-mono text-3xl tracking-[0.12em] text-primary">{activationCode}</strong>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Válido por 7 dias e apenas para o primeiro acesso.</p>
            </div>
            <Button className="w-full" onClick={async () => { await navigator.clipboard.writeText(activationCode); toast.add({ title: 'Código copiado.', type: 'success' }); }}>
              Copiar código
            </Button>
            <Button variant="outline" className="w-full" onClick={() => { setActivationCode(''); setStep(0); onOpenChange(false); }}>Concluir</Button>
          </div>
        ) : <>
        {isMobile && (
          <div className="patient-create-progress" aria-label={`Etapa ${step + 1} de ${steps.length}: ${steps[step]}`}>
            <div>
              <span>Etapa {step + 1} de {steps.length}</span>
              <strong>{steps[step]}</strong>
            </div>
            <div className="patient-create-progress-track">
              {steps.map((label, index) => (
                <i key={label} data-state={index < step ? 'done' : index === step ? 'current' : 'next'} />
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo" className="patient-create-field" active={!isMobile || step === 0}>
            <Input
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>
          <Field label="Nascimento" className="patient-create-field" active={!isMobile || step === 0}>
            <Input
              type="date"
              value={form.birthDate}
              onChange={(event) => set('birthDate', event.target.value)}
            />
          </Field>
          <Field label="Sexo para cálculos" className="patient-create-field" active={!isMobile || step === 0}>
            <select
              value={form.sex}
              onChange={(event) => set('sex', event.target.value)}
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm"
            >
              <option value="male">Masculino</option>
              <option value="female">Feminino</option>
              <option value="other">Outro</option>
            </select>
          </Field>
          <Field label="Altura (cm)" className="patient-create-field" active={!isMobile || step === 0}>
              <Input
                type="number"
                value={form.heightCm}
                onChange={(event) => set('heightCm', event.target.value)}
              />
          </Field>
          <Field label="Peso inicial (kg)" className="patient-create-field" active={!isMobile || step === 1}>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={form.weightKg}
                onChange={(event) => set('weightKg', event.target.value)}
              />
          </Field>
          <div className="patient-create-field sm:col-span-2" data-active={!isMobile || step === 1}>
            <Field label="Objetivo">
              <Textarea
                value={form.objective}
                onChange={(event) => set('objective', event.target.value)}
                placeholder="Ex.: melhorar composição corporal…"
              />
            </Field>
          </div>
          <Field label="Nível de atividade" className="patient-create-field" active={!isMobile || step === 1}>
            <select
              value={form.activityLevel}
              onChange={(event) => set('activityLevel', event.target.value)}
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm"
            >
              <option value="sedentary">Sedentário</option>
              <option value="light">Leve</option>
              <option value="moderate">Moderado</option>
              <option value="active">Ativo</option>
              <option value="very_active">Muito ativo</option>
            </select>
          </Field>
          <div className="patient-create-field sm:col-span-2" data-active={!isMobile || step === 2}>
            <Field label="Preferências alimentares">
              <Textarea
                value={form.foodPreferences}
                onChange={(event) => set('foodPreferences', event.target.value)}
              />
            </Field>
          </div>
          <Field label="Restrições alimentares" className="patient-create-field" active={!isMobile || step === 2}>
            <Textarea
              value={form.foodRestrictions}
              onChange={(event) => set('foodRestrictions', event.target.value)}
            />
          </Field>
          <Field label="Alergias" className="patient-create-field" active={!isMobile || step === 2}>
            <Textarea
              value={form.allergies}
              onChange={(event) => set('allergies', event.target.value)}
            />
          </Field>
          <div className="patient-create-field sm:col-span-2" data-active={!isMobile || step === 2}>
            <Field label="Rotina alimentar">
              <Textarea
                value={form.mealRoutine}
                onChange={(event) => set('mealRoutine', event.target.value)}
              />
            </Field>
          </div>
          <section className="patient-create-field macro-goal-editor sm:col-span-2" data-active={!isMobile || step === 3}>
            <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-primary">Gasto cotidiano estimado</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Basal de {basalKcal == null ? '—' : `${formatNumber(basalKcal)} kcal`} × fator cotidiano.
                </p>
              </div>
              <strong className="shrink-0 font-display text-xl text-primary">
                {everydayKcal == null ? '—' : `${formatNumber(everydayKcal)} kcal`}
              </strong>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Metas iniciais
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Podem ser ajustadas depois no workspace do paciente.
                </p>
              </div>
              <GoalInput
                label="Energia (kcal)"
                value={form.energyKcal}
                onChange={(value) => set('energyKcal', value)}
              />
            </div>
            <div className="mt-4 rounded-2xl border border-primary/15 bg-white p-4">
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_11rem]">
                <div>
                  <p className="text-sm font-medium">Fator cotidiano</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Multiplica a basal para representar sua rotina sem treino. A digestão dos alimentos e os exercícios registrados são somados separadamente.
                  </p>
                </div>
                <GoalInput
                  label="Fator sobre a basal"
                  value={form.dailyActivityFactor}
                  step="0.05"
                  onChange={(value) => set('dailyActivityFactor', value)}
                />
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MacroGoalControl
                label="Carboidratos"
                tone="carb"
                value={form.carbohydratePercent}
                grams={
                  (Number(form.energyKcal) *
                    (Number(form.carbohydratePercent) / 100)) /
                  4
                }
                kcal={
                  Number(form.energyKcal) *
                  (Number(form.carbohydratePercent) / 100)
                }
                onChange={(value) => set('carbohydratePercent', value)}
              />
              <MacroGoalControl
                label="Proteínas"
                tone="protein"
                value={form.proteinPercent}
                grams={
                  (Number(form.energyKcal) *
                    (Number(form.proteinPercent) / 100)) /
                  4
                }
                kcal={
                  Number(form.energyKcal) * (Number(form.proteinPercent) / 100)
                }
                onChange={(value) => set('proteinPercent', value)}
              />
              <MacroGoalControl
                label="Gorduras"
                tone="fat"
                value={form.fatPercent}
                grams={
                  (Number(form.energyKcal) * (Number(form.fatPercent) / 100)) /
                  9
                }
                kcal={Number(form.energyKcal) * (Number(form.fatPercent) / 100)}
                onChange={(value) => set('fatPercent', value)}
              />
            </div>
            <p className="mt-3 text-right text-xs font-semibold text-muted-foreground">
              Total:{' '}
              {formatNumber(
                Number(form.carbohydratePercent) +
                  Number(form.proteinPercent) +
                  Number(form.fatPercent),
              )}
              %
            </p>
          </section>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {isMobile ? (
          <div className="patient-create-actions">
            <Button variant="ghost" onClick={() => { setError(''); setStep((current) => Math.max(0, current - 1)); }} disabled={step === 0 || loading}>
              Voltar
            </Button>
            <Button onClick={step === steps.length - 1 ? create : advance} disabled={loading}>
              {loading ? 'Criando…' : step === steps.length - 1 ? 'Criar paciente' : 'Continuar'}
            </Button>
          </div>
        ) : (
          <Button onClick={create} disabled={loading}>
            {loading ? 'Criando…' : 'Criar paciente e gerar código'}
          </Button>
        )}
        </>}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className = '',
  active,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <label className={`space-y-2 ${className}`} data-active={active}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function PatientPasswordDialog({
  patient,
  onOpenChange,
  onSaved,
}: {
  patient: Pick<PatientListItem, 'id' | 'name' | 'email' | 'accessStatus'>;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ message?: string; previewUrl?: string | null; activationCode?: string } | null>(null);
  async function send() {
    setLoading(true);
    setError('');
    try {
      const path = patient.accessStatus === 'active'
        ? 'password-reset-email'
        : patient.accessStatus === 'pending_verification'
          ? 'email-verification'
          : 'activation-code';
      const response = await api<{ message?: string; previewUrl?: string | null; activationCode?: string; deliveryStatus?: string }>(
        `/nutritionist/patients/${patient.id}/${path}`,
        { method: 'POST' },
      );
      if (response.deliveryStatus === 'failed') {
        setError(response.message || 'Não foi possível entregar o e-mail. Tente reenviar mais tarde.');
        return;
      }
      setResult(response);
      await onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível concluir a ação.',
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {patient.accessStatus === 'active'
              ? 'Restaurar senha'
              : patient.accessStatus === 'pending_verification'
                ? 'Reenviar confirmação'
                : 'Novo código de ativação'}
          </DialogTitle>
          <DialogDescription>
            {patient.accessStatus === 'active'
              ? `O Nutri+ enviará um link de restauração para ${patient.email}.`
              : patient.accessStatus === 'pending_verification'
                ? `O Nutri+ enviará um novo link para ${patient.email}.`
                : `O código anterior de ${patient.name} será invalidado.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {result?.activationCode && (
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 text-center">
              <p className="text-xs font-semibold text-primary">Novo código</p>
              <strong className="mt-2 block font-mono text-2xl tracking-[0.12em] text-primary">{result.activationCode}</strong>
              <Button variant="outline" className="mt-4" onClick={() => navigator.clipboard.writeText(result.activationCode!)}>Copiar código</Button>
            </div>
          )}
          {result?.message && <p className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-sm text-primary">{result.message}</p>}
          {result?.previewUrl && <a href={result.previewUrl} className="block rounded-xl border p-3 text-center text-sm font-semibold text-primary">Abrir link local de teste</a>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        {result ? (
          <Button onClick={() => onOpenChange(false)}>Concluir</Button>
        ) : (
          <Button onClick={send} disabled={loading}>
            {loading ? 'Enviando…' : patient.accessStatus === 'pending_activation' ? 'Gerar código' : 'Enviar e-mail'}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GoalsDialog({
  open,
  onOpenChange,
  patientId,
  goals,
  weightKg,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  patientId: number;
  goals: Record<string, number | undefined> | null;
  weightKg: number | null;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    energyKcal: String(goals?.energy_kcal ?? 2000),
    carbohydratePercent: String(goals?.carbohydrate_percent ?? 50),
    proteinPercent: String(goals?.protein_percent ?? 20),
    fatPercent: String(goals?.fat_percent ?? 30),
    fiberG: String(goals?.fiber_g ?? 30),
    dailyActivityFactor: String(goals?.daily_activity_factor ?? 1),
  });
  const [error, setError] = useState('');
  useEffect(() => {
    if (goals)
      setForm({
        energyKcal: String(goals.energy_kcal ?? 2000),
        carbohydratePercent: String(goals.carbohydrate_percent ?? 50),
        proteinPercent: String(goals.protein_percent ?? 20),
        fatPercent: String(goals.fat_percent ?? 30),
        fiberG: String(goals.fiber_g ?? 30),
        dailyActivityFactor: String(goals.daily_activity_factor ?? 1),
      });
  }, [goals]);
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const energyKcal = Number(form.energyKcal) || 0;
  const carbohydratePercent = Number(form.carbohydratePercent) || 0;
  const proteinPercent = Number(form.proteinPercent) || 0;
  const fatPercent = Number(form.fatPercent) || 0;
  const dailyActivityFactor = Number(form.dailyActivityFactor);
  const macroTotal = carbohydratePercent + proteinPercent + fatPercent;
  const validDistribution =
    Math.abs(macroTotal - 100) < 0.001 &&
    [carbohydratePercent, proteinPercent, fatPercent].every(
      (value) => value >= 0 && value <= 100,
    );
  async function save() {
    if (!validDistribution) {
      setError('A distribuição precisa totalizar exatamente 100%.');
      return;
    }
    setError('');
    try {
      await api(`/nutritionist/patients/${patientId}/goals`, {
        method: 'POST',
        body: JSON.stringify({
          validFrom: brazilNow().date,
          energyKcal: form.energyKcal === '' ? null : energyKcal,
          carbohydratePercent,
          proteinPercent,
          fatPercent,
          fiberG: form.fiberG === '' ? null : Number(form.fiberG),
          dailyActivityFactor,
        }),
      });
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível salvar as metas.',
      );
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Metas individuais</DialogTitle>
          <DialogDescription>
            Defina a energia e como ela será distribuída entre os
            macronutrientes.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <GoalInput
            label="Energia (kcal)"
            value={form.energyKcal}
            onChange={(value) => set('energyKcal', value)}
          />
          <GoalInput
            label="Fibras (g)"
            value={form.fiberG}
            onChange={(value) => set('fiberG', value)}
          />
          <div className="rounded-2xl border bg-surface-soft px-4 py-4 sm:col-span-2">
            <p className="text-sm font-medium">Fator cotidiano</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Multiplica a basal para representar a rotina sem treino. A digestão dos alimentos e os exercícios registrados são somados separadamente.
            </p>
            <div className="mt-3 max-w-48">
              <GoalInput
                label="Fator sobre a basal"
                value={form.dailyActivityFactor}
                step="0.05"
                onChange={(value) => set('dailyActivityFactor', value)}
              />
            </div>
          </div>
          <section className="macro-goal-editor sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Distribuição de macronutrientes
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Os gramas e as kcal são recalculados enquanto você ajusta.
                </p>
              </div>
              <output
                className="macro-total-badge"
                data-valid={validDistribution}
              >
                Total: {formatNumber(macroTotal)}%
              </output>
            </div>
            <div className="macro-distribution-bar" aria-hidden="true">
              <span
                data-tone="carb"
                style={{ width: `${Math.min(100, carbohydratePercent)}%` }}
              />
              <span
                data-tone="protein"
                style={{ width: `${Math.min(100, proteinPercent)}%` }}
              />
              <span
                data-tone="fat"
                style={{ width: `${Math.min(100, fatPercent)}%` }}
              />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MacroGoalControl
                label="Carboidratos"
                tone="carb"
                value={form.carbohydratePercent}
                grams={(energyKcal * (carbohydratePercent / 100)) / 4}
                kcal={energyKcal * (carbohydratePercent / 100)}
                onChange={(value) => set('carbohydratePercent', value)}
              />
              <MacroGoalControl
                label="Proteínas"
                tone="protein"
                value={form.proteinPercent}
                grams={(energyKcal * (proteinPercent / 100)) / 4}
                kcal={energyKcal * (proteinPercent / 100)}
                onChange={(value) => set('proteinPercent', value)}
              />
              <MacroGoalControl
                label="Gorduras"
                tone="fat"
                value={form.fatPercent}
                grams={(energyKcal * (fatPercent / 100)) / 9}
                kcal={energyKcal * (fatPercent / 100)}
                onChange={(value) => set('fatPercent', value)}
              />
            </div>
          </section>
          <div className="rounded-2xl border bg-surface-soft px-4 py-4 sm:col-span-2">
            <p className="text-sm font-medium">Água automática</p>
            <p className="mt-1 font-display text-xl font-semibold">
              {weightKg == null
                ? 'Meta indisponível'
                : `${formatNumber(weightKg * 40)} ml/dia`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {weightKg == null
                ? 'Registre o peso do paciente para calcular a meta.'
                : `${formatNumber(weightKg, 1)} kg × 40 ml`}
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={save}
          disabled={
            !validDistribution ||
            energyKcal <= 0 ||
            !Number.isFinite(dailyActivityFactor) ||
            dailyActivityFactor < 1 ||
            dailyActivityFactor > 2.5
          }
        >
          Salvar metas a partir de hoje
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function MacroGoalControl({
  label,
  tone,
  value,
  grams,
  kcal,
  onChange,
}: {
  label: string;
  tone: 'carb' | 'protein' | 'fat';
  value: string;
  grams: number;
  kcal: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="macro-goal-control" data-tone={tone}>
      <span className="macro-goal-label">
        <i aria-hidden="true" /> {label}
      </span>
      <span className="relative mt-3 block">
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 bg-white pr-8 text-lg font-semibold"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          %
        </span>
      </span>
      <span className="mt-3 block text-sm font-semibold">
        {formatNumber(grams, 1)} g
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {formatNumber(kcal)} kcal
      </span>
    </label>
  );
}

function GoalInput({
  label,
  value,
  step = '1',
  onChange,
}: {
  label: string;
  value: string;
  step?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
