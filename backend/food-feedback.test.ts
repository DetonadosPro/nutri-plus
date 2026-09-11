import {describe,expect,it} from 'vitest';
import {feedbackBoostFromUses,MAX_FEEDBACK_TIE_BREAK,MIN_FEEDBACK_CONTEXT_USES} from '../shared/food-feedback';
import {foodMatchesMeatFamily,rankSemanticFoodCandidates,type DetectedFood} from '../shared/food-recognition';

const item:DetectedFood={name:'carne suína',preparation:'grelhada',visibleDetails:['bisteca com osso'],confidence:.9,alternative:null,componentRole:'independent',identityAmbiguity:null,meatVisual:{familyCandidate:'pork',familyConfidence:1,cutStyle:'steak',visibleFatLevel:'medium',bone:'with',shapeHints:['bisteca']}};
const food=(description:string,feedbackScore=0)=>({description,displayName:description,source_code:description,feedbackScore});

describe('aprendizado operacional determinístico',()=>{
  it('usa correções anteriores apenas como desempate limitado',()=>{
    expect(feedbackBoostFromUses(0)).toBe(0);
    expect(MIN_FEEDBACK_CONTEXT_USES).toBe(3);
    expect(feedbackBoostFromUses(1)).toBe(0);
    expect(feedbackBoostFromUses(2)).toBe(0);
    expect(feedbackBoostFromUses(3)).toBeGreaterThan(0);
    expect(feedbackBoostFromUses(30)).toBeLessThanOrEqual(MAX_FEEDBACK_TIE_BREAK);
    expect(feedbackBoostFromUses(Number.NaN)).toBe(0);
  });
  it('não deixa uma correção isolada alterar materialmente o top 3',()=>{
    const foods=[food('Bisteca suína grelhada com osso'),food('Bisteca suína assada com osso'),food('Lombo suíno grelhado sem osso')];
    const normal=rankSemanticFoodCandidates(item,foods).map(result=>result.food.source_code);
    foods[2].feedbackScore=feedbackBoostFromUses(1);
    expect(rankSemanticFoodCandidates(item,foods).map(result=>result.food.source_code)).toEqual(normal);
  });
  it('usa histórico coerente apenas para desempatar candidatos semanticamente equivalentes',()=>{
    const first=food('Bisteca suína grelhada com osso A'),second=food('Bisteca suína grelhada com osso B',feedbackBoostFromUses(8));
    expect(rankSemanticFoodCandidates(item,[first,second])[0].food).toBe(second);
  });
  it('não supera incompatibilidade forte de corte, osso ou preparo',()=>{
    const compatible=food('Bisteca suína grelhada com osso');
    const incompatible=food('Lombo suíno cozido sem osso',MAX_FEEDBACK_TIE_BREAK);
    expect(rankSemanticFoodCandidates(item,[incompatible,compatible])[0].food).toBe(compatible);
  });
  it('não permite que feedback atravesse a família escolhida',()=>{
    const pork=food('Bisteca suína grelhada com osso');
    const beef=food('Bife bovino grelhado com osso',MAX_FEEDBACK_TIE_BREAK);
    const familyPool=[pork,beef].filter(candidate=>foodMatchesMeatFamily(candidate,'pork'));
    expect(rankSemanticFoodCandidates(item,familyPool)[0].food).toBe(pork);
  });
  it('não muda o ranking determinístico quando não há histórico',()=>{
    const foods=[food('Bisteca suína grelhada com osso'),food('Lombo suíno grelhado sem osso')];
    expect(rankSemanticFoodCandidates(item,foods).map(result=>result.food.source_code)).toEqual(rankSemanticFoodCandidates(item,foods.map(({feedbackScore,...entry})=>entry)).map(result=>result.food.source_code));
  });
});
