import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scaleNutrients } from '../shared/scale-nutrients';
import { automaticSubstitutionSuggestions } from './smart-substitutions';
import { closeDatabase, db, migrate } from './db';

describe('USDA Torresmo catalog entry', () => {
  beforeAll(() => migrate());
  afterAll(() => closeDatabase());

  it('is a separate USDA food with source-backed identity, aliases and nutrient states', async () => {
    const food = await db.prepare(`SELECT * FROM foods WHERE source='USDA' AND source_code='167961'`).get<any>();
    expect(food).toMatchObject({
      description: 'Pele suína frita, com sal',
      display_name: 'Torresmo',
      source: 'USDA',
      source_code: '167961',
      category: 'Snacks',
      glycemic_index: null,
      active: true,
    });
    expect(food.search_aliases).toEqual(['torresminho','pele de porco frita','pele suína frita','pork rinds','pork skins']);
    expect(await db.prepare(`SELECT count(*)::int count FROM foods WHERE source='TBCA'`).get()).toEqual({count:5874});
    expect(await db.prepare(`SELECT count(*)::int count FROM food_measures m JOIN foods f ON f.id=m.food_id WHERE f.source='TBCA'`).get()).toEqual({count:8317});
    expect(await db.prepare(`SELECT count(*)::int count FROM food_measures WHERE food_id=?`).get(food.id)).toEqual({count:0});

    const nutrients = Object.fromEntries((await db.prepare(`SELECT nutrient_code,numeric_value,raw_value,status FROM food_nutrients WHERE food_id=?`).all<any>(food.id)).map((row:any)=>[row.nutrient_code,row]));
    expect(Object.keys(nutrients)).toHaveLength(41);
    expect(nutrients.energia_kcal.numeric_value).toBe(544);
    expect(nutrients.energia_kj).toMatchObject({numeric_value:2276,raw_value:'2276',status:'numeric'});
    expect(nutrients.proteina_g.numeric_value).toBe(61.3);
    expect(nutrients.lipideos_g.numeric_value).toBe(31.3);
    expect(nutrients.carboidrato_g.numeric_value).toBe(0);
    expect(nutrients.sodio_mg.numeric_value).toBe(1818);
    expect(nutrients.selenio_mcg.numeric_value).toBe(41);
    expect(nutrients.trans_g).toMatchObject({numeric_value:null,raw_value:'NA',status:'missing'});
    expect(nutrients.acucar_adicao_g).toMatchObject({numeric_value:null,raw_value:'NA',status:'missing'});
    expect(nutrients.proteina_animal_g).toMatchObject({numeric_value:null,raw_value:'NA',status:'missing'});
  });

  it('scales the stored per-100-g values without portion copies', async () => {
    const food = await db.prepare(`SELECT id FROM foods WHERE source='USDA' AND source_code='167961'`).get<{id:number}>();
    const values = Object.fromEntries((await db.prepare(`SELECT nutrient_code,numeric_value FROM food_nutrients WHERE food_id=?`).all<any>(food!.id)).map((row:any)=>[row.nutrient_code,row.numeric_value]));
    expect(scaleNutrients(values,50).values).toMatchObject({energia_kcal:272,proteina_g:30.65,lipideos_g:15.65});
    const portion30=scaleNutrients(values,30).values;
    expect(portion30.energia_kcal).toBeCloseTo(163.2);
    expect(portion30.proteina_g).toBeCloseTo(18.39);
    expect(portion30.lipideos_g).toBeCloseTo(9.39);
  });

  it('is never returned as an automatic substitution for a lean protein', async () => {
    const chicken = await db.prepare(`SELECT id FROM foods WHERE source='TBCA' AND source_code='BRC0114F'`).get<{id:number}>();
    const result = await automaticSubstitutionSuggestions(chicken!.id,100);
    expect(result.suggestions.some((entry:any)=>entry.food.source_code==='167961')).toBe(false);
  });
});
