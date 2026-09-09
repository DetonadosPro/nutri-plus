import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rankSemanticFoodCandidates } from '../shared/food-recognition';
import { projectPath } from './db';

type RawFood = {
  codigo: string;
  nome_original: string;
  nome_exibicao: string;
  aliases_busca: string[];
  grupo: string;
};

const foods = (JSON.parse(readFileSync(projectPath('data', 'tbca', 'tbca completa normalizada.json'), 'utf8')) as RawFood[])
  .map((food) => ({
    source_code: food.codigo,
    description: food.nome_original,
    displayName: food.nome_exibicao,
    searchAliases: food.aliases_busca,
    category: food.grupo,
  }));

function codes(name: string, preparation: string | null, alternative: string | null = null, visibleDetails: string[] = []) {
  return rankSemanticFoodCandidates({ name, preparation, alternative, visibleDetails, confidence: 0.9 }, foods, 5)
    .map((match) => match.food.source_code);
}

describe('matcher against the complete TBCA catalog', () => {
  it.each([
    ['arroz branco', 'cozido', 'BRC0018A'],
    ['aipim', 'cozido', 'BRC0053B'],
    ['macaxeira', 'cozida', 'BRC0053B'],
    ['pão de sal', null, 'BRC0002A'],
  ])('places the expected TBCA food in the top three for %s', (name, preparation, expected) => {
    expect(codes(name, preparation).slice(0, 3)).toContain(expected);
  });

  it('uses the single visual alternative without creating a duplicate item', () => {
    expect(codes('mussarela', null, 'queijo muçarela').length).toBeGreaterThan(0);
  });

  it('finds a singular TBCA entry when vision returns a plural food name',()=>{
    expect(codes('almôndegas','frita')[0]).toBe('BRC0004F');
  });

  it('prioritizes grilled chicken candidates when preparation is visible', () => {
    const matches = rankSemanticFoodCandidates({
      name: 'frango', preparation: 'grelhado', alternative: 'filé de frango',
      visibleDetails: ['aparenta ser peito', 'sem empanamento'], confidence: 0.86,
    }, foods, 5);
    expect(matches[0].food.displayName.toLowerCase()).toContain('frango');
    expect(matches[0].food.displayName.toLowerCase()).toContain('grelhad');
  });

  it('does not confuse the main food with an ingredient in a compound dish', () => {
    const result = rankSemanticFoodCandidates({
      name: 'ovo frito', preparation: 'frito', alternative: null,
      visibleDetails: ['claras brancas', 'gemas visíveis'], confidence: 0.99,
    }, foods, 5);
    expect(['BRC0015J', 'BRC0028J']).toContain(result[0].food.source_code);
    expect(result[0].food.displayName.toLowerCase()).toMatch(/^ovo/);
  });

  it.each([
    ['batata frita', 'frita', ['palitos dourados'], 'BRC0118B'],
    ['espaguete', 'cozido', ['fios longos', 'molho vermelho'], 'BRC0218A'],
    ['filé de peixe', 'grelhado', ['filé com marcas de grelha'], 'BRC0104E'],
  ])('keeps incompatible recipes out of the first position for %s', (name, preparation, visibleDetails, expected) => {
    expect(codes(name, preparation, null, visibleDetails)[0]).toBe(expected);
  });
});
