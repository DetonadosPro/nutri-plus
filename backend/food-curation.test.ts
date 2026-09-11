import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectPath } from './db';
import { normalizeFoodName } from '../shared/food-recognition';
import { rankCuratedFoods, sha256, validateCuration, type CurationSourceFood, type FoodCurationFile } from './food-curation-rules';
import {presentFoodSearchResults} from '../shared/food-catalog-presentation';

const sourceBuffer=readFileSync(projectPath('data','tbca','tbca completa normalizada.json'));
const foods=JSON.parse(sourceBuffer.toString('utf8')) as CurationSourceFood[];
const curation=JSON.parse(readFileSync(projectPath('data','food-curation.v1.json'),'utf8')) as FoodCurationFile;
const firstPass=JSON.parse(readFileSync(projectPath('data','food-curation.v1.first-pass.json'),'utf8')) as FoodCurationFile;
const secondPass=JSON.parse(readFileSync(projectPath('data','food-curation.v1.second-pass.json'),'utf8')) as FoodCurationFile;
const sourceByCode=new Map(foods.map((food)=>[food.codigo,food]));

function ranked(query:string) {return rankCuratedFoods(curation.foods,sourceByCode,query).map((row)=>row.entry);}
function patientResults(query:string){return presentFoodSearchResults(ranked(query).map(food=>({source_code:food.source_code,description:sourceByCode.get(food.source_code)!.nome_original,displayName:food.friendly_name,category:sourceByCode.get(food.source_code)!.grupo})),query);}

describe('curadoria integral da busca TBCA',()=>{
  it('cobre os 5.874 códigos sem alterar nem substituir a fonte',()=>{
    expect(validateCuration(curation,foods)).toBe(curation);
    expect(curation.source_sha256).toBe(sha256(sourceBuffer));
    expect(new Set(curation.foods.map((food)=>food.source_code)).size).toBe(5874);
    expect(curation.foods.every((food)=>food.aliases.length<=8)).toBe(true);
    expect(curation.foods.every((food)=>['common','useful','specific'].includes(food.priority))).toBe(true);
  });

  it.each([
    ['arroz',['BRC0018A','BRC0016A','BRC0001A','BRC0017A']],
    ['feijão',['BRC0001T','BRC0008T']],
    ['frango',['BRC0114F','BRC0194F','BRC0113F','BRC0133F']],
    ['ovo',['BRC0010J','BRC0015J','BRC0011J']],
    ['leite',['BRC0044G','BRC0043G','BRC0036G']],
    ['banana',['BRC0007C','BRC0011C','BRC0009C']],
    ['carne',['BRC0025F','BRC0047F','BRC0023F']],
    ['pão',['BRC0002A','BRC0123B','BRC0149A']],
    ['batata',['BRC0117B','BRC0048B','BRC0302B']],
    ['queijo',['BRC0052G','BRC0059G','BRC0058G']],
  ])('prioriza bases simples em %s',(query,expectedCodes)=>{
    expect(ranked(query).slice(0,expectedCodes.length).map((food)=>food.source_code)).toEqual(expectedCodes);
    expect(ranked(query).slice(0,expectedCodes.length).every((food)=>food.priority==='common')).toBe(true);
  });

  it('mantém uma preparação específica encontrável por seus próprios termos',()=>{
    const results=ranked('arroz com espinafre');
    expect(results[0].friendly_name).toMatch(/^Arroz com espinafre/i);
    expect(results[0].priority).toBe('specific');
  });

  it('apresenta peito bovino sem variantes técnicas repetidas ou carne crua',()=>{
    const results=patientResults('peito bovino');
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0].displayName).toBe('Peito bovino grelhado');
    expect(results.map(food=>food.displayName).join(' ')).not.toMatch(/\b(?:com|sem) (?:sal|óleo|oleo|gordura|manteiga)\b|\bcru[as]?\b/i);
    expect(new Set(results.map(food=>food.displayName)).size).toBe(results.length);
  });

  it('mostra Pepino e mantém arroz cozido acima das formas cruas',()=>{
    expect(patientResults('pepino')[0].displayName).toBe('Pepino');
    const rice=patientResults('arroz');
    expect(rice[0].source_code).toBe('BRC0018A');
    expect(rice.slice(0,10).map(food=>food.displayName).join(' ')).not.toMatch(/arroz[^,]*\bcru[as]?\b/i);
  });

  it.each(['peito bovino','pepino','arroz','linguiça','linguiça suína','bisteca','lombo','pernil'])('mantém a busca manual limpa para %s',(query)=>{
    const results=patientResults(query);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(25);
    expect(new Set(results.map(food=>food.displayName)).size).toBe(results.length);
    if(!/\bcru[as]?\b/i.test(query))expect(results.slice(0,10).map(food=>food.displayName).join(' ')).not.toMatch(/\b(?:com|sem) (?:sal|óleo|oleo|gordura|manteiga)\b/i);
  });

  it('prioriza a omelete simples sem ocultar as preparações específicas',()=>{
    const results=ranked('omelete');
    expect(results[0]).toEqual(expect.objectContaining({source_code:'BRC0065J',friendly_name:'Omelete',priority:'common'}));
    expect(results.slice(1).some((food)=>food.friendly_name.toLocaleLowerCase('pt-BR').startsWith('omelete'))).toBe(true);
  });

  it.each(['arroz','frango','carne','feijão','ovo'])('não deixa receitas específicas poluírem os cinco primeiros resultados de %s',(query)=>{
    const top=ranked(query).slice(0,5);
    expect(top).toHaveLength(5);
    expect(top.every((food)=>food.curation_category!=='composite_meal'&&food.priority!=='specific')).toBe(true);
  });

  it('não cria aliases exatos de ingredientes genéricos em preparações específicas ou compostas',()=>{
    const genericIngredients=new Set(['arroz','arroz branco','frango','peito de frango','carne','carne de boi','carne vermelha','feijao','ovo']);
    const polluted=curation.foods.filter((food)=>(food.priority==='specific'||food.curation_category==='composite_meal'||food.curation_category==='composite_recipe')&&food.aliases.some((alias)=>genericIngredients.has(normalizeFoodName(alias))));
    expect(polluted).toEqual([]);
    const meal=curation.foods.find((food)=>food.source_code==='BRC0001S');
    expect(meal?.aliases).toEqual([meal?.friendly_name]);
  });

  it('promove alimentos individuais detalhados sem confundir comprimento com especificidade',()=>{
    for(const code of ['BRC0006T','BRC0014T','BRC0033F','BRC0042F']) {
      const food=curation.foods.find((item)=>item.source_code===code);
      expect(food?.priority,code).toBe('useful');
      expect(food?.curation_category,code).not.toBe('composite_recipe');
    }
    const beforeByCode=new Map(firstPass.foods.map((food)=>[food.source_code,food]));
    const promoted=curation.foods.filter((food)=>beforeByCode.get(food.source_code)?.priority==='specific'&&food.priority==='useful');
    expect(promoted.length).toBeGreaterThanOrEqual(30);
  });

  it('naturaliza nomes e transfere qualificadores secundários para detalhes',()=>{
    const expected:Record<string,{name:string;details?:string[]}>= {
      BRC0001B:{name:'Abóbora crua',details:['Sem casca','Sem sementes']},
      BRC0001E:{name:'Camarão cozido sem casca',details:['Drenado','Sem óleo','Sem sal']},
      BRC0001F:{name:'Almôndega bovina crua',details:['Industrializado','Com sal']},
      BRC0001R:{name:'Mistura para bolo'},
      BRC0011K:{name:'Chocolate em pó'},
    };
    for(const [code,wanted] of Object.entries(expected)) {
      const food=curation.foods.find((item)=>item.source_code===code);
      expect(food?.friendly_name,code).toBe(wanted.name);
      for(const detail of wanted.details??[]) expect(food?.details,`${code}:${detail}`).toContain(detail);
    }
    const beforeByCode=new Map(firstPass.foods.map((food)=>[food.source_code,food]));
    expect(curation.foods.filter((food)=>beforeByCode.get(food.source_code)?.friendly_name!==food.friendly_name).length).toBeGreaterThanOrEqual(30);
  });

  it('remove em escala os aliases herdados de ingredientes sem perder o nome da preparação',()=>{
    const beforeByCode=new Map(firstPass.foods.map((food)=>[food.source_code,food]));
    let removed=0;
    for(const food of curation.foods) {
      const current=new Set(food.aliases.map(normalizeFoodName));
      removed+=(beforeByCode.get(food.source_code)?.aliases??[]).filter((alias)=>!current.has(normalizeFoodName(alias))).length;
      expect(food.aliases.map(normalizeFoodName)).toContain(normalizeFoodName(food.friendly_name));
    }
    expect(removed).toBeGreaterThanOrEqual(30);
  });

  it('marca colisões sem inventar nomes e sem excluir os registros',()=>{
    const naturalYogurts=curation.foods.filter((food)=>food.friendly_name==='Iogurte natural');
    expect(naturalYogurts.map((food)=>food.source_code).sort()).toEqual(['BRC0020G','BRC0021G']);
    expect(naturalYogurts.every((food)=>food.specificity_flags.includes('friendly_name_collision'))).toBe(true);
    expect(naturalYogurts.every((food)=>food.possible_duplicate_codes.length===1)).toBe(true);
  });

  it('mantém common seletivo e rebaixa apenas common claramente fortes demais',()=>{
    const beforeByCode=new Map(secondPass.foods.map((food)=>[food.source_code,food]));
    const changes=curation.foods.filter((food)=>beforeByCode.get(food.source_code)?.priority!==food.priority);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((food)=>beforeByCode.get(food.source_code)?.priority==='common'&&['useful','specific'].includes(food.priority))).toBe(true);
    expect(curation.foods.filter((food)=>food.priority==='common').length).toBeLessThanOrEqual(174);
    expect(curation.foods.some((food)=>food.priority==='common'&&food.curation_category==='composite_meal')).toBe(false);
    expect(curation.foods.find((food)=>food.source_code==='BRC0187A')?.priority).not.toBe('common');
    expect(curation.foods.find((food)=>food.source_code==='BRC0558A')?.priority).not.toBe('common');
  });

  it('prioriza dez peixes simples antes de receitas na busca genérica',()=>{
    const top=ranked('peixe').slice(0,10);
    expect(top.map((food)=>food.source_code)).toEqual(['BRC0486E','BRC0190E','BRC0162E','BRC0067E','BRC0042E','BRC0068E','BRC0019E','BRC0096E','BRC0098E','BRC0065E']);
    expect(top.every((food)=>['base_food','simple_preparation'].includes(food.curation_category)&&food.priority==='useful')).toBe(true);
    expect(ranked('peixe').findIndex((food)=>food.friendly_name.match(/parmegiana|milanesa|molho/i))).toBeGreaterThanOrEqual(10);
  });

  it('não dá alias peixe para receitas complexas',()=>{
    const polluted=curation.foods.filter((food)=>['composite_meal','composite_recipe'].includes(food.curation_category)&&food.aliases.some((alias)=>normalizeFoodName(alias)==='peixe'));
    expect(polluted).toEqual([]);
  });

  it('corrige concordância, hífen e nomes de peixe sem aplicar gênero cegamente',()=>{
    const expected:Record<string,string>={BRC0006E:'Lagosta cozida',BRC0017E:'Ostra cozida',BRC0019E:'Corvina de água doce crua',BRC0049E:'Corvina do mar crua',BRC0009E:'Lula músculo cru',BRC0072E:'Filé de sardinha em conserva com molho de tomate temperado',BRC0081E:'Filé de tainha preparado em micro-ondas',BRC0197E:'Filé de salmão assado/grelhado sem pele sem óleo com sal',BRC0418E:'Filé de abadejo cozido ao molho de tomate (tomate com óleo cebola e alho) sem sal',BRC0420E:'Posta de cação cozida ao molho de tomate (tomate com óleo cebola e alho) sem sal',BRC0422E:'Pescada branca cozida ao molho de tomate (tomate com óleo cebola e alho) sem sal',BRC0424E:'Pescadinha cozida ao molho de tomate (tomate com óleo cebola e alho) sem sal',BRC0427E:'Filé de salmão cozido sem pele ao molho de tomate (tomate com óleo cebola e alho) sem sal',BRC0194E:'Merluza frita em óleo de soja',BRC0017T:'Grão-de-bico cozido drenado'};
    for(const [code,name] of Object.entries(expected)) expect(curation.foods.find((food)=>food.source_code===code)?.friendly_name,code).toBe(name);
    const merluza=curation.foods.find((food)=>food.source_code==='BRC0194E')!;
    expect(merluza.aliases.map(normalizeFoodName)).toContain('peixe agua salgada merluza frito oleo soja sal');
    expect(merluza.details).toEqual(expect.arrayContaining(['Com óleo de soja','Com sal']));
    expect(curation.foods.find((food)=>food.source_code==='BRC0017T')?.aliases).not.toContain('Grão-de- bico');
  });

  it.each([
    ['salmão','BRC0065E'],['tilápia','BRC0486E'],['merluza','BRC0190E'],['sardinha','BRC0068E'],['atum','BRC0042E'],
    ['carne moída','BRC0025F'],['peito de frango','BRC0114F'],['arroz integral','BRC0016A'],['feijão preto','BRC0008T'],['leite integral','BRC0044G'],
  ])('preserva precisão na busca de controle %s',(query,expectedCode)=>{
    expect(ranked(query).slice(0,10).map((food)=>food.source_code)).toContain(expectedCode);
  });
});
