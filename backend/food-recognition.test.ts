import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { detectionSchema, rankFoodCandidates } from '../shared/food-recognition';
import { normalizePhoto } from './photo-image';

describe('food photo boundaries', () => {
  it('rejects model invented quantities, IDs and nutrition', () => {
    expect(detectionSchema.safeParse({ items: [{ name: 'Arroz', alternatives: [], uncertain: false, foodId: 1, grams: 100, calories: 120 }] }).success).toBe(false);
    expect(detectionSchema.parse({ items: [] }).items).toEqual([]);
  });
  it('keeps preparation distinctions and does not match preparation without the food', () => {
    const foods = [{ description: 'Batata, inglesa, frita' }, { description: 'Batata, inglesa, cozida' }, { description: 'Carne, cozida' }];
    expect(rankFoodCandidates('batata frita', foods)[0].food.description).toContain('frita');
    expect(rankFoodCandidates('batata cozida', foods).some(r => r.food.description.startsWith('Carne'))).toBe(false);
    expect(rankFoodCandidates('sushi', foods)).toEqual([]);
  });
  it('resolves aliases to existing candidates only', () => {
    const foods = [
      { description:'Mandioca, sem casca, cozida',displayName:'Mandioca cozida',searchAliases:['aipim','macaxeira'] },
      { description:'Pão, trigo, tipo francês',displayName:'Pão francês',searchAliases:['pão de sal','cacetinho'] },
      { description:'Queijo, muçarela',displayName:'Queijo muçarela',searchAliases:['mussarela'] },
      { description:'Peito, frango, grelhado',displayName:'Peito de frango grelhado',searchAliases:['filé de frango','file de frango'] },
    ];
    for (const query of ['aipim','macaxeira','pão de sal','cacetinho','mussarela','file de frango','filé de frango'])
      expect(rankFoodCandidates(query,foods)[0]?.food).toBeTruthy();
  });
  it('ranks a direct friendly name above an indirect alias', () => {
    const direct = { description:'Arroz, polido, cru',displayName:'Arroz branco',searchAliases:['arroz comum'] };
    const indirect = { description:'Refeição composta',displayName:'Prato executivo',searchAliases:['prato com arroz branco'] };
    expect(rankFoodCandidates('arroz branco',[indirect,direct])[0].food).toBe(direct);
  });
  it('rejects disguised non-images and strips metadata from valid photos', async () => {
    await expect(normalizePhoto(Buffer.from('<svg></svg>'))).rejects.toThrow();
    await expect(normalizePhoto(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow();
    const source = await sharp({ create: { width: 1500, height: 1100, channels: 3, background: 'green' } }).jpeg().withMetadata().toBuffer();
    const output = await normalizePhoto(source);
    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe('jpeg');
  });
});
