import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { canonicalQueries,deduplicateDetections,decideMatch,detectionSchema,foodMatchesMeatFamily,foodRetrievalTokens,foodSearchTokenVariants,needsMeatFamilyConfirmation,normalizeFoodQuery,rankFoodCandidates,rankSemanticFoodCandidates,recognitionFoodName,refineMeatFamily,rerankSchema,selectDistinctFoodCandidates,validRerankIndex,type DetectedFood } from '../shared/food-recognition';
import { normalizePhoto } from './photo-image';

function detection(name:string,preparation:string|null=null,visibleDetails:string[]=[],overrides:Partial<DetectedFood>={}):DetectedFood {
  return {name,preparation,visibleDetails,confidence:.9,alternative:null,componentRole:'independent',identityAmbiguity:null,meatVisual:null,...overrides};
}

describe('food photo boundaries', () => {
  it('rejects model invented quantities, IDs and nutrition', () => {
    expect(detectionSchema.safeParse({ items: [{ name: 'Arroz', alternatives: [], uncertain: false, foodId: 1, grams: 100, calories: 120 }] }).success).toBe(false);
    expect(detectionSchema.parse({ items: [] }).items).toEqual([]);
  });
  it('accepts one semantic alternative and rejects invalid confidence/output',()=>{
    expect(detectionSchema.parse({items:[detection('arroz branco','cozido',['grãos brancos'])]}).items).toHaveLength(1);
    expect(detectionSchema.safeParse({items:[detection('arroz',null,[],{confidence:2})]}).success).toBe(false);
    expect(detectionSchema.safeParse({items:[{...detection('arroz'),foodId:12}]}).success).toBe(false);
    expect(rerankSchema.safeParse({candidateIndex:5,confidence:.9,uncertain:false}).success).toBe(false);
    expect(validRerankIndex({candidateIndex:2,confidence:.9,uncertain:false},2)).toBe(false);
  });
  it('captures meat family and visual structure in the first vision response',()=>{
    const meat=detection('carne','grelhada',['peça com osso e gordura lateral'],{identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'pork',familyConfidence:.58,cutStyle:'steak',visibleFatLevel:'medium',bone:'with',shapeHints:['bisteca']}});
    expect(detectionSchema.parse({items:[meat]}).items[0].meatVisual).toMatchObject({familyCandidate:'pork',cutStyle:'steak',bone:'with',shapeHints:['bisteca']});
    expect(needsMeatFamilyConfirmation(meat)).toBe(true);
    expect(needsMeatFamilyConfirmation({...meat,name:'carne suína',identityAmbiguity:null,meatVisual:{...meat.meatVisual!,familyConfidence:.9}})).toBe(false);
  });
  it('accepts sausage as a processed meat form without treating it as a fresh whole cut',()=>{
    const sausage=detection('linguiça','grelhada',['peça cilíndrica'],{meatVisual:{familyCandidate:'pork',familyConfidence:.8,cutStyle:'sausage',visibleFatLevel:'unknown',bone:'without',shapeHints:[]}});
    expect(detectionSchema.parse({items:[sausage]}).items[0].meatVisual?.cutStyle).toBe('sausage');
  });
  it('keeps preparation distinctions and does not match preparation without the food', () => {
    const foods = [{ description: 'Batata, inglesa, frita' }, { description: 'Batata, inglesa, cozida' }, { description: 'Carne, cozida' }];
    expect(rankFoodCandidates('batata frita', foods)[0].food.description).toContain('frita');
    expect(rankFoodCandidates('batata cozida', foods).some(r => r.food.description.startsWith('Carne'))).toBe(false);
    expect(rankFoodCandidates('sushi', foods)).toEqual([]);
  });
  it('asks only the meat family when the species is not visually defensible',()=>{
    expect(needsMeatFamilyConfirmation(detection('carne picada','cozida',[],{identityAmbiguity:'meat_family'}))).toBe(true);
    expect(foodRetrievalTokens(detection('carne picada','cozida'))).toEqual(['carne']);
    expect(needsMeatFamilyConfirmation(detection('frango','cozido',['em cubos dourados']))).toBe(false);
    expect(needsMeatFamilyConfirmation(detection('carne moída','cozida'))).toBe(true);
    expect(needsMeatFamilyConfirmation(detection('peito de frango em cubos','cozido'))).toBe(false);
    expect(needsMeatFamilyConfirmation(detection('bife bovino','cozido'))).toBe(false);
    expect(needsMeatFamilyConfirmation(detection('carne suína desfiada','cozida'))).toBe(false);
    expect(needsMeatFamilyConfirmation(detection('carne bovina','cozida',[],{alternative:'carne suína'}))).toBe(true);
    expect(needsMeatFamilyConfirmation(detection('batata em cubos','cozida'))).toBe(false);
    const refined=refineMeatFamily(detection('carne desfiada','cozida',[],{identityAmbiguity:'meat_family'}),'chicken');
    expect(refined).toMatchObject({name:'frango desfiado',identityAmbiguity:null});
    expect(foodMatchesMeatFamily({description:'Peito de frango cozido'},'chicken')).toBe(true);
    expect(foodMatchesMeatFamily({description:'Lombo suíno assado'},'chicken')).toBe(false);
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
    const item=detection('batata inglesa','frita',['palitos fritos'],{confidence:.95});
    const matches=rankSemanticFoodCandidates(item,[boiled,fried]);
    expect(matches[0].food).toBe(fried);
    const conflicting = matches.find((match) => match.food === boiled);
    expect(conflicting === undefined || conflicting.contradictions.length > 0).toBe(true);
  });
  it('uses explicit score and margin states',()=>{
    const item=detection('arroz','cozido',[],{confidence:.95});
    expect(decideMatch(item,[{food:{},matchConfidence:.94,contradictions:[],query:'arroz'},{food:{},matchConfidence:.7,contradictions:[],query:'arroz'}]).state).toBe('AUTOSELECT');
    expect(decideMatch(item,[{food:{},matchConfidence:.9,contradictions:[],query:'arroz'},{food:{},matchConfidence:.87,contradictions:[],query:'arroz'}]).state).toBe('ASK_ATTRIBUTE');
    expect(decideMatch(item,[{food:{},matchConfidence:.4,contradictions:[],query:'arroz'}]).state).toBe('NO_MATCH');
  });
  it('uses only controlled visible details and deduplicates paraphrases',()=>{
    const base=detection('frango','grelhado',['aparenta ser peito','prato bonito'],{confidence:.8,alternative:'filé de frango'});
    expect(canonicalQueries(base).join(' ')).toContain('peito');expect(canonicalQueries(base).join(' ')).not.toContain('bonito');
    expect(deduplicateDetections([base,{...base,name:'frango grelhado',confidence:.7}])).toHaveLength(1);
    expect(deduplicateDetections([base,{...base,name:'arroz',confidence:.9}])).toHaveLength(2);
  });
  it('normalizes aliases and grammatical gender for retrieval',()=>{
    expect(foodRetrievalTokens(detection('espaguete','cozido'))).toEqual(['macarrao']);
    const raw={description:'Alface crua',displayName:'Alface crua'};
    const result=rankSemanticFoodCandidates(detection('alface','cru'),[raw]);
    expect(result[0]?.contradictions).toEqual([]);
  });
  it('matches common Portuguese food plurals without losing the original form',()=>{
    expect(normalizeFoodQuery('almôndegas')).toBe('almondega');
    expect(normalizeFoodQuery('pães e feijões')).toBe('pao e feijao');
    expect(normalizeFoodQuery('carnes tomates vegetais')).toBe('carne tomate vegetal');
    expect(foodSearchTokenVariants('almôndegas')).toEqual([['almondegas','almondega']]);
    expect(rankFoodCandidates('almôndegas',[{description:'Almôndega de carne bovina cozida'},{description:'Arroz cozido'}])[0].food.description).toContain('Almôndega');
  });
  it('collapses invisible salt and oil variants without exposing catalog noise',()=>{
    const item=detection('feijão preto','cozido',[],{confidence:.95});
    const withSalt={description:'Feijão preto cozido sem óleo com sal',displayName:'Feijão preto cozido sem óleo com sal',source_code:'WITH'};
    const withoutSalt={description:'Feijão preto cozido sem óleo sem sal',displayName:'Feijão preto cozido sem óleo sem sal',source_code:'WITHOUT'};
    const matches=rankSemanticFoodCandidates(item,[withoutSalt,withSalt]);
    const visible=selectDistinctFoodCandidates(item,matches);
    expect(visible).toHaveLength(1);
    expect(recognitionFoodName(visible[0].food)).toBe('Feijão preto cozido');
  });
  it('collapses only technical variants of the same sausage identity',()=>{
    const item=detection('linguiça suína','grelhada',[],{meatVisual:{familyCandidate:'pork',familyConfidence:.9,cutStyle:'sausage',visibleFatLevel:'unknown',bone:'without',shapeHints:[]}});
    const sameIdentity=[
      {description:'Linguiça suína grelhada sem óleo com sal',displayName:'Linguiça suína grelhada sem óleo com sal',source_code:'A'},
      {description:'Linguiça suína grelhada com óleo sem sal',displayName:'Linguiça suína grelhada com óleo sem sal',source_code:'B'},
      {description:'Preparado suíno grelhado',displayName:'Preparado suíno grelhado',source_code:'C'},
    ];
    const visible=selectDistinctFoodCandidates(item,rankSemanticFoodCandidates(item,sameIdentity));
    expect(visible.filter(match=>/Linguiça/i.test(match.food.displayName||''))).toHaveLength(1);
    expect(visible.some(match=>/^Preparado/i.test(match.food.displayName||''))).toBe(false);
  });
  it('abstains when the TBCA candidate requires an unseen recipe',()=>{
    const item=detection('omelete','frita',['dobrada e dourada'],{confidence:.95,componentRole:'integrated-preparation'});
    const candidates=[{description:'Omelete com vegetais e queijo',displayName:'Omelete com vegetais e queijo'}];
    expect(decideMatch(item,rankSemanticFoodCandidates(item,candidates))).toMatchObject({state:'NO_EXACT_TBCA_MATCH'});
  });
  it('keeps visible components separate and never completes the plate culturally',()=>{
    const first=deduplicateDetections([
      detection('feijão','cozido',['grãos em caldo']),
      detection('omelete','frita',['dobrada e dourada'],{componentRole:'integrated-preparation'}),
      detection('pepino','cru',['rodelas verdes']),
    ]);
    expect(first.map(item=>item.name)).toEqual(['feijão','omelete','pepino']);
    expect(first.some(item=>/arroz/i.test(item.name))).toBe(false);
    const second=deduplicateDetections([
      detection('macarrão','cozido',['massa longa com molho vermelho']),
      detection('frango desfiado','cozido',['fibras e pedaços separados']),
    ]);
    expect(second).toHaveLength(2);
    expect(second.map(item=>item.name)).toEqual(['macarrão','frango desfiado']);
    expect(deduplicateDetections([detection('massa com molho e carne','cozida'),detection('carne','cozida')])).toHaveLength(2);
    expect(deduplicateDetections([detection('frango','cozido'),detection('frango desfiado','cozido')])).toHaveLength(1);
    expect(deduplicateDetections([detection('feijão','cozido')]).map(item=>item.name)).toEqual(['feijão']);
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
