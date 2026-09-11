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
  curationPriority?: 'common' | 'useful' | 'specific' | null;
  curationScore?: number | null;
  curationCategory?:
    | 'base_food'
    | 'simple_preparation'
    | 'common_dish'
    | 'composite_recipe'
    | 'composite_meal'
    | 'branded_product'
    | 'infant_food'
    | 'supplement'
    | null;
  curationDetails?: string[] | null;
  curationFlags?: string[] | null;
  curationConfidence?: 'high' | 'medium' | 'low' | null;
  duplicateGroup?: string | null;
};

export type MatchState =
  | 'AUTOSELECT'
  | 'RERANK'
  | 'ASK_IDENTITY'
  | 'ASK_ATTRIBUTE'
  | 'NO_EXACT_TBCA_MATCH'
  | 'NO_MATCH';

export const MATCH_THRESHOLDS = {
  AUTOSELECT_MIN_SCORE: 0.86,
  AUTOSELECT_MIN_MARGIN: 0.08,
  AUTOSELECT_MIN_VISUAL_CONFIDENCE: 0.65,
  MATCH_MIN_SCORE: 0.46,
  MATCH_MAX_SCORE_DROP: 0.16,
  MATCH_POOL_MAX_CANDIDATES: 24,
  ASK_USER_MAX_CANDIDATES: 3,
  // Compatibilidade somente com os executores dos benchmarks históricos.
  RERANK_MIN_SCORE: 0.46,
  RERANK_MAX_CANDIDATES: 24,
  RERANK_MIN_CONFIDENCE: 0.72,
} as const;

const STOP_WORDS = new Set([
  'a', 'ao', 'aparenta', 'brasil', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'media', 'o',
  'para', 'por', 'sem', 'ser', 'tipo',
]);

const CANONICAL_WORDS: Record<string, string> = {
  aipim: 'mandioca', assada: 'assado', assadas: 'assado', assados: 'assado', branca: 'branco',
  bife: 'carne', brancas: 'branco', brancos: 'branco', carioquinha: 'carioca', cozida: 'cozido', cozidas: 'cozido',
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
  'baiana', 'baiano', 'bolonhesa', 'catchup', 'chuchu', 'instantaneo', 'intantaneo', 'legume', 'lentilha', 'light', 'linguica', 'mcdonald', 'moranga',
  'molho', 'omelete', 'parmegiana', 'picles', 'pizza', 'pure', 'requeijao', 'salsicha', 'vegano',
  'recheado', 'recheio', 'role', 'salada', 'salsa', 'sanduiche', 'saute', 'sopa', 'sushi', 'toucinho', 'tropeiro', 'vegetal',
]);

const EXPLICIT_COMPOUND_TOKENS = new Set([
  'acaraje', 'baiana', 'baiano', 'bolo', 'bolonhesa', 'brigadeiro', 'cappuccino', 'carreteiro', 'coxinha', 'estrogonofe', 'feijoada',
  'fricasse', 'hamburguer', 'lasanha', 'milkshake', 'molho', 'moqueca', 'omelete', 'parmegiana', 'pastel',
  'pizza', 'pure', 'risoto', 'salada', 'sanduiche', 'sopa', 'sushi', 'tapioca', 'torta', 'tropeiro',
  'vatapa',
]);

const OBSERVABLE_TOKENS = new Set(['caldo']);
const PRESENTATION_TOKENS = new Set(['cubo', 'desfiado', 'isca', 'moido', 'pedaco', 'picado', 'tira']);

const AXES = [
  { identities: ['arroz'], values: ['integral', 'branco', 'creme', 'glutinoso'] },
  { identities: ['feijao'], values: ['carioca', 'preto', 'branco', 'vermelho', 'jalo', 'rajado', 'rosinha', 'fradinho'] },
  { identities: ['batata'], values: ['inglesa', 'doce', 'baroa'] },
  { identities: ['batata'], values: ['palito', 'chip'] },
  { identities: ['banana'], values: ['nanica', 'prata', 'maca', 'terra', 'ouro', 'figo', 'pacova'] },
  { identities: ['camarao'], values: ['barba', 'pitu'] },
  { identities: ['ovo'], values: ['galinha', 'codorna'] },
  { identities: ['ovo'], values: ['inteiro', 'clara', 'gema'] },
  { identities: ['frango'], values: ['peito', 'coxa', 'sobrecoxa', 'asa'] },
  { identities: ['carne'], values: ['bovino', 'suino', 'frango', 'cabrito', 'cordeiro'] },
  { identities: ['carne'], values: ['acem', 'alcatra', 'contrafile', 'coxao', 'maminha', 'picanha', 'patinho', 'lagarto', 'paleta', 'lombo', 'pernil', 'costela'] },
  { identities: ['alface'], values: ['crespa', 'lisa', 'roxo', 'americana'] },
  { identities: ['cebola'], values: ['branco', 'roxo'] },
  { identities: ['peixe', 'file'], values: ['abadejo', 'anchova', 'atum', 'bacalhau', 'cacao', 'carpa', 'cavala', 'corvina', 'linguado', 'merluza', 'namorado', 'pescada', 'pintado', 'salmao', 'sardinha', 'tainha', 'tilapia', 'truta', 'tucunare'] },
  { identities: ['leite'], values: ['integral', 'desnatado', 'semidesnatado'] },
  { identities: ['leite'], values: ['vaca', 'bufala', 'cabra', 'humano'] },
  { identities: ['leite'], values: ['po', 'fermentado', 'condensado', 'evaporado'] },
  { identities: ['queijo'], values: ['minas', 'frescal', 'padrao', 'mucarela', 'prato', 'requeijao', 'parmesao', 'cheddar', 'provolone', 'coalho', 'ricota'] },
] as const;

const MATERIAL_ATTRIBUTE_TOKENS = new Set([
  'abadejo', 'anchova', 'atum', 'bacalhau', 'barba', 'baroa', 'cacao', 'carpa', 'cavala', 'cheddar',
  'codorna', 'corvina', 'doce', 'linguado', 'merluza', 'minas', 'mucarela', 'namorado', 'parmesao',
  'pescada', 'pintado', 'pitu', 'prato', 'provolone', 'requeijao', 'salmao', 'sardinha', 'tainha',
  'tilapia', 'truta', 'tucunare',
]);

const IDENTITY_PARENTS: Record<string, string[]> = {
  atum: ['peixe'], bacalhau: ['peixe'], merluza: ['peixe'], pescada: ['peixe'], salmao: ['peixe'],
  sardinha: ['peixe'], tilapia: ['peixe'],
  cheddar: ['queijo'], coalho: ['queijo'], minas: ['queijo'], mucarela: ['queijo'], parmesao: ['queijo'],
  prato: ['queijo'], provolone: ['queijo'], requeijao: ['queijo'], ricota: ['queijo'],
};

export function normalizeFoodName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function canonicalToken(token: string) {
  return CANONICAL_WORDS[token] ?? singularFoodToken(token);
}

function singularFoodToken(token: string) {
  if (token.length < 4 || token.endsWith('is') || token.endsWith('us')) return token;
  if (token.endsWith('oes') || token.endsWith('aes')) return `${token.slice(0, -3)}ao`;
  if (token.endsWith('ais')) return `${token.slice(0, -3)}al`;
  if (token.endsWith('eis')) return `${token.slice(0, -3)}el`;
  if (token.endsWith('ois')) return `${token.slice(0, -3)}ol`;
  if (token.endsWith('ns')) return `${token.slice(0, -2)}m`;
  if (/[rz]es$/.test(token)) return token.slice(0, -2);
  if (/[aeou]s$/.test(token)) return token.slice(0, -1);
  return token;
}

export function foodSearchTokenVariants(value: string) {
  return normalizeFoodName(value).split(' ').filter(Boolean).map((token) => [...new Set([token, canonicalToken(token)])]);
}

export function normalizeFoodQuery(value: string) {
  return foodSearchTokenVariants(value).map((variants) => variants.at(-1)!).join(' ');
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
  skin: 'with' | 'without' | null;
  bone: 'with' | 'without' | null;
};

function visiblePolarity(value: string, attribute: 'pele' | 'osso') {
  if (new RegExp(`\\bsem ${attribute}\\b`).test(value)) return 'without' as const;
  if (new RegExp(`\\bcom ${attribute}\\b`).test(value)) return 'with' as const;
  return null;
}

function detectionProfile(item: DetectedFood): DetectionProfile {
  const rawText = normalizeFoodName([item.name, item.preparation ?? '', ...item.visibleDetails].join(' '));
  const nameTokens = tokens(item.name);
  const expandedNameTokens = unique(nameTokens.flatMap((token) => [token, ...(IDENTITY_PARENTS[token] ?? [])]));
  const identitySeed = new Set(expandedNameTokens);
  const preparationTokens = unique(tokens([item.name, item.preparation ?? ''].join(' ')).filter((token) => PREPARATIONS.has(token)));
  const evidence = new Set([...expandedNameTokens, ...preparationTokens]);
  for (const detail of item.visibleDetails) {
    for (const token of tokens(detail)) {
      const relevantAxisValue = AXES.some((axis) => axis.identities.some((identity) => identitySeed.has(identity)) && axis.values.includes(token as never));
      if (PREPARATIONS.has(token) || PRESENTATION_TOKENS.has(token) || relevantAxisValue || RECIPE_MARKERS.has(token) || OBSERVABLE_TOKENS.has(token) || token === 'pele' || token === 'osso') evidence.add(token);
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
  const identity = new Set(expandedNameTokens.filter((token) => !STOP_WORDS.has(token) && !PREPARATIONS.has(token) && !PRESENTATION_TOKENS.has(token)));
  return {
    identity,
    evidence,
    preparations: new Set(preparationTokens),
    alternative: new Set(tokens(item.alternative ?? '').filter((token) => !STOP_WORDS.has(token))),
    rawText,
    skin: visiblePolarity(rawText, 'pele'),
    bone: visiblePolarity(rawText, 'osso'),
  };
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
  skin: 'with' | 'without' | null;
  bone: 'with' | 'without' | null;
};

const candidateCache = new WeakMap<object, CandidateProfile>();

function candidateProfile(food: SearchableFood): CandidateProfile {
  const cached = candidateCache.get(food as object);
  if (cached) return cached;
  const displayName = food.displayName || food.description;
  const fields = unique([displayName, ...(food.searchAliases ?? []), food.description, food.category ?? ''].filter(Boolean));
  const display = tokens(displayName);
  const semanticFields = fields.map(semanticPhrase);
  const attributeText = [displayName, food.description, ...(food.curationDetails ?? [])].join(' ');
  const all = new Set([...fields, ...(food.curationDetails ?? [])].flatMap(tokens));
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
    skin: visiblePolarity(normalizeFoodName(attributeText), 'pele'),
    bone: visiblePolarity(normalizeFoodName(attributeText), 'osso'),
  };
  candidateCache.set(food as object, profile);
  return profile;
}

export function canonicalQueries(item: DetectedFood) {
  const profile = detectionProfile(item);
  const base = semanticPhrase(item.name), prep = semanticPhrase(item.preparation ?? '');
  const visible = [...profile.evidence].filter((token) => !profile.identity.has(token) && !profile.preparations.has(token) && token !== 'pele' && token !== 'osso');
  const polarity = [profile.skin ? `${profile.skin === 'with' ? 'com' : 'sem'} pele` : '', profile.bone ? `${profile.bone === 'with' ? 'com' : 'sem'} osso` : ''].filter(Boolean);
  const queries = [base, [base, prep].filter(Boolean).join(' ')];
  if (visible.length || polarity.length) queries.push([base, prep, ...visible, ...polarity].filter(Boolean).join(' '));
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

function visibleAttributeContradictions(profile: DetectionProfile, candidate: CandidateProfile) {
  const found: string[] = [];
  if (profile.skin && candidate.skin && profile.skin !== candidate.skin) found.push(`pele:${profile.skin}!=${candidate.skin}`);
  if (profile.bone && candidate.bone && profile.bone !== candidate.bone) found.push(`osso:${profile.bone}!=${candidate.bone}`);
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
  if (profile.identity.has('macarrao')) {
    for (const ingredient of ['camarao', 'frango', 'lula', 'mexilhao', 'queijo', 'sardinha']) {
      if (candidate.all.has(ingredient) && !profile.evidence.has(ingredient)) markers.push(ingredient);
    }
  }
  if (profile.identity.has('farofa') || profile.identity.has('omelete')) {
    for (const filling of ['carne', 'cenoura', 'linguica', 'toucinho', 'bacon', 'vegetal', 'queijo', 'frio', 'ovo']) {
      if (candidate.all.has(filling) && !profile.evidence.has(filling)) markers.push(filling);
    }
  }
  return unique(markers);
}

function unobservedMaterialAttributes(profile: DetectionProfile, candidate: CandidateProfile) {
  const values: string[] = [];
  const axes = relevantAxes(profile);
  for (const axis of axes) {
    if (axis.values.some((value) => profile.evidence.has(value))) continue;
    for (const value of axis.values) if (candidate.all.has(value) && MATERIAL_ATTRIBUTE_TOKENS.has(value)) values.push(value);
  }
  const fishSpeciesObserved = axes.some((axis) => axis.identities.some((identity) => identity === 'peixe' || identity === 'file') && axis.values.some((value) => profile.evidence.has(value)));
  if ((profile.identity.has('peixe') || profile.identity.has('file')) && !fishSpeciesObserved && candidate.fishSpecific && !values.length) values.push('fish_species');
  if (profile.identity.has('file') && candidate.hasPosta && !profile.evidence.has('posta')) values.push('posta');
  if (!profile.skin && candidate.skin) values.push('skin');
  if (!profile.bone && candidate.bone) values.push('bone');
  if (profile.identity.has('queijo') && !relevantAxes(profile)[0]?.values.some((value) => profile.evidence.has(value)) && !values.length) values.push('cheese_variety');
  if (profile.identity.has('farofa')) values.push('farofa_recipe');
  if (profile.identity.has('omelete')) values.push('omelet_recipe');
  if ((profile.identity.has('peixe') || profile.identity.has('file')) && profile.evidence.has('empanado')) values.push('breaded_fish_recipe');
  return unique(values);
}

function curationAdjustment(food: SearchableFood, profile: DetectionProfile) {
  if (!food.curationPriority && food.curationScore == null && !food.curationCategory) return 0;
  const compoundWasDetected = [...profile.evidence].some((token) => EXPLICIT_COMPOUND_TOKENS.has(token));
  let score = compoundWasDetected
    ? food.curationPriority === 'common' ? 0.02 : food.curationPriority === 'useful' ? 0.01 : 0
    : food.curationPriority === 'common' ? 0.06 : food.curationPriority === 'useful' ? 0.025 : -0.06;
  if (typeof food.curationScore === 'number') score += Math.max(0, Math.min(1000, food.curationScore)) / 1000 * 0.07;
  if (food.curationCategory === 'base_food') score += 0.02;
  else if (food.curationCategory === 'simple_preparation') score += 0.02;
  else if (food.curationCategory === 'common_dish') score += compoundWasDetected ? 0.01 : -0.12;
  else if (food.curationCategory === 'composite_recipe') score += compoundWasDetected ? 0 : -0.18;
  else if (food.curationCategory === 'composite_meal') score += compoundWasDetected ? -0.02 : -0.24;
  else if (food.curationCategory === 'infant_food' || food.curationCategory === 'supplement') score -= 0.24;
  else if (food.curationCategory === 'branded_product') score -= 0.02;
  if (food.curationConfidence === 'low') score -= 0.015;
  return score;
}

function unobservedSubtypePenalty(profile: DetectionProfile, candidate: CandidateProfile) {
  if (profile.identity.has('camarao') && !profile.evidence.has('barba') && !profile.evidence.has('pitu') && (candidate.all.has('barba') || candidate.all.has('pitu'))) return 0.02;
  return 0;
}

export type SemanticMatch<T> = {
  food: T; matchConfidence: number; contradictions: string[]; query: string;
  materialUnknowns?: string[]; resolutionPolicies?: string[]; saltSignature?: string; withSalt?: boolean;
};

function sortSemanticMatches<T extends SearchableFood>(matches: SemanticMatch<T>[]) {
  return matches.sort((left, right) => {
    const scoreDifference = right.matchConfidence - left.matchConfidence;
    if (Math.abs(scoreDifference) > 0.0001) return scoreDifference;
    const priority = { common: 0, useful: 1, specific: 2 } as const;
    const priorityDifference = (priority[left.food.curationPriority ?? 'specific'] ?? 2) - (priority[right.food.curationPriority ?? 'specific'] ?? 2);
    if (priorityDifference) return priorityDifference;
    const curationDifference = (right.food.curationScore ?? 0) - (left.food.curationScore ?? 0);
    if (curationDifference) return curationDifference;
    return (left.food.source_code || '').localeCompare(right.food.source_code || '') || (left.food.displayName || left.food.description).localeCompare(right.food.displayName || right.food.description);
  });
}

export function rankSemanticFoodCandidates<T extends SearchableFood>(item: DetectedFood, foods: T[], limit: number = MATCH_THRESHOLDS.MATCH_POOL_MAX_CANDIDATES): SemanticMatch<T>[] {
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
    const missingVisible = visible.filter((token) => !candidate.all.has(token)
      && (RECIPE_MARKERS.has(token) || OBSERVABLE_TOKENS.has(token) || token === 'empanado'
        || (token === 'tomate' && profile.evidence.has('molho'))));
    const semanticContradictions = [
      ...preparationContradictions(profile.preparations, candidate.preparations),
      ...axisContradictions(profile, candidate.all),
      ...visibleAttributeContradictions(profile, candidate),
    ];
    const contradictions = [...semanticContradictions, ...missingVisible.map((value) => `visible:${value}!=absent`)];
    const unexpectedRecipes = unexpectedRecipeMarkers(profile, candidate);
    const materialAttributes = unobservedMaterialAttributes(profile, candidate);
    const hiddenAdditions = [...candidate.positiveIngredients].filter((ingredient) => {
      if (ingredient === 'oleo' && (profile.preparations.has('frito') || profile.preparations.has('refogado'))) return false;
      if (profile.evidence.has('molho') && profile.identity.has('macarrao')) return false;
      return !profile.evidence.has(ingredient);
    });
    const directFriendlyMatch = primaryQueries.includes(candidate.semanticFields[0]);
    const exactAliasMatch = candidate.semanticFields.slice(1).some((field) => primaryQueries.includes(field));
    const visibleAttributeMatch = (profile.skin && candidate.skin === profile.skin ? 0.04 : 0) + (profile.bone && candidate.bone === profile.bone ? 0.03 : 0);
    const raw = identityMatch === 0 ? 0 : identityMatch * 0.34 + lexical * 0.22 + prepMatch * 0.10 + visibleMatch * 0.08 + (identityIsMain ? 0.05 : 0)
      + (directFriendlyMatch ? 0.05 : exactAliasMatch ? 0.025 : 0) + visibleAttributeMatch + alternativeCoverage * 0.015 + curationAdjustment(food, profile)
      - Math.min(0.42, unexpectedRecipes.length * 0.14) - unobservedSubtypePenalty(profile, candidate)
      - Math.min(0.36, missingVisible.length * 0.18) - Math.min(0.21, hiddenAdditions.length * 0.07)
      - Math.min(0.70, semanticContradictions.length * 0.30);
    return {
      food, matchConfidence: Math.max(0, Math.min(0.99, Number(raw.toFixed(4)))), contradictions,
      query: primaryQueries.find((query) => fieldTier(query, food) === lexical) || primaryQueries[0],
      materialUnknowns: unique([...unexpectedRecipes.map((value) => `recipe:${value}`), ...materialAttributes.map((value) => `attribute:${value}`)]),
      resolutionPolicies: [], saltSignature: candidate.saltSignature, withSalt: candidate.withSalt,
    };
  });
  return sortSemanticMatches(matches).filter((match) => match.matchConfidence >= 0.25).slice(0, limit);
}

function candidateDiversityKey<T extends SearchableFood>(item: DetectedFood, match: SemanticMatch<T>) {
  const profile = detectionProfile(item), candidate = candidateProfile(match.food);
  if (match.food.duplicateGroup) return `duplicate:${match.food.duplicateGroup}`;
  const axes = relevantAxes(profile);
  const valuesFor = (identity: string) => unique(axes.filter((axis) => axis.identities.includes(identity as never)).flatMap((axis) => axis.values.filter((value) => candidate.all.has(value))));
  const evidenceFor = (identity: string) => unique(axes.filter((axis) => axis.identities.includes(identity as never)).flatMap((axis) => axis.values.filter((value) => profile.evidence.has(value))));

  if ((profile.identity.has('peixe') || profile.identity.has('file')) && !evidenceFor('peixe').length && !evidenceFor('file').length) {
    const species = [...new Set([...valuesFor('peixe'), ...valuesFor('file')])];
    if (species.length) return `fish:${species.join('+')}`;
  }
  if (profile.identity.has('leite') && !evidenceFor('leite').length) {
    const values = valuesFor('leite');
    return `milk:${values.filter((value) => ['vaca', 'bufala', 'cabra', 'humano'].includes(value)).join('+') || 'vaca'}:${values.filter((value) => ['integral', 'desnatado', 'semidesnatado'].includes(value)).join('+') || 'unknown-fat'}:${values.filter((value) => ['po', 'fermentado', 'condensado', 'evaporado'].includes(value)).join('+') || 'liquid'}`;
  }
  if (profile.identity.has('queijo') && !evidenceFor('queijo').length) {
    const variety = valuesFor('queijo');
    if (variety.length) return `cheese:${variety.join('+')}`;
  }
  if (profile.identity.has('banana') && !evidenceFor('banana').length) {
    const variety = valuesFor('banana');
    if (variety.length) return `banana:${variety.join('+')}`;
  }

  const axisParts = axes.flatMap((axis, index) => axis.values.filter((value) => candidate.all.has(value)).map((value) => `${index}:${value}`));
  const presentation = [...candidate.all].filter((token) => PRESENTATION_TOKENS.has(token));
  const parts = unique([
    ...axisParts,
    ...[...candidate.preparations].map((value) => `prep:${value}`),
    ...presentation.map((value) => `shape:${value}`),
    ...(candidate.skin ? [`skin:${candidate.skin}`] : []),
    ...(candidate.bone ? [`bone:${candidate.bone}`] : []),
  ]);
  if (parts.length) return parts.sort().join('|');
  const ignored = new Set([...STOP_WORDS, 'amostra', 'amostras', 'marca', 'oleo', 'sal']);
  const remainder = candidate.display.filter((token) => !profile.identity.has(token) && !ignored.has(token)).slice(0, 5);
  return remainder.length ? remainder.join('|') : 'base';
}

export function selectDistinctFoodCandidates<T extends SearchableFood>(item: DetectedFood, matches: SemanticMatch<T>[], limit: number = MATCH_THRESHOLDS.ASK_USER_MAX_CANDIDATES) {
  const maximum = Math.max(0, Math.min(MATCH_THRESHOLDS.ASK_USER_MAX_CANDIDATES, Math.trunc(limit)));
  if (!maximum || !matches.length) return [] as SemanticMatch<T>[];
  const sorted = sortSemanticMatches([...matches]);
  const top = sorted[0];
  const selected: SemanticMatch<T>[] = [], seen = new Set<string>();
  for (const match of sorted) {
    if (match.matchConfidence < MATCH_THRESHOLDS.MATCH_MIN_SCORE) continue;
    if (top.matchConfidence - match.matchConfidence > MATCH_THRESHOLDS.MATCH_MAX_SCORE_DROP) continue;
    if (!top.contradictions.length && match.contradictions.length) continue;
    const key = candidateDiversityKey(item, match);
    if (seen.has(key)) continue;
    seen.add(key); selected.push(match);
    if (selected.length === maximum) break;
  }
  return selected;
}

function unresolvedRecipe(unknowns: string[]) {
  return unknowns.some((value) => value.startsWith('recipe:') || /(?:farofa|omelet|breaded_fish)_recipe$/.test(value));
}

export function decideMatch<T>(item: DetectedFood, matches: SemanticMatch<T>[]) {
  const top1 = matches[0]?.matchConfidence ?? 0, top2 = matches[1]?.matchConfidence ?? 0, margin = Number((top1 - top2).toFixed(4)), top = matches[0];
  const policy = top?.resolutionPolicies?.[0] ?? null;
  if (top && unresolvedRecipe(top.materialUnknowns ?? [])) return { state: 'NO_EXACT_TBCA_MATCH' as const, top1Score: top1, top2Score: top2, margin, policy };
  if (!top || top1 < MATCH_THRESHOLDS.MATCH_MIN_SCORE) return { state: 'NO_MATCH' as const, top1Score: top1, top2Score: top2, margin, policy };
  if (top1 >= MATCH_THRESHOLDS.AUTOSELECT_MIN_SCORE && (matches.length === 1 || margin >= MATCH_THRESHOLDS.AUTOSELECT_MIN_MARGIN) && item.confidence >= MATCH_THRESHOLDS.AUTOSELECT_MIN_VISUAL_CONFIDENCE && !top.contradictions.length && !(top.materialUnknowns?.length ?? 0)) {
    return { state: 'AUTOSELECT' as const, top1Score: top1, top2Score: top2, margin, policy };
  }
  return { state: 'ASK_ATTRIBUTE' as const, top1Score: top1, top2Score: top2, margin, policy };
}

export function resolveFoodCandidates<T extends SearchableFood>(item: DetectedFood, foods: T[]) {
  const ranked = rankSemanticFoodCandidates(item, foods, MATCH_THRESHOLDS.MATCH_POOL_MAX_CANDIDATES);
  const distinct = selectDistinctFoodCandidates(item, ranked);
  const initial = decideMatch(item, distinct);
  const forceIdentityChoice = needsMeatConfirmation(item);
  const decision = forceIdentityChoice ? { ...initial, state: 'ASK_IDENTITY' as const, policy: null } : initial;
  const candidates = decision.state === 'NO_MATCH' || decision.state === 'NO_EXACT_TBCA_MATCH'
    ? []
    : decision.state === 'AUTOSELECT' ? distinct.slice(0, 1) : distinct;
  return { ranked, candidates, decision };
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
