import { z } from 'zod';

// Vision describes food only. Never accept IDs, amounts or nutrients from the model.
export const detectionSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    alternatives: z.array(z.string().trim().min(2).max(100)).max(3),
    uncertain: z.boolean(),
  }).strict()).max(15),
}).strict();

export function normalizeFoodName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export type SearchableFood = {
  description: string;
  displayName?: string | null;
  searchAliases?: string[] | null;
};

export function rankFoodCandidates<T extends SearchableFood>(name: string, foods: T[]) {
  const normalized = normalizeFoodName(name);
  const tokens = normalized.split(' ').filter(t => !['de', 'com', 'e', 'a', 'ao'].includes(t));
  const stem = (t: string) => t.replace(/(cozida|cozido)$/, 'cozid').replace(/(grelhada|grelhado)$/, 'grelhad').replace(/(frita|frito)$/, 'frit').replace(/(assada|assado)$/, 'assad');
  return foods.map(food => {
    const display = normalizeFoodName(food.displayName || food.description);
    const original = normalizeFoodName(food.description);
    const aliases = (food.searchAliases || []).map(normalizeFoodName);
    const fields = [display, ...aliases, original];
    const tokenScore = Math.max(...fields.map(field => {
      const words = field.split(' ').map(stem);
      const hits = tokens.filter(t => words.includes(stem(t))).length;
      return tokens.length > 0 && words.includes(stem(tokens[0])) ? hits / tokens.length : 0;
    }));
    const tier = display === normalized ? 8
      : display.startsWith(`${normalized} `) ? 7
      : aliases.includes(normalized) ? 6
      : aliases.some(alias => alias.startsWith(`${normalized} `)) ? 5
      : display.includes(normalized) ? 4
      : aliases.some(alias => alias.includes(normalized)) ? 3
      : original === normalized ? 2
      : original.startsWith(`${normalized} `) ? 1
      : original.includes(normalized) ? 0.5 : 0;
    return { food, score: tier + tokenScore, exact: tier >= 6 };
  }).filter(item => item.score >= .5).sort((a, b) => b.score - a.score
    || Number(!normalizeFoodName(a.food.displayName || a.food.description).includes(normalized)) - Number(!normalizeFoodName(b.food.displayName || b.food.description).includes(normalized))
    || (a.food.displayName || a.food.description).localeCompare(b.food.displayName || b.food.description)).slice(0, 5);
}
