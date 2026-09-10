'use client';
import { gramMeasure, measureGrams, measureLabel, type FoodMeasure } from '../../../shared/food-measures';
export { gramMeasure, measureGrams };
export function safeGrams(value: string, measure: FoodMeasure) {
  try { return measureGrams(Number(value.replace(',', '.')), measure); } catch { return 0; }
}
export function MeasureInput({id, value, measure, measures, onChange}: {
  id: string; value: string; measure: FoodMeasure; measures: FoodMeasure[];
  onChange: (value: string, measure: FoodMeasure) => void;
}) {
  const grams = safeGrams(value, measure);
  return <div className="measure-control">
    <div className="measure-control-row">
      <input id={id} aria-label="Quantidade" inputMode="decimal" type="text" value={value} placeholder="0"
        onChange={e => { if (/^\d*([.,]\d*)?$/.test(e.target.value)) onChange(e.target.value,measure); }} />
      <select aria-label="Medida" value={measure.id} onChange={e => {
        const next = measures.find(m => m.id === Number(e.target.value)) ?? gramMeasure;
        const quantity = Number(value.replace(',', '.'));
        onChange(value && quantity > 0 ? String(quantity * (measure.grams / measure.quantity) / (next.grams / next.quantity)) : value, next);
      }}>
        {measures.map(m => <option key={m.id} value={m.id}>{measureLabel(Number(value.replace(',', '.')),m)}</option>)}
      </select>
    </div>
    {measure.kind !== 'mass' && grams > 0 && <small>≈ {new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(grams)} g</small>}
  </div>;
}
