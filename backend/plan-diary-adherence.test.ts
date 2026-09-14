import { describe, expect, it } from 'vitest';
import { matchMealItems, mealState, quantityAlignment, QUANTITY_TOLERANCE } from './plan-diary-adherence';

const planned = (id: number, foodId: number, grams: number | null, substitutions: Array<{ foodId: number; grams: number | null }> = []) => ({
  id, foodId, name: `Planejado ${foodId}`, amount: grams ?? 1, unit: grams == null ? 'unidade' : 'g', grams, position: id,
  substitutions: substitutions.map((entry) => ({ ...entry, name: `Alternativa ${entry.foodId}`, amount: entry.grams ?? 1, unit: entry.grams == null ? 'unidade' : 'g' })),
});
const diary = (id: number, foodId: number, grams: number | null) => ({ id, foodId, name: `Registrado ${foodId}`, amount: grams ?? 1, unit: grams == null ? 'unidade' : 'g', grams, position: id });

describe('plan diary adherence deterministic core', () => {
  it('matches the original food and classifies same, near and different quantities', () => {
    expect(matchMealItems([planned(1, 10, 100)], [diary(1, 10, 105)])[0]).toMatchObject({ state: 'matched_original', quantity: 'within_target' });
    expect(matchMealItems([planned(1, 10, 100)], [diary(1, 10, 120)])[0]).toMatchObject({ state: 'matched_original', quantity: 'near_target' });
    expect(matchMealItems([planned(1, 10, 100)], [diary(1, 10, 150)])[0]).toMatchObject({ state: 'matched_quantity_difference', quantity: 'outside_target' });
  });

  it('matches only explicitly approved substitutions against their approved portion', () => {
    expect(matchMealItems([planned(1, 10, 100, [{ foodId: 20, grams: 180 }])], [diary(1, 20, 175)])[0]).toMatchObject({ state: 'matched_substitution', approvedSubstitution: true, quantity: 'within_target' });
    expect(matchMealItems([planned(1, 10, 100, [{ foodId: 20, grams: 180 }])], [diary(1, 30, 180)]).map((item) => item.state)).toEqual(['planned_not_recorded', 'extra_recorded']);
  });

  it('does not reuse one diary item for duplicate planned items', () => {
    const result = matchMealItems([planned(1, 10, 100), planned(2, 10, 80)], [diary(1, 10, 82)]);
    expect(result.filter((item) => item.state.startsWith('matched_'))).toHaveLength(1);
    expect(result.filter((item) => item.state === 'planned_not_recorded')).toHaveLength(1);
    expect(result.find((item) => item.state.startsWith('matched_'))?.planned?.grams).toBe(80);
  });

  it('prioritizes original identity before an approved substitution', () => {
    const result = matchMealItems([
      planned(1, 10, 100, [{ foodId: 20, grams: 100 }]),
      planned(2, 20, 100),
    ], [diary(1, 20, 100)]);
    expect(result.find((item) => item.state.startsWith('matched_'))?.planned?.name).toBe('Planejado 20');
  });

  it('keeps extra food informational and missing planned food unevaluated', () => {
    const result = matchMealItems([planned(1, 10, 100)], [diary(1, 10, 100), diary(2, 30, 50)]);
    expect(result.map((item) => item.state)).toEqual(['matched_original', 'extra_recorded']);
    expect(matchMealItems([planned(1, 10, 100)], [])[0]).toMatchObject({ state: 'planned_not_recorded', quantity: 'not_evaluable' });
  });

  it('uses an absolute floor for small portions and does not invent missing grams', () => {
    expect(QUANTITY_TOLERANCE.withinAbsoluteGrams).toBe(5);
    expect(quantityAlignment(5, 7).status).toBe('within_target');
    expect(quantityAlignment(null, 100).status).toBe('not_evaluable');
    expect(quantityAlignment(100, null).status).toBe('not_evaluable');
  });

  it('compares volume and count through their stored grams equivalent', () => {
    expect(matchMealItems([planned(1, 40, 206)], [diary(1, 40, 200)])[0].quantity).toBe('within_target');
    expect(matchMealItems([planned(1, 50, 100)], [diary(1, 50, 104)])[0].quantity).toBe('within_target');
  });

  it('keeps a 20-case semantic meal matrix stable', () => {
    const scenarios = [
      { name:'exact original', p:[planned(1,10,100)], d:[diary(1,10,100)], state:'aligned' },
      { name:'within original', p:[planned(1,10,100)], d:[diary(1,10,105)], state:'aligned' },
      { name:'near original', p:[planned(1,10,100)], d:[diary(1,10,120)], state:'aligned' },
      { name:'outside quantity', p:[planned(1,10,100)], d:[diary(1,10,150)], state:'mostly_aligned' },
      { name:'nothing recorded', p:[planned(1,10,100)], d:[], state:'not_evaluable' },
      { name:'one of three', p:[planned(1,10,100),planned(2,20,100),planned(3,30,100)], d:[diary(1,10,100)], state:'mostly_aligned' },
      { name:'complete plus extra', p:[planned(1,10,100)], d:[diary(1,10,100),diary(2,90,50)], state:'aligned' },
      { name:'unapproved only', p:[planned(1,10,100,[{foodId:20,grams:100}])], d:[diary(1,30,100)], state:'different' },
      { name:'original plus unapproved extra', p:[planned(1,10,100)], d:[diary(1,10,100),diary(2,30,100)], state:'aligned' },
      { name:'approved substitution', p:[planned(1,10,100,[{foodId:20,grams:180}])], d:[diary(1,20,180)], state:'aligned' },
      { name:'two originals correctly paired', p:[planned(1,10,100),planned(2,10,200)], d:[diary(1,10,190),diary(2,10,105)], state:'aligned' },
      { name:'original wins substitution', p:[planned(1,10,100,[{foodId:20,grams:100}]),planned(2,20,100)], d:[diary(1,20,100)], state:'mostly_aligned' },
      { name:'competing substitution once', p:[planned(1,10,100,[{foodId:30,grams:100}]),planned(2,20,100,[{foodId:30,grams:100}])], d:[diary(1,30,100)], state:'mostly_aligned' },
      { name:'missing plan grams', p:[planned(1,10,null)], d:[diary(1,10,100)], state:'aligned' },
      { name:'missing diary grams', p:[planned(1,10,100)], d:[diary(1,10,null)], state:'aligned' },
      { name:'diary-only meal', p:[], d:[diary(1,10,100)], state:'different' },
      { name:'partial with extra', p:[planned(1,10,100),planned(2,20,100)], d:[diary(1,10,100),diary(2,30,100)], state:'mostly_aligned' },
      { name:'substitution outside quantity', p:[planned(1,10,100,[{foodId:20,grams:180}])], d:[diary(1,20,250)], state:'mostly_aligned' },
      { name:'two near originals', p:[planned(1,10,100),planned(2,20,100)], d:[diary(1,10,120),diary(2,20,80)], state:'aligned' },
      { name:'two planned no diary', p:[planned(1,10,100),planned(2,20,100)], d:[], state:'not_evaluable' },
    ] as const;
    for (const scenario of scenarios) expect(mealState(matchMealItems([...scenario.p], [...scenario.d])), scenario.name).toBe(scenario.state);
    const ambiguous = matchMealItems([planned(1,10,100),planned(2,10,200)],[diary(1,10,190),diary(2,10,105)]);
    expect(ambiguous.map((item) => [item.planned?.grams,item.recorded?.grams])).toEqual([[100,105],[200,190]]);
    const tied = () => matchMealItems([planned(1,10,100,[{foodId:30,grams:100}]),planned(2,20,100,[{foodId:30,grams:100}])],[diary(1,30,100)]).map((item) => item.state);
    expect(Array.from({length:20},tied).every((result) => JSON.stringify(result) === JSON.stringify(tied()))).toBe(true);
  });
});
