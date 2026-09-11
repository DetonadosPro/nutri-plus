import { describe, expect, it } from 'vitest';
import { MEAT_FAMILY_OPTIONS, recognitionFoodLabel } from './food-photo-recognition';

describe('food photo recognition review', () => {
  it('offers only the three supported meat families', () => {
    expect(MEAT_FAMILY_OPTIONS).toEqual([
      { value: 'chicken', label: 'Frango' },
      { value: 'pork', label: 'Porco' },
      { value: 'beef', label: 'Carne bovina' },
    ]);
  });

  it('uses the recognition label that hides latent catalog attributes', () => {
    const food={id:1,source_code:'X',description:'Feijão com sal',recognitionName:'Feijão cozido',category:null,source:'TBCA' as const,favorite:false,nutrients:{},nutrientSources:{},dataSources:[]};
    expect(recognitionFoodLabel(food)).toBe('Feijão cozido');
  });
});
