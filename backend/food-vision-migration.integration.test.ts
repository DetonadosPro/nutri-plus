import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadEnvFile} from 'node:process';
import pg from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const enabled=process.env.RUN_POSTGRES_MIGRATION_TESTS==='1';
const projectDir=join(import.meta.dirname,'..');
const envPath=join(projectDir,'.env.local');
if(enabled)loadEnvFile(envPath);
const sourceUrl=process.env.DATABASE_URL||process.env.DATABASE_URL_DEV||'';
const admin=sourceUrl?new pg.Pool({connectionString:sourceUrl}):null;
const schemas=[`nutri_m024_clean_${randomUUID().replaceAll('-','').slice(0,12)}`,`nutri_m024_existing_${randomUUID().replaceAll('-','').slice(0,12)}`];
const migrationDir=join(import.meta.dirname,'migrations','postgres');
const migrations=readdirSync(migrationDir).filter(file=>file.endsWith('.sql')).sort();

function schemaUrl(name:string){const url=new URL(sourceUrl);url.searchParams.set('options',`-csearch_path=${name},public`);return url.toString()}
async function createSchema(name:string){await admin!.query(`CREATE SCHEMA ${name}`)}
async function dropSchema(name:string){await admin!.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`)}
async function applyThrough(client:pg.Client,last:string){
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for(const file of migrations){
    if(file>last)break;
    await client.query('BEGIN');
    try{await client.query(readFileSync(join(migrationDir,file),'utf8'));await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[file]);await client.query('COMMIT')}
    catch(error){await client.query('ROLLBACK');throw error}
  }
}
function runNormalMigration(name:string){
  const runner=`import('./backend/db.ts').then(async database=>{await database.migrate();await database.closeDatabase()})`;
  execFileSync(process.execPath,['--import','tsx','--eval',runner],{cwd:projectDir,env:{...process.env,DATABASE_URL:schemaUrl(name)},stdio:'pipe'});
}

describe.runIf(enabled)('migrations 024 a 026 em PostgreSQL temporário',()=>{
  beforeAll(async()=>{for(const name of schemas)await createSchema(name)},30_000);
  afterAll(async()=>{for(const name of schemas)await dropSchema(name);await admin!.end()},30_000);

  it('aplica todo o fluxo em banco limpo e registra a migration',async()=>{
    runNormalMigration(schemas[0]);
    const client=new pg.Client({connectionString:schemaUrl(schemas[0])});await client.connect();
    const columns=await client.query(`SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='food_vision_predictions' AND column_name IN ('detected_payload','suggested_family','chosen_family','candidate_food_ids','manual_search') ORDER BY column_name`);
    expect(columns.rows).toHaveLength(5);
    expect(columns.rows.find(row=>row.column_name==='detected_payload')).toMatchObject({is_nullable:'NO'});
    expect(columns.rows.find(row=>row.column_name==='candidate_food_ids')).toMatchObject({is_nullable:'NO'});
    expect(columns.rows.find(row=>row.column_name==='manual_search')).toMatchObject({is_nullable:'NO'});
    expect((await client.query(`SELECT count(*)::int AS count FROM schema_migrations WHERE version='024_food_vision_feedback_context.sql'`)).rows[0].count).toBe(1);
    expect((await client.query(`SELECT count(*)::int AS count FROM schema_migrations WHERE version='025_simple_omelet.sql'`)).rows[0].count).toBe(1);
    expect((await client.query(`SELECT count(*)::int AS count FROM schema_migrations WHERE version='026_meal_plans.sql'`)).rows[0].count).toBe(1);
    expect((await client.query(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('meal_plans','meal_plan_meals','meal_plan_items')`)).rows[0].count).toBe(3);
    expect((await client.query(`SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='meal_plan_items' AND column_name='nutrient_snapshot'`)).rows[0]).toMatchObject({data_type:'jsonb',is_nullable:'YES'});
    expect((await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='meal_plans_one_active_per_patient'`)).rows[0].indexdef).toContain("WHERE (status = 'active'::text)");
    expect((await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_food_vision_feedback_family_cut'`)).rows[0].indexdef).toContain('WHERE (final_food_id IS NOT NULL)');
    await client.end();
  },60_000);

  it('preserva dados antigos, usa defaults e permite reversão transacional segura',async()=>{
    const client=new pg.Client({connectionString:schemaUrl(schemas[1])});await client.connect();
    await applyThrough(client,'023_tbca_search_curation.sql');
    const analysis=(await client.query(`INSERT INTO food_vision_analyses(analysis_token,model,reasoning_effort,first_latency_ms,detected_count) VALUES($1,'legacy','none',10,1) RETURNING id`,[randomUUID()])).rows[0];
    const prediction=(await client.query(`INSERT INTO food_vision_predictions(analysis_id,item_token,decision_state,top1_score,top2_score,margin,visual_confidence) VALUES($1,$2,'ASK_IDENTITY',.7,.6,.1,.8) RETURNING *`,[analysis.id,randomUUID()])).rows[0];
    await client.query(`INSERT INTO foods(source,source_code,description,normalized_name) VALUES('TBCA','BRC0065J','Ovo de galinha mexido sem óleo sem sal','ovo de galinha mexido sem oleo sem sal')`);
    await client.end();
    runNormalMigration(schemas[1]);
    const migrated=new pg.Client({connectionString:schemaUrl(schemas[1])});await migrated.connect();
    const row=(await migrated.query('SELECT * FROM food_vision_predictions WHERE id=$1',[prediction.id])).rows[0];
    for(const key of Object.keys(prediction))expect(row[key]).toEqual(prediction[key]);
    expect(row).toMatchObject({detected_payload:{},suggested_family:null,chosen_family:null,candidate_food_ids:[],manual_search:false});
    const omelet=(await migrated.query(`SELECT f.display_name,m.key,m.kind,m.name,m.quantity::float8 AS quantity,m.grams::float8 AS grams,m.is_default FROM foods f JOIN food_measures m ON m.food_id=f.id WHERE f.source='TBCA' AND f.source_code='BRC0065J'`)).rows[0];
    expect(omelet).toMatchObject({display_name:'Omelete',key:'omelet-egg-count',kind:'count',name:'ovo',quantity:1,grams:50,is_default:true});
    expect((await migrated.query(`SELECT count(*)::int AS count FROM meal_entries`)).rows[0].count).toBe(0);
    expect((await migrated.query(`SELECT count(*)::int AS count FROM foods WHERE source_code='BRC0065J'`)).rows[0].count).toBe(1);
    await expect(migrated.query(`INSERT INTO food_vision_predictions(analysis_id,item_token,decision_state,top1_score,top2_score,margin,visual_confidence,suggested_family) VALUES($1,$2,'ASK_IDENTITY',.7,.6,.1,.8,'fish')`,[analysis.id,randomUUID()])).rejects.toThrow();
    await migrated.query('BEGIN');
    await migrated.query('DROP INDEX idx_food_vision_feedback_family_cut');
    await migrated.query('ALTER TABLE food_vision_predictions DROP COLUMN detected_payload,DROP COLUMN suggested_family,DROP COLUMN chosen_family,DROP COLUMN candidate_food_ids,DROP COLUMN manual_search');
    await migrated.query('ROLLBACK');
    expect((await migrated.query(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='food_vision_predictions' AND column_name='detected_payload'`)).rows[0].count).toBe(1);
    await migrated.end();
  },60_000);
});
