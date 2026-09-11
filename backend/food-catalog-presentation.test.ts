import {describe,expect,it} from 'vitest';
import {patientFoodName,presentFoodSearchResults,shouldHideRawFood} from '../shared/food-catalog-presentation';

describe('apresentação canônica do catálogo ao paciente',()=>{
  it('remove atributos técnicos invisíveis e colapsa suas variantes',()=>{
    const foods=[
      {source_code:'A',description:'Peito bovino sem gordura grelhada sem sal',displayName:'Peito bovino sem gordura grelhada sem sal'},
      {source_code:'B',description:'Peito bovino sem gordura grelhada com manteiga sem sal',displayName:'Peito bovino sem gordura grelhada com manteiga sem sal'},
      {source_code:'C',description:'Peito bovino sem gordura cozida sem óleo com sal',displayName:'Peito bovino sem gordura cozida sem óleo com sal'},
    ];
    const visible=presentFoodSearchResults(foods,'peito bovino');
    expect(visible.map(food=>food.displayName)).toEqual(['Peito bovino grelhado','Peito bovino cozido']);
    expect(visible.map(food=>food.source_code)).toEqual(['A','C']);
  });

  it('mostra vegetais naturalmente crus sem cru no título',()=>{
    expect(patientFoodName({description:'Pepino com casca cru'})).toBe('Pepino');
    expect(patientFoodName({description:'Alface crespa crua'})).toBe('Alface crespa');
    expect(patientFoodName({description:'Tomate cru'})).toBe('Tomate');
  });

  it('oculta alimentos que exigem cocção, salvo busca explícita por cru',()=>{
    const rice={description:'Arroz branco cru'};
    const beef={description:'Peito bovino sem gordura crua'};
    expect(shouldHideRawFood(rice,'arroz')).toBe(true);
    expect(shouldHideRawFood(beef,'peito bovino')).toBe(true);
    expect(shouldHideRawFood(rice,'arroz cru')).toBe(false);
    expect(shouldHideRawFood({description:'Pepino cru'},'pepino')).toBe(false);
  });

  it('humaniza cortes suínos sem alterar a identidade',()=>{
    expect(patientFoodName({description:'Bisteca suíno grelhada sem óleo com sal'})).toBe('Bisteca suína grelhada');
    expect(patientFoodName({description:'Lombo suíno assada sem sal'})).toBe('Lombo suíno assado');
    expect(patientFoodName({description:'Pernil suíno assada'})).toBe('Pernil suíno assado');
  });
});
