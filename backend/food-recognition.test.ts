import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { canonicalQueries,deduplicateDetections,decideMatch,detectionSchema,rankFoodCandidates,rankSemanticFoodCandidates,rerankSchema,validRerankIndex } from '../shared/food-recognition';
import { normalizePhoto } from './photo-image';

describe('food photo boundaries', () => {
  it('rejects model invented quantities, IDs and nutrition', () => {
    expect(detectionSchema.safeParse({ items: [{ name: 'Arroz', alternatives: [], uncertain: false, foodId: 1, grams: 100, calories: 120 }] }).success).toBe(false);
    expect(detectionSchema.parse({ items: [] }).items).toEqual([]);
  });
  it('accepts one semantic alternative and rejects invalid confidence/output',()=>{
    expect(detectionSchema.parse({items:[{name:'arroz branco',preparation:'cozido',visibleDetails:['grãos brancos'],confidence:.9,alternative:null}]}).items).toHaveLength(1);
    expect(detectionSchema.safeParse({items:[{name:'arroz',preparation:null,visibleDetails:[],confidence:2,alternative:null}]}).success).toBe(false);
    expect(detectionSchema.safeParse({items:[{name:'arroz',preparation:null,visibleDetails:[],confidence:.9,alternative:null,foodId:12}]}).success).toBe(false);
    expect(rerankSchema.safeParse({candidateIndex:5,confidence:.9,uncertain:false}).success).toBe(false);
    expect(validRerankIndex({candidateIndex:2,confidence:.9,uncertain:false},2)).toBe(false);
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
  it('uses preparation and conservatively penalizes contradictions',()=>{
    const fried={description:'Batata, inglesa, frita',displayName:'Batata inglesa frita'},boiled={description:'Batata, inglesa, cozida',displayName:'Batata inglesa cozida'};
    const item={name:'batata inglesa',preparation:'frita',visibleDetails:['palitos fritos'],confidence:.95,alternative:null};
    const matches=rankSemanticFoodCandidates(item,[boiled,fried]);
    expect(matches[0].food).toBe(fried);expect(matches.find(match=>match.food===boiled)?.contradictions.length).toBeGreaterThan(0);
  });
  it('uses explicit score and margin states',()=>{
    const item={name:'arroz',preparation:'cozido',visibleDetails:[],confidence:.95,alternative:null};
    expect(decideMatch(item,[{food:{},matchConfidence:.94,contradictions:[],query:'arroz'},{food:{},matchConfidence:.7,contradictions:[],query:'arroz'}]).state).toBe('AUTOSELECT');
    expect(decideMatch(item,[{food:{},matchConfidence:.9,contradictions:[],query:'arroz'},{food:{},matchConfidence:.87,contradictions:[],query:'arroz'}]).state).toBe('RERANK');
    expect(decideMatch(item,[{food:{},matchConfidence:.4,contradictions:[],query:'arroz'}]).state).toBe('NO_MATCH');
  });
  it('uses only controlled visible details and deduplicates paraphrases',()=>{
    const base={name:'frango',preparation:'grelhado',visibleDetails:['aparenta ser peito','prato bonito'],confidence:.8,alternative:'filé de frango'};
    expect(canonicalQueries(base).join(' ')).toContain('peito');expect(canonicalQueries(base).join(' ')).not.toContain('bonito');
    expect(deduplicateDetections([base,{...base,name:'frango grelhado',confidence:.7}])).toHaveLength(1);
    expect(deduplicateDetections([base,{...base,name:'arroz',confidence:.9}])).toHaveLength(2);
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
