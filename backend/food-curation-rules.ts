import { createHash } from 'node:crypto';
import { normalizeFoodName } from '../shared/food-recognition';

export type CurationPriority = 'common' | 'useful' | 'specific';
export type CurationConfidence = 'high' | 'medium' | 'low';

export type CurationSourceFood = {
  codigo: string;
  nome: string;
  nome_original: string;
  nome_exibicao: string;
  aliases_busca: string[];
  grupo: string | null;
  marca?: string | null;
  nutrientes?: Array<{ tagname: string; unidade: string; valor_100g: unknown }>;
};

export type TacoReferenceFood = {
  source_code: string;
  description: string;
  group: string;
};

export type FoodCurationEntry = {
  source_code: string;
  friendly_name: string;
  aliases: string[];
  priority: CurationPriority;
  priority_score: number;
  curation_category: 'base_food' | 'simple_preparation' | 'common_dish' | 'composite_recipe' | 'composite_meal' | 'branded_product' | 'infant_food' | 'supplement';
  details: string[];
  specificity_flags: string[];
  confidence: CurationConfidence;
  taco_reference_codes: string[];
  duplicate_group: string | null;
  possible_duplicate_codes: string[];
};

export type FoodCurationFile = {
  version: 1;
  source: 'TBCA';
  source_sha256: string;
  taco_reference_sha256: string;
  rules_version: string;
  foods: FoodCurationEntry[];
};

export type FoodCurationOverride = {
  friendly_name?: string;
  aliases?: string[];
  priority?: CurationPriority;
  priority_score?: number;
  curation_category?: FoodCurationEntry['curation_category'];
  confidence?: CurationConfidence;
};

const CONNECTORS = new Set(['a','as','ao','aos','com','da','das','de','do','dos','e','em','na','nas','no','nos','para','por']);
const TECHNICAL = new Set(['amostra','amostras','brasil','dado','dados','diferente','diferentes','importado','importados','media','medias','varias','varios']);
const MATCH_SYNONYMS: Record<string,string> = {
  boi:'bovino', bovina:'bovino', bovinas:'bovino', bovinos:'bovino',
  galinha:'frango', galinhas:'frango',
  polido:'branco', refinada:'branco', refinado:'branco',
  macaxeira:'mandioca', aipim:'mandioca',
  mussarela:'mucarela', mozarela:'mucarela', muzarela:'mucarela',
  liquido:'fluido', liquida:'fluido',
};
const COMMON_DISH = /^(acaraj[eé]|arroz carreteiro|brigadeiro|cachorro.quente|canjica|coxinha|estrogonofe|feijoada|lasanha|moqueca|p[aã]o de queijo|pastel|pizza|tapioca|vatap[aá])\b/i;
const COMPOSITE_MEAL = /^(almo[cç]o|jantar|lanche brasileiro|prato composto|refei[cç][aã]o composta)/i;
const INFANT = /\b(alimento infantil|f[oó]rmula infantil|lactente|papa|papinha)\b/i;
const SUPPLEMENT = /\b(albumina|creatina|f[oó]rmula enteral|hipercal[oó]rico|maltodextrina|suplemento|whey)\b/i;
const FAST_FOOD = /\b(burger king|habib.?s|kfc|mcdonald|subway)\b/i;
const SIMPLE_FOOD_GROUP = /^(carnes e derivados|ovos e derivados|pescados e frutos do mar|vegetais e derivados|frutas e derivados|leguminosas e derivados)$/i;
const COMPLEX_PREPARATION = /\b(acompanhad[oa]|com arroz|com feij[aã]o|com macarr[aã]o|com vegetais|ensopad[oa] com|farofa|lasanha|molho|rechead[oa]|risoto|salada|sandu[ií]che|sopa|torta)\b/i;
const SELECTIVE_COMMON_DISH = /^(canjica milho branca cozida|coxinha de frango|estrogonofe \(stro(?:gon|gan)off\) de (?:carne|frango) (?:com|sem) sal|feijoada (?:com|sem) sal|moqueca de peixe (?:capixaba|baiana) com sal|p[aã]o de queijo assado|pastel (?:frito caseiro|com recheio de (?:carne bovina|queijo) frito artesanal)|pizza (?:lingui[cç]a calabresa caseira|marguerita com queijo mu[cç]arela e manjeric[aã]o artesanal|portuguesa (?:assada|caseira)|queijo mu[cç]arela artesanal assada)|tapioca (?:com manteiga com sal|sem manteiga sem recheio))\b/i;
const FEMININE_FISH_HEAD = /^(anchova|carpa|cavala|corvina(?: do mar)?|lagosta|lula|merluza|ostra|pescada(?: branca)?|pescadinha|sardinha|tainha|til[aá]pia|truta)\b/i;
const FISH_FILLET_HEAD = /^(abadejo|corvina(?: do mar)?|merluza|pescada(?: branca)?|salm[aã]o|sardinha|tainha|til[aá]pia|tucunar[eé]) fil[eé](?=\s|$)/i;
const FISH_STEAK_HEAD = /^ca[cç][aã]o posta(?=\s|$)/i;
const FISH_SEARCH_ALIASES:Record<string,string[]> = {
  BRC0486E:['peixe','peixe tilápia','filé de tilápia'],
  BRC0190E:['peixe','peixe merluza','merluza'],
  BRC0162E:['peixe','peixe pescada','pescada'],
  BRC0067E:['peixe','peixe salmão','salmão'],
  BRC0042E:['peixe','peixe atum','atum'],
  BRC0068E:['peixe','peixe sardinha','sardinha'],
  BRC0019E:['peixe','peixe corvina','corvina'],
  BRC0096E:['peixe','peixe pintado','pintado'],
  BRC0098E:['peixe','peixe tilápia','filé de tilápia'],
  BRC0065E:['peixe','peixe salmão','salmão'],
};
const FISH_SEARCH_SCORES:Record<string,number> = {BRC0486E:690,BRC0190E:680,BRC0162E:670,BRC0067E:660,BRC0042E:650,BRC0068E:640,BRC0019E:630,BRC0096E:620,BRC0098E:610,BRC0065E:600};

function words(value: string) {
  return normalizeFoodName(value).split(' ').filter(Boolean);
}

function canonicalWords(value: string) {
  return words(value)
    .filter((token) => !CONNECTORS.has(token) && !TECHNICAL.has(token) && !/^\d+$/.test(token) && token !== 'tipo')
    .map((token) => MATCH_SYNONYMS[token] ?? token);
}

function titleStart(value: string) {
  const clean = value.replace(/\bGr[aã]o-de-\s+bico\b/gi,'Grão-de-bico').replace(/\s+/g,' ').replace(/\s+([,;)])/g,'$1').replace(/([(])\s+/g,'$1').trim();
  return clean ? clean[0].toLocaleUpperCase('pt-BR') + clean.slice(1) : clean;
}

function swapPreparationGender(value:string,to:'feminine'|'masculine') {
  const pairs:Partial<Record<string,string>>=to==='feminine'
    ? {assado:'assada',cozido:'cozida',cru:'crua',desidratado:'desidratada',drenado:'drenada',frito:'frita',grelhado:'grelhada',congelado:'congelada'}
    : {assada:'assado',cozida:'cozido',crua:'cru',desidratada:'desidratado',drenada:'drenado',frita:'frito',grelhada:'grelhado',congelada:'congelado'};
  return value.replace(/\b(assad[oa]|cozid[oa]|cru|crua|desidratad[oa]|drenad[oa]|frit[oa]|grelhad[oa]|congelad[oa])\b/gi,(word)=>{
    const replacement=pairs[word.toLowerCase()];
    return replacement ? replacement : word;
  });
}

function naturalizeFishName(value:string) {
  let name=value;
  if (/^Peixe agua salgada merluza frito oleo soja sal$/i.test(name)) return 'Merluza frita em óleo de soja';
  if (FISH_FILLET_HEAD.test(name)) name=name.replace(FISH_FILLET_HEAD,(_,species:string)=>`Filé de ${species.toLocaleLowerCase('pt-BR')}`);
  if (FISH_STEAK_HEAD.test(name)) name=name.replace(FISH_STEAK_HEAD,'Posta de cação');
  if (/^Fil[eé] de /i.test(name)) {
    name=swapPreparationGender(name,'masculine')
      .replace(/^(Fil[eé] de .+?) (sem|com) pele fresco (assado\/grelhado|assado|cozido|cru|frito|grelhado)\b/i,'$1 fresco $3 $2 pele')
      .replace(/^(Fil[eé] de .+?) (sem|com) pele (assado\/grelhado|assado|cozido|cru|frito|grelhado)\b/i,'$1 $3 $2 pele');
  } else if (/^Posta de ca[cç][aã]o\b/i.test(name)) name=swapPreparationGender(name,'feminine');
  else if (FEMININE_FISH_HEAD.test(name) && !/\bmúsculo\b/i.test(name)) name=swapPreparationGender(name,'feminine');
  return name
    .replace(/\bao com molho\b/gi,'ao molho')
    .replace(/(?<!\bem )\bconserva\b/gi,'em conserva')
    .replace(/\s+Brazil$/i,'')
    .replace(/\bagua\b/gi,'água')
    .replace(/\boleo\b/gi,'óleo');
}

const EXACT_FISH_NAMES:Record<string,string>={
  BRC0019E:'Corvina de água doce crua',
  BRC0049E:'Corvina do mar crua',
  BRC0051E:'Corvina do mar cozida',
  BRC0088E:'Corvina de água doce cozida',
};

export function defaultFriendlyName(food: CurationSourceFood) {
  let name = food.nome_exibicao.trim()
    .replace(/^Arroz polido\b/i,'Arroz branco')
    .replace(/^Leite de vaca\s+/i,'Leite ')
    .replace(/^Bolo mistura para$/i,'Mistura para bolo')
    .replace(/^Chocolate p[oó]$/i,'Chocolate em pó')
    .replace(/^Alm[oô]ndega carne (?:boi|bovina)\b/i,'Almôndega bovina')
    .replace(/^Alm[oô]ndega carne (?:ave|frango)\b/i,'Almôndega de frango')
    .replace(/\bGr[aã]o-de-\s+bico\b/gi,'Grão-de-bico')
    .replace(/\bflu[ií]do\b/gi,'fluido')
    .replace(/\s*\(dado importado\)\s*/gi,' ')
    .replace(/\*+/g,'');
  const canonicalWithoutOilOrSalt=/\bs\/\s*[oó]leo\b/i.test(food.nome_original) && /\bs\/\s*sal\b/i.test(food.nome_original);
  if (canonicalWithoutOilOrSalt) name=name.replace(/\bsem [oó]leo\b/gi,' ').replace(/\bsem sal\b/gi,' ');
  if (/^Alm[oô]ndega\b/i.test(name)) name=name.replace(/\bindustrializad[oa]s?\b/gi,' ').replace(/\bcom sal\b/gi,' ');
  if (/^Camar[aã]o\b/i.test(name) && !/\bmolho\b/i.test(name)) name=name.replace(/\bdrenad[oa]s?\b/gi,' ');
  if (/^(?:ab[oó]bora|jerimum)\b/i.test(name)) name=name.replace(/\bsem casca\b/gi,' ').replace(/\bsem sementes?\b/gi,' ');
  name=name
    .replace(/^(Camar[aã]o) sem casca (cozid[oa]|cru[oa]|frit[oa]|grelhad[oa]|assad[oa])\b/i,'$1 $2 sem casca')
    .replace(/^(Cox[aã]o duro(?: \([^)]*\))? bovino) sem gordura cozida\b/i,'$1 cozido sem gordura')
    .replace(/^(Miolo de alcatra bovino) sem gordura grelhada\b/i,'$1 grelhado sem gordura');
  name=EXACT_FISH_NAMES[food.codigo]??name;
  if (!EXACT_FISH_NAMES[food.codigo]&&(/^Pescados e frutos do mar$/i.test(food.grupo ?? '')||FEMININE_FISH_HEAD.test(name)||FISH_FILLET_HEAD.test(name)||FISH_STEAK_HEAD.test(name)||/^Peixe agua salgada merluza/i.test(name))) name=naturalizeFishName(name);
  return titleStart(name);
}

function detailsFor(food: CurationSourceFood) {
  const source = food.nome_original;
  const details: string[] = [];
  const add = (condition: boolean, value: string) => { if (condition && !details.includes(value)) details.push(value); };
  add(/\b(?:s\/|sem)\s*[oó]leo\b/i.test(source),'Sem óleo');
  add(/\b(?:c\/|com)\s*[oó]leo\b/i.test(source),'Com óleo');
  add(/\b(?:s\/|sem)\s*sal\b/i.test(source),'Sem sal');
  add(/\b(?:c\/|com)\s*sal\b/i.test(source),'Com sal');
  add(/\b(?:s\/|sem)\s*a[cç][uú]car\b/i.test(source),'Sem açúcar');
  add(/\b(?:c\/|com)\s*a[cç][uú]car\b/i.test(source),'Com açúcar');
  add(/\b(?:s\/|sem)\s*casca\b/i.test(source),'Sem casca');
  add(/\b(?:s\/|sem)\s*sementes?\b/i.test(source),'Sem sementes');
  add(/\bdrenad[oa]s?\b/i.test(source),'Drenado');
  add(/\bindustrializad[oa]s?\b/i.test(source),'Industrializado');
  add(/\boleo soja\b/i.test(source),'Com óleo de soja');
  add(/^peixe agua salgada merluza frito oleo soja sal$/i.test(source),'Com sal');
  add(/\b(?:Brasil|Brazil)\b/i.test(source),'Brasil');
  add(/m[eé]dia (?:de |das |dos )?(?:diferentes |v[aá]rias )?(?:amostras|cultivares|marcas|tipos|preparos)/i.test(source),'Média de amostras');
  add(/dado importado/i.test(source),'Dado importado');
  if (food.marca?.trim()) add(true,food.marca.trim());
  return details.slice(0,8);
}

function categoryAndFlags(food: CurationSourceFood, friendlyName: string) {
  const source = `${food.nome_original} ${friendlyName}`;
  const flags: string[] = [];
  const withCount = (source.match(/\bc\/|\bcom\b/gi) ?? []).length;
  const wordCount = words(source).length;
  const commonDish = COMMON_DISH.test(friendlyName);
  const simpleIndividual = SIMPLE_FOOD_GROUP.test(food.grupo ?? '') && !COMPLEX_PREPARATION.test(source);
  const complexPreparation = COMPLEX_PREPARATION.test(source) || withCount >= 3;
  if (COMPOSITE_MEAL.test(source)) flags.push('composite_meal');
  if (withCount >= 3) flags.push('many_ingredients');
  if (wordCount >= 24) flags.push('long_description');
  if (simpleIndividual) flags.push('individual_food');
  if (food.marca?.trim() || FAST_FOOD.test(source)) flags.push('branded');
  if (/m[eé]dia (?:de |das |dos )?(?:diferentes |v[aá]rias )?(?:amostras|cultivares|marcas|tipos|preparos)/i.test(source)) flags.push('technical_average');
  if (/dado importado/i.test(source)) flags.push('imported_reference');
  if (/[\/]|\bou\b/i.test(friendlyName)) flags.push('ambiguous_label');
  if (INFANT.test(source)) flags.push('infant_specific');
  if (SUPPLEMENT.test(source)) flags.push('supplement');

  let category: FoodCurationEntry['curation_category'];
  if (flags.includes('composite_meal')) category='composite_meal';
  else if (flags.includes('infant_specific')) category='infant_food';
  else if (flags.includes('supplement')) category='supplement';
  else if (flags.includes('branded')) category='branded_product';
  else if (commonDish) category='common_dish';
  else if (complexPreparation) category='composite_recipe';
  else if (withCount === 0 && words(friendlyName).length <= 7) category='base_food';
  else category='simple_preparation';
  return { category, flags, commonDish };
}

function similarity(left: string, right: string) {
  const a = new Set(canonicalWords(left));
  const b = new Set(canonicalWords(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token)=>b.has(token)).length;
  return intersection / a.size * .72 + intersection / b.size * .28;
}

export type TacoMatch = { tacoCode: string; tbcaCode: string; score: number; margin: number };

export function matchTacoToTbca(tacoFoods: TacoReferenceFood[], tbcaFoods: CurationSourceFood[]) {
  const matches: TacoMatch[] = [];
  for (const taco of tacoFoods) {
    const tacoFirst = canonicalWords(taco.description)[0];
    let best: { code: string; score: number } | undefined;
    let second = 0;
    for (const tbca of tbcaFoods) {
      const tbcaWords = canonicalWords(tbca.nome_original);
      if (!tacoFirst || !tbcaWords.includes(tacoFirst)) continue;
      let score = similarity(taco.description,tbca.nome_original);
      if (normalizeFoodName(taco.group) === normalizeFoodName(tbca.grupo ?? '')) score += .04;
      score = Math.min(1,score);
      if (!best || score > best.score || (score === best.score && tbca.codigo.localeCompare(best.code)<0)) {
        second = best?.score ?? second;
        best={code:tbca.codigo,score};
      } else if (score > second) second=score;
    }
    if (best && best.score >= .62) matches.push({tacoCode:taco.source_code,tbcaCode:best.code,score:Number(best.score.toFixed(4)),margin:Number((best.score-second).toFixed(4))});
  }
  return matches;
}

function conciseAliases(food: CurationSourceFood, friendlyName: string, priority: CurationPriority, category: FoodCurationEntry['curation_category'], overrideAliases: string[] = []) {
  const preparationSpecific=priority==='specific' || category==='composite_meal' || category==='composite_recipe';
  // Preparações específicas só recebem o próprio nome e aliases manuais da preparação.
  // A lista automática da fonte contém fragmentos de ingredientes que poluem buscas genéricas.
  const fishAliases=!preparationSpecific ? (FISH_SEARCH_ALIASES[food.codigo]??[]) : [];
  const candidates=preparationSpecific ? [friendlyName,...overrideAliases] : [friendlyName,...overrideAliases,...fishAliases,...food.aliases_busca];
  const first=words(friendlyName)[0];
  if (priority==='common' && first && !['carne','queijo'].includes(first)) candidates.push(first);
  const seen=new Set<string>();
  const aliases: string[]=[];
  for (const alias of candidates) {
    const clean=titleStart(alias.replace(/\*+/g,''));
    const normalized=normalizeFoodName(clean);
    const isFriendlyName=normalized===normalizeFoodName(friendlyName);
    if (!normalized || (!isFriendlyName && clean.length>72) || seen.has(normalized)) continue;
    if (priority!=='common' && words(normalized).length===1 && normalized!==normalizeFoodName(friendlyName) && !(FISH_SEARCH_ALIASES[food.codigo]??[]).some((item)=>normalizeFoodName(item)===normalized)) continue;
    seen.add(normalized); aliases.push(clean);
    if (aliases.length===8) break;
  }
  return aliases;
}

function priorityFor(food: CurationSourceFood, friendlyName: string, category: FoodCurationEntry['curation_category'], flags: string[], hasTacoMatch: boolean, commonDish: boolean) {
  if (['composite_meal','infant_food','supplement','branded_product'].includes(category)) return {priority:'specific' as const,score:180};
  if (category==='composite_recipe' && !commonDish) return {priority:'specific' as const,score:250};
  if (commonDish) {
    if (SELECTIVE_COMMON_DISH.test(friendlyName)) return {priority:'common' as const,score:720};
    if (flags.includes('many_ingredients')||flags.includes('long_description')||/\b(light|vegana|vegetariana|frutos do mar|lagosta|hawaiana|calif[oó]rnia|napolitana|pepperoni|shiitake|nozes|amarula|5 queijos|doce)\b/i.test(friendlyName)) return {priority:'specific' as const,score:250};
    return {priority:'useful' as const,score:430};
  }
  if (FISH_SEARCH_SCORES[food.codigo]) return {priority:'useful' as const,score:FISH_SEARCH_SCORES[food.codigo]};
  if (hasTacoMatch) return {priority:'useful' as const,score:560};
  return {priority:'useful' as const,score:430};
}

function exactCollisionGroups(entries: FoodCurationEntry[]) {
  const groups=new Map<string,FoodCurationEntry[]>();
  for (const entry of entries) {
    const key=normalizeFoodName(entry.friendly_name);
    const rows=groups.get(key) ?? []; rows.push(entry); groups.set(key,rows);
  }
  return [...groups.entries()].filter(([,rows])=>rows.length>1);
}

export function generateCuration(tbcaFoods: CurationSourceFood[], tacoFoods: TacoReferenceFood[], overrides: Record<string,FoodCurationOverride>) {
  const tacoMatches=matchTacoToTbca(tacoFoods,tbcaFoods);
  const tacoByTbca=new Map<string,string[]>();
  for (const match of tacoMatches) tacoByTbca.set(match.tbcaCode,[...(tacoByTbca.get(match.tbcaCode) ?? []),match.tacoCode]);
  const entries: FoodCurationEntry[]=tbcaFoods.map((food)=>{
    const override=overrides[food.codigo] ?? {};
    const friendlyName=titleStart(override.friendly_name ?? defaultFriendlyName(food));
    const {category: inferredCategory,flags,commonDish}=categoryAndFlags(food,friendlyName);
    const tacoCodes=tacoByTbca.get(food.codigo) ?? [];
    const inferred=priorityFor(food,friendlyName,inferredCategory,flags,tacoCodes.length>0,commonDish);
    const priority=override.priority ?? inferred.priority;
    const priorityScore=override.priority_score ?? inferred.score;
    let confidence: CurationConfidence=override.confidence ?? (override.friendly_name ? 'high' : tacoCodes.length ? 'high' : 'medium');
    if (!override.confidence && flags.includes('ambiguous_label')) confidence='low';
    return {
      source_code:food.codigo,
      friendly_name:friendlyName,
      aliases:conciseAliases(food,friendlyName,priority,override.curation_category ?? inferredCategory,override.aliases),
      priority,
      priority_score:priorityScore,
      curation_category:override.curation_category ?? inferredCategory,
      details:detailsFor(food),
      specificity_flags:flags,
      confidence,
      taco_reference_codes:tacoCodes.sort((a,b)=>Number(a)-Number(b)),
      duplicate_group:null,
      possible_duplicate_codes:[],
    };
  }).sort((a,b)=>a.source_code.localeCompare(b.source_code));

  for (const [normalized,rows] of exactCollisionGroups(entries)) {
    const group=`friendly:${normalized}`;
    const codes=rows.map((row)=>row.source_code).sort();
    for (const row of rows) {
      row.duplicate_group=group;
      row.possible_duplicate_codes=codes.filter((code)=>code!==row.source_code);
      if (!row.specificity_flags.includes('friendly_name_collision')) row.specificity_flags.push('friendly_name_collision');
      if (!overrides[row.source_code]?.confidence) row.confidence='low';
    }
  }
  return { entries, tacoMatches };
}

export function validateCuration(file: FoodCurationFile, tbcaFoods: CurationSourceFood[]) {
  if (file.version!==1 || file.source!=='TBCA' || file.foods.length!==5874) throw new Error('A curadoria deve conter exatamente os 5.874 alimentos TBCA.');
  const sourceCodes=new Set(tbcaFoods.map((food)=>food.codigo));
  const seen=new Set<string>();
  for (const food of file.foods) {
    if (!sourceCodes.has(food.source_code) || seen.has(food.source_code)) throw new Error(`Código ausente ou duplicado na curadoria: ${food.source_code}`);
    seen.add(food.source_code);
    if (!food.friendly_name.trim() || !['common','useful','specific'].includes(food.priority)) throw new Error(`Curadoria incompleta: ${food.source_code}`);
    if (food.aliases.length>8 || food.aliases.some((alias)=>!alias.trim())) throw new Error(`Aliases inválidos: ${food.source_code}`);
    if (!Number.isInteger(food.priority_score) || food.priority_score<0 || food.priority_score>1000) throw new Error(`Score inválido: ${food.source_code}`);
  }
  return file;
}

export function sha256(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }

function trigrams(value: string) {
  const padded=`  ${normalizeFoodName(value)} `;
  const result:string[]=[];
  for(let i=0;i<padded.length-2;i++) result.push(padded.slice(i,i+3));
  return result;
}

function trigramSimilarity(a:string,b:string) {
  const left=trigrams(a),right=trigrams(b),counts=new Map<string,number>();
  left.forEach((item)=>counts.set(item,(counts.get(item)??0)+1));
  let common=0;
  right.forEach((item)=>{const count=counts.get(item)??0;if(count){common++;counts.set(item,count-1);}});
  return left.length+right.length ? 2*common/(left.length+right.length) : 0;
}

export function rankCuratedFoods(entries: FoodCurationEntry[], sourceFoods: Map<string,CurationSourceFood>, query: string) {
  const q=normalizeFoodName(query);
  const qTokens=words(q);
  const priorityRank={common:0,useful:1,specific:2};
  return entries.map((entry)=>{
    const source=sourceFoods.get(entry.source_code)!;
    const friendly=normalizeFoodName(entry.friendly_name);
    const original=normalizeFoodName(source.nome_original);
    const aliases=entry.aliases.map(normalizeFoodName);
    const text=[friendly,original,...aliases].join(' ');
    if (!qTokens.every((token)=>text.includes(token))) return null;
    const tier=friendly===q ? 0 : aliases.includes(q) ? 1 : friendly.startsWith(q) ? 2 : aliases.some((alias)=>alias.startsWith(q)) ? 3 : original===q ? 4 : original.startsWith(q) ? 5 : 6;
    return {entry,tier,similarity:Math.max(trigramSimilarity(friendly,q),trigramSimilarity(original,q))};
  }).filter((row): row is NonNullable<typeof row>=>Boolean(row)).sort((a,b)=>a.tier-b.tier || priorityRank[a.entry.priority]-priorityRank[b.entry.priority] || b.entry.priority_score-a.entry.priority_score || b.similarity-a.similarity || a.entry.source_code.localeCompare(b.entry.source_code));
}

export function rankLegacyFoods(sourceFoods: CurationSourceFood[], query: string) {
  const q=normalizeFoodName(query),first=q.split(' ')[0];
  return sourceFoods.map((food)=>{
    const display=normalizeFoodName(food.nome_exibicao),original=normalizeFoodName(food.nome_original),aliases=food.aliases_busca.map(normalizeFoodName);
    const text=[display,original,...aliases].join(' ');
    if (!words(q).every((token)=>text.includes(token))) return null;
    const tier=display===q||original===q?0:display.startsWith(q)||original.startsWith(q)?1:display.startsWith(first)||original.startsWith(first)?2:3;
    const aliasTier=aliases.includes(q)?0:aliases.some((a)=>a.startsWith(q))?1:aliases.some((a)=>a.includes(q))?2:3;
    return {food,tier,aliasTier,similarity:Math.max(trigramSimilarity(display,q),trigramSimilarity(original,q))};
  }).filter((row): row is NonNullable<typeof row>=>Boolean(row)).sort((a,b)=>a.tier-b.tier || b.similarity-a.similarity || a.aliasTier-b.aliasTier || a.food.codigo.localeCompare(b.food.codigo));
}

export function curationFingerprint(entries: FoodCurationEntry[]) {
  return sha256(JSON.stringify([...entries].sort((a,b)=>a.source_code.localeCompare(b.source_code))));
}
