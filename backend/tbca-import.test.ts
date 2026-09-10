import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectPath } from './db';
import { inactiveTbcaCodes, tbcaDisplayNameOverrides, validateTbcaDataset, type RawFood } from './tbca-import';

describe('TBCA com nomes amigáveis', () => {
  it('preserva todos os nomes originais e valida aliases sem truncamento', () => {
    const foods = JSON.parse(readFileSync(projectPath('data','tbca','tbca completa normalizada.json'),'utf8')) as RawFood[];
    expect(validateTbcaDataset(foods)).toEqual({ foods:5874, values:240834, missing:20346, trace:5638, zero:32938 });
    expect(new Set(foods.map(food => food.codigo)).size).toBe(5874);
    expect(foods.every(food => food.nome === food.nome_original)).toBe(true);
    expect(foods.every(food => food.nome_exibicao.trim().length > 0)).toBe(true);
    expect(foods.reduce((total,food) => total + food.aliases_busca.length,0)).toBe(41531);
    const rice = foods.find(food => food.codigo === 'BRC0001A')!;
    expect(rice.nome_original).toContain('Arroz, polido, cru');
    expect(rice.nome_exibicao).toBe('Arroz polido cru');
    expect(rice.nome_original).not.toBe(rice.nome_exibicao);
    expect(inactiveTbcaCodes.has('BRC0056G')).toBe(true);
    expect(inactiveTbcaCodes.has('BRC0058G')).toBe(false);
    expect(inactiveTbcaCodes.has('BRC0001A')).toBe(true);
    expect(inactiveTbcaCodes.has('BRC0018A')).toBe(false);
    expect(tbcaDisplayNameOverrides.get('BRC0018A')).toBe('Arroz Branco');
  });
});
