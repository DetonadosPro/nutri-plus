import { describe, expect, it } from 'vitest';
import { gramMeasure, type FoodMeasure } from '../shared/food-measures';
import {
  classifySubstitutionFood,
  equivalentServing,
  solveEquivalentGrams,
  substitutionCompatibility,
  SUBSTITUTION_ALGORITHM_VERSION,
  SUBSTITUTION_GROUP_CONFIG,
  type SubstitutionFood,
} from './smart-substitutions';

const cup: FoodMeasure = {
  id: 101,
  kind: 'household',
  name: 'xícara rasa',
  plural: 'xícaras rasas',
  quantity: 1,
  grams: 100,
  source: 'TBCA',
  reference: 'fixture baseada em medida cadastrada',
  isDefault: true,
};

function food(overrides: Partial<SubstitutionFood> = {}): SubstitutionFood {
  return {
    id: 1,
    source_code: 'BRC0018A',
    display_name: 'Arroz branco cozido',
    description: 'Arroz, polido, cozido, sem óleo, sem sal',
    category: 'Cereais e derivados',
    curation_category: 'base_food',
    curation_confidence: 'high',
    curation_flags: ['individual_food'],
    curation_details: ['Sem óleo', 'Sem sal'],
    curation_score: 990,
    duplicate_group: null,
    nutrients: {
      energia_kcal: 130,
      proteina_g: 2.38,
      carboidrato_g: 30,
      lipideos_g: .3,
      fibra_g: 1,
    },
    measures: [cup, gramMeasure],
    ...overrides,
  };
}

describe('smart substitutions deterministic core', () => {
  it('uses a small explainable taxonomy and defaults uncertainty to unknown', () => {
    expect(classifySubstitutionFood(food())).toMatchObject({
      group: 'carbohydrate',
      family: 'arroz',
      preparation: 'cooked',
    });
    expect(classifySubstitutionFood(food({
      source_code: 'BRC0001T',
      display_name: 'Feijão carioca cozido',
      description: 'Feijão carioca cozido sem óleo e sem sal',
      category: 'Leguminosas e derivados',
    }))).toMatchObject({ group: 'legume', preparation: 'cooked' });
    expect(classifySubstitutionFood(food({
      display_name: 'Omelete carne bovina e cogumelo',
      description: 'Omelete com carne bovina e cogumelo',
      category: 'Ovos e derivados',
      curation_category: 'simple_preparation',
      curation_confidence: 'medium',
    })).group).toBe('unknown');
    expect(classifySubstitutionFood(food({
      display_name: 'Preparação sem identidade segura',
      description: 'Preparação mista',
      curation_category: 'composite_recipe',
      curation_flags: ['many_ingredients'],
    }))).toMatchObject({ group: 'unknown', reason: 'non_individual_curation' });
  });

  it('requires semantic group, culinary role and compatible preparation before math', () => {
    const rice = classifySubstitutionFood(food());
    const potato = classifySubstitutionFood(food({
      id: 2,
      source_code: 'BRC0117B',
      display_name: 'Batata inglesa cozida',
      description: 'Batata inglesa cozida sem óleo',
      category: 'Vegetais e derivados',
    }));
    const rawPotato = { ...potato, preparation: 'raw' as const };
    expect(substitutionCompatibility(rice, potato)).toMatchObject({ compatible: true });
    expect(substitutionCompatibility(rice, rawPotato)).toMatchObject({
      compatible: false,
      reason: 'incompatible_preparation',
    });
    expect(substitutionCompatibility(rice, { ...potato, group: 'vegetable' })).toMatchObject({
      compatible: false,
      reason: 'different_group',
    });
  });

  it('solves weighted least squares deterministically without unstable zero divisions', () => {
    const target = {
      energia_kcal: 130,
      proteina_g: 2.38,
      carboidrato_g: 30,
      lipideos_g: .3,
      fibra_g: 1,
    };
    const candidate = {
      energia_kcal: 65,
      proteina_g: 1.19,
      carboidrato_g: 15,
      lipideos_g: .15,
      fibra_g: .5,
    };
    const config = SUBSTITUTION_GROUP_CONFIG.carbohydrate;
    expect(solveEquivalentGrams(target, candidate, config)).toBeCloseTo(200, 10);
    expect(solveEquivalentGrams(target, candidate, config)).toBe(
      solveEquivalentGrams(target, candidate, config),
    );
    expect(solveEquivalentGrams(target, { energia_kcal: 0 }, config)).toBeNull();
  });

  it('returns only a real registered measure or the explicit gram fallback', () => {
    const original = food();
    const candidate = food({
      id: 2,
      source_code: 'BRC0117B',
      display_name: 'Batata inglesa cozida',
      description: 'Batata inglesa cozida sem óleo',
      category: 'Vegetais e derivados',
      nutrients: {
        energia_kcal: 130,
        proteina_g: 2.4,
        carboidrato_g: 30,
        lipideos_g: .3,
        fibra_g: 1,
      },
      measures: [cup, gramMeasure],
    });
    const result = equivalentServing(original, 100, candidate);
    expect(result).not.toBeNull();
    expect(result?.algorithmVersion).toBe(SUBSTITUTION_ALGORITHM_VERSION);
    expect(result?.gramsFinal).toBeGreaterThan(0);
    expect(result?.measureSnapshot === null || result?.measureSnapshot?.id === cup.id).toBe(true);
  });

  it('keeps cross-group choices manual and explicitly marked as incompatible', () => {
    const result = equivalentServing(food(), 100, food({
      id: 3,
      source_code: 'BRC0114F',
      display_name: 'Peito de frango grelhado',
      description: 'Peito de frango grelhado sem óleo',
      category: 'Carnes e derivados',
      nutrients: {
        energia_kcal: 160,
        proteina_g: 31,
        carboidrato_g: 0,
        lipideos_g: 3.6,
        fibra_g: 0,
      },
    }), true);
    expect(result).toMatchObject({
      automaticCompatible: false,
      compatibilityReason: 'different_group',
    });
  });
});
