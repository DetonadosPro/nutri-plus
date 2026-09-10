import { it, expect } from 'vitest';

it.skipIf(process.env.NUTRI_RUN_MEASURE_TESTS !== 'true')('importação idempotente, validação, snapshot e rollback no PostgreSQL local', async () => {
  const {db,transaction,closeDatabase,databaseInfo,migrate} = await import('./db');
  const {importMeasures} = await import('./measure-import');
  const {resolveQuantity,measuresForFoods} = await import('./food-measures');
  if (databaseInfo.host !== '127.0.0.1') throw new Error('Teste exige PostgreSQL local.');
  await migrate();
  const rollback = new Error('rollback fixture');
  try {
    await expect(transaction(async () => {
      const food = (await db.prepare("SELECT id,source_code FROM foods WHERE active AND source='TBCA' ORDER BY id LIMIT 1").get<{id:number;source_code:string}>())!;
      const fixture = {foodSource:'TBCA',foodCode:food.source_code,key:'test-only',kind:'count',name:'unidade',plural:'unidades',quantity:1,grams:50,source:'manual',reference:'SYNTHETIC TEST ONLY',reviewed:true,isDefault:true};
      await importMeasures([fixture]); await importMeasures([fixture]);
      const rows=(await measuresForFoods([food.id])).get(food.id)!;
      const measure=rows.find(r=>r.reference==='SYNTHETIC TEST ONLY')!;
      expect(rows.filter(r=>r.reference==='SYNTHETIC TEST ONLY')).toHaveLength(1);
      const first=await resolveQuantity(food.id,{quantity:2,measureId:measure.id});
      expect(first.grams).toBe(100);
      await importMeasures([{...fixture,grams:60}]);
      expect((await resolveQuantity(food.id,{quantity:2,measureId:measure.id},first.snapshot)).grams).toBe(100);
      expect((await resolveQuantity(food.id,{quantity:2,measureId:measure.id})).grams).toBe(120);
      expect((await resolveQuantity(food.id,{grams:12})).snapshot).toBeNull();
      await expect(resolveQuantity(food.id+1,{quantity:1,measureId:measure.id})).rejects.toThrow();
      await expect(importMeasures([fixture,fixture])).rejects.toThrow('duplicateKeys');
      await expect(importMeasures([{...fixture,grams:undefined}])).rejects.toThrow();
      await expect(importMeasures([{...fixture,reviewed:false}])).rejects.toThrow();
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await closeDatabase(); }
});
