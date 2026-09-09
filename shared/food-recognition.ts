import { z } from 'zod';

export const detectedFoodSchema = z.object({
  name:z.string().trim().min(2).max(80), preparation:z.string().trim().min(2).max(40).nullable(),
  visibleDetails:z.array(z.string().trim().min(2).max(60)).max(6), confidence:z.number().min(0).max(1),
  alternative:z.string().trim().min(2).max(80).nullable(),
}).strict();
export const detectionSchema=z.object({items:z.array(detectedFoodSchema).max(15)}).strict();
export type DetectedFood=z.infer<typeof detectedFoodSchema>;
export const rerankSchema=z.object({candidateIndex:z.number().int().min(0).max(4).nullable(),confidence:z.number().min(0).max(1),uncertain:z.boolean()}).strict();
export function validRerankIndex(decision:z.infer<typeof rerankSchema>,candidateCount:number){return decision.candidateIndex===null||(decision.candidateIndex>=0&&decision.candidateIndex<candidateCount)}
export type SearchableFood={id?:number;source_code?:string;description:string;displayName?:string|null;searchAliases?:string[]|null};

export const MATCH_THRESHOLDS={AUTOSELECT_MIN_SCORE:.84,AUTOSELECT_MIN_MARGIN:.06,AUTOSELECT_MIN_VISUAL_CONFIDENCE:.65,RERANK_MIN_SCORE:.55,RERANK_MAX_CANDIDATES:5,ASK_USER_MAX_CANDIDATES:3,RERANK_MIN_CONFIDENCE:.72} as const;
const stop=new Set(['de','da','do','das','dos','com','sem','e','a','o','ao','tipo','aparenta','ser']);
const preparations=new Set(['cru','crua','cozido','cozida','frito','frita','grelhado','grelhada','assado','assada','empanado','empanada']);
const traits=new Set(['peito','coxa','sobrecoxa','file','integral','branco','branca','refinado','refinada','pele']);
const opposites=[['cru','crua','cozido','cozida'],['frito','frita','grelhado','grelhada','assado','assada','cozido','cozida'],['integral','branco','branca','refinado','refinada'],['peito','coxa','sobrecoxa']] as const;

export function normalizeFoodName(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function stem(token:string){return token.replace(/(cozida|cozido)$/,'cozid').replace(/(grelhada|grelhado)$/,'grelhad').replace(/(frita|frito)$/,'frit').replace(/(assada|assado)$/,'assad').replace(/s$/,'')}
function tokens(value:string){return normalizeFoodName(value).split(' ').filter(Boolean).map(stem)}
function isPreparation(token:string){return [...preparations].map(stem).includes(token)}
function usefulDetails(details:string[]){return [...new Set(details.flatMap(tokens).filter(token=>isPreparation(token)||traits.has(token)))]}

export function canonicalQueries(item:DetectedFood){
  const base=normalizeFoodName(item.name),prep=normalizeFoodName(item.preparation||''),details=usefulDetails(item.visibleDetails),queries=[base,[base,prep].filter(Boolean).join(' ')];
  const cut=details.filter(token=>traits.has(token)); if(cut.length) queries.push([...cut,base,prep].filter(Boolean).join(' '));
  if(item.alternative) queries.push([normalizeFoodName(item.alternative),prep].filter(Boolean).join(' '));
  return [...new Set(queries.map(normalizeFoodName).filter(Boolean))];
}
function fieldTier(query:string,food:SearchableFood){
  const display=normalizeFoodName(food.displayName||food.description),original=normalizeFoodName(food.description),aliases=(food.searchAliases||[]).map(normalizeFoodName);
  if(display===query)return 1;if(display.startsWith(`${query} `))return .94;if(aliases.includes(query))return .91;if(aliases.some(alias=>alias.startsWith(`${query} `)))return .86;
  const queryTokens=tokens(query).filter(t=>!stop.has(t)),fields=[display,...aliases,original];
  const coverage=Math.max(...fields.map(field=>{const words=new Set(tokens(field));return queryTokens.length?queryTokens.filter(token=>words.has(token)).length/queryTokens.length:0}));
  if(coverage===1)return .8;if(display.includes(query))return .72;if(aliases.some(alias=>alias.includes(query)))return .66;if(original.includes(query))return .58;return coverage*.62;
}
function contradictions(expected:Set<string>,candidate:Set<string>){
  const found:string[]=[];for(const group of opposites){const wanted=group.map(stem).filter(value=>expected.has(value)),present=group.map(stem).filter(value=>candidate.has(value));if(wanted.length&&present.length&&!present.some(value=>wanted.includes(value)))found.push(`${wanted[0]}!=${present[0]}`)}return found;
}
export type SemanticMatch<T>={food:T;matchConfidence:number;contradictions:string[];query:string};
export function rankSemanticFoodCandidates<T extends SearchableFood>(item:DetectedFood,foods:T[],limit=5):SemanticMatch<T>[] {
  const queries=canonicalQueries(item),expected=new Set(queries.flatMap(tokens)),expectedPrep=[...expected].filter(isPreparation),expectedTraits=[...expected].filter(token=>traits.has(token));
  return foods.map(food=>{const displayTokens=tokens(food.displayName||food.description),candidate=new Set(tokens([food.displayName||'',...(food.searchAliases||[]),food.description].join(' '))),lexical=Math.max(...queries.map(query=>fieldTier(query,food))),prepMatch=expectedPrep.length?expectedPrep.filter(token=>candidate.has(token)).length/expectedPrep.length:1,traitMatch=expectedTraits.length?expectedTraits.filter(token=>candidate.has(token)).length/expectedTraits.length:1,conflicts=contradictions(expected,candidate),identity=[...expected].filter(token=>!stop.has(token)&&!expectedPrep.includes(token)&&!expectedTraits.includes(token)),identityMatch=identity.length?identity.filter(token=>candidate.has(token)).length/identity.length:0,extra=displayTokens.filter(token=>!expected.has(token)&&!stop.has(token)).length,compound=['refeicao','lanche','sanduiche','lasanha','sopa','bolo','molho','crepe','bruschetta','tapioca','rolinho','esfirra','omelete','pizza','salada','pizzaiolo','mcdonald','burger','torrada'].some(token=>displayTokens.includes(token)&&!expected.has(token)),added=displayTokens.includes('com')&&!expected.has('com'),baseDescriptor=expected.has('pao')&&displayTokens.includes('padaria'),specificityPenalty=Math.min(.08,extra*.006)+(compound ? .10 : 0)+(added ? .05 : 0)-(baseDescriptor ? .10 : 0),raw=identityMatch===0?0:lexical*.48+identityMatch*.27+prepMatch*.16+traitMatch*.09-conflicts.length*.22-specificityPenalty;return{food,matchConfidence:Math.max(0,Math.min(1,Number(raw.toFixed(4)))),contradictions:conflicts,query:queries.find(query=>fieldTier(query,food)===lexical)||queries[0]}})
    .filter(match=>match.matchConfidence>=.25).sort((a,b)=>b.matchConfidence-a.matchConfidence||(a.food.source_code||'').localeCompare(b.food.source_code||'')||(a.food.displayName||a.food.description).localeCompare(b.food.displayName||b.food.description)).slice(0,limit);
}
export function decideMatch<T>(item:DetectedFood,matches:SemanticMatch<T>[]){const top1=matches[0]?.matchConfidence??0,top2=matches[1]?.matchConfidence??0,margin=Number((top1-top2).toFixed(4));if(matches[0]&&top1>=MATCH_THRESHOLDS.AUTOSELECT_MIN_SCORE&&margin>=MATCH_THRESHOLDS.AUTOSELECT_MIN_MARGIN&&item.confidence>=MATCH_THRESHOLDS.AUTOSELECT_MIN_VISUAL_CONFIDENCE&&!matches[0].contradictions.length)return{state:'AUTOSELECT' as const,top1Score:top1,top2Score:top2,margin};if(matches.length>=2&&top1>=MATCH_THRESHOLDS.RERANK_MIN_SCORE)return{state:'RERANK' as const,top1Score:top1,top2Score:top2,margin};return{state:'NO_MATCH' as const,top1Score:top1,top2Score:top2,margin}}
export function deduplicateDetections(items:DetectedFood[]){const result:DetectedFood[]=[];for(const item of items){const identity=tokens(item.name).filter(token=>!stop.has(token)),prep=tokens(item.preparation||'').join(' '),index=result.findIndex(existing=>tokens(existing.name).filter(token=>!stop.has(token)).some(token=>identity.includes(token))&&tokens(existing.preparation||'').join(' ')===prep);if(index<0)result.push(item);else if(item.confidence>result[index].confidence)result[index]=item}return result}
export function rankFoodCandidates<T extends SearchableFood>(name:string,foods:T[]){return rankSemanticFoodCandidates({name,preparation:null,visibleDetails:[],confidence:1,alternative:null},foods).map(match=>({food:match.food,score:match.matchConfidence,exact:match.matchConfidence>=MATCH_THRESHOLDS.AUTOSELECT_MIN_SCORE}))}
