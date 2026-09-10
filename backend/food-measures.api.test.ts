import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

it.skipIf(!process.env.NUTRI_MEASURE_TEST_API)('API: criar, editar, mover, copiar e remover preservando medidas e histórico', async () => {
  const {db,closeDatabase,databaseInfo} = await import('./db');
  const {createSession} = await import('./auth');
  const base=process.env.NUTRI_MEASURE_TEST_API!;
  if (databaseInfo.host !== '127.0.0.1' || new URL(base).hostname !== '127.0.0.1') throw new Error('Teste somente local.');
  const tag=randomUUID();
  let userId:number|undefined, foodId:number|undefined;
  try {
    userId=(await db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES('Teste medidas',?,'disabled','nutritionist') RETURNING id").get<{id:number}>(`measure-test-${tag}@local.test`))!.id;
    await db.prepare('INSERT INTO patients(user_id,nutritionist_user_id) VALUES(?,?)').run(userId,userId);
    foodId=(await db.prepare("INSERT INTO foods(source,source_code,description,normalized_name,display_name) VALUES('TBCA',?,'TESTE SINTÉTICO MEDIDAS','teste sintetico medidas','TESTE SINTÉTICO MEDIDAS') RETURNING id").get<{id:number}>(`TEST-${tag}`))!.id;
    await db.prepare("INSERT INTO food_nutrients(food_id,nutrient_code,numeric_value,raw_value,status) VALUES(?,'energia_kcal',200,'200','numeric')").run(foodId);
    const measure=(await db.prepare("INSERT INTO food_measures(food_id,key,kind,name,plural,quantity,grams,source,reference,is_default) VALUES(?,'test','count','unidade','unidades',1,50,'manual','SYNTHETIC TEST ONLY',true) RETURNING id").get<{id:number}>(foodId))!;
    const session=await createSession(userId);
    async function request(path:string,method:string,body?:unknown) {
      const response=await fetch(base+path,{method,headers:{Cookie:`nutri_session=${session.token}`,'Content-Type':'application/json'},body:body == null ? undefined : JSON.stringify(body)});
      return {status:response.status,body:response.status===204 ? null : await response.json()};
    }
    const rice=(await db.prepare("SELECT id FROM foods WHERE source='TBCA' AND source_code='BRC0018A'").get<{id:number}>())!;
    const whiteRiceSearch=await request('/foods?search=arroz%20branco','GET');
    expect(whiteRiceSearch.status).toBe(200);
    expect(whiteRiceSearch.body[0]).toEqual(expect.objectContaining({source_code:'BRC0018A',displayName:'Arroz Branco'}));
    expect(whiteRiceSearch.body.some((food:any)=>food.source_code==='BRC0001A')).toBe(false);
    const riceMeasure=(await db.prepare("SELECT id FROM food_measures WHERE food_id=? AND name='colher de sopa cheia'").get<{id:number}>(rice.id))!;
    const listedMeasures=await request(`/foods/${rice.id}/measures`,'GET');
    expect(listedMeasures.status).toBe(200);
    expect(listedMeasures.body).toEqual(expect.arrayContaining([
      expect.objectContaining({id:riceMeasure.id,name:'colher de sopa cheia',plural:'colheres de sopa cheias',grams:20,source:'TBCA'}),
    ]));
    const realFood=await request('/meals','POST',{date:'2026-09-12',mealType:'breakfast',items:[{foodId:rice.id,quantity:1,measureId:riceMeasure.id}]});
    expect(realFood.status).toBe(201);
    const riceEntry=realFood.body.meals[0].entries[0];
    expect(riceEntry.amount).toBe(1);
    expect(riceEntry.unit).toBe('colher de sopa cheia');
    expect(riceEntry.grams_equivalent).toBe(20);
    expect(riceEntry.measure_snapshot).toEqual(expect.objectContaining({name:'colher de sopa cheia',grams:20,source:'TBCA'}));
    expect(riceEntry.nutrients.energia_kcal).toBeCloseTo(26,2);
    const liquid=(await db.prepare("SELECT id FROM foods WHERE source='TBCA' AND source_code='BRC0027G'").get<{id:number}>())!;
    const liquidNutrient=(await db.prepare("SELECT numeric_value FROM food_nutrients WHERE food_id=? AND nutrient_code='energia_kcal'").get<{numeric_value:number}>(liquid.id))!;
    const liquidMeasures=await request(`/foods/${liquid.id}/measures`,'GET');
    expect(liquidMeasures.status).toBe(200);
    const ml=liquidMeasures.body.find((item:any)=>item.kind==='volume');
    const cup=liquidMeasures.body.find((item:any)=>item.name==='copo americano pequeno');
    expect(ml).toEqual(expect.objectContaining({name:'mL',plural:'mL',quantity:165,grams:165,source:'TBCA'}));
    expect(cup).toEqual(expect.objectContaining({grams:165,source:'TBCA'}));
    const searched=await request('/foods?search=leite%20b%C3%BAfala%20integral','GET');
    expect(searched.status).toBe(200);
    expect(searched.body.find((food:any)=>food.id===liquid.id)?.measures).toEqual(expect.arrayContaining([expect.objectContaining({id:ml.id,kind:'volume',name:'mL'})]));
    const genericMilk=await request('/foods?search=leite%20integral','GET');
    expect(genericMilk.status).toBe(200);
    expect(genericMilk.body[0]).toEqual(expect.objectContaining({source_code:'BRC0027G',displayName:'Leite búfala integral'}));
    expect(genericMilk.body.findIndex((food:any)=>food.displayName.startsWith('Lanche brasileiro'))).toBeGreaterThan(0);
    const liquidAdded=await request('/meals','POST',{date:'2026-09-13',mealType:'breakfast',items:[{foodId:liquid.id,quantity:100,measureId:ml.id}]});
    expect(liquidAdded.status).toBe(201);
    let liquidMeal=liquidAdded.body.meals[0], liquidEntry=liquidMeal.entries[0];
    expect(liquidEntry).toEqual(expect.objectContaining({amount:100,unit:'mL',grams_equivalent:100}));
    expect(liquidEntry.measure_snapshot).toEqual(expect.objectContaining({kind:'volume',name:'mL',plural:'mL',quantity:165,grams:165,source:'TBCA'}));
    expect(liquidEntry.nutrients.energia_kcal).toBeCloseTo(liquidNutrient.numeric_value,10);
    const liquidDecimal=await request(`/meal-entries/${liquidEntry.id}`,'PATCH',{quantity:125.5,measureId:ml.id});
    liquidEntry=liquidDecimal.body.meals[0].entries[0];
    expect(liquidEntry).toEqual(expect.objectContaining({amount:125.5,unit:'mL',grams_equivalent:125.5}));
    const toCup=await request(`/meal-entries/${liquidEntry.id}`,'PATCH',{quantity:1,measureId:cup.id});
    liquidEntry=toCup.body.meals[0].entries[0];
    expect(liquidEntry).toEqual(expect.objectContaining({amount:1,unit:'copo americano pequeno',grams_equivalent:165}));
    const backToMl=await request(`/meal-entries/${liquidEntry.id}`,'PATCH',{quantity:200.5,measureId:ml.id});
    liquidMeal=backToMl.body.meals[0]; liquidEntry=liquidMeal.entries[0];
    expect(liquidEntry).toEqual(expect.objectContaining({amount:200.5,unit:'mL',grams_equivalent:200.5}));
    expect(liquidEntry.measure_snapshot).toEqual(expect.objectContaining({name:'mL',grams:165}));
    const liquidCopy=await request(`/meals/${liquidMeal.id}/copy`,'POST',{targetDate:'2026-09-14'});
    const copiedLiquid=liquidCopy.body.meals[0].entries[0];
    expect(copiedLiquid).toEqual(expect.objectContaining({amount:200.5,unit:'mL',grams_equivalent:200.5}));
    expect(copiedLiquid.measure_snapshot).toEqual(liquidEntry.measure_snapshot);
    expect((await request('/meals','POST',{date:'2026-09-15',mealType:'breakfast',items:[{foodId:liquid.id,quantity:5000.1,measureId:ml.id}]})).status).toBe(400);
    expect((await request('/meals','POST',{date:'2026-09-15',mealType:'breakfast',items:[{foodId:liquid.id,quantity:-1,measureId:ml.id}]})).status).toBe(400);
    const added=await request('/meals','POST',{date:'2026-09-10',mealType:'lunch',items:[{foodId,quantity:2,measureId:measure.id},{foodId,grams:20}]});
    expect(added.status).toBe(201);
    let meal=added.body.meals[0], entry=meal.entries.find((e:any)=>e.measure_snapshot);
    expect(entry.amount).toBe(2); expect(entry.grams_equivalent).toBe(100); expect(entry.nutrients.energia_kcal).toBe(200);
    const legacy=meal.entries.find((e:any)=>!e.measure_snapshot);
    expect(legacy.grams_equivalent).toBe(20);
    await db.prepare('UPDATE food_measures SET grams=60 WHERE id=?').run(measure.id);
    const edited=await request(`/meal-entries/${entry.id}`,'PATCH',{quantity:1.5,measureId:measure.id});
    expect(edited.status).toBe(200);
    entry=edited.body.meals[0].entries.find((e:any)=>e.id===entry.id);
    expect(entry.grams_equivalent).toBe(75); expect(entry.amount).toBe(1.5);
    const moved=await request(`/meal-entries/${entry.id}`,'PATCH',{mealType:'dinner'});
    expect(moved.status).toBe(200);
    meal=moved.body.meals.find((m:any)=>m.meal_type==='dinner');
    expect(meal.entries[0].amount).toBe(1.5); expect(meal.entries[0].measure_snapshot.grams).toBe(50);
    const copied=await request(`/meals/${meal.id}/copy`,'POST',{targetDate:'2026-09-11'});
    expect(copied.status).toBe(201); expect(copied.body.meals[0].entries[0].measure_snapshot.grams).toBe(50);
    const oldEdit=await request(`/meal-entries/${legacy.id}`,'PATCH',{grams:.5});
    expect(oldEdit.status).toBe(200);
    const invalid=await request('/meals','POST',{date:'2026-09-10',mealType:'lunch',items:[{foodId,quantity:1,measureId:99999999}]});
    expect(invalid.status).toBe(400);
    expect((await request(`/meal-entries/${entry.id}`,'DELETE')).status).toBe(204);
  } finally {
    if(userId) { await db.prepare('DELETE FROM patients WHERE user_id=?').run(userId); await db.prepare('DELETE FROM users WHERE id=?').run(userId); }
    if(foodId) await db.prepare('DELETE FROM foods WHERE id=?').run(foodId);
    await closeDatabase();
  }
},30_000);
