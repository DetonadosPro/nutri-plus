import {readFileSync,writeFileSync} from 'node:fs';
import {decideMatch,rankSemanticFoodCandidates} from '../../shared/food-recognition';

const root='tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20';
const audit=JSON.parse(readFileSync(`${root}/ground-truth.audit.json`,'utf8'));
const predictions=JSON.parse(readFileSync(`${root}/predictions-luna-baseline.json`,'utf8'));
const raw=JSON.parse(readFileSync('backend/data/tbca/tbca completa normalizada.json','utf8'));
const foods=raw.map((f:any)=>({source_code:f.codigo,description:f.nome_original,displayName:f.nome_exibicao,searchAliases:f.aliases_busca,category:f.grupo}));
const association:Record<string,(number|null)[]>={
  'food-001':[0],'food-002':[0],'food-003':[0],'food-004':[0],'food-005':[0],
  'food-006':[0],'food-007':[0],'food-008':[2,0,1,3,4,5],'food-009':[null],
  'food-010':[0,1,2,3,4,5],'food-011':[0],'food-012':[0],'food-013':[0],
  'food-014':[0],'food-015':[0],'food-016':[0],'food-017':[0],'food-018':[0,1,2],
  'food-019':[0],'food-020':[0],
};
const causes:Record<string,string>={
  'food-001:0':'hidden_variant_tie','food-002:0':'visual_identity_underspecified','food-003:0':'visual_identity_underspecified',
  'food-004:0':'hidden_variant_tie','food-005:0':'hidden_variant_tie','food-006:0':'identity_hierarchy_missing',
  'food-007:0':'no_exact_tbca_match','food-008:0':'retrieval_identity_leak','food-008:1':'hidden_variant_tie',
  'food-008:2':'visual_identity_underspecified','food-008:3':'hidden_variety_tie','food-008:4':'correct','food-008:5':'visible_variety_rerank',
  'food-009:0':'visual_misidentification','food-010:0':'no_exact_tbca_match','food-010:1':'hidden_variant_tie',
  'food-010:2':'hidden_variant_tie','food-010:3':'no_exact_tbca_match','food-010:4':'normalization_and_compound_bias',
  'food-010:5':'correct','food-011:0':'visual_over_specificity','food-012:0':'no_exact_tbca_match',
  'food-013:0':'hidden_variant_tie','food-014:0':'identity_hierarchy_missing','food-015:0':'specificity_penalty_too_weak',
  'food-016:0':'alias_and_retrieval_gap','food-017:0':'correct','food-018:0':'hidden_variety_tie',
  'food-018:1':'correct','food-018:2':'correct','food-019:0':'correct','food-020:0':'no_exact_tbca_match',
};
const cases=audit.cases.map((test:any)=>{const result=predictions.cases.find((x:any)=>x.id===test.id);return{id:test.id,components:test.expectedFoods.map((expected:any,index:number)=>{const predictionIndex=association[test.id][index],item=predictionIndex==null?null:result.items[predictionIndex];const matches=item?rankSemanticFoodCandidates(item.detected,foods,5):[],decision=item?decideMatch(item.detected,matches):null;const allowed=new Set(expected.tbcaCode?[expected.tbcaCode,...expected.acceptableCodes]:[]);return{expectedLabel:expected.expectedLabel,tbcaCode:expected.tbcaCode,acceptableCodes:expected.acceptableCodes,catalogReviewStatus:expected.catalogReviewStatus,cause:causes[`${test.id}:${index}`],detected:item?.detected??null,baselineState:item?.state??'MISSING',baselineSelectedCode:item?.selectedCode??null,decisionState:decision?.state??'MISSING',decisionPolicy:decision?.policy??null,recommendedCode:decision?.state==='AUTOSELECT'?matches[0]?.food.source_code??null:null,top1Score:decision?.top1Score??0,top2Score:decision?.top2Score??0,margin:decision?.margin??0,firstAcceptableRank:expected.tbcaCode?(matches.findIndex(m=>allowed.has(m.food.source_code))+1||null):null,rerankerCalled:Boolean(item?.rerankerTelemetry),candidates:matches.map((m,rank)=>({rank:rank+1,code:m.food.source_code,name:m.food.displayName,score:m.matchConfidence,contradictions:m.contradictions,materialUnknowns:m.materialUnknowns,resolutionPolicies:m.resolutionPolicies}))};})}});
writeFileSync(`${root}/offline-diagnosis.json`,JSON.stringify({sourcePredictions:'predictions-luna-baseline.json',apiCalls:0,matcherRevision:'semantic-identity-v2-working-tree',cases},null,2)+'\n');
console.log(`Gravado ${root}/offline-diagnosis.json (${cases.reduce((n,c)=>n+c.components.length,0)} componentes, sem API).`);
