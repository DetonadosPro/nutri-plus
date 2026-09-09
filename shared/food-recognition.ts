import { z } from 'zod';

export const detectedFoodSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    preparation: z.string().trim().min(2).max(40).nullable(),
    visibleDetails: z.array(z.string().trim().min(2).max(60)).max(6),
    confidence: z.number().min(0).max(1),
    alternative: z.string().trim().min(2).max(80).nullable(),
  })
  .strict();

export const detectionSchema = z.object({ items: z.array(detectedFoodSchema).max(15) }).strict();
export type DetectedFood = z.infer<typeof detectedFoodSchema>;

const MEAT_WORDS = /\b(carne|bovin[oa]|boi|bife|frango|galinha|suin[oa]|porco|costela)\b/;
const CHOPPED_MEAT_WORDS = /\b(picado|picada|cubos?|pedacos?|tiras?|iscas?|desfiado|desfiada|moido|moida)\b/;
const SPECIFIC_MEAT_CUTS = /\b(acem|alcatra|contrafile|coxao|maminha|picanha|patinho|lagarto|paleta|peito|coxa|sobrecoxa|asa|lombo|pernil|tilapia|salmao|pescada|merluza|atum|bacalhau)\b/;

/** A foto de carne fragmentada não sustenta a escolha automática de um corte TBCA. */
export function needsMeatConfirmation(item: DetectedFood) {
  const description = normalizeFoodName([item.name, item.preparation ?? '', ...item.visibleDetails].join(' '));
  return MEAT_WORDS.test(description) && CHOPPED_MEAT_WORDS.test(description) && !SPECIFIC_MEAT_CUTS.test(description);
}

export const rerankSchema = z
  .object({
    candidateIndex: z.number().int().min(0).max(4).nullable(),
    confidence: z.number().min(0).max(1),
    uncertain: z.boolean(),
  })
  .strict();

export function validRerankIndex(decision: z.infer<typeof rerankSchema>, candidateCount: number) {
  return decision.candidateIndex === null || (decision.candidateIndex >= 0 && decision.candidateIndex < candidateCount);
}

export type SearchableFood = {
  id?: number;
  source_code?: string;
  description: string;
  displayName?: string | null;
  searchAliases?: string[] | null;
  category?: string | null;
};

export type MatchState =
  | 'AUTOSELECT'
  | 'RERANK'
  | 'ASK_IDENTITY'
  | 'ASK_ATTRIBUTE'
  | 'NO_EXACT_TBCA_MATCH'
  | 'NO_MATCH';

export const MATCH_THRESHOLDS = {
  AUTOSELECT_MIN_SCORE: 0.84,
  AUTOSELECT_MIN_MARGIN: 0.06,
  AUTOSELECT_MIN_VISUAL_CONFIDENCE: 0.65,
  RERANK_MIN_SCORE: 0.55,
  RERANK_MAX_CANDIDATES: 5,
  ASK_USER_MAX_CANDIDATES: 3,
  RERANK_MIN_CONFIDENCE: 0.72,
} as const;

const STOP_WORDS = new Set([
  'a', 'ao', 'aparenta', 'brasil', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'media', 'o',
  'para', 'por', 'sem', 'ser', 'tipo',
]);

const CANONICAL_WORDS: Record<string, string> = {
  aipim: 'mandioca', assada: 'assado', assadas: 'assado', assados: 'assado', branca: 'branco',
  brancas: 'branco', brancos: 'branco', carioquinha: 'carioca', cozida: 'cozido', cozidas: 'cozido',
  cozidos: 'cozido', crua: 'cru', cruas: 'cru', crus: 'cru', empanada: 'empanado',
  empanadas: 'empanado', empanados: 'empanado', ensopada: 'ensopado', ensopadas: 'ensopado',
  ensopados: 'ensopado', espaguete: 'macarrao', file: 'file', files: 'file', frita: 'frito',
  fatias: 'fatia', folhas: 'folha', frios: 'frio', graos: 'grao', legumes: 'legume', marcas: 'marca',
  fritas: 'frito', fritos: 'frito', grelhada: 'grelhado', grelhadas: 'grelhado', grelhados: 'grelhado',
  inteira: 'inteiro', inteiras: 'inteiro', inteiros: 'inteiro', macaxeira: 'mandioca', massa: 'macarrao',
  massas: 'macarrao', mussarela: 'mucarela', ovos: 'ovo', palitos: 'palito', pedacos: 'pedaco',
  cubos: 'cubo', desfiada: 'desfiado', desfiadas: 'desfiado', desfiados: 'desfiado', iscas: 'isca',
  moida: 'moido', moidas: 'moido', moidos: 'moido', picada: 'picado', picadas: 'picado', picados: 'picado', tiras: 'tira',
  chips: 'chip', milanesa: 'empanado', polido: 'branco', refinada: 'refinado', rodelas: 'rodela', sementes: 'semente',
  vegetais: 'vegetal',
  refogada: 'refogado', refogadas: 'refogado', refogados: 'refogado', roxa: 'roxo', roxas: 'roxo',
  roxos: 'roxo', vermelha: 'vermelho', vermelhas: 'vermelho', vermelhos: 'vermelho',
};

const PREPARATIONS = new Set([
  'assado', 'cozido', 'cru', 'empanado', 'ensopado', 'frito', 'grelhado', 'refogado', 'vapor',
]);

const RECIPE_MARKERS = new Set([
  'bacon', 'bolo', 'cavalo', 'creme', 'extrato', 'frio', 'hamburguer', 'industrializado', 'lasanha', 'margarina',
  'camarao', 'frango', 'instantaneo', 'intantaneo', 'light', 'linguica', 'lula', 'mcdonald', 'mexilhao',
  'molho', 'omelete', 'parmegiana', 'picles', 'pizza', 'pure', 'queijo', 'salsicha', 'sardinha', 'vegano',
  'recheado', 'recheio', 'role', 'salada', 'salsa', 'sanduiche', 'saute', 'sopa', 'sushi', 'toucinho', 'tropeiro', 'vegetal',
]);

const OBSERVABLE_TOKENS = new Set(['caldo']);
const PRESENTATION_TOKENS = new Set(['cubo', 'desfiado', 'isca', 'moido', 'pedaco', 'picado', 'tira']);

const AXES = [
  { identities: ['arroz'], values: ['integral', 'branco', 'creme', 'glutinoso'] },
  { identities: ['feijao'], values: ['carioca', 'preto', 'branco', 'vermelho', 'jalo', 'rajado', 'rosinha', 'fradinho'] },
  { identities: ['batata'], values: ['inglesa', 'doce', 'baroa'] },
  { identities: ['batata'], values: ['palito', 'chip'] },
  { identities: ['ovo'], values: ['galinha', 'codorna'] },
  { identities: ['ovo'], values: ['inteiro', 'clara', 'gema'] },
  { identities: ['frango'], values: ['peito', 'coxa', 'sobrecoxa', 'asa'] },
  { identities: ['alface'], values: ['crespa', 'lisa', 'roxo', 'americana'] },
  { identities: ['cebola'], values: ['branco', 'roxo'] },
  { identities: ['peixe', 'file'], values: ['salmao', 'pescada', 'merluza', 'tilapia', 'atum', 'bacalhau'] },
  { identities: ['queijo'], values: ['minas', 'mucarela', 'prato', 'requeijao', 'parmesao', 'cheddar', 'provolone'] },
] as const;

const MATERIAL_ATTRIBUTE_TOKENS = new Set([
  'bacalhau', 'baroa', 'cheddar', 'codorna', 'doce', 'merluza', 'minas', 'mucarela', 'parmesao',
  'pescada', 'prato', 'provolone', 'requeijao', 'salmao', 'tilapia', 'atum',
]);

export function normalizeFoodName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function canonicalToken(token: string) {
  return CANONICAL_WORDS[token] ?? token;
}

function tokens(value: string) {
  return normalizeFoodName(value).split(' ').filter(Boolean).map(canonicalToken);
}

function semanticPhrase(value: string) {
  return tokens(value).join(' ');
}

function unique<T>(values: T[]) { return [...new Set(values)]; }
function intersects(left: Set<string>, right: Set<string>) { return [...left].some((value) => right.has(value)); }

type DetectionProfile = {
  identity: Set<string>;
  evidence: Set<string>;
  preparations: Set<string>;
  alternative: Set<string>;
  rawText: string;
};

function detectionProfile(item: DetectedFood): DetectionProfile {
  const rawText = normalizeFoodName([item.name, item.preparation ?? '', ...item.visibleDetails].join(' '));
  const nameTokens = tokens(item.name);
  const identitySeed = new Set(nameTokens);
  const preparationTokens = unique(tokens([item.name, item.preparation ?? ''].join(' ')).filter((token) => PREPARATIONS.has(token)));
  const evidence = new Set([...nameTokens, ...preparationTokens]);
  for (const detail of item.visibleDetails) {
    for (const token of tokens(detail)) {
      const relevantAxisValue = AXES.some((axis) => axis.identities.some((identity) => identitySeed.has(identity)) && axis.values.includes(token as never));
      if (PREPARATIONS.has(token) || relevantAxisValue || RECIPE_MARKERS.has(token) || OBSERVABLE_TOKENS.has(token)) evidence.add(token);
    }
  }
  if (/graos? branc|fatias? branc|pedacos? branc/.test(rawText)) evidence.add('branco');
  if (/graos? (claros? e )?rosad|graos? marron/.test(rawText) && evidence.has('feijao')) evidence.add('carioca');
  if (/folhas?.*(crespa|enrugad)/.test(rawText) && evidence.has('alface')) evidence.add('crespa');
  if (/file/.test(rawText) && evidence.has('frango')) { evidence.add('file'); evidence.add('peito'); }
  if (evidence.has('ovo') && ((rawText.includes('gema') && rawText.includes('clara')) || rawText.includes('ovo inteiro'))) {
    // Seeing yolk and white together describes a whole egg; they are not competing
    // candidates for an isolated egg-white or yolk entry.
    evidence.delete('clara'); evidence.delete('gema'); evidence.add('inteiro'); evidence.add('galinha');
  }
  if (/molho (vermelho|de tomate)/.test(rawText)) { evidence.add('molho'); evidence.add('tomate'); }
  const identity = new Set(nameTokens.filter((token) => !STOP_WORDS.has(token) && !PREPARATIONS.has(token) && !PRESENTATION_TOKENS.has(token)));
  return { identity, evidence, preparations: new Set(preparationTokens), alternative: new Set(tokens(item.alternative ?? '').filter((token) => !STOP_WORDS.has(token))), rawText };
}

type CandidateProfile = {
  all: Set<string>;
  display: string[];
  fields: string[];
  semanticFields: string[];
  fieldTokenSets: Set<string>[];
  preparations: Set<string>;
  recipeMarkers: Set<string>;
  positiveIngredients: Set<string>;
  withSalt: boolean;
  saltSignature: string;
  fishSpecific: boolean;
  hasPosta: boolean;
};

const candidateCache = new WeakMap<object, CandidateProfile>();

function candidateProfile(food: SearchableFood): CandidateProfile {
  const cached = candidateCache.get(food as object);
  if (cached) return cached;
  const displayName = food.displayName || food.description;
  const fields = unique([displayName, ...(food.searchAliases ?? []), food.description, food.category ?? ''].filter(Boolean));
  const display = tokens(displayName);
  const semanticFields = fields.map(semanticPhrase);
  const all = new Set(fields.flatMap(tokens));
  const contentTokens = new Set([displayName, ...(food.searchAliases ?? []), food.description].flatMap(tokens));
  const normalizedDisplay = normalizeFoodName(displayName);
  const profile: CandidateProfile = {
    all, display, fields, semanticFields, fieldTokenSets: semanticFields.map((field) => new Set(tokens(field))),
    preparations: new Set([...all].filter((token) => PREPARATIONS.has(token))),
    recipeMarkers: new Set([...contentTokens].filter((token) => RECIPE_MARKERS.has(token))),
    positiveIngredients: new Set([
      ...(/\bcom (oleo|azeite|manteiga|gordura)\b/.test(normalizedDisplay) ? ['oleo'] : []),
      ...(/\b(com|e) cebola\b/.test(normalizedDisplay) ? ['cebola'] : []),
      ...(/\b(com|e) alho\b/.test(normalizedDisplay) ? ['alho'] : []),
    ]),
    withSalt: /\bcom sal\b/.test(normalizedDisplay),
    saltSignature: normalizedDisplay.replace(/\b(com|sem) sal\b/g, '').replace(/\s+/g, ' ').trim(),
    fishSpecific: /pescados|peixe/.test(normalizeFoodName(food.category ?? food.description)) && !['file', 'posta', 'peixe'].includes(display[0]),
    hasPosta: display.includes('posta'),
  };
  candidateCache.set(food as object, profile);
  return profile;
}

export function canonicalQueries(item: DetectedFood) {
  const profile = detectionProfile(item);
  const base = semanticPhrase(item.name), prep = semanticPhrase(item.preparation ?? '');
  const visible = [...profile.evidence].filter((token) => !profile.identity.has(token) && !profile.preparations.has(token));
  const queries = [base, [base, prep].filter(Boolean).join(' ')];
  if (visible.length) queries.push([...visible, base, prep].filter(Boolean).join(' '));
  if (item.alternative) queries.push([semanticPhrase(item.alternative), prep].filter(Boolean).join(' '));
  return unique(queries.map(semanticPhrase).filter(Boolean));
}

export function foodRetrievalTokens(item: DetectedFood) {
  return [...detectionProfile(item).identity].filter((token) => !STOP_WORDS.has(token)).slice(0, 4);
}

function fieldTier(query: string, food: SearchableFood) {
  const profile = candidateProfile(food), semanticQuery = semanticPhrase(query), fields = profile.semanticFields;
  if (fields[0] === semanticQuery) return 1;
  if (fields[0].startsWith(`${semanticQuery} `)) return 0.96;
  if (fields.slice(1).includes(semanticQuery)) return 0.93;
  if (fields.slice(1).some((field) => field.startsWith(`${semanticQuery} `))) return 0.88;
  const queryTokens = tokens(semanticQuery).filter((token) => !STOP_WORDS.has(token));
  const coverage = Math.max(0, ...profile.fieldTokenSets.map((words) => queryTokens.length ? queryTokens.filter((token) => words.has(token)).length / queryTokens.length : 0));
  if (coverage === 1) return 0.82;
  if (fields[0].includes(semanticQuery)) return 0.74;
  if (fields.slice(1).some((field) => field.includes(semanticQuery))) return 0.68;
  return coverage * 0.62;
}

function relevantAxes(profile: DetectionProfile) {
  return AXES.filter((axis) => axis.identities.some((identity) => profile.identity.has(identity)));
}

function axisContradictions(profile: DetectionProfile, candidate: Set<string>) {
  const found: string[] = [];
  for (const axis of relevantAxes(profile)) {
    const wanted = axis.values.filter((value) => profile.evidence.has(value)), present = axis.values.filter((value) => candidate.has(value));
    if (wanted.length && present.length && !present.some((value) => wanted.includes(value))) found.push(`${wanted[0]}!=${present[0]}`);
  }
  return found;
}

function preparationContradictions(expected: Set<string>, candidate: Set<string>) {
  if (!expected.size) return [];
  const found: string[] = [];
  const cookingMethods = new Set(['assado', 'cozido', 'cru', 'ensopado', 'frito', 'grelhado', 'refogado', 'vapor']);
  const wantedMethods = new Set([...expected].filter((value) => cookingMethods.has(value)));
  const presentMethods = new Set([...candidate].filter((value) => cookingMethods.has(value)));
  if (wantedMethods.size && presentMethods.size && !intersects(wantedMethods, presentMethods)) found.push(`${[...wantedMethods][0]}!=${[...presentMethods][0]}`);
  if (wantedMethods.has('cozido')) {
    const extraMethod = [...presentMethods].find((value) => value !== 'cozido');
    if (extraMethod) found.push(`cozido!=${extraMethod}`);
  }
  if (expected.has('empanado') && !candidate.has('empanado')) found.push('empanado!=ausente');
  return found;
}

function unexpectedRecipeMarkers(profile: DetectionProfile, candidate: CandidateProfile) {
  const markers = [...candidate.recipeMarkers].filter((marker) => !profile.evidence.has(marker) && !profile.identity.has(marker));
  if (profile.identity.has('farofa') || profile.identity.has('omelete')) {
    for (const filling of ['carne', 'cenoura', 'linguica', 'toucinho', 'bacon', 'vegetal', 'queijo', 'frio', 'ovo']) {
      if (candidate.all.has(filling) && !profile.evidence.has(filling)) markers.push(filling);
    }
  }
  return unique(markers);
}

function unobservedMaterialAttributes(profile: DetectionProfile, candidate: CandidateProfile) {
  const values: string[] = [];
  for (const axis of relevantAxes(profile)) {
    if (axis.values.some((value) => profile.evidence.has(value))) continue;
    for (const value of axis.values) if (candidate.all.has(value) && MATERIAL_ATTRIBUTE_TOKENS.has(value)) values.push(value);
  }
  if ((profile.identity.has('peixe') || profile.identity.has('file')) && candidate.fishSpecific) values.push('fish_species');
  if (profile.identity.has('file') && candidate.hasPosta && !profile.evidence.has('posta')) values.push('posta');
  if (profile.identity.has('queijo') && !relevantAxes(profile)[0]?.values.some((value) => profile.evidence.has(value))) values.push('cheese_variety');
  if (profile.identity.has('farofa')) values.push('farofa_recipe');
  if (profile.identity.has('omelete')) values.push('omelet_recipe');
  if ((profile.identity.has('peixe') || profile.identity.has('file')) && profile.evidence.has('empanado')) values.push('breaded_fish_recipe');
  return unique(values);
}

function defaultVarietyAdjustment(profile: DetectionProfile, candidate: CandidateProfile) {
  if (profile.identity.has('batata') && !profile.evidence.has('doce') && !profile.evidence.has('baroa')) {
    if (candidate.all.has('inglesa')) return { bonus: 0.05, policy: 'standard_potato' };
    if (candidate.all.has('doce') || candidate.all.has('baroa')) return { bonus: -0.12, policy: null };
  }
  if (profile.identity.has('ovo') && !profile.evidence.has('codorna')) {
    if (candidate.all.has('galinha')) return { bonus: 0.03, policy: 'standard_chicken_egg' };
    if (candidate.all.has('codorna')) return { bonus: -0.16, policy: null };
  }
  return { bonus: 0, policy: null };
}

export type SemanticMatch<T> = {
  food: T; matchConfidence: number; contradictions: string[]; query: string;
  materialUnknowns?: string[]; resolutionPolicies?: string[]; saltSignature?: string; withSalt?: boolean;
};

function preferSaltWhenEquivalent<T extends SearchableFood>(matches: SemanticMatch<T>[]) {
  return matches.sort((left, right) => {
    const scoreDifference = right.matchConfidence - left.matchConfidence;
    if (Math.abs(scoreDifference) > 0.0001) return scoreDifference;
    if (left.saltSignature && left.saltSignature === right.saltSignature && left.withSalt !== right.withSalt) return right.withSalt ? 1 : -1;
    return (left.food.source_code || '').localeCompare(right.food.source_code || '') || (left.food.displayName || left.food.description).localeCompare(right.food.displayName || right.food.description);
  });
}

export function rankSemanticFoodCandidates<T extends SearchableFood>(item: DetectedFood, foods: T[], limit = 5): SemanticMatch<T>[] {
  const profile = detectionProfile(item), queries = canonicalQueries(item);
  const primaryQueries = queries.filter((query) => !item.alternative || !query.startsWith(semanticPhrase(item.alternative)));
  const matches = foods.map((food) => {
    const candidate = candidateProfile(food), identity = [...profile.identity];
    const identityMatch = identity.length ? identity.filter((token) => candidate.all.has(token)).length / identity.length : 0;
    const identityIsMain = Boolean(candidate.display[0] && profile.evidence.has(candidate.display[0]));
    const lexical = Math.max(0, ...primaryQueries.map((query) => fieldTier(query, food)));
    const alternativeCoverage = profile.alternative.size ? [...profile.alternative].filter((token) => candidate.all.has(token)).length / profile.alternative.size : 0;
    const prepMatch = profile.preparations.size ? [...profile.preparations].filter((token) => candidate.preparations.has(token)).length / profile.preparations.size : 1;
    const visible = [...profile.evidence].filter((token) => !profile.identity.has(token) && !profile.preparations.has(token) && !STOP_WORDS.has(token));
    const visibleMatch = visible.length ? visible.filter((token) => candidate.all.has(token)).length / visible.length : 1;
    const contradictions = [...preparationContradictions(profile.preparations, candidate.preparations), ...axisContradictions(profile, candidate.all)];
    const unexpectedRecipes = unexpectedRecipeMarkers(profile, candidate);
    const materialAttributes = unobservedMaterialAttributes(profile, candidate);
    const hiddenAdditions = [...candidate.positiveIngredients].filter((ingredient) => {
      if (ingredient === 'oleo' && (profile.preparations.has('frito') || profile.preparations.has('refogado'))) return false;
      if (profile.evidence.has('molho') && profile.identity.has('macarrao')) return false;
      return !profile.evidence.has(ingredient);
    });
    const defaultVariety = defaultVarietyAdjustment(profile, candidate);
    const explicitRecipeMatch = [...candidate.recipeMarkers].some((marker) => profile.evidence.has(marker)) ? 0.10 : 0;
    const raw = identityMatch === 0 ? 0 : identityMatch * 0.42 + lexical * 0.22 + prepMatch * 0.12 + visibleMatch * 0.12 + (identityIsMain ? 0.06 : 0) + explicitRecipeMatch + alternativeCoverage * 0.02 + defaultVariety.bonus
      - Math.min(0.48, unexpectedRecipes.length * 0.16) - Math.min(0.24, materialAttributes.length * 0.08)
      - Math.min(0.24, hiddenAdditions.length * 0.08) - Math.min(0.65, contradictions.length * 0.28);
    return {
      food, matchConfidence: Math.max(0, Math.min(0.99, Number(raw.toFixed(4)))), contradictions,
      query: primaryQueries.find((query) => fieldTier(query, food) === lexical) || primaryQueries[0],
      materialUnknowns: unique([...unexpectedRecipes.map((value) => `recipe:${value}`), ...materialAttributes.map((value) => `attribute:${value}`)]),
      resolutionPolicies: defaultVariety.policy ? [defaultVariety.policy] : [], saltSignature: candidate.saltSignature, withSalt: candidate.withSalt,
    };
  });
  return preferSaltWhenEquivalent(matches).filter((match) => match.matchConfidence >= 0.25).slice(0, limit);
}

function saltPolicyApplies<T>(top: SemanticMatch<T>, second: SemanticMatch<T> | undefined) {
  return Boolean(second && top.saltSignature && top.saltSignature === second.saltSignature && top.withSalt && !second.withSalt && !top.contradictions.length && !second.contradictions.length);
}

export function decideMatch<T>(item: DetectedFood, matches: SemanticMatch<T>[]) {
  const top1 = matches[0]?.matchConfidence ?? 0, top2 = matches[1]?.matchConfidence ?? 0, margin = Number((top1 - top2).toFixed(4)), top = matches[0];
  const policy = top && saltPolicyApplies(top, matches[1]) ? 'salt_default' : top?.resolutionPolicies?.[0] ?? null;
  if (top && (top.materialUnknowns?.length ?? 0) > 0) return { state: 'NO_EXACT_TBCA_MATCH' as const, top1Score: top1, top2Score: top2, margin, policy };
  if (top && top1 >= MATCH_THRESHOLDS.AUTOSELECT_MIN_SCORE && (margin >= MATCH_THRESHOLDS.AUTOSELECT_MIN_MARGIN || policy === 'salt_default') && item.confidence >= MATCH_THRESHOLDS.AUTOSELECT_MIN_VISUAL_CONFIDENCE && !top.contradictions.length) {
    return { state: 'AUTOSELECT' as const, top1Score: top1, top2Score: top2, margin, policy };
  }
  if (matches.length >= 2 && top1 >= MATCH_THRESHOLDS.RERANK_MIN_SCORE) return { state: 'RERANK' as const, top1Score: top1, top2Score: top2, margin, policy };
  return { state: 'NO_MATCH' as const, top1Score: top1, top2Score: top2, margin, policy };
}

export function deduplicateDetections(items: DetectedFood[]) {
  const result: DetectedFood[] = [];
  for (const item of items) {
    const profile = detectionProfile(item);
    const index = result.findIndex((existing) => {
      const current = detectionProfile(existing);
      const samePreparation = (!current.preparations.size && !profile.preparations.size) || intersects(current.preparations, profile.preparations);
      return intersects(current.identity, profile.identity) && samePreparation;
    });
    if (index < 0) result.push(item); else if (item.confidence > result[index].confidence) result[index] = item;
  }
  return result;
}

export function rankFoodCandidates<T extends SearchableFood>(name: string, foods: T[]) {
  return rankSemanticFoodCandidates({ name, preparation: null, visibleDetails: [], confidence: 1, alternative: null }, foods)
    .map((match) => ({ food: match.food, score: match.matchConfidence, exact: match.matchConfidence >= MATCH_THRESHOLDS.AUTOSELECT_MIN_SCORE }));
}
