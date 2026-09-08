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

export function rankFoodCandidates<T extends { description: string }>(name: string, foods: T[]) {
  const normalized = normalizeFoodName(name);
  const aliases: Record<string, string> = { macaxeira: 'mandioca', aipim: 'mandioca', 'batata frita': 'batata inglesa frita' };
  const query = Object.hasOwn(aliases, normalized) ? aliases[normalized] : normalized;
  const tokens = query.split(' ').filter(t => !['de', 'com', 'e', 'a', 'ao'].includes(t));
  const stem = (t: string) => t.replace(/(cozida|cozido)$/, 'cozid').replace(/(grelhada|grelhado)$/, 'grelhad').replace(/(frita|frito)$/, 'frit').replace(/(assada|assado)$/, 'assad');
  return foods.map(food => {
    const label = normalizeFoodName(food.description);
    const words = label.split(' ').map(stem);
    const hits = tokens.filter(t => words.includes(stem(t))).length;
    // Require the food noun; preparations alone must not match an unrelated food.
    const eligible = tokens.length > 0 && words.includes(stem(tokens[0]));
    return { food, score: eligible ? hits / tokens.length : 0, exact: label === query };
  }).filter(item => item.score >= .5).sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.food.description.localeCompare(b.food.description)).slice(0, 5);
}
