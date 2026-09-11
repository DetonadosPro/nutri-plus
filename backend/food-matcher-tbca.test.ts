import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MATCH_THRESHOLDS,
  needsMeatConfirmation,
  normalizeFoodName,
  resolveFoodCandidates,
  type DetectedFood,
  type SearchableFood,
} from '../shared/food-recognition';
import type { FoodCurationFile } from './food-curation-rules';
import { projectPath } from './db';

type RawFood = {
  codigo: string;
  nome_original: string;
  grupo: string;
};

const sourceFoods = JSON.parse(
  readFileSync(projectPath('data', 'tbca', 'tbca completa normalizada.json'), 'utf8'),
) as RawFood[];
const curation = JSON.parse(
  readFileSync(projectPath('data', 'food-curation.v1.json'), 'utf8'),
) as FoodCurationFile;
const sourceByCode = new Map(sourceFoods.map((food) => [food.codigo, food]));

const foods = curation.foods.map((curated): SearchableFood => {
  const source = sourceByCode.get(curated.source_code);
  if (!source) throw new Error(`Curadoria sem fonte TBCA: ${curated.source_code}`);
  return {
    source_code: curated.source_code,
    description: source.nome_original,
    displayName: curated.friendly_name,
    searchAliases: curated.aliases,
    category: source.grupo,
    curationPriority: curated.priority,
    curationScore: curated.priority_score,
    curationCategory: curated.curation_category,
    curationDetails: curated.details,
    curationFlags: curated.specificity_flags,
    curationConfidence: curated.confidence,
    duplicateGroup: curated.duplicate_group,
  };
});

function detection(
  name: string,
  preparation: string | null = null,
  visibleDetails: string[] = [],
  confidence = 0.9,
): DetectedFood {
  return { name, preparation, visibleDetails, confidence, alternative: null };
}

function resolve(item: DetectedFood) {
  return resolveFoodCandidates(item, foods);
}

function codes(item: DetectedFood) {
  return resolve(item).candidates.map((match) => match.food.source_code);
}

function names(item: DetectedFood) {
  return resolve(item).candidates.map((match) => match.food.displayName || match.food.description);
}

describe('photo matcher against the curated complete TBCA catalog', () => {
  it.each([
    [detection('arroz'), 'BRC0018A'],
    [detection('arroz branco', 'cozido'), 'BRC0018A'],
    [detection('arroz integral'), 'BRC0016A'],
    [detection('feijão'), 'BRC0001T'],
    [detection('feijão preto'), 'BRC0008T'],
    [detection('frango'), 'BRC0114F'],
    [detection('peito de frango'), 'BRC0114F'],
    [detection('peito de frango', 'grelhado', ['sem pele']), 'BRC0114F'],
    [detection('carne'), 'BRC0025F'],
    [detection('carne moída'), 'BRC0025F'],
    [detection('ovo', 'frito'), 'BRC0015J'],
    [detection('banana'), 'BRC0007C'],
    [detection('leite'), 'BRC0044G'],
    [detection('peixe'), 'BRC0486E'],
    [detection('tilápia'), 'BRC0486E'],
    [detection('salmão'), 'BRC0067E'],
    [detection('queijo'), 'BRC0052G'],
    [detection('batata', 'cozida'), 'BRC0117B'],
    [detection('camarão'), 'BRC0001E'],
  ])('uses curation and semantic evidence for $0.name', (item, expected) => {
    const result = resolve(item);
    expect(result.candidates[0]?.food.source_code).toBe(expected);
    expect(result.decision.top1Score).toBeGreaterThanOrEqual(MATCH_THRESHOLDS.MATCH_MIN_SCORE);
  });

  it.each([
    detection('arroz'),
    detection('arroz branco'),
    detection('arroz integral'),
    detection('feijão'),
    detection('feijão preto'),
    detection('frango'),
    detection('peito de frango'),
    detection('carne'),
    detection('carne moída'),
    detection('ovo', 'frito'),
    detection('banana'),
    detection('leite'),
    detection('peixe'),
    detection('tilápia'),
    detection('salmão'),
    detection('queijo'),
    detection('batata', 'cozida'),
    detection('camarão'),
    detection('xilofônico'),
  ])('never returns more than three candidates for $name', (item) => {
    expect(resolve(item).candidates.length).toBeLessThanOrEqual(3);
  });

  it('uses one option for an exact, visually supported match', () => {
    const item = detection('peito de frango', 'grelhado', ['sem pele']);
    const result = resolve(item);
    expect(result.decision.state).toBe('AUTOSELECT');
    expect(codes(item)).toEqual(['BRC0114F']);
  });

  it('does not infer skin when it was not visually supplied', () => {
    const result = resolve(detection('peito de frango', 'grelhado'));
    expect(result.decision.state).toBe('ASK_ATTRIBUTE');
    expect(result.candidates[0]?.materialUnknowns).toContain('attribute:skin');
  });

  it('collapses invisible milk processing variants and keeps useful fat choices', () => {
    expect(codes(detection('leite'))).toEqual(['BRC0044G', 'BRC0036G', 'BRC0046G']);
    expect(names(detection('leite')).join(' ')).not.toMatch(/cappuccino|milk.?shake/i);
  });

  it('offers distinct simple fish identities for a generic fish', () => {
    const result = resolve(detection('peixe'));
    expect(result.decision.state).toBe('ASK_ATTRIBUTE');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]?.food.source_code).toBe('BRC0486E');
    expect(names(detection('peixe')).join(' ')).not.toMatch(/parmegiana|lasanha|pizza/i);
  });

  it('uses visible grilling but does not invent a fish species', () => {
    const result = resolve(detection('peixe', 'grelhado'));
    expect(result.decision.state).toBe('ASK_ATTRIBUTE');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((match) => /grelhad|assad/i.test(match.food.displayName || ''))).toBe(true);
  });

  it('keeps generic results away from unrelated composite recipes', () => {
    const checks = [
      [detection('arroz'), /carreteiro/i],
      [detection('frango'), /lasanha/i],
      [detection('peixe'), /parmegiana/i],
      [detection('banana'), /sobremesa/i],
      [detection('leite'), /cappuccino|milk.?shake/i],
    ] as const;
    for (const [item, forbidden] of checks) expect(names(item).join(' ')).not.toMatch(forbidden);
  });

  it('keeps preparation conflicts out of the visible options', () => {
    expect(names(detection('ovo', 'frito')).every((name) => !/cozid|cru/i.test(name))).toBe(true);
    expect(names(detection('batata', 'cozida')).every((name) => !/frit|assad|cru/i.test(name))).toBe(true);
  });

  it('uses curated aliases without changing the detected label', () => {
    expect(codes(detection('aipim', 'cozido'))[0]).toBe('BRC0053B');
    expect(codes(detection('macaxeira', 'cozida'))[0]).toBe('BRC0053B');
    expect(codes(detection('pão de sal'))).toContain('BRC0002A');
    expect(codes(detection('mussarela'))[0]).toBe('BRC0059G');
  });

  it('keeps an exact banana variety to one option', () => {
    const result = resolve(detection('banana nanica'));
    expect(result.decision.state).toBe('AUTOSELECT');
    expect(codes(detection('banana nanica'))).toEqual(['BRC0007C']);
  });

  it('preserves a visible tomato sauce without offering an unseen seafood recipe', () => {
    const item = detection('espaguete', 'cozido', ['fios longos', 'molho vermelho']);
    const result = resolve(item);
    expect(names(item)[0]).toMatch(/molho de tomate/i);
    expect(names(item).join(' ')).not.toMatch(/camarão|lula|mexilhão|frutos do mar/i);
    expect(names(item).every((name) => /molho de tomate/i.test(name))).toBe(true);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('asks for identity when fragmented meat hides the defensible cut', () => {
    const item = detection('carne moída');
    const result = resolve(item);
    expect(needsMeatConfirmation(item)).toBe(true);
    expect(result.decision.state).toBe('ASK_IDENTITY');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('maps a visible grilled steak to simple bovine cuts, not named recipes', () => {
    const item = detection('bife', 'grelhado', ['carne bovina em corte inteiro']);
    const result = resolve(item);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(names(item).join(' ')).not.toMatch(/cavalo|parmegiana|rol[eê]/i);
  });

  it('returns no forced TBCA match below the quality floor', () => {
    const result = resolve(detection('xilofônico'));
    expect(result.decision.state).toBe('NO_MATCH');
    expect(result.candidates).toEqual([]);
  });

  it('does not expose a candidate that requires an unseen recipe', () => {
    const result = resolve(detection('omelete', 'frita', ['dobrada e dourada']));
    expect(result.decision.state).toBe('NO_EXACT_TBCA_MATCH');
    expect(result.candidates).toEqual([]);
  });

  it('resolves multiple plate components independently', () => {
    const items = [
      detection('arroz branco', 'cozido'),
      detection('feijão preto', 'cozido'),
      detection('peito de frango', 'grelhado', ['sem pele']),
    ].map(resolve);
    expect(items.map((item) => item.candidates[0]?.food.source_code)).toEqual([
      'BRC0018A',
      'BRC0008T',
      'BRC0114F',
    ]);
    expect(items.every((item) => item.candidates.length <= 3)).toBe(true);
  });

  it('does not expose three duplicate display labels', () => {
    for (const item of [detection('leite'), detection('frango'), detection('peixe')]) {
      const normalized = names(item).map(normalizeFoodName);
      expect(new Set(normalized).size).toBe(normalized.length);
    }
  });
});
