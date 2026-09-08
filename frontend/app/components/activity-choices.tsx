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
    codes: ['02054', '02054', '02050'],
    hints: ['Cargas leves', 'Vários exercícios', 'Esforço vigoroso'],
    category: 'Musculação e treinamento resistido',
  },
  {
    id: 'walk',
    name: 'Caminhada',
    Icon: Footprints,
    tone: 'green',
    codes: ['17152', '17190', '17200'],
    hints: ['3,2–3,9 km/h', '4,5–5,5 km/h', '5,6–6,3 km/h'],
    category: 'Caminhada e trilhas',
  },
  {
    id: 'run',
    name: 'Corrida',
    Icon: PersonStanding,
    tone: 'peach',
    codes: ['12028', '12030', '12050'],
    hints: ['6,4–6,8 km/h', '8–8,4 km/h', '9,7–10,1 km/h'],
    category: 'Corrida',
  },
  {
    id: 'bike',
    name: 'Ciclismo',
    Icon: Bike,
    tone: 'blue',
    codes: ['01015', '01016', '01017'],
    hints: ['Passeio tranquilo', 'Ritmo moderado', 'Ritmo forte'],
    category: 'Ciclismo',
  },
  {
    id: 'football',
    name: 'Futebol',
    Icon: Volleyball,
    tone: 'green',
    codes: ['15610', '15610', '15605'],
    hints: ['Recreativo', 'Recreativo', 'Competitivo'],
    category: 'Esportes',
  },
  {
    id: 'swim',
    name: 'Natação',
    Icon: Waves,
    tone: 'blue',
    codes: ['18240', '18290', '18230'],
    hints: ['Livre recreativo', 'Crawl médio', 'Livre rápido'],
    category: 'Atividades aquáticas',
  },
  {
    id: 'yoga',
    name: 'Yoga / Pilates',
    Icon: Flower2,
    tone: 'violet',
    codes: [],
    hints: [],
    category: 'Condicionamento e bem-estar',
  },
  {
    id: 'dance',
    name: 'Dança',
    Icon: Music2,
    tone: 'pink',
    codes: [],
    hints: [],
    category: 'Dança',
  },
  {
    id: 'sports',
    name: 'Esportes',
    Icon: Trophy,
    tone: 'peach',
    codes: [],
    hints: [],
    category: 'Esportes',
  },
  {
    id: 'home',
    name: 'Em casa',
    Icon: House,
    tone: 'yellow',
    codes: ['05025', '05026', '05027'],
    hints: ['Tarefas leves', 'Tarefas moderadas', 'Tarefas intensas'],
    category: 'Atividades domésticas',
  },
  {
    id: 'other',
    name: 'Outras atividades',
    Icon: CirclePlus,
    tone: 'neutral',
    codes: [],
    hints: [],
    category: '',
  },
] as const;
export type ActivityChoice = (typeof activityChoices)[number];
export const effortValues = ['light', 'moderate', 'vigorous'] as const;
export const effortLabels = ['Leve', 'Moderada', 'Intensa'];
export const restChoices = [
  ['under30', 'Até 30 s'],
  ['30to60', '30–60 s'],
  ['1to2', '1–2 min'],
  ['2to3', '2–3 min'],
  ['over3', 'Mais de 3 min'],
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
      (c.codes as readonly string[]).includes(code ?? ''),
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
    (c.codes as readonly string[]).includes(row.code ?? ''),
  );
  return c?.name ?? row.name;
}
export function matchesChoice(row: ActivityCatalog, c: ActivityChoice) {
  if (c.id === 'yoga') return /yoga|pilates/i.test(row.name);
  return !c.category || row.category === c.category;
}
