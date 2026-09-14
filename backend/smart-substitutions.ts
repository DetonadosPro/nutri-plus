import { performance } from 'node:perf_hooks';
import { db } from './db';
import { measuresForFoods } from './food-measures';
import { gramMeasure, type FoodMeasure } from '../shared/food-measures';
import { normalizeFoodName } from '../shared/food-recognition';

export const SUBSTITUTION_ALGORITHM_VERSION = 'substitution-v1';

export type SubstitutionGroup =
  | 'carbohydrate'
  | 'legume'
  | 'animal_protein'
  | 'egg'
  | 'dairy'
  | 'fruit'
  | 'vegetable'
  | 'fat'
  | 'unknown';

export type NutrientKey =
  | 'energia_kcal'
  | 'proteina_g'
  | 'carboidrato_g'
  | 'lipideos_g'
  | 'fibra_g';

export type SubstitutionFood = {
  id: number;
  source_code: string;
  display_name: string;
  description: string;
  category: string | null;
  curation_category: string | null;
  curation_confidence: string | null;
  curation_flags: string[] | null;
  curation_details: string[] | null;
  curation_score: number | null;
  duplicate_group: string | null;
  nutrients: Partial<Record<NutrientKey, number | null>>;
  measures: FoodMeasure[];
};

export type FoodClassification = {
  group: SubstitutionGroup;
  role: string;
  family: string;
  preparation: 'raw' | 'fresh' | 'cooked' | 'grilled' | 'roasted' | 'fried' | 'liquid' | 'other';
  confidence: 'high' | 'medium' | 'unknown';
  reason: string;
};

type GroupConfig = {
  weights: Record<NutrientKey, number>;
  tolerances: Partial<Record<NutrientKey, number>>;
  maxWeightedError: number;
  minGrams: number;
  maxGrams: number;
  minRatio: number;
  maxRatio: number;
  categories: string[];
};

export const SUBSTITUTION_GROUP_CONFIG: Record<Exclude<SubstitutionGroup, 'unknown'>, GroupConfig> = {
  carbohydrate: {
    weights: { energia_kcal: .35, proteina_g: .05, carboidrato_g: .5, lipideos_g: .03, fibra_g: .07 },
    tolerances: { energia_kcal: .25, carboidrato_g: .22, fibra_g: 1.25 },
    maxWeightedError: .24, minGrams: 25, maxGrams: 450, minRatio: .28, maxRatio: 4.2,
    categories: ['Cereais e derivados', 'Vegetais e derivados'],
  },
  legume: {
    weights: { energia_kcal: .24, proteina_g: .27, carboidrato_g: .25, lipideos_g: .04, fibra_g: .2 },
    tolerances: { energia_kcal: .3, proteina_g: .32, carboidrato_g: .3, fibra_g: .4 },
    maxWeightedError: .3, minGrams: 30, maxGrams: 400, minRatio: .35, maxRatio: 3.2,
    categories: ['Leguminosas e derivados'],
  },
  animal_protein: {
    weights: { energia_kcal: .27, proteina_g: .52, carboidrato_g: .01, lipideos_g: .2, fibra_g: 0 },
    tolerances: { energia_kcal: .32, proteina_g: .22, lipideos_g: .65 },
    maxWeightedError: .3, minGrams: 30, maxGrams: 350, minRatio: .35, maxRatio: 3,
    categories: ['Carnes e derivados', 'Pescados e frutos do mar'],
  },
  egg: {
    weights: { energia_kcal: .3, proteina_g: .45, carboidrato_g: .02, lipideos_g: .23, fibra_g: 0 },
    tolerances: { energia_kcal: .3, proteina_g: .25, lipideos_g: .45 },
    maxWeightedError: .28, minGrams: 25, maxGrams: 300, minRatio: .4, maxRatio: 2.5,
    categories: ['Ovos e derivados'],
  },
  dairy: {
    weights: { energia_kcal: .3, proteina_g: .27, carboidrato_g: .2, lipideos_g: .23, fibra_g: 0 },
    tolerances: { energia_kcal: .28, proteina_g: .4, carboidrato_g: .35, lipideos_g: .55 },
    maxWeightedError: .3, minGrams: 40, maxGrams: 500, minRatio: .35, maxRatio: 3,
    categories: ['Leite e derivados'],
  },
  fruit: {
    weights: { energia_kcal: .35, proteina_g: .02, carboidrato_g: .5, lipideos_g: .01, fibra_g: .12 },
    tolerances: { energia_kcal: .25, carboidrato_g: .22, fibra_g: .75 },
    maxWeightedError: .25, minGrams: 35, maxGrams: 300, minRatio: .3, maxRatio: 3,
    categories: ['Frutas e derivados'],
  },
  vegetable: {
    weights: { energia_kcal: .22, proteina_g: .12, carboidrato_g: .24, lipideos_g: .02, fibra_g: .4 },
    tolerances: { energia_kcal: .45, carboidrato_g: .5, fibra_g: .55 },
    maxWeightedError: .4, minGrams: 20, maxGrams: 600, minRatio: .25, maxRatio: 5,
    categories: ['Vegetais e derivados'],
  },
  fat: {
    weights: { energia_kcal: .35, proteina_g: 0, carboidrato_g: 0, lipideos_g: .65, fibra_g: 0 },
    tolerances: { energia_kcal: .18, lipideos_g: .15 },
    maxWeightedError: .18, minGrams: 3, maxGrams: 80, minRatio: .2, maxRatio: 4,
    categories: ['Gorduras e óleos'],
  },
};

const ALLOWED_CURATION = new Set(['base_food', 'simple_preparation']);
const BLOCKED_FLAGS = new Set(['composite_meal', 'many_ingredients', 'infant_specific', 'supplement', 'branded']);
const PROCESSING = /\b(linguic|salsich|salame|presunto|mortadela|hamburguer|nugget|empanad|embutid|industrializ|almond[êe]ga)\b/;
const COMPOSITE = /\b(lasanha|sanduiche|pizza|estrogonofe|feijoada|risoto|torta|sopa|bolo|biscoito|sobremesa)\b/;

function normalizedFoodText(food: Pick<SubstitutionFood, 'display_name' | 'description'>) {
  return normalizeFoodName(`${food.display_name} ${food.description}`);
}

function familyFrom(text: string) {
  const families: Array<[RegExp, string]> = [
    [/\barroz\b/, 'arroz'], [/\bbatata(?: doce| inglesa)?\b/, 'batata'], [/\bmandioca|aipim|macaxeira\b/, 'mandioca'],
    [/\bmacarrao|massa\b/, 'macarrao'], [/\bcuscuz\b/, 'cuscuz'], [/\bmilho\b/, 'milho'], [/\baveia\b/, 'aveia'], [/\bpao\b/, 'pao'],
    [/\bfeijao\b/, 'feijao'], [/\blentilha\b/, 'lentilha'], [/\bervilha\b/, 'ervilha'], [/\bgrao de bico\b/, 'grao-de-bico'],
    [/\bbanana\b/, 'banana'], [/\bmaca\b/, 'maca'], [/\bpera\b/, 'pera'], [/\blaranja\b/, 'laranja'], [/\bmamao\b/, 'mamao'],
    [/\bfrango\b/, 'frango'], [/\bperu\b/, 'peru'], [/\bbovin|carne de boi|contrafile|patinho|alcatra\b/, 'bovino'],
    [/\bsuino|porco|lombo\b/, 'suino'], [/\bcamarao|crustaceo\b/, 'camarao'], [/\btilapia|salmao|sardinha|atum|merluza|pescad|peixe\b/, 'peixe'],
    [/\bovo|omelete\b/, 'ovo'], [/\bleite\b/, 'leite'], [/\biogurte\b/, 'iogurte'], [/\bqueijo\b/, 'queijo'],
    [/\bazeite\b/, 'azeite'], [/\boleo\b/, 'oleo'], [/\bmanteiga\b/, 'manteiga'], [/\bmargarina\b/, 'margarina'],
  ];
  return families.find(([pattern]) => pattern.test(text))?.[1] ?? text.split(' ')[0] ?? 'unknown';
}

function preparationFrom(text: string, group: SubstitutionGroup) : FoodClassification['preparation'] {
  if (group === 'fruit' && /\bin natura\b/.test(text)) return 'fresh';
  if (/\bcru[ao]?\b|\bin natura\b/.test(text)) return 'raw';
  if (/\bfrit[ao]\b/.test(text)) return 'fried';
  if (/\bgrelhad[ao]\b/.test(text)) return 'grilled';
  if (/\bassad[ao]\b/.test(text)) return 'roasted';
  if (/\bcozid[ao]\b|\bdrenad[ao]\b/.test(text)) return 'cooked';
  if (/\bfluido\b|\buht\b|\bpasteurizad[ao]\b/.test(text)) return 'liquid';
  return 'other';
}

export function classifySubstitutionFood(food: Omit<SubstitutionFood, 'nutrients' | 'measures'>): FoodClassification {
  const text = normalizedFoodText(food);
  const familyText = normalizeFoodName(food.display_name);
  const flags = food.curation_flags ?? [];
  const unknown = (reason: string): FoodClassification => ({ group: 'unknown', role: 'unknown', family: familyFrom(familyText), preparation: 'other', confidence: 'unknown', reason });
  if (food.curation_confidence === 'low') return unknown('low_curation_confidence');
  if (!ALLOWED_CURATION.has(food.curation_category ?? '')) return unknown('non_individual_curation');
  if (flags.some((flag) => BLOCKED_FLAGS.has(flag)) || COMPOSITE.test(text)) return unknown('composite_or_specific_food');
  let group: SubstitutionGroup = 'unknown';
  let role = 'standard';
  if (food.category === 'Cereais e derivados' && /\b(arroz|macarrao|massa|cuscuz|aveia|pao|milho|quinoa)\b/.test(text)) group = 'carbohydrate';
  else if (food.category === 'Vegetais e derivados' && /\b(batata|mandioca|aipim|macaxeira|inhame|car[aá]|taro)\b/.test(text)) group = 'carbohydrate';
  else if (food.category === 'Leguminosas e derivados' && /\b(feijao|lentilha|ervilha|grao de bico)\b/.test(text) && !/\b(farinha|pasta|proteina|extrato|vagem)\b/.test(text)) group = 'legume';
  else if (['Carnes e derivados', 'Pescados e frutos do mar'].includes(food.category ?? '') && !PROCESSING.test(text) && !/\b(coracao|figado|rim|miolo|dobradinha|tripa)\b/.test(text)) group = 'animal_protein';
  else if (food.category === 'Ovos e derivados' && /\bovo|omelete\b/.test(text) && !/\b(vegetais|frios|queijo|maionese|carne|frango|atum|cogumelo|espinafre|couve flor|margarina|benedict|po|desidratad)\b/.test(text)) group = 'egg';
  else if (food.category === 'Leite e derivados') {
    if (/\bleite\b/.test(text) && /\bfluido|uht|pasteurizad|organico\b/.test(text) && !/\b(po|vitamina|bebida|creme|condensado)\b/.test(text)) { group = 'dairy'; role = 'milk'; }
    else if (/\biogurte\b/.test(text) && !/\bbolo|molho|vitamina\b/.test(text)) { group = 'dairy'; role = 'yogurt'; }
    else if (/\bqueijo\b/.test(text) && !/\bmolho|pao|sanduiche\b/.test(text)) { group = 'dairy'; role = 'cheese'; }
  } else if (food.category === 'Frutas e derivados' && !/\b(suco|geleia|doce|desidratad|cozid|assad|farinha|polpa com|nectar)\b/.test(text)) { group = 'fruit'; role = 'fresh'; }
  else if (food.category === 'Vegetais e derivados' && !/\b(farinha|suco|sopa|pure|conserva|desidratad|empanad)\b/.test(text)) group = 'vegetable';
  else if (food.category === 'Gorduras e óleos') {
    if (/\bazeite|oleo\b/.test(text)) { group = 'fat'; role = 'oil'; }
    else if (/\bmanteiga|margarina\b/.test(text)) { group = 'fat'; role = 'spread'; }
  }
  if (group === 'unknown') return unknown('insufficient_structural_evidence');
  return { group, role, family: familyFrom(familyText), preparation: preparationFrom(text, group), confidence: food.curation_confidence === 'high' ? 'high' : 'medium', reason: 'structured_category_and_curated_identity' };
}

export function substitutionCompatibility(original: FoodClassification, candidate: FoodClassification) {
  if (original.group === 'unknown' || candidate.group === 'unknown') return { compatible: false, preparationScore: 0, reason: 'unknown_group' };
  if (original.group !== candidate.group) return { compatible: false, preparationScore: 0, reason: 'different_group' };
  if (original.role !== candidate.role) return { compatible: false, preparationScore: 0, reason: 'different_culinary_role' };
  const diversifyFamily = new Set<SubstitutionGroup>(['carbohydrate', 'legume', 'animal_protein', 'fruit', 'vegetable']);
  if (original.family === candidate.family && diversifyFamily.has(original.group))
    return { compatible: false, preparationScore: 0, reason: 'same_food_family' };
  const strict = new Set(['raw', 'fresh', 'fried', 'liquid']);
  if ((strict.has(original.preparation) || strict.has(candidate.preparation)) && original.preparation !== candidate.preparation)
    return { compatible: false, preparationScore: 0, reason: 'incompatible_preparation' };
  const prepared = new Set(['cooked', 'grilled', 'roasted']);
  if (prepared.has(original.preparation) && !prepared.has(candidate.preparation)) return { compatible: false, preparationScore: 0, reason: 'incompatible_preparation' };
  const preparationScore = original.preparation === candidate.preparation ? 1 : prepared.has(original.preparation) && prepared.has(candidate.preparation) ? .78 : .62;
  return { compatible: true, preparationScore, reason: 'compatible' };
}

const FLOORS: Record<NutrientKey, number> = { energia_kcal: 20, proteina_g: 1, carboidrato_g: 1, lipideos_g: .5, fibra_g: .5 };

export function nutrientPortion(per100g: SubstitutionFood['nutrients'], grams: number) {
  return Object.fromEntries((Object.keys(FLOORS) as NutrientKey[]).map((key) => [key, per100g[key] == null ? null : Number(per100g[key]) * grams / 100])) as Record<NutrientKey, number | null>;
}

function usableNutrients(target: Record<NutrientKey, number | null>, candidate: SubstitutionFood['nutrients'], config: GroupConfig) {
  return (Object.keys(config.weights) as NutrientKey[]).filter((key) => config.weights[key] > 0 && target[key] != null && candidate[key] != null && Number.isFinite(Number(candidate[key])));
}

export function solveEquivalentGrams(target: Record<NutrientKey, number | null>, candidate: SubstitutionFood['nutrients'], config: GroupConfig) {
  const keys = usableNutrients(target, candidate, config);
  if (!keys.includes('energia_kcal') || keys.length < 2) return null;
  let numerator = 0, denominator = 0;
  for (const key of keys) {
    const scale = Math.max(Math.abs(Number(target[key])), FLOORS[key]);
    const perGram = Number(candidate[key]) / 100;
    numerator += config.weights[key] * perGram * Number(target[key]) / (scale * scale);
    denominator += config.weights[key] * perGram * perGram / (scale * scale);
  }
  if (!Number.isFinite(denominator) || denominator <= 1e-12) return null;
  const grams = numerator / denominator;
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

export function servingDifferences(target: Record<NutrientKey, number | null>, candidatePortion: Record<NutrientKey, number | null>, config: GroupConfig) {
  const differences = {} as Record<NutrientKey, number | null>;
  let weighted = 0, weights = 0;
  for (const key of Object.keys(config.weights) as NutrientKey[]) {
    if (target[key] == null || candidatePortion[key] == null || config.weights[key] <= 0) { differences[key] = null; continue; }
    const relative = (Number(candidatePortion[key]) - Number(target[key])) / Math.max(Math.abs(Number(target[key])), FLOORS[key]);
    differences[key] = relative;
    weighted += config.weights[key] * relative * relative;
    weights += config.weights[key];
  }
  return { differences, weightedError: weights ? Math.sqrt(weighted / weights) : Infinity };
}

function withinTolerances(differences: Record<NutrientKey, number | null>, weightedError: number, config: GroupConfig) {
  if (weightedError > config.maxWeightedError) return false;
  return Object.entries(config.tolerances).every(([key, tolerance]) => differences[key as NutrientKey] == null || Math.abs(Number(differences[key as NutrientKey])) <= Number(tolerance));
}

function rounded(value: number, step: number, minimum = step) {
  return Math.max(minimum, Math.round(value / step) * step);
}

function servingCandidates(idealGrams: number, measures: FoodMeasure[]) {
  const choices: Array<{ amount: number; unit: string; grams: number; snapshot: FoodMeasure | null; friendliness: number }> = [];
  for (const measure of measures) {
    if (measure.id === 0 || measure.kind === 'mass') continue;
    const exact = idealGrams / (measure.grams / measure.quantity);
    const step = measure.kind === 'count' ? 1 : measure.kind === 'volume' ? (exact >= 100 ? 25 : 10) : .5;
    const amount = rounded(exact, step);
    const grams = amount * (measure.grams / measure.quantity);
    if (measure.kind === 'household' && amount > 6) continue;
    if (measure.kind === 'count' && amount > 10) continue;
    if (grams > 0 && grams <= 5000) choices.push({ amount, unit: measure.name, grams, snapshot: measure, friendliness: measure.kind === 'household' ? 4 : measure.kind === 'count' ? 3 : 2 });
  }
  const grams = rounded(idealGrams, 5, 5);
  choices.push({ amount: grams, unit: 'g', grams, snapshot: null, friendliness: 1 });
  return choices;
}

export function equivalentServing(original: SubstitutionFood, originalGrams: number, candidate: SubstitutionFood, manual = false) {
  const originalClass = classifySubstitutionFood(original);
  const candidateClass = classifySubstitutionFood(candidate);
  const compatibility = substitutionCompatibility(originalClass, candidateClass);
  const group = originalClass.group;
  if (group === 'unknown') return null;
  const config = SUBSTITUTION_GROUP_CONFIG[group];
  const target = nutrientPortion(original.nutrients, originalGrams);
  const idealGrams = solveEquivalentGrams(target, candidate.nutrients, config);
  if (!idealGrams) return null;
  const plausible = idealGrams >= config.minGrams && idealGrams <= config.maxGrams && idealGrams / originalGrams >= config.minRatio && idealGrams / originalGrams <= config.maxRatio;
  if (!manual && (!compatibility.compatible || !plausible)) return null;
  const evaluated = servingCandidates(idealGrams, candidate.measures).map((choice) => {
    const result = servingDifferences(target, nutrientPortion(candidate.nutrients, choice.grams), config);
    return { ...choice, ...result, accepted: withinTolerances(result.differences, result.weightedError, config) };
  }).sort((a, b) => {
    const practicalError = (choice: typeof a) => choice.weightedError + (choice.friendliness > 1 ? 0 : .03);
    return Number(b.accepted) - Number(a.accepted)
      || practicalError(a) - practicalError(b)
      || b.friendliness - a.friendliness
      || a.grams - b.grams;
  });
  const selected = evaluated.find((choice) => manual || choice.accepted);
  if (!selected || (!manual && !selected.accepted)) return null;
  return {
    algorithmVersion: SUBSTITUTION_ALGORITHM_VERSION,
    group,
    originalClassification: originalClass,
    candidateClassification: candidateClass,
    automaticCompatible: compatibility.compatible && plausible && selected.accepted,
    compatibilityReason: compatibility.reason,
    gramsIdeal: idealGrams,
    gramsFinal: selected.grams,
    amount: selected.amount,
    unit: selected.unit,
    measureSnapshot: selected.snapshot,
    targetNutrients: target,
    candidateNutrients: nutrientPortion(candidate.nutrients, selected.grams),
    differences: selected.differences,
    weightedError: selected.weightedError,
    plausible,
    friendlyMeasure: selected.friendliness > 1,
    preparationScore: compatibility.preparationScore,
  };
}

async function loadFood(foodId: number): Promise<SubstitutionFood | null> {
  const row = await db.prepare(`SELECT f.id,f.source_code,COALESCE(f.display_name,f.description) AS display_name,f.description,f.category,
    f.curation_category,f.curation_confidence,f.curation_flags,f.curation_details,f.curation_score,f.duplicate_group,
    COALESCE(jsonb_object_agg(n.code,CASE WHEN fn.status='numeric' THEN fn.numeric_value ELSE NULL END) FILTER(WHERE n.code IS NOT NULL),'{}'::jsonb) AS nutrients
    FROM foods f LEFT JOIN food_nutrients fn ON fn.food_id=f.id LEFT JOIN nutrients n ON n.code=fn.nutrient_code
    WHERE f.id=? AND f.active AND f.source='TBCA' GROUP BY f.id`).get<Omit<SubstitutionFood, 'measures'>>(foodId);
  if (!row) return null;
  return { ...row, measures: (await measuresForFoods([foodId])).get(foodId) ?? [gramMeasure] };
}

async function loadCandidateFoodRows(categories: string[]): Promise<Array<Omit<SubstitutionFood, 'measures'>>> {
  return db.prepare(`SELECT f.id,f.source_code,COALESCE(f.display_name,f.description) AS display_name,f.description,f.category,
    f.curation_category,f.curation_confidence,f.curation_flags,f.curation_details,f.curation_score,f.duplicate_group,
    COALESCE(jsonb_object_agg(n.code,CASE WHEN fn.status='numeric' THEN fn.numeric_value ELSE NULL END) FILTER(WHERE n.code IS NOT NULL),'{}'::jsonb) AS nutrients
    FROM foods f LEFT JOIN food_nutrients fn ON fn.food_id=f.id LEFT JOIN nutrients n ON n.code=fn.nutrient_code
    WHERE f.active AND f.source='TBCA' AND f.category=ANY(?::text[])
      AND f.curation_category=ANY(ARRAY['base_food','simple_preparation']::text[])
      AND f.curation_confidence IS DISTINCT FROM 'low'
    GROUP BY f.id ORDER BY f.source_code`).all<Omit<SubstitutionFood, 'measures'>>(categories);
}

export async function manualSubstitutionEquivalence(originalFoodId: number, originalGrams: number, candidateFoodId: number, finalGrams?: number) {
  const [original, candidate] = await Promise.all([loadFood(originalFoodId), loadFood(candidateFoodId)]);
  if (!original || !candidate) return null;
  let equivalence = equivalentServing(original, originalGrams, candidate, true);
  if (equivalence && finalGrams != null) {
    const config = SUBSTITUTION_GROUP_CONFIG[equivalence.group];
    const result = servingDifferences(equivalence.targetNutrients, nutrientPortion(candidate.nutrients, finalGrams), config);
    equivalence = {
      ...equivalence,
      gramsFinal: finalGrams,
      candidateNutrients: nutrientPortion(candidate.nutrients, finalGrams),
      differences: result.differences,
      weightedError: result.weightedError,
      automaticCompatible: equivalence.automaticCompatible && withinTolerances(result.differences, result.weightedError, config),
    };
  }
  return equivalence ? { food: candidate, equivalence } : null;
}

export async function automaticSubstitutionSuggestions(originalFoodId: number, originalGrams: number, excludedFoodIds: number[] = []) {
  const started = performance.now();
  const original = await loadFood(originalFoodId);
  if (!original) return { algorithmVersion: SUBSTITUTION_ALGORITHM_VERSION, suggestions: [], metrics: { initialCandidates: 0, classifiedCandidates: 0, rankingMs: 0, returned: 0 }, classification: null };
  const classification = classifySubstitutionFood(original);
  if (classification.group === 'unknown') return { algorithmVersion: SUBSTITUTION_ALGORITHM_VERSION, suggestions: [], metrics: { initialCandidates: 0, classifiedCandidates: 0, rankingMs: Number((performance.now() - started).toFixed(2)), returned: 0 }, classification };
  const candidateRows = await loadCandidateFoodRows(SUBSTITUTION_GROUP_CONFIG[classification.group].categories);
  const excluded = new Set([originalFoodId, ...excludedFoodIds]);
  const semanticRows = candidateRows.filter((candidate) => {
    if (excluded.has(Number(candidate.id))) return false;
    if (original.duplicate_group && original.duplicate_group === candidate.duplicate_group) return false;
    return substitutionCompatibility(classification, classifySubstitutionFood(candidate)).compatible;
  });
  const measures = await measuresForFoods(semanticRows.map((row) => Number(row.id)));
  const candidates = semanticRows.map((row) => ({
    ...row,
    measures: measures.get(Number(row.id)) ?? [gramMeasure],
  }));
  const ranked = candidates.flatMap((candidate) => {
    const equivalence = equivalentServing(original, originalGrams, candidate, false);
    if (!equivalence) return [];
    const quality = Math.max(0, 1 - equivalence.weightedError);
    const curation = Math.min(1, Math.max(0, Number(candidate.curation_score ?? 0) / 1000));
    const score = quality * .58 + equivalence.preparationScore * .22 + (equivalence.friendlyMeasure ? 1 : .45) * .12 + curation * .08;
    return [{ food: candidate, equivalence, score }];
  }).sort((a, b) => b.score - a.score || a.food.source_code.localeCompare(b.food.source_code));
  const selected: typeof ranked = [];
  const families = new Set<string>();
  for (const suggestion of ranked) {
    if (families.has(suggestion.equivalence.candidateClassification.family)) continue;
    families.add(suggestion.equivalence.candidateClassification.family);
    selected.push(suggestion);
    if (selected.length === 3) break;
  }
  return {
    algorithmVersion: SUBSTITUTION_ALGORITHM_VERSION,
    classification,
    suggestions: selected.map(({ food, equivalence }) => ({ food, equivalence })),
    metrics: { initialCandidates: candidateRows.length, classifiedCandidates: ranked.length, rankingMs: Number((performance.now() - started).toFixed(2)), returned: selected.length },
  };
}

export function equivalenceMetadata(equivalence: NonNullable<ReturnType<typeof equivalentServing>>) {
  return {
    algorithmVersion: equivalence.algorithmVersion,
    group: equivalence.group,
    automaticCompatible: equivalence.automaticCompatible,
    compatibilityReason: equivalence.compatibilityReason,
    gramsIdeal: Number(equivalence.gramsIdeal.toFixed(6)),
    gramsFinal: Number(equivalence.gramsFinal.toFixed(6)),
    weightedError: Number(equivalence.weightedError.toFixed(6)),
    differences: Object.fromEntries(Object.entries(equivalence.differences).map(([key, value]) => [key, value == null ? null : Number(value.toFixed(6))])),
  };
}
