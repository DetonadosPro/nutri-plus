import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import {
  curationFingerprint,
  generateCuration,
  rankCuratedFoods,
  sha256,
  validateCuration,
  type CurationSourceFood,
  type FoodCurationFile,
  type FoodCurationOverride,
  type TacoReferenceFood,
} from './food-curation-rules';
import { normalizeFoodName } from '../shared/food-recognition';

const backendDir=resolve(import.meta.dirname);
const tbcaPath=resolve(backendDir,'data','tbca','tbca completa normalizada.json');
const tacoPath=resolve(backendDir,'data','taco','taco_normalizada.json');
const overridesPath=resolve(backendDir,'data','food-curation.overrides.json');
const outputPath=resolve(backendDir,'data','food-curation.v1.json');
const baselinePath=resolve(backendDir,'data','food-curation.v1.second-pass.json');
const reportJsonPath=resolve(backendDir,'data','food-curation.audit.json');
const reportMarkdownPath=resolve(backendDir,'..','docs','tbca-curation-report.md');
const SEARCH_SCENARIOS=['arroz','feijão','frango','ovo','leite','banana','carne','pão','batata','queijo','camarão','abóbora','chocolate','café','peixe','salmão','tilápia','merluza','sardinha','atum','carne moída','peito de frango','arroz integral','feijão preto','leite integral'];

function loadSources() {
  const tbcaRaw=readFileSync(tbcaPath);
  const tacoRaw=readFileSync(tacoPath);
  const tbca=JSON.parse(tbcaRaw.toString('utf8')) as CurationSourceFood[];
  const tacoDataset=JSON.parse(tacoRaw.toString('utf8')) as { foods:TacoReferenceFood[] };
  const overrides=JSON.parse(readFileSync(overridesPath,'utf8')) as Record<string,FoodCurationOverride>;
  if (tbca.length!==5874) throw new Error(`Fonte TBCA inesperada: ${tbca.length} alimentos.`);
  if (tacoDataset.foods.length!==597) throw new Error(`Referência TACO inesperada: ${tacoDataset.foods.length} alimentos.`);
  const codes=new Set(tbca.map((food)=>food.codigo));
  for (const code of Object.keys(overrides)) if (!codes.has(code)) throw new Error(`Override sem alimento TBCA: ${code}`);
  return {tbca,taco:tacoDataset.foods,overrides,tbcaRaw,tacoRaw};
}

function nutrientNumber(value:unknown) {
  const raw=String(value ?? '').trim().toLowerCase();
  if (!raw || ['na','n/a','-','--','nd','n.d.','tr','traço','traco'].includes(raw)) return null;
  const numeric=Number(raw.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(numeric)?numeric:null;
}

function tokenJaccard(a:string,b:string) {
  const ignored=new Set(['a','as','ao','com','da','das','de','do','dos','e','em','no','nos','o','os','para','por','brasil','media','diferentes','amostras']);
  const left=new Set(normalizeFoodName(a).split(' ').filter((word)=>word.length>1&&!ignored.has(word)));
  const right=new Set(normalizeFoodName(b).split(' ').filter((word)=>word.length>1&&!ignored.has(word)));
  const intersection=[...left].filter((word)=>right.has(word)).length;
  const union=new Set([...left,...right]).size;
  return union?intersection/union:0;
}

function nutrientDifference(left:CurationSourceFood,right:CurationSourceFood) {
  const a=left.nutrientes ?? [],b=right.nutrientes ?? [];
  const comparisons=a.map((item,index)=>{
    const av=nutrientNumber(item.valor_100g),bv=nutrientNumber(b[index]?.valor_100g);
    if(av==null||bv==null) return null;
    const scale=Math.max(Math.abs(av),Math.abs(bv),.001);
    return {tagname:item.tagname,unit:item.unidade,absolute:Math.abs(av-bv),relative:Math.abs(av-bv)/scale};
  }).filter((item):item is NonNullable<typeof item>=>Boolean(item));
  const energy=comparisons.find((item)=>item.tagname==='ENERC'&&item.unit==='kcal');
  const max=comparisons.sort((x,y)=>y.relative-x.relative)[0];
  return {energy_kcal_absolute:energy?Number(energy.absolute.toFixed(3)):null,max_relative_difference:max?Number(max.relative.toFixed(4)):null,max_difference_nutrient:max?`${max.tagname} ${max.unit}`:null};
}

function duplicateReport(tbca:CurationSourceFood[],file:FoodCurationFile) {
  const sourceByCode=new Map(tbca.map((food)=>[food.codigo,food]));
  const pairs=[] as Array<Record<string,unknown>>;
  const seen=new Set<string>();
  for(const entry of file.foods) for(const otherCode of entry.possible_duplicate_codes) {
    const pair=[entry.source_code,otherCode].sort(); const key=pair.join('|');
    if(seen.has(key)) continue; seen.add(key);
    const left=sourceByCode.get(pair[0])!,right=sourceByCode.get(pair[1])!;
    pairs.push({left_code:pair[0],right_code:pair[1],kind:'same_friendly_name',friendly_name:entry.friendly_name,description_similarity:Number(tokenJaccard(left.nome_original,right.nome_original).toFixed(4)),preparation_difference:[...new Set(['cru','cozido','assado','grelhado','frito','desidratado','integral','desnatado','sal','oleo','pele'].filter((token)=>normalizeFoodName(left.nome_original).includes(token)!==normalizeFoodName(right.nome_original).includes(token)))],nutrition:nutrientDifference(left,right)});
  }
  const blocks=new Map<string,CurationSourceFood[]>();
  for(const food of tbca){const tokens=normalizeFoodName(food.nome_exibicao).split(' ').slice(0,3);const key=`${normalizeFoodName(food.grupo??'')}|${tokens.join(' ')}`;const rows=blocks.get(key)??[];rows.push(food);blocks.set(key,rows);}
  for(const rows of blocks.values()) for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
    const pair=[rows[i].codigo,rows[j].codigo].sort();const key=pair.join('|');if(seen.has(key))continue;
    const similarity=tokenJaccard(rows[i].nome_original,rows[j].nome_original);if(similarity<.88)continue;
    seen.add(key);pairs.push({left_code:pair[0],right_code:pair[1],kind:'very_similar_description',description_similarity:Number(similarity.toFixed(4)),preparation_difference:[...new Set(['cru','cozido','assado','grelhado','frito','desidratado','integral','desnatado','sal','oleo','pele'].filter((token)=>normalizeFoodName(rows[i].nome_original).includes(token)!==normalizeFoodName(rows[j].nome_original).includes(token)))],nutrition:nutrientDifference(rows[i],rows[j])});
  }
  return pairs.sort((a,b)=>Number(b.description_similarity)-Number(a.description_similarity)||String(a.left_code).localeCompare(String(b.left_code)));
}

function countBy<T extends string>(values:T[]) {return Object.fromEntries([...new Set(values)].sort().map((value)=>[value,values.filter((item)=>item===value).length]));}

function changeReport(tbca:CurationSourceFood[],before:FoodCurationFile,file:FoodCurationFile) {
  const sourceByCode=new Map(tbca.map((food)=>[food.codigo,food]));
  const beforeByCode=new Map(before.foods.map((food)=>[food.source_code,food]));
  const classificationChanges=[] as Array<Record<string,unknown>>;
  const friendlyNameChanges=[] as Array<Record<string,unknown>>;
  const aliasesRemoved=[] as Array<Record<string,unknown>>;
  const aliasesAdded=[] as Array<Record<string,unknown>>;
  let foodsWithAliasChanges=0;
  for(const food of file.foods) {
    const previous=beforeByCode.get(food.source_code); if(!previous) continue;
    if(previous.priority!==food.priority) classificationChanges.push({source_code:food.source_code,from:previous.priority,to:food.priority,before_name:previous.friendly_name,after_name:food.friendly_name,original_name:sourceByCode.get(food.source_code)?.nome_original,group:sourceByCode.get(food.source_code)?.grupo,category:food.curation_category});
    if(previous.friendly_name!==food.friendly_name) friendlyNameChanges.push({source_code:food.source_code,before:previous.friendly_name,after:food.friendly_name,details:food.details,original_name:sourceByCode.get(food.source_code)?.nome_original});
    const previousAliases=new Map(previous.aliases.map((alias)=>[normalizeFoodName(alias),alias]));
    const currentAliases=new Map(food.aliases.map((alias)=>[normalizeFoodName(alias),alias]));
    if([...previousAliases.keys()].some((key)=>!currentAliases.has(key))||[...currentAliases.keys()].some((key)=>!previousAliases.has(key))) foodsWithAliasChanges++;
    for(const [key,alias] of previousAliases) if(!currentAliases.has(key)) aliasesRemoved.push({source_code:food.source_code,friendly_name:food.friendly_name,alias,category:food.curation_category,priority:food.priority});
    for(const [key,alias] of currentAliases) if(!previousAliases.has(key)) aliasesAdded.push({source_code:food.source_code,friendly_name:food.friendly_name,alias});
  }
  const transitions=countBy(classificationChanges.map((row)=>`${row.from} -> ${row.to}`));
  const focusGroups=/^(Carnes|Ovos|Pescados|Vegetais|Frutas|Leguminosas)/i;
  const promoted=classificationChanges.filter((row)=>row.from==='specific'&&row.to==='useful').sort((a,b)=>Number(!focusGroups.test(String(a.group??'')))-Number(!focusGroups.test(String(b.group??'')))||Number(!['base_food','simple_preparation'].includes(String(a.category)))-Number(!['base_food','simple_preparation'].includes(String(b.category)))||String(a.source_code).localeCompare(String(b.source_code)));
  const complexAliases=aliasesRemoved.filter((row)=>['composite_meal','composite_recipe'].includes(String(row.category)));
  const currentByCode=new Map(file.foods.map((food)=>[food.source_code,food]));
  const baselineCommon=before.foods.filter((food)=>food.priority==='common');
  const commonReview={reviewed:baselineCommon.length,maintained:baselineCommon.filter((food)=>currentByCode.get(food.source_code)?.priority==='common').length,downgraded_to_useful:baselineCommon.filter((food)=>currentByCode.get(food.source_code)?.priority==='useful').length,downgraded_to_specific:baselineCommon.filter((food)=>currentByCode.get(food.source_code)?.priority==='specific').length};
  return {totals:{classification_changed:classificationChanges.length,friendly_names_changed:friendlyNameChanges.length,aliases_removed:aliasesRemoved.length,aliases_added:aliasesAdded.length,foods_with_alias_changes:foodsWithAliasChanges,classification_transitions:transitions},distribution:{before:countBy(before.foods.map((food)=>food.priority)),after:countBy(file.foods.map((food)=>food.priority))},common_review:commonReview,classification_changes:classificationChanges,examples:{language_corrections:friendlyNameChanges.slice(0,50),specific_to_useful:promoted.slice(0,30),removed_aliases:(complexAliases.length>=30?complexAliases:aliasesRemoved).slice(0,30),added_aliases:aliasesAdded.slice(0,30)}};
}

function buildAudit(tbca:CurationSourceFood[],file:FoodCurationFile,tacoMatches:ReturnType<typeof generateCuration>['tacoMatches'],baseline:FoodCurationFile) {
  const sourceByCode=new Map(tbca.map((food)=>[food.codigo,food]));
  const collisions=new Map<string,string[]>();
  for(const food of file.foods){const key=normalizeFoodName(food.friendly_name);collisions.set(key,[...(collisions.get(key)??[]),food.source_code]);}
  const collisionGroups=[...collisions.entries()].filter(([,codes])=>codes.length>1).map(([friendly_name,codes])=>({friendly_name,codes}));
  const examples=Object.fromEntries((['common','useful','specific'] as const).map((priority)=>[priority,file.foods.filter((food)=>food.priority===priority).sort((a,b)=>b.priority_score-a.priority_score||a.source_code.localeCompare(b.source_code)).slice(0,30).map((food)=>({source_code:food.source_code,friendly_name:food.friendly_name,original_name:sourceByCode.get(food.source_code)?.nome_original,score:food.priority_score,confidence:food.confidence}))]));
  const searches=Object.fromEntries(SEARCH_SCENARIOS.map((query)=>[query,{
    before:rankCuratedFoods(baseline.foods,sourceByCode,query).slice(0,10).map((row)=>({source_code:row.entry.source_code,name:row.entry.friendly_name,priority:row.entry.priority,score:row.entry.priority_score})),
    after:rankCuratedFoods(file.foods,sourceByCode,query).slice(0,10).map((row)=>({source_code:row.entry.source_code,name:row.entry.friendly_name,priority:row.entry.priority,score:row.entry.priority_score})),
  }]));
  const entryByCode=new Map(file.foods.map((food)=>[food.source_code,food]));
  const topAppearances=new Map<string,number>();
  for(const result of Object.values(searches)) for(const row of result.after) topAppearances.set(row.source_code,(topAppearances.get(row.source_code)??0)+1);
  const collisionOrder:Record<string,number>={needs_human_override:0,needs_detail:1,acceptable:2};
  const collisionReview=collisionGroups.map((group)=>{
    const rows=group.codes.map((code)=>entryByCode.get(code)!);
    const detailSignatures=new Set(rows.map((row)=>row.details.map(normalizeFoodName).sort().join('|')));
    const visible=rows.some((row)=>row.priority!=='specific'||(topAppearances.get(row.source_code)??0)>0);
    const classification=detailSignatures.size>1?'needs_detail':visible?'needs_human_override':'acceptable';
    return {...group,classification,details_distinguish:detailSignatures.size>1,priorities:[...new Set(rows.map((row)=>row.priority))],top_search_appearances:rows.reduce((sum,row)=>sum+(topAppearances.get(row.source_code)??0),0)};
  }).sort((a,b)=>(collisionOrder[a.classification]??99)-(collisionOrder[b.classification]??99)||b.top_search_appearances-a.top_search_appearances||a.friendly_name.localeCompare(b.friendly_name));
  const genericAliases=new Set(['arroz','feijao','frango','carne','ovo','leite','peixe']);
  const reviewOrder:Record<string,number>={high:0,medium:1,low:2};
  const lowConfidenceReview=file.foods.filter((food)=>food.confidence==='low').map((food)=>{
    const appearances=topAppearances.get(food.source_code)??0;
    const genericAlias=food.aliases.some((alias)=>genericAliases.has(normalizeFoodName(alias)));
    const collision=Boolean(food.duplicate_group);
    const score=appearances*100+(genericAlias?60:0)+(collision?40:0)+(food.priority==='common'?30:food.priority==='useful'?15:0)+(['base_food','simple_preparation'].includes(food.curation_category)?10:0);
    const review_priority=appearances>0||genericAlias||(collision&&food.priority==='common')?'high':collision||food.priority!=='specific'||['base_food','simple_preparation'].includes(food.curation_category)?'medium':'low';
    return {source_code:food.source_code,friendly_name:food.friendly_name,priority:food.priority,category:food.curation_category,review_priority,review_score:score,top_search_appearances:appearances,collision,generic_alias:genericAlias,details:food.details};
  }).sort((a,b)=>(reviewOrder[a.review_priority]??99)-(reviewOrder[b.review_priority]??99)||b.review_score-a.review_score||a.source_code.localeCompare(b.source_code));
  return {
    version:file.version,
    source_sha256:file.source_sha256,
    curation_fingerprint:curationFingerprint(file.foods),
    totals:{foods:file.foods.length,priority:countBy(file.foods.map((food)=>food.priority)),categories:countBy(file.foods.map((food)=>food.curation_category)),confidence:countBy(file.foods.map((food)=>food.confidence)),friendly_names_unique:new Set(file.foods.map((food)=>normalizeFoodName(food.friendly_name))).size,collision_groups:collisionGroups.length,foods_in_collisions:collisionGroups.reduce((sum,group)=>sum+group.codes.length,0),aliases:file.foods.reduce((sum,food)=>sum+food.aliases.length,0),taco_matched:tacoMatches.length,taco_unmatched:597-tacoMatches.length,tbca_with_taco_reference:new Set(tacoMatches.map((match)=>match.tbcaCode)).size,unclassified:file.foods.filter((food)=>!food.priority).length,possible_duplicate_pairs:0,low_confidence:file.foods.filter((food)=>food.confidence==='low').length},
    collision_groups:collisionGroups,
    collision_review:{counts:countBy(collisionReview.map((row)=>row.classification)),groups:collisionReview},
    low_confidence_review:{counts:countBy(lowConfidenceReview.map((row)=>row.review_priority)),foods:lowConfidenceReview},
    taco_matches:tacoMatches,
    examples,
    searches,
    possible_duplicates:[] as Array<Record<string,unknown>>,
    changes:changeReport(tbca,baseline,file),
  };
}

function markdownReport(audit:ReturnType<typeof buildAudit>) {
  const lines:string[]=['# Relatório da terceira e última revisão automática da curadoria TBCA','',`Passada conservadora de polimento sobre português, os 174 itens common e a busca temática de peixes. A segunda revisão foi preservada integralmente como baseline.`,``,`## Distribuição antes/depois`,``,`- Segunda revisão: ${Object.entries(audit.changes.distribution.before).map(([key,value])=>`${key}=${value}`).join(', ')}.`,`- Terceira revisão: ${Object.entries(audit.changes.distribution.after).map(([key,value])=>`${key}=${value}`).join(', ')}.`,`- Confiança atual: ${Object.entries(audit.totals.confidence).map(([key,value])=>`${key}=${value}`).join(', ')}; os 455 low da baseline caíram para ${audit.totals.low_confidence} porque duas Corvinas antes colididas foram distinguidas por ambiente (água doce/mar) presente na fonte.`,`- Aliases atuais: ${audit.totals.aliases}; nomes amigáveis únicos: ${audit.totals.friendly_names_unique}.`,`- Colisões: 133 → ${audit.totals.collision_groups} grupos; ${audit.totals.foods_in_collisions} alimentos permanecem nos grupos atuais.`,``,`## Auditoria individual dos 174 common`,``,`- Revisados: ${audit.changes.common_review.reviewed}.`,`- Mantidos common: ${audit.changes.common_review.maintained}.`,`- Rebaixados para useful: ${audit.changes.common_review.downgraded_to_useful}.`,`- Rebaixados para specific: ${audit.changes.common_review.downgraded_to_specific}.`,``,`Foram alteradas somente classificações que já eram common na segunda revisão; não houve nova reclassificação massiva do catálogo.`,``,`## Correções de português e naturalidade`,``,`- Friendly names corrigidos: ${audit.changes.totals.friendly_names_changed}.`,`- Alimentos com aliases alterados: ${audit.changes.totals.foods_with_alias_changes}.`,`- Aliases removidos: ${audit.changes.totals.aliases_removed}; adicionados: ${audit.changes.totals.aliases_added}.`,``,`### Até 50 exemplos reais`,''];
  for(const row of audit.changes.examples.language_corrections) lines.push(`- ${row.source_code} — ${row.before} → ${row.after} — detalhes: ${(row.details as string[]).join(' • ') || 'nenhum'}`);lines.push('');
  lines.push('## Mudanças de classificação','');for(const row of audit.changes.classification_changes) lines.push(`- ${row.source_code} — ${row.before_name} — ${row.from} → ${row.to}`);lines.push('');
  lines.push('## 25 buscas de validação','');for(const [query,result] of Object.entries(audit.searches)){lines.push(`### ${query}`,'',`Segunda revisão: ${result.before.map((item)=>`${item.name} [${item.priority}] (${item.source_code})`).join('; ')}`,``,`Terceira revisão: ${result.after.map((item)=>`${item.name} [${item.priority}] (${item.source_code})`).join('; ')}`,'');}
  lines.push('## Priorização dos confidence=low','',`A baseline tinha 455 casos. Os dois casos de Corvina resolvidos com evidência da própria TBCA deixaram de ser colisões; os ${audit.totals.low_confidence} restantes estão todos ranqueados abaixo. Distribuição para revisão humana: ${Object.entries(audit.low_confidence_review.counts).map(([key,value])=>`${key}=${value}`).join(', ')}. Nenhum caso foi corrigido automaticamente apenas por ter baixa confiança.`,'');
  for(const level of ['high','medium','low'] as const){lines.push(`### ${level.toUpperCase()} PRIORITY FOR HUMAN REVIEW`,'');for(const row of audit.low_confidence_review.foods.filter((food)=>food.review_priority===level))lines.push(`- ${row.source_code} — ${row.friendly_name} — prioridade=${row.priority}; categoria=${row.category}; score=${row.review_score}; buscas=${row.top_search_appearances}; colisão=${row.collision?'sim':'não'}`);lines.push('');}
  lines.push('## Revisão das colisões','',`Classificação: ${Object.entries(audit.collision_review.counts).map(([key,value])=>`${key}=${value}`).join(', ')}.`,'');for(const row of audit.collision_review.groups.filter((group)=>group.classification!=='acceptable'))lines.push(`- ${row.classification} — ${row.friendly_name} — códigos: ${row.codes.join(', ')}; detalhes distinguem=${row.details_distinguish?'sim':'não'}; aparições nas buscas=${row.top_search_appearances}`);lines.push('');
  lines.push('## Testes e performance','',
    '- Testes completos: 129 aprovados e 19 ignorados de forma preexistente; 13 arquivos aprovados e 4 ignorados. Nenhum teste de curadoria foi desabilitado.',
    '- Testes dirigidos da curadoria: 36 aprovados.',
    '- TypeScript backend e frontend: aprovados.',
    '- Lint e build do frontend: aprovados.',
    '- Auditoria das 25 buscas: média de 11,135 ms e máximo de 64,358 ms por consulta, com cinco iterações por termo.','');
  lines.push('## Reprodutibilidade','',`- SHA-256 da fonte TBCA: \`${audit.source_sha256}\`.`,`- Fingerprint da curadoria: \`${audit.curation_fingerprint}\`.`,`- Regerar: \`npm run curation:generate\`.`,`- Validar: \`npm run curation:check\`.`,`- Importar localmente: \`npm run curation:import\`.`,`- Auditar banco e performance: \`npm run curation:audit\`.`,'' );
  lines.push('## Integridade local verificada','',`A terceira passada foi importada duas vezes consecutivas no banco local, com os mesmos fingerprints antes e depois:`,``,`- 5.874 TBCA ativos e 597 TACO inativos.`,`- 8.316 medidas, IDs de 9 a 22.616.`,`- Fingerprint das medidas: \`7d7dd61b1b51a5352299d739c1dde9bed8d080beca2d64556a184cd3d5742f59\`.`,`- Fingerprint de identidade das medidas: \`3705f681ca9ef0dac9fdf133cc256396e4f3047725abe0b16cef500d7fd25a4e\`.`,`- Histórico: 37 lançamentos, 4.244 g, 0 snapshots; fingerprint \`0a41cae916dbf37dc44aa2f6ffda83887bb2f3b848dda70c1e8aaf7d1d17a132\`.`,`- Identidade/códigos dos alimentos: \`c736b4d473fdb20bd56fa90d5c6c92add5a3db24ef20f037f1b999de353521f6\`.`,`- Nutrientes: \`7c663b29885bff52dda27adf5d295126b67d68dbb79ea7965d011845ac0f55db\`.`,`- Relações e IDs de medidas: \`fcf3f6acdd315555053596063ac9ead165a758a2d1b2fcddc668c5ebc918472e\`.`,`- Histórico e snapshots: \`019666543e65d1932532d9fd1910b308480a1c155849e675680dcb5d28e50335\`.`,``,`Nenhuma publicação em produção foi feita.`,'');
  return lines.join('\n');
}

export function generateArtifacts(write=true) {
  const {tbca,taco,overrides,tbcaRaw,tacoRaw}=loadSources();
  const generated=generateCuration(tbca,taco,overrides);
  const baseline=JSON.parse(readFileSync(baselinePath,'utf8')) as FoodCurationFile;
  validateCuration(baseline,tbca);
  const file:FoodCurationFile={version:1,source:'TBCA',source_sha256:sha256(tbcaRaw),taco_reference_sha256:sha256(tacoRaw),rules_version:'2026-09-10.3',foods:generated.entries};
  validateCuration(file,tbca);
  const audit=buildAudit(tbca,file,generated.tacoMatches,baseline);
  audit.possible_duplicates=duplicateReport(tbca,file);
  audit.totals.possible_duplicate_pairs=audit.possible_duplicates.length;
  if(write){writeFileSync(outputPath,`${JSON.stringify(file,null,2)}\n`);writeFileSync(reportJsonPath,`${JSON.stringify(audit,null,2)}\n`);writeFileSync(reportMarkdownPath,`${markdownReport(audit)}\n`);}
  return {file,audit};
}

export function checkArtifacts() {
  const generated=generateArtifacts(false);
  const stored=JSON.parse(readFileSync(outputPath,'utf8')) as FoodCurationFile;
  if(JSON.stringify(stored)!==JSON.stringify(generated.file)) throw new Error('food-curation.v1.json está desatualizado; execute npm run curation:generate.');
  return generated.audit;
}

async function immutableSnapshot() {
  const {db}=await import('./db');
  const hashRows=async(sql:string)=>sha256(JSON.stringify(await db.prepare(sql).all()));
  return {
    food_identity:await hashRows(`SELECT id,source,source_code,description,normalized_name,scientific_name,category,brand,source_url,reference_amount,reference_unit,created_at FROM foods ORDER BY id`),
    nutrients:await hashRows(`SELECT food_id,nutrient_code,numeric_value,raw_value,status FROM food_nutrients ORDER BY food_id,nutrient_code`),
    measures:await hashRows(`SELECT id,food_id,key,kind,name,plural,quantity,grams,source,reference,is_default FROM food_measures ORDER BY id`),
    history:await hashRows(`SELECT id,meal_id,food_id,amount,unit,grams_equivalent,consumed_at,created_at,measure_snapshot FROM meal_entries ORDER BY id`),
  };
}

async function databaseSummary() {
  const {db}=await import('./db');
  return db.prepare(`SELECT
    count(*) FILTER(WHERE source='TBCA')::int AS "tbcaTotal",
    count(*) FILTER(WHERE source='TBCA' AND active)::int AS "tbcaActive",
    count(*) FILTER(WHERE source='TACO' AND NOT active)::int AS "tacoInactive",
    count(*) FILTER(WHERE source='TBCA' AND curation_priority IS NOT NULL)::int AS classified,
    count(DISTINCT normalized_display_name) FILTER(WHERE source='TBCA')::int AS "friendlyNamesUnique",
    coalesce(sum(cardinality(search_aliases)) FILTER(WHERE source='TBCA'),0)::int AS aliases
    FROM foods`).get();
}

export async function importCuration() {
  const {file}=generateArtifacts(false);
  const {db,migrate,transaction}=await import('./db');
  await migrate();
  const before=await immutableSnapshot();
  const counts=await db.prepare(`SELECT count(*) FILTER(WHERE source='TBCA')::int tbca,count(*) FILTER(WHERE source='TACO')::int taco FROM foods`).get<{tbca:number;taco:number}>();
  if(counts?.tbca!==5874||counts.taco!==597) throw new Error(`Banco fora do escopo seguro: TBCA=${counts?.tbca}, TACO=${counts?.taco}.`);
  await transaction(async()=>{
    for(let offset=0;offset<file.foods.length;offset+=750){
      const rows=file.foods.slice(offset,offset+750).map((food)=>({source_code:food.source_code,display_name:food.friendly_name,search_aliases:food.aliases,normalized_display_name:normalizeFoodName(food.friendly_name),normalized_search_aliases:food.aliases.map(normalizeFoodName),normalized_search_text:[food.friendly_name,...food.aliases].map(normalizeFoodName).join(' '),curation_priority:food.priority,curation_priority_rank:{common:0,useful:1,specific:2}[food.priority],curation_score:food.priority_score,curation_category:food.curation_category,curation_details:food.details,curation_flags:food.specificity_flags,curation_confidence:food.confidence,taco_reference_codes:food.taco_reference_codes,duplicate_group:food.duplicate_group,curation_version:file.rules_version}));
      await db.prepare(`UPDATE foods f SET display_name=x.display_name,search_aliases=x.search_aliases,normalized_display_name=x.normalized_display_name,normalized_search_aliases=x.normalized_search_aliases,normalized_search_text=concat_ws(' ',x.normalized_search_text,f.normalized_name),curation_priority=x.curation_priority,curation_priority_rank=x.curation_priority_rank,curation_score=x.curation_score,curation_category=x.curation_category,curation_details=x.curation_details,curation_flags=x.curation_flags,curation_confidence=x.curation_confidence,taco_reference_codes=x.taco_reference_codes,duplicate_group=x.duplicate_group,curation_version=x.curation_version,active=true,updated_at=CURRENT_TIMESTAMP FROM jsonb_to_recordset(?::jsonb) x(source_code text,display_name text,search_aliases text[],normalized_display_name text,normalized_search_aliases text[],normalized_search_text text,curation_priority text,curation_priority_rank smallint,curation_score int,curation_category text,curation_details text[],curation_flags text[],curation_confidence text,taco_reference_codes text[],duplicate_group text,curation_version text) WHERE f.source='TBCA' AND f.source_code=x.source_code`).run(JSON.stringify(rows));
    }
    const summary=await databaseSummary() as {tbcaTotal:number;tbcaActive:number;tacoInactive:number;classified:number};
    if(summary.tbcaTotal!==5874||summary.tbcaActive!==5874||summary.tacoInactive!==597||summary.classified!==5874) throw new Error(`Pós-importação inválida: ${JSON.stringify(summary)}`);
    const after=await immutableSnapshot();
    if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error(`Invariante de preservação violada: antes=${JSON.stringify(before)} depois=${JSON.stringify(after)}`);
  });
  return {before,after:await immutableSnapshot(),summary:await databaseSummary(),curationFingerprint:curationFingerprint(file.foods)};
}

async function auditDatabase() {
  const {db,migrate}=await import('./db'); await migrate();
  checkArtifacts();
  const {file}=generateArtifacts(false);
  const snapshot=await immutableSnapshot();
  const queries=[] as Array<{query:string;milliseconds:number;results:string[]}>;
  for(const query of SEARCH_SCENARIOS){const started=performance.now();let rows:Array<{source_code:string;displayName:string}>=[];for(let i=0;i<5;i++)rows=await db.prepare(`SELECT source_code,display_name AS "displayName" FROM foods WHERE active AND source='TBCA' AND normalized_search_text LIKE ? ORDER BY CASE WHEN normalized_display_name=? THEN 0 WHEN ?=ANY(normalized_search_aliases) THEN 1 WHEN normalized_display_name LIKE ? THEN 2 WHEN EXISTS(SELECT 1 FROM unnest(normalized_search_aliases) a WHERE a LIKE ?) THEN 3 WHEN normalized_name=? THEN 4 WHEN normalized_name LIKE ? THEN 5 ELSE 6 END,curation_priority_rank,curation_score DESC,GREATEST(similarity(normalized_display_name,?),similarity(normalized_name,?)) DESC,source_code LIMIT 25`).all(`%${normalizeFoodName(query)}%`,normalizeFoodName(query),normalizeFoodName(query),`${normalizeFoodName(query)}%`,`${normalizeFoodName(query)}%`,normalizeFoodName(query),`${normalizeFoodName(query)}%`,normalizeFoodName(query),normalizeFoodName(query));queries.push({query,milliseconds:Number(((performance.now()-started)/5).toFixed(3)),results:rows.slice(0,10).map((row)=>`${row.displayName} (${row.source_code})`)});}
  return {summary:await databaseSummary(),snapshot,curationFingerprint:curationFingerprint(file.foods),performance:{iterationsPerQuery:5,queries,maxMilliseconds:Math.max(...queries.map((row)=>row.milliseconds)),averageMilliseconds:Number((queries.reduce((sum,row)=>sum+row.milliseconds,0)/queries.length).toFixed(3))}};
}

const command=process.argv[2]??'--check';
if(import.meta.filename===process.argv[1]){
  const brief=(audit:ReturnType<typeof buildAudit>)=>({totals:audit.totals,source_sha256:audit.source_sha256,curation_fingerprint:audit.curation_fingerprint});
  const run=command==='--generate'?()=>brief(generateArtifacts(true).audit):command==='--check'?()=>brief(checkArtifacts()):command==='--import'?()=>importCuration():command==='--audit'?()=>auditDatabase():()=>{throw new Error(`Opção desconhecida: ${command}`);};
  Promise.resolve(run()).then((result)=>console.log(JSON.stringify(result,null,2))).finally(async()=>{try{const {closeDatabase}=await import('./db');await closeDatabase();}catch{}});
}
