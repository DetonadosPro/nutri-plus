import { importMeasures } from './measure-import';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { closeDatabase, db, migrate, projectPath, transaction } from './db';
import { normalizeSearch, type NutrientStatus } from './taco-import';

type RawNutrient = { componente: string; tagname: string; unidade: string; valor_100g: unknown };
export type RawFood = { codigo: string; grupo: string | null; marca?: string | null; nome: string; nome_original: string; nome_exibicao: string; aliases_busca: string[]; nome_cientifico?: string | null; url?: string | null; nutrientes: RawNutrient[] };

const definitions = [
  ['vitamina_e_mg','Vitamina E','TOCPHA','mg','vitamin'], ['acucar_adicao_g','Açúcar de adição','TBCA_ADDED_SUGAR','g','macro'],
  ['carboidrato_disponivel_g','Carboidrato disponível','CHOAVLDF','g','macro'], ['carboidrato_g','Carboidrato total','CHOCDF','g','macro'],
  ['cinzas_g','Cinzas','ASH','g','other'], ['cobre_mg','Cobre','CU','mg','mineral'], ['colesterol_mg','Colesterol','CHOLE','mg','other'],
  ['calcio_mg','Cálcio','CA','mg','mineral'], ['energia_kcal','Energia','ENERC','kcal','energy'], ['energia_kj','Energia','ENERC','kJ','energy'],
  ['folato_equivalente_mcg','Equivalente de folato','FOLDFE','mcg','vitamin'], ['ferro_mg','Ferro','FE','mg','mineral'],
  ['fibra_g','Fibra alimentar','FIBTG','g','macro'], ['fosforo_mg','Fósforo','P','mg','mineral'],
  ['gordura_adicao_g','Gordura de adição','TBCA_ADDED_FAT','g','macro'], ['lipideos_g','Lipídios','FAT','g','macro'],
  ['magnesio_mg','Magnésio','MG','mg','mineral'], ['manganes_mg','Manganês','MN','mg','mineral'], ['niacina_mg','Niacina','NIA','mg','vitamin'],
  ['potassio_mg','Potássio','K','mg','mineral'], ['proteina_g','Proteína','PROCNT','g','macro'],
  ['proteina_animal_g','Proteína animal','TBCA_ANIMAL_PROTEIN','g','macro'], ['proteina_vegetal_g','Proteína vegetal','TBCA_PLANT_PROTEIN','g','macro'],
  ['riboflavina_mg','Riboflavina','RIBF','mg','vitamin'], ['sal_adicao_g','Sal de adição','TBCA_ADDED_SALT','g','other'],
  ['selenio_mcg','Selênio','SE','mcg','mineral'], ['sodio_mg','Sódio','NA','mg','mineral'], ['tiamina_mg','Tiamina','THIA','mg','vitamin'],
  ['umidade_g','Umidade','WATER','g','other'], ['rae_ug','Vitamina A (RAE)','VITA RAE','mcg','vitamin'], ['re_ug','Vitamina A (RE)','VITA','mcg','vitamin'],
  ['vitamina_b12_mcg','Vitamina B12','VITB12','mcg','vitamin'], ['piridoxina_mg','Vitamina B6','VITB6A','mg','vitamin'],
  ['vitamina_c_mg','Vitamina C','VITC','mg','vitamin'], ['vitamina_d_mcg','Vitamina D','VITD','mcg','vitamin'], ['zinco_mg','Zinco','ZN','mg','mineral'],
  ['monoinsaturados_g','Ácidos graxos monoinsaturados','FAMS','g','macro'], ['poliinsaturados_g','Ácidos graxos poliinsaturados','FAPU','g','macro'],
  ['saturados_g','Ácidos graxos saturados','FASAT','g','macro'], ['trans_g','Ácidos graxos trans','FATRN','g','macro'], ['alcool_g','Álcool','ALC','g','other'],
] as const;

function parsedValue(input: unknown): { numeric_value: number | null; raw_value: string; status: NutrientStatus } {
  const raw = input == null ? '' : String(input).trim();
  const key = raw.toLocaleLowerCase('pt-BR');
  if (!raw || ['na','n/a','-','--','nd','n.d.'].includes(key)) return { numeric_value: null, raw_value: raw, status: 'missing' };
  if (['tr','traço','traco'].includes(key)) return { numeric_value: null, raw_value: raw, status: 'trace' };
  const numeric = typeof input === 'number' ? input : Number(raw.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numeric)) throw new Error(`Valor TBCA inválido: ${raw}`);
  return { numeric_value: numeric, raw_value: raw, status: 'numeric' };
}

export function validateTbcaDataset(dataset: RawFood[]) {
  if (!Array.isArray(dataset) || dataset.length !== 5874) throw new Error('A TBCA deve conter exatamente 5.874 alimentos.');
  const codes = new Set(dataset.map(f => f.codigo));
  if (codes.size !== 5874 || [...codes].some(code => !/^BRC[0-9A-Z]+$/.test(code))) throw new Error('Códigos TBCA inválidos ou duplicados.');
  let missing = 0, trace = 0, zero = 0;
  for (const food of dataset) {
    if (!food.nome_original?.trim() || !food.nome_exibicao?.trim() || !Array.isArray(food.aliases_busca) || food.nutrientes?.length !== definitions.length)
      throw new Error(`Estrutura incompleta no alimento TBCA ${food.codigo}.`);
    if (food.nome !== food.nome_original) throw new Error(`Nome original divergente no alimento TBCA ${food.codigo}.`);
    if (food.aliases_busca.some(alias => typeof alias !== 'string' || !alias.trim())) throw new Error(`Alias inválido no alimento TBCA ${food.codigo}.`);
    food.nutrientes.forEach((nutrient, index) => {
      const definition = definitions[index];
      const expectedTag = definition[2].startsWith('TBCA_') ? '—' : definition[2];
      if (nutrient.unidade !== definition[3] || nutrient.tagname !== expectedTag) throw new Error(`Ordem/identidade inesperada em ${food.codigo}, posição ${index + 1}.`);
      const value = parsedValue(nutrient.valor_100g);
      if (value.status === 'missing') missing++; else if (value.status === 'trace') trace++; else if (value.numeric_value === 0) zero++;
    });
  }
  if (missing !== 20346 || trace !== 5638 || zero !== 32938) throw new Error(`Auditoria TBCA divergente: missing=${missing}, trace=${trace}, zero=${zero}.`);
  return { foods: dataset.length, values: dataset.length * definitions.length, missing, trace, zero };
}

export async function importTbca(filePath = projectPath('data','tbca','tbca completa normalizada.json')) {
  const dataset = JSON.parse(readFileSync(filePath,'utf8')) as RawFood[];
  const audit = validateTbcaDataset(dataset);
  await migrate();
  const existingFoods = new Set((await db.prepare(`SELECT source_code FROM foods WHERE source='TBCA'`).all<{source_code:string}>()).map(r => r.source_code));
  const existingValues = Number((await db.prepare(`SELECT COUNT(*)::int count FROM food_nutrients fn JOIN foods f ON f.id=fn.food_id WHERE f.source='TBCA'`).get<{count:number}>())?.count ?? 0);
  const report = { foodsProcessed:audit.foods, foodsCreated:audit.foods-existingFoods.size, foodsUpdated:existingFoods.size, nutrients:definitions.length,
    values:audit.values, valuesCreated:Math.max(0,audit.values-existingValues), valuesUpdated:Math.min(audit.values,existingValues), missing:audit.missing, trace:audit.trace, zero:audit.zero, errors:0 };
  await transaction(async () => {
    const nutrientRows = definitions.map((d,i) => ({code:d[0],name:d[1],tagname:d[2],unit:d[3],nutrient_group:d[4],sort_order:i+1}));
    await db.prepare(`INSERT INTO nutrients(code,name,tagname,unit,nutrient_group,sort_order)
      SELECT x.code,x.name,x.tagname,x.unit,x.nutrient_group,x.sort_order FROM jsonb_to_recordset(?::jsonb) x(code text,name text,tagname text,unit text,nutrient_group text,sort_order int)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,tagname=excluded.tagname,unit=excluded.unit,nutrient_group=excluded.nutrient_group,sort_order=excluded.sort_order`).run(JSON.stringify(nutrientRows));
    const foods = dataset.map(f => {
      const normalizedAliases = [...new Set(f.aliases_busca.map(normalizeSearch).filter(Boolean))];
      const normalizedName = normalizeSearch(f.nome_original);
      const normalizedDisplayName = normalizeSearch(f.nome_exibicao);
      return {source_code:f.codigo,description:f.nome_original,display_name:f.nome_exibicao,search_aliases:f.aliases_busca,normalized_name:normalizedName,normalized_display_name:normalizedDisplayName,normalized_search_aliases:normalizedAliases,normalized_search_text:[normalizedDisplayName,normalizedName,...normalizedAliases].join(' '),category:f.grupo,scientific_name:f.nome_cientifico ?? null,brand:f.marca ?? null,source_url:f.url ?? null};
    });
    for (let offset=0; offset<foods.length; offset+=1000) await db.prepare(`INSERT INTO foods(source,source_code,description,display_name,search_aliases,normalized_name,normalized_display_name,normalized_search_aliases,normalized_search_text,category,scientific_name,brand,source_url,active,updated_at)
      SELECT 'TBCA',x.source_code,x.description,x.display_name,x.search_aliases,x.normalized_name,x.normalized_display_name,x.normalized_search_aliases,x.normalized_search_text,x.category,x.scientific_name,x.brand,x.source_url,true,CURRENT_TIMESTAMP FROM jsonb_to_recordset(?::jsonb) x(source_code text,description text,display_name text,search_aliases text[],normalized_name text,normalized_display_name text,normalized_search_aliases text[],normalized_search_text text,category text,scientific_name text,brand text,source_url text)
      ON CONFLICT(source,source_code) DO UPDATE SET description=excluded.description,display_name=excluded.display_name,search_aliases=excluded.search_aliases,normalized_name=excluded.normalized_name,normalized_display_name=excluded.normalized_display_name,normalized_search_aliases=excluded.normalized_search_aliases,normalized_search_text=excluded.normalized_search_text,category=excluded.category,scientific_name=excluded.scientific_name,brand=excluded.brand,source_url=excluded.source_url,active=true,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(foods.slice(offset,offset+1000)));
    const ids = new Map((await db.prepare(`SELECT id,source_code FROM foods WHERE source='TBCA'`).all<{id:number;source_code:string}>()).map(r => [r.source_code,r.id]));
    await importMeasures(JSON.parse(readFileSync(projectPath('data','food-measures.reviewed.json'),'utf8')));
    const rows: Record<string,unknown>[] = [];
    dataset.forEach(food => food.nutrientes.forEach((nutrient,index) => rows.push({food_id:ids.get(food.codigo),nutrient_code:definitions[index][0],...parsedValue(nutrient.valor_100g)})));
    for (let offset=0; offset<rows.length; offset+=2000) await db.prepare(`INSERT INTO food_nutrients(food_id,nutrient_code,numeric_value,raw_value,status,updated_at)
      SELECT x.food_id,x.nutrient_code,x.numeric_value,x.raw_value,x.status,CURRENT_TIMESTAMP FROM jsonb_to_recordset(?::jsonb) x(food_id bigint,nutrient_code text,numeric_value double precision,raw_value text,status text)
      ON CONFLICT(food_id,nutrient_code) DO UPDATE SET numeric_value=excluded.numeric_value,raw_value=excluded.raw_value,status=excluded.status,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(rows.slice(offset,offset+2000)));
    await db.prepare(`UPDATE foods SET active=false,updated_at=CURRENT_TIMESTAMP WHERE source='TACO' AND active`).run();
    await db.prepare(`UPDATE foods SET active=false,updated_at=CURRENT_TIMESTAMP WHERE source='TBCA' AND NOT(source_code=ANY(?::text[]))`).run(dataset.map(f=>f.codigo));
    await db.prepare(`INSERT INTO nutrition_import_runs(source,source_file,source_size,foods_processed,foods_created,foods_updated,nutrients_created,values_created,values_updated,missing_values,trace_values,zero_values,errors)
      VALUES('TBCA',?,?,?,?,?,?,?,?,?,?,?,?)`).run(basename(filePath),statSync(filePath).size,report.foodsProcessed,report.foodsCreated,report.foodsUpdated,report.nutrients,report.valuesCreated,report.valuesUpdated,report.missing,report.trace,report.zero,report.errors);
  });
  return report;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) importTbca().then(r=>console.log(JSON.stringify(r,null,2))).finally(closeDatabase);
