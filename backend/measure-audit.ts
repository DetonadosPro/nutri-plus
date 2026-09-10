import { createHash } from 'node:crypto';
import { db, closeDatabase } from './db';

try {
  const entries = await db.prepare(`SELECT id,amount,unit,grams_equivalent,measure_snapshot
    FROM meal_entries ORDER BY id`).all<Record<string, unknown>>();
  const measures = await db.prepare('SELECT id,food_id,key,kind,name,plural,quantity,grams,source,reference,is_default FROM food_measures ORDER BY food_id,key').all<Record<string, unknown>>();
  const identities = measures.map(({ id, food_id, key }) => ({ id, food_id, key }));
  const preservationMaxId = Number(process.env.NUTRI_MEASURE_AUDIT_MAX_ID || 0);
  const preservedIdentities = preservationMaxId > 0
    ? identities.filter(identity => Number(identity.id) <= preservationMaxId)
    : identities;
  const historyFingerprint = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  console.log(JSON.stringify({
    foods: await db.prepare(`SELECT
      count(*)::int AS "activeTbca",
      count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id))::int AS "onlyGrams",
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id))::int AS "withAdditionalMeasure",
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id AND m.kind='household'))::int AS "withHousehold",
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id AND m.kind='volume'))::int AS "withVolume",
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id AND m.kind='count'))::int AS "withCount",
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id AND m.kind='count' AND m.name='unidade'))::int AS "withUnit",
      count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM food_measures m WHERE m.food_id=f.id))::int AS "withoutAdditionalClassification"
      FROM foods f WHERE active AND source='TBCA'`).get(),
    measures: {
      total: measures.length,
      fingerprint: createHash('sha256').update(JSON.stringify(measures)).digest('hex'),
      minId: measures.length ? Math.min(...measures.map(measure => Number(measure.id))) : null,
      maxId: measures.length ? Math.max(...measures.map(measure => Number(measure.id))) : null,
      identityFingerprint: createHash('sha256').update(JSON.stringify(identities)).digest('hex'),
      preservedThroughId: preservationMaxId || null,
      preservedCount: preservedIdentities.length,
      preservedIdentityFingerprint: createHash('sha256').update(JSON.stringify(preservedIdentities)).digest('hex'),
      byKind: await db.prepare('SELECT kind,count(*)::int AS measures,count(DISTINCT food_id)::int AS foods FROM food_measures GROUP BY kind ORDER BY kind').all(),
      bySource: await db.prepare('SELECT source,count(*)::int AS measures,count(DISTINCT food_id)::int AS foods FROM food_measures GROUP BY source ORDER BY source').all(),
    },
    history: {
      entries: entries.length,
      grams: entries.reduce((sum, entry) => sum + Number(entry.grams_equivalent), 0),
      snapshots: entries.filter(entry => entry.measure_snapshot != null).length,
      fingerprint: historyFingerprint,
    },
  }, null, 2));
} finally { await closeDatabase(); }
