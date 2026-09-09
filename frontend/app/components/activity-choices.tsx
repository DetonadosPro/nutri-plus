import {
  Bike,
  Dumbbell,
  Footprints,
  PersonStanding,
  Waves,
  Flower2,
  Music2,
  House,
  Volleyball,
  CirclePlus,
  Trophy,
} from 'lucide-react';
import type { ActivityCatalog } from './activity-types';

// Each quick choice selects an actual Compendium row, never a MET multiplier.
// Effort labels include the operational description that defines that row.
export const activityChoices = [
  {
    id: 'strength',
    name: 'Musculação',
    Icon: Dumbbell,
    tone: 'violet',
    efforts: [
      { value: 'light', label: 'Leve', code: '02054', hint: 'Treino confortável' },
      { value: 'moderate', label: 'Moderada', code: '02054', hint: 'Esforço controlado' },
      { value: 'intense', label: 'Intensa', code: '02054', hint: 'Treino desafiador' },
      { value: 'vigorous', label: 'Vigorosa', code: '02050', hint: 'Ritmo vigoroso' },
    ],
    category: 'Musculação e treinamento resistido',
  },
  {
    id: 'walk',
    name: 'Caminhada',
    Icon: Footprints,
    tone: 'green',
    efforts: [
      { value: 'light', label: 'Leve', code: '17152', hint: '3,2–3,9 km/h' },
      { value: 'moderate', label: 'Moderada', code: '17190', hint: '4,5–5,5 km/h' },
      { value: 'vigorous', label: 'Intensa', code: '17200', hint: '5,6–6,3 km/h' },
    ],
    category: 'Caminhada e trilhas',
  },
  {
    id: 'run',
    name: 'Corrida',
    Icon: PersonStanding,
    tone: 'peach',
    efforts: [
      { value: 'light', label: 'Leve', code: '12028', hint: '6,4–6,8 km/h' },
      { value: 'moderate', label: 'Moderada', code: '12030', hint: '8–8,4 km/h' },
      { value: 'vigorous', label: 'Intensa', code: '12050', hint: '9,7–10,1 km/h' },
    ],
    category: 'Corrida',
  },
  {
    id: 'bike',
    name: 'Ciclismo',
    Icon: Bike,
    tone: 'blue',
    efforts: [
      { value: 'light', label: 'Leve', code: '01015', hint: 'Passeio tranquilo' },
      { value: 'moderate', label: 'Moderada', code: '01016', hint: 'Ritmo moderado' },
      { value: 'intense', label: 'Intensa', code: '01030', hint: '19,3–22,4 km/h' },
      { value: 'vigorous', label: 'Vigorosa', code: '01017', hint: 'Ritmo vigoroso' },
    ],
    category: 'Ciclismo',
  },
  {
    id: 'football',
    name: 'Futebol',
    Icon: Volleyball,
    tone: 'green',
    efforts: [
      { value: 'light', label: 'Recreativa', code: '15610', hint: 'Jogo casual' },
      { value: 'vigorous', label: 'Competitiva', code: '15605', hint: 'Partida competitiva' },
    ],
    category: 'Esportes',
  },
  {
    id: 'swim',
    name: 'Natação',
    Icon: Waves,
    tone: 'blue',
    efforts: [
      { value: 'light', label: 'Leve', code: '18240', hint: 'Livre recreativo' },
      { value: 'moderate', label: 'Moderada', code: '18290', hint: 'Crawl médio' },
      { value: 'vigorous', label: 'Intensa', code: '18230', hint: 'Livre rápido' },
    ],
    category: 'Atividades aquáticas',
  },
  {
    id: 'yoga',
    name: 'Yoga / Pilates',
    Icon: Flower2,
    tone: 'violet',
    efforts: [],
    category: 'Condicionamento e bem-estar',
  },
  {
    id: 'dance',
    name: 'Dança',
    Icon: Music2,
    tone: 'pink',
    efforts: [],
    category: 'Dança',
  },
  {
    id: 'sports',
    name: 'Esportes',
    Icon: Trophy,
    tone: 'peach',
    efforts: [],
    category: 'Esportes',
  },
  {
    id: 'home',
    name: 'Em casa',
    Icon: House,
    tone: 'yellow',
    efforts: [
      { value: 'light', label: 'Leve', code: '05025', hint: 'Tarefas leves' },
      { value: 'moderate', label: 'Moderada', code: '05026', hint: 'Tarefas moderadas' },
      { value: 'vigorous', label: 'Intensa', code: '05027', hint: 'Tarefas intensas' },
    ],
    category: 'Atividades domésticas',
  },
  {
    id: 'other',
    name: 'Outras atividades',
    Icon: CirclePlus,
    tone: 'neutral',
    efforts: [],
    category: '',
  },
] as const;
export type ActivityChoice = (typeof activityChoices)[number];
export type ActivityEffort = 'light' | 'moderate' | 'intense' | 'vigorous';
export const restChoices = [
  [30, '30 s'],
  [60, '1 min'],
  [90, '1 min 30 s'],
  [120, '2 min'],
  [180, '3 min'],
  [240, '4 min+'],
] as const;
export const normalizeActivity = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export function choiceFor(
  category: string,
  code?: string | null,
): ActivityChoice {
  return (
    activityChoices.find((c) =>
      c.efforts.some((effort) => effort.code === code),
    ) ??
    activityChoices.find((c) => c.category === category) ??
    activityChoices[10]
  );
}
export function ActivityGlyph({
  category,
  code,
}: {
  category: string;
  code?: string | null;
}) {
  const c = choiceFor(category, code);
  return (
    <span className="movement-glyph" data-tone={c.tone}>
      <c.Icon aria-hidden="true" strokeWidth={1.7} />
    </span>
  );
}
export function quickName(row: {
  name: string;
  category: string;
  code: string | null;
}) {
  const c = activityChoices.find((c) =>
    c.efforts.some((effort) => effort.code === row.code),
  );
  return c?.name ?? row.name;
}
export function matchesChoice(row: ActivityCatalog, c: ActivityChoice) {
  if (c.id === 'yoga') return /yoga|pilates/i.test(row.name);
  return !c.category || row.category === c.category;
}
