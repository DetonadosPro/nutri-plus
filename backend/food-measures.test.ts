import { describe, it, expect } from 'vitest';
import { gramMeasure, measureGrams, measureLabel, formatServing, type FoodMeasure } from '../shared/food-measures';
import { scaleNutrients } from '../shared/scale-nutrients';

// Synthetic fixtures exercise arithmetic only; never imported into the food catalog.
const unit: FoodMeasure = {...gramMeasure,id:1,kind:'count',name:'unidade',plural:'unidades',grams:50};
const spoon: FoodMeasure = {...unit,id:2,kind:'household',name:'colher de sopa',plural:'colheres de sopa',grams:30};
const ml: FoodMeasure = {...unit,id:3,kind:'volume',name:'mL',plural:'mL',quantity:100,grams:103};
describe('medidas determinísticas', () => {
  it('mantém fallback em g e nutrientes históricos', () => {
    expect(measureGrams(120,gramMeasure)).toBe(120);
    expect(formatServing({amount:120,unit:'g',grams_equivalent:120})).toBe('120 g');
  });
  it('converte contagem, várias medidas e frações sem arredondar', () => {
    expect(measureGrams(2,unit)).toBe(100);
    expect(measureGrams(.5,unit)).toBe(25);
    expect(measureGrams(1.5,spoon)).toBe(45);
    expect(measureGrams(.0001,spoon)).toBeCloseTo(.003,12);
  });
  it('respeita a relação cadastrada para volume', () => {
    expect(measureGrams(200,ml)).toBe(206);
    expect(() => measureGrams(200,{...ml,grams:NaN})).toThrow();
  });
  it('trocar unidade pode preservar a massa', () => {
    const grams = measureGrams(2,unit);
    expect(measureGrams(grams / spoon.grams * spoon.quantity,spoon)).toBeCloseTo(grams,12);
  });
  it('formata plural e preserva forma original', () => {
    expect(measureLabel(1,spoon)).toBe('colher de sopa');
    expect(measureLabel(2,spoon)).toBe('colheres de sopa');
    expect(measureLabel(200,ml)).toBe('mL');
    expect(formatServing({amount:2,unit:'unidade',grams_equivalent:100,measure_snapshot:unit})).toBe('2 unidades');
    expect(formatServing({amount:.5,unit:'unidade',grams_equivalent:25,measure_snapshot:unit})).toBe('0,5 unidades');
    expect(formatServing({amount:200,unit:'mL',grams_equivalent:200,measure_snapshot:ml})).toBe('200 mL');
    expect(formatServing({amount:125.5,unit:'mL',grams_equivalent:125.5,measure_snapshot:ml})).toBe('125,5 mL');
  });
  it('reutiliza cálculo nutricional e mantém indisponíveis', () => {
    const grams=measureGrams(1.333333,spoon);
    const scaled=scaleNutrients({energia_kcal:123,proteina_g:5,ferro_mg:null},grams);
    expect(scaled.values.energia_kcal).toBe(123*(grams/100));
    expect(scaled.values.ferro_mg).toBeNull();
  });
  it('rejeita valores inválidos e limites após conversão', () => {
    for (const n of [0,-1,Infinity,NaN,5001]) expect(() => measureGrams(n,gramMeasure)).toThrow();
    expect(() => measureGrams(101,unit)).toThrow();
  });
});
