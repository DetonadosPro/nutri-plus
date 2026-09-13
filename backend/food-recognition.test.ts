import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { atomizeDetections,canonicalQueries,deduplicateDetections,decideMatch,detectionSchema,foodMatchesMeatFamily,foodRetrievalTokens,foodSearchTokenVariants,needsMeatFamilyConfirmation,normalizeFoodQuery,rankFoodCandidates,rankSemanticFoodCandidates,recognitionFoodName,refineMeatFamily,rerankSchema,selectDistinctFoodCandidates,shouldAskMeatFamily,validRerankIndex,type DetectedFood,type SemanticMatch,type SearchableFood } from '../shared/food-recognition';
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
  it('adds the chosen family without erasing first-pass cut evidence',()=>{
    const original=detection('carne','grelhada',['peça achatada com gordura lateral'],{foodKind:'meat_cut',groupLabel:'carne com cebola',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'unknown',familyConfidence:.35,cutStyle:'steak',visibleFatLevel:'medium',bone:'without',shapeHints:['bisteca']}});
    const refined=refineMeatFamily(original,'beef');
    expect(refined).toMatchObject({preparation:original.preparation,visibleDetails:original.visibleDetails,foodKind:'meat_cut',groupLabel:'carne com cebola',identityAmbiguity:null,meatVisual:{familyCandidate:'beef',familyConfidence:1,cutStyle:'steak',shapeHints:['bisteca'],bone:'without',visibleFatLevel:'medium'}});
  });
  it('uses an alternative visual form when refining the family',()=>{
    const original=detection('carne','grelhada',['fibras visíveis'],{foodKind:'meat_cut',alternative:'bife',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'unknown',familyConfidence:.3,cutStyle:'unknown',visibleFatLevel:'medium',bone:'without',shapeHints:[]}});
    expect(refineMeatFamily(original,'beef')).toMatchObject({name:'carne bovina bife',preparation:'grelhada',visibleDetails:['fibras visíveis'],alternative:null,meatVisual:{cutStyle:'unknown',bone:'without',visibleFatLevel:'medium'}});
  });
  it('captures a coarse food kind and an optional visual group without merging identities',()=>{
    const salad=[detection('alface',null,['folhas verdes'],{foodKind:'vegetable',groupLabel:'salada'}),detection('tomate',null,['fatias vermelhas'],{foodKind:'vegetable',groupLabel:'salada'})];
    const parsed=detectionSchema.parse({items:salad});
    expect(parsed.items.map(item=>item.name)).toEqual(['alface','tomate']);
    expect(parsed.items.every(item=>item.groupLabel==='salada'&&item.foodKind==='vegetable')).toBe(true);
    expect(deduplicateDetections(parsed.items)).toHaveLength(2);
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
  it.each(['cebola','tomate','alface','arroz','feijão'])('never opens the meat gate for %s when retrieval is non-meat',(name)=>{
    const item=detection(name,null,['servido ao lado da carne'],{foodKind:name==='arroz'?'grain_starch':name==='feijão'?'legume':'vegetable',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'unknown',familyConfidence:.2,cutStyle:'unknown',visibleFatLevel:'unknown',bone:'unknown',shapeHints:[]}});
    const matches:SemanticMatch<SearchableFood>[]=[{food:{description:`${name} cru`,displayName:name,category:'Hortaliças'},matchConfidence:.9,contradictions:[],query:name}];
    expect(shouldAskMeatFamily(item,matches)).toBe(false);
  });
  it('opens the meat gate only when local candidates confirm multiple animal families',()=>{
    const candidates:SemanticMatch<SearchableFood>[]=[
      {food:{description:'Linguiça suína grelhada'},matchConfidence:.9,contradictions:[],query:'linguiça'},
      {food:{description:'Linguiça de frango grelhada'},matchConfidence:.88,contradictions:[],query:'linguiça'},
    ];
    const sausage=detection('linguiça','grelhada',[],{foodKind:'processed_meat',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'unknown',familyConfidence:.3,cutStyle:'sausage',visibleFatLevel:'unknown',bone:'without',shapeHints:[]}});
    expect(shouldAskMeatFamily(sausage,candidates)).toBe(true);
    expect(shouldAskMeatFamily(detection('carne','grelhada',[],{foodKind:'meat_cut',identityAmbiguity:'meat_family'}),candidates)).toBe(true);
    expect(shouldAskMeatFamily(sausage,candidates.slice(0,1))).toBe(false);
  });
  it('keeps a conflicting first-pass animal alternative in the family question',()=>{
    const item=detection('carne bovina','grelhada',['peça inteira'],{foodKind:'meat_cut',alternative:'carne suína',meatVisual:{familyCandidate:'beef',familyConfidence:.7,cutStyle:'whole_piece',visibleFatLevel:'medium',bone:'without',shapeHints:[]}});
    const beefOnly:SemanticMatch<SearchableFood>[]=[{food:{description:'Contrafilé bovino grelhado'},matchConfidence:.9,contradictions:[],query:'carne bovina'}];
    expect(shouldAskMeatFamily(item,beefOnly)).toBe(true);
  });
  it('atomizes explicit independent identities only when every part resolves strongly',async()=>{
    const combined=detection('alface e tomate',null,['folhas e fatias'],{foodKind:'vegetable',groupLabel:'salada'});
    const result=await atomizeDetections([combined],async item=>[{description:item.name,displayName:item.name,category:'Hortaliças'}]);
    expect(result.entries.map(entry=>entry.item.name)).toEqual(['alface','tomate']);
    expect(result.entries.every(entry=>entry.item.groupLabel==='salada')).toBe(true);
    expect(result.splits).toEqual([{source:'alface e tomate',parts:['alface','tomate']}]);
  });
  it('does not split integrated recipes or weak compound identities',async()=>{
    const integrated=detection('arroz e feijão',null,[],{componentRole:'integrated-preparation',foodKind:'composite'});
    const weak=detection('alimento amarelo e molho',null,[],{foodKind:'unknown'});
    const retrieve=async(item:DetectedFood)=>item.name==='alimento amarelo'?[]:[{description:item.name,displayName:item.name}];
    expect((await atomizeDetections([integrated],retrieve)).entries).toHaveLength(1);
    const weakResult=await atomizeDetections([weak],retrieve);
    expect(weakResult.entries).toHaveLength(1);
    expect(weakResult.entries[0].item.name).toBe('alimento amarelo e molho');
  });
  it('does not leak meat context from one atomized component to its vegetable neighbor',async()=>{
    const combined=detection('carne e cebola',null,['cebola sobre a carne'],{foodKind:'meat_cut',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'unknown',familyConfidence:.3,cutStyle:'steak',visibleFatLevel:'medium',bone:'unknown',shapeHints:[]}});
    const result=await atomizeDetections([combined],async item=>[{description:item.name==='carne'?'Carne bovina grelhada':'Cebola branca crua',displayName:item.name,category:item.name==='carne'?'Carnes e derivados':'Hortaliças'}]);
    expect(result.entries.map(entry=>entry.item.name)).toEqual(['carne','cebola']);
    expect(result.entries[0].item.meatVisual).not.toBeNull();
    expect(result.entries[1].item.meatVisual).toBeNull();
    expect(result.entries[1].item.identityAmbiguity).toBeNull();
  });
  it('keeps an already atomic bisteca and onion as independent component contexts',()=>{
    const bisteca=detection('bisteca','grelhada',['corte achatado'],{foodKind:'meat_cut',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'unknown',familyConfidence:.4,cutStyle:'steak',visibleFatLevel:'medium',bone:'with',shapeHints:['bisteca']}});
    const onion=detection('cebola','refogada',['tiras sobre a bisteca'],{foodKind:'vegetable',groupLabel:'carne com cebola'});
    const result=deduplicateDetections([bisteca,onion]);
    expect(result).toHaveLength(2);
    expect(result[0].meatVisual?.shapeHints).toEqual(['bisteca']);
    expect(result[1].meatVisual).toBeNull();
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
  it('abstains when low-confidence vision offers a materially different identity',()=>{
    const uncertain=detection('farinha de mandioca','frita',['cobertura granulada'],{confidence:.73,alternative:'croquete',foodKind:'unknown'});
    expect(decideMatch(uncertain,[{food:{description:'Farinha de mandioca torrada'},matchConfidence:.7,contradictions:[],query:'farinha'}]).state).toBe('NO_MATCH');
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
