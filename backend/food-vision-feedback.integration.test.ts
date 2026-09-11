import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {DetectedFood} from '../shared/food-recognition';

it.skipIf(process.env.NUTRI_RUN_VISION_FEEDBACK_TESTS!=='true')('persiste contexto, família, candidatos e correção sem guardar imagem',async()=>{
  const {db,transaction,closeDatabase,databaseInfo,migrate}=await import('./db');
  const {meatFeedbackBoosts}=await import('./food-identity-repository');
  if(databaseInfo.host!=='127.0.0.1')throw new Error('Teste exige PostgreSQL local.');
  await migrate();
  const rollback=new Error('rollback vision feedback fixture');
  try{
    await expect(transaction(async()=>{
      const foods=await db.prepare("SELECT id FROM foods WHERE source='TBCA' AND source_code IN ('BRC0160F','BRC0163F','BRC0167F') ORDER BY source_code").all<{id:number}>();
      expect(foods).toHaveLength(3);
      const detected:DetectedFood={name:'carne',preparation:'grelhada',visibleDetails:['peça com osso'],confidence:.8,alternative:null,componentRole:'independent',identityAmbiguity:'meat_family',meatVisual:{familyCandidate:'pork',familyConfidence:.55,cutStyle:'steak',visibleFatLevel:'medium',bone:'with',shapeHints:['bisteca']}};
      await db.prepare(`DELETE FROM food_vision_predictions WHERE chosen_family='pork' AND detected_payload->'meatVisual'->>'cutStyle'='steak' AND detected_payload->'meatVisual'->'shapeHints' @> '["bisteca"]'::jsonb`).run();
      const addFeedback=async()=>{
        const analysis=(await db.prepare(`INSERT INTO food_vision_analyses(analysis_token,model,reasoning_effort,first_latency_ms,detected_count) VALUES(?,'test','none',1,1) RETURNING id`).get<{id:number}>(randomUUID()))!;
        const prediction=(await db.prepare(`INSERT INTO food_vision_predictions(analysis_id,item_token,decision_state,top1_score,top2_score,margin,visual_confidence,detected_payload,suggested_family,candidate_food_ids) VALUES(?,?,'ASK_IDENTITY',.7,.6,.1,.8,?::jsonb,'pork',?) RETURNING id`).get<{id:number}>(analysis.id,randomUUID(),JSON.stringify(detected),foods.map(food=>food.id)))!;
        await db.prepare('UPDATE food_vision_predictions SET chosen_family=?,final_food_id=?,manual_search=true,changed=true WHERE id=?').run('pork',foods[0].id,prediction.id);
        return prediction;
      };
      const prediction=await addFeedback();
      const stored=await db.prepare('SELECT detected_payload,suggested_family,chosen_family,candidate_food_ids,final_food_id,manual_search FROM food_vision_predictions WHERE id=?').get<any>(prediction.id);
      expect(stored).toMatchObject({suggested_family:'pork',chosen_family:'pork',final_food_id:foods[0].id,manual_search:true});
      expect(stored.candidate_food_ids.map(Number)).toEqual(foods.map(food=>food.id));
      expect(stored.detected_payload).toMatchObject({meatVisual:{cutStyle:'steak',shapeHints:['bisteca']}});
      expect((await meatFeedbackBoosts(detected,'pork')).get(foods[0].id)).toBe(0);
      await addFeedback();await addFeedback();
      expect((await meatFeedbackBoosts(detected,'pork')).get(foods[0].id)).toBeGreaterThan(0);
      const otherShape={...detected,meatVisual:{...detected.meatVisual!,shapeHints:['lombo'] as ('lombo')[]}};
      expect((await meatFeedbackBoosts(otherShape,'pork')).get(foods[0].id)??0).toBe(0);
      expect((await meatFeedbackBoosts(detected,'beef')).get(foods[0].id)??0).toBe(0);
      throw rollback;
    })).rejects.toBe(rollback);
  }finally{await closeDatabase();}
});
