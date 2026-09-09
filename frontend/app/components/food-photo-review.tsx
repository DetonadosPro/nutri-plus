'use client';
import '../food-photo.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Camera, Check, ImagePlus, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { brazilNow } from '@/lib/datetime';
import { formatNumber } from '@/lib/nutrition-format';
import { MEAL_TYPES } from '@/lib/meal-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { scaleNutrients } from '../../../shared/scale-nutrients';
import type { Food, Summary } from '../types';
import { foodDisplayName } from '@/lib/food-name';

type Detection = { itemToken:string;name:string;preparation:string|null;visualConfidence:number;state:'AUTOSELECT'|'RERANK'|'ASK_USER'|'NO_MATCH';top1Score:number;top2Score:number;margin:number;candidates:Food[] };
type Row = Detection & { key: string; food: Food | null; grams: string };

export function FoodPhotoReview({ date, initialMealType, initialPhoto, onBack, onAdded }: {
  date: string; initialMealType?: string; initialPhoto?: { file: File; token: number }; onBack: () => void; onAdded: (summary: Summary) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [analysisToken,setAnalysisToken]=useState('');
  const [analyzed, setAnalyzed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [mealType, setMealType] = useState(initialMealType || '');
  const [time, setTime] = useState(() => brazilNow().time);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[]>([]);
  const [searching, setSearching] = useState(false);
  const request = useRef<AbortController | null>(null);
  const saveLock = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const analyzedInitialPhoto = useRef<number | undefined>(undefined);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api<Food[]>(`/foods?search=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(setResults).catch(() => { if (!controller.signal.aborted) setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editing, query]);

  const analyze = useCallback(async (file?: File) => {
    if (!file || saving || saved) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Escolha uma foto JPEG, PNG ou WebP de até 5 MB.'); return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPreview(URL.createObjectURL(file)); setRows([]); setAnalysisToken(''); setAnalyzed(false); setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 100_000);
    try {
      const data = await api<{ analysisToken:string;items: Detection[] }>('/foods/recognize', {
        method: 'POST', headers: { 'Content-Type': file.type }, body: file, signal: controller.signal,
      });
      if (request.current !== controller) return;
      setAnalysisToken(data.analysisToken);
      setRows(data.items.map(item => ({ ...item, key: crypto.randomUUID(), food: ['AUTOSELECT','RERANK'].includes(item.state) ? item.candidates[0] || null : null, grams: '' })));
      setAnalyzed(true);
    } catch (reason) {
      if (request.current === controller) setError(controller.signal.aborted ? 'A análise demorou mais que o esperado. Você pode usar a busca manual.' : reason instanceof Error ? reason.message : 'Reconhecimento indisponível. Use a busca manual.');
    } finally { clearTimeout(timeout); if (request.current === controller) setBusy(false); }
  }, [saved, saving]);

  useEffect(() => {
    if (!initialPhoto || analyzedInitialPhoto.current === initialPhoto.token) return;
    analyzedInitialPhoto.current = initialPhoto.token;
    void analyze(initialPhoto.file);
  }, [initialPhoto, analyze]);

  function choose(food: Food) {
    if (editing === 'new') setRows(current => [...current, { key: crypto.randomUUID(),itemToken:crypto.randomUUID(),name:foodDisplayName(food),preparation:null,visualConfidence:1,state:'ASK_USER',top1Score:0,top2Score:0,margin:0,candidates:[],food,grams:'' }]);
    else setRows(current => current.map(row => row.key === editing ? { ...row, food } : row));
    setEditing(null); setQuery('');
  }
  const valid = rows.length > 0 && rows.every(row => row.food && Number(row.grams) > 0 && Number(row.grams) <= 5000);
  async function save() {
    if (!valid || !mealType || !time || saveLock.current) return;
    saveLock.current = true; setSaving(true); setError('');
    try {
      const summary = await api<Summary>('/meals', { method: 'POST', body: JSON.stringify({
        date, mealType, consumedTime: time, items: rows.map(row => ({ foodId: row.food!.id, grams: Number(row.grams) })),
      }) });
      setSaved(true);
      if(analysisToken)void api('/foods/recognize/feedback',{method:'POST',body:JSON.stringify({analysisToken,items:rows.filter(row=>row.food).map(row=>({itemToken:row.itemToken,selectedFoodId:row.food!.id}))})}).catch(()=>undefined);
      await onAdded(summary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); saveLock.current = false; }
  }

  if (saved) return <div className="photo-empty"><output>Refeição registrada! Seus alimentos foram adicionados ao Diário.</output><Button onClick={onBack}>Concluir</Button></div>;
  if (editing) return <section className="photo-search">
    <Button variant="ghost" onClick={() => setEditing(null)}><ArrowLeft /> Voltar à revisão</Button>
    <label htmlFor="photo-food-search">{editing === 'new' ? 'Adicionar alimento' : 'Trocar alimento'}</label>
    <Input id="photo-food-search" placeholder="Busque arroz, feijão, frango…" value={query} onChange={e => setQuery(e.target.value)} />
    {searching && <output>Buscando…</output>}
    {!searching && !results.length && <p>Nenhum alimento encontrado. Tente outro nome.</p>}
    {results.map(food => <button className="photo-result" key={food.id} onClick={() => choose(food)}><strong>{foodDisplayName(food)}</strong><small>{formatNumber(food.nutrients.energia_kcal)} kcal / 100 g</small></button>)}
  </section>;

  return <section className="photo-review">
    <Button variant="ghost" onClick={onBack} disabled={saving}><ArrowLeft /> Busca manual</Button>
    <div className="photo-review-layout">
      <aside className="photo-capture">
        {preview ? <Image src={preview} unoptimized width={600} height={400} alt="Foto do prato para revisar" className="photo-preview" /> : <div className="photo-placeholder"><Camera /><strong>Seu prato, em poucos toques</strong><span>Tire uma foto e depois informe as quantidades.</span></div>}
        <input ref={camera} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => { void analyze(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={gallery} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void analyze(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="photo-capture-actions"><Button variant="outline" disabled={busy || saving} onClick={() => camera.current?.click()}><Camera /> Tirar foto</Button><Button variant="outline" disabled={busy || saving} onClick={() => gallery.current?.click()}><ImagePlus /> Galeria</Button></div>
        <p className="photo-hint">A foto é usada apenas para esta análise. Revise os alimentos antes de registrar.</p>
      </aside>
      <div className="photo-review-main">
        {busy && <div className="photo-empty"><LoaderCircle className="animate-spin" /><output>Reconhecendo seu prato…</output><p>Isso pode levar até um minuto e meio.</p></div>}
        {error && <p role="alert" className="photo-error">{error}</p>}
        {analyzed && !rows.length && <div className="photo-empty"><Search /><strong>Nenhum alimento identificado</strong><p>Tente uma foto mais nítida ou adicione pela busca.</p></div>}
        {rows.length > 0 && <p className="photo-hint">Confira os alimentos e preencha a quantidade de cada um. Você pode incluir o que ficou faltando.</p>}
        <div className="photo-items">{rows.map(row => <article className="photo-item" key={row.key}>
          <div className="photo-item-heading"><strong>{row.food ? <><Check className="inline size-4 text-primary"/> {foodDisplayName(row.food)}</> : row.name}</strong><button disabled={saving} className="icon-button" aria-label={`Remover ${row.name}`} onClick={() => setRows(items => items.filter(item => item.key !== row.key))}><Trash2 size={18} /></button></div>
          {!row.food && <div className="photo-candidates"><small>{row.state==='NO_MATCH'?'Não encontramos uma opção segura. Busque manualmente:':'Escolha o alimento correspondente:'}</small>{row.candidates.map(food => <button key={food.id} disabled={saving} onClick={() => setRows(items => items.map(item => item.key === row.key ? { ...item, food } : item))}>{foodDisplayName(food)}</button>)}{!row.candidates.length && <p>Use “Buscar alimento” para encontrar a opção correta.</p>}</div>}
          <div className="photo-item-actions"><Button variant="ghost" disabled={saving} onClick={() => { setEditing(row.key); setQuery(row.name); }}> {row.food ? 'Trocar alimento' : 'Buscar alimento'}</Button>
            <label htmlFor={`photo-grams-${row.key}`}>Quantidade (g)<Input id={`photo-grams-${row.key}`} aria-label={`Quantidade de ${row.name} em gramas`} type="number" inputMode="decimal" min="0.1" max="5000" step="any" placeholder="Ex.: 100" value={row.grams} disabled={saving} onChange={e => setRows(items => items.map(item => item.key === row.key ? { ...item, grams: e.target.value } : item))} /></label>
          </div>
          {row.food && Number(row.grams) > 0 && <p className="photo-hint">{formatNumber(scaleNutrients(row.food.nutrients, Number(row.grams)).values.energia_kcal)} kcal · {formatNumber(scaleNutrients(row.food.nutrients, Number(row.grams)).values.proteina_g, 1)} g proteína</p>}
        </article>)}</div>
        {!busy && <Button variant="outline" disabled={saving || rows.length >= 20} onClick={() => { setEditing('new'); setQuery(''); }}><Plus /> Adicionar alimento</Button>}
        {rows.length > 0 && <div className="photo-save"><label htmlFor="photo-meal">Refeição<select id="photo-meal" value={mealType} disabled={saving} onChange={e => setMealType(e.target.value)}><option value="">Escolha a refeição</option>{MEAL_TYPES.map(meal => <option key={meal.value} value={meal.value}>{meal.label}</option>)}</select></label><label htmlFor="photo-time">Horário<Input id="photo-time" type="time" value={time} disabled={saving} onChange={e => setTime(e.target.value)} /></label><Button disabled={!valid || !mealType || !time || saving} onClick={save}>{saving ? 'Registrando…' : 'Confirmar refeição'}</Button></div>}
      </div>
    </div>
  </section>;
}
