import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewedMeasure } from './measure-import';

const catalog = JSON.parse(readFileSync(new URL('./data/food-measures.reviewed.json', import.meta.url), 'utf8'));

describe('catálogo revisado de medidas TBCA', () => {
  it('mantém a estrutura e a cobertura curada esperadas', () => {
    const rows = reviewedMeasure.array().parse(catalog);
    expect(rows).toHaveLength(8316);
    expect(new Set(rows.map(row => row.foodCode)).size).toBe(4878);
    expect(rows.every(row => row.foodSource === 'TBCA' && row.source === 'TBCA' && row.reviewed)).toBe(true);
    expect(rows.filter(row => row.kind === 'household')).toHaveLength(6087);
    expect(rows.filter(row => row.kind === 'count')).toHaveLength(1784);
    expect(rows.filter(row => row.kind === 'volume')).toHaveLength(445);
    expect(rows.some(row => row.isDefault)).toBe(false);
  });

  it('não contém chaves, nomes ou pesos conflitantes dentro do alimento', () => {
    const rows = reviewedMeasure.array().parse(catalog);
    const keys = rows.map(row => `${row.foodCode}:${row.key}`);
    const names = rows.map(row => `${row.foodCode}:${row.name.trim().toLocaleLowerCase('pt-BR')}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
    expect(rows.every(row => Number.isFinite(row.grams) && row.grams > 0 && Number.isFinite(row.quantity) && row.quantity > 0)).toBe(true);
  });

  it('preserva o exemplo documentado do arroz sem alterar o arquivo', () => {
    expect(catalog).toContainEqual(expect.objectContaining({
      foodCode: 'BRC0001A', name: 'colher de sopa cheia', quantity: 1, grams: 23,
      source: 'TBCA', reviewed: true, isDefault: false,
    }));
  });

  it('mantém volumes como equivalências de cálculo publicadas pela TBCA', () => {
    const volumes = reviewedMeasure.array().parse(catalog).filter(row => row.kind === 'volume');
    expect(volumes.every(row => row.name === 'mL' && row.plural === 'mL')).toBe(true);
    expect(volumes.every(row => row.quantity === row.grams)).toBe(true);
  });

  it('mantém excluídas as medidas caseiras conflitantes de BRC0243C', () => {
    const rows = reviewedMeasure.array().parse(catalog).filter(row => row.foodCode === 'BRC0243C');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({kind:'volume',name:'mL',quantity:165,grams:165}));
  });
});
