'use client';
import '../food-photo.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Camera, Check, ChevronRight, ImagePlus, LoaderCircle, Plus, Search, Sparkles, Trash2, UtensilsCrossed } from 'lucide-react';
import { api } from '@/lib/client-api';
import { formatNumber } from '@/lib/nutrition-format';
import { MEAL_TYPES } from '@/lib/meal-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { scaleNutrients } from '../../../shared/scale-nutrients';
import type { Food, Summary } from '../types';
import { foodDisplayName } from '@/lib/food-name';
import { MeasureInput, gramMeasure, safeGrams } from './measure-input';
import { measureLabel, type FoodMeasure } from '../../../shared/food-measures';
import { optimizeFoodPhoto } from '@/lib/food-photo';

type DetectionState = 'AUTOSELECT'|'RERANK'|'ASK_USER'|'ASK_IDENTITY'|'ASK_ATTRIBUTE'|'NO_EXACT_TBCA_MATCH'|'NO_MATCH';
type Detection = { itemToken:string;name:string;preparation:string|null;clarificationKind:'MEAT_TYPE'|null;visualConfidence:number;state:DetectionState;top1Score:number;top2Score:number;margin:number;resolutionPolicy?:string|null;abstentionReason?:string|null;candidates:Food[] };
type Row = Detection & { key: string; food: Food | null; grams: string; measure?: FoodMeasure; confirmed: boolean };

function choiceMessage(state:DetectionState){
  if(state==='NO_MATCH')return 'Não encontramos uma opção segura. Busque manualmente:';
  if(state==='NO_EXACT_TBCA_MATCH')return 'A foto não mostra detalhes suficientes. Escolha uma opção se souber:';
  if(state==='ASK_IDENTITY')return 'Qual alimento aparece na foto?';
  return 'Qual destas opções corresponde ao alimento?';
}

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
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[]>([]);
  const [searching, setSearching] = useState(false);
  const request = useRef<AbortController | null>(null);
  const saveLock = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const analyzedInitialPhoto = useRef<number | undefined>(undefined);

  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
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
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRows([]); setAnalysisToken(''); setAnalyzed(false); setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 100_000);
    try {
      const upload = await optimizeFoodPhoto(file, controller.signal);
      if (request.current !== controller) return;
      setPreview(URL.createObjectURL(upload));
      const data = await api<{ analysisToken:string;items: Detection[] }>('/foods/recognize', {
        method: 'POST', headers: { 'Content-Type': upload.type }, body: upload, signal: controller.signal,
      });
      if (request.current !== controller) return;
      setAnalysisToken(data.analysisToken);
      setRows(data.items.map(item => ({ ...item, key: crypto.randomUUID(), food: ['AUTOSELECT','RERANK'].includes(item.state) ? item.candidates[0] || null : null, grams: '', confirmed: false })));
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
    if (editing === 'new') setRows(current => [...current, { key: crypto.randomUUID(),itemToken:crypto.randomUUID(),name:foodDisplayName(food),preparation:null,clarificationKind:null,visualConfidence:1,state:'ASK_ATTRIBUTE',top1Score:0,top2Score:0,margin:0,candidates:[],food,grams:'',measure:food.measures?.find(m=>m.isDefault) ?? gramMeasure,confirmed:false }]);
    else setRows(current => current.map(row => row.key === editing ? { ...row, food, grams:"", measure:food.measures?.find(m=>m.isDefault) ?? gramMeasure, confirmed:false } : row));
    setEditing(null); setQuery('');
  }
  const valid = rows.length > 0 && rows.every(row => row.confirmed && row.food && safeGrams(row.grams,row.measure ?? gramMeasure) > 0);
  const activeRow=rows.find(row=>!row.confirmed);
  const activeIndex=activeRow?rows.findIndex(row=>row.key===activeRow.key):-1;
  const completed=rows.filter(row=>row.confirmed).length;
  const activeFoodId=activeRow?.food?.id;
  const activeKey=activeRow?.key;
  const hasMeasures=Boolean(activeRow?.food?.measures);
  useEffect(()=>{
    if(!activeFoodId || !activeKey || hasMeasures) return;
    let live=true;
    api<FoodMeasure[]>(`/foods/${activeFoodId}/measures`).then(measures=>{
      if(live) setRows(items=>items.map(row=>row.key===activeKey && row.food?.id===activeFoodId ? {...row,food:{...row.food,measures},measure:row.grams ? row.measure ?? gramMeasure : measures.find(m=>m.isDefault) ?? gramMeasure}:row));
    }).catch(()=>{});
    return ()=>{live=false};
  },[activeFoodId,activeKey,hasMeasures]);


  function updateGrams(key:string,value:string,measure:FoodMeasure){setRows(items=>items.map(item=>item.key===key?{...item,grams:value,measure}:item))}

  function confirmRow(row:Row){if(!row.food||safeGrams(row.grams,row.measure ?? gramMeasure)<=0)return;setRows(items=>items.map(item=>item.key===row.key?{...item,confirmed:true}:item))}
  function editRow(key:string){setRows(items=>items.map(item=>item.key===key?{...item,confirmed:false}:item))}
  async function save() {
    if (!valid || !mealType || saveLock.current) return;
    saveLock.current = true; setSaving(true); setError('');
    try {
      const summary = await api<Summary>('/meals', { method: 'POST', body: JSON.stringify({
        date, mealType, items: rows.map(row => ({ foodId: row.food!.id, quantity: Number(row.grams.replace(',', '.')), measureId: (row.measure ?? gramMeasure).id })),
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

  return <section className="photo-review photo-flow">
    <header className="photo-flow-header">
      <Button variant="ghost" onClick={onBack} disabled={saving}><ArrowLeft /> Busca manual</Button>
      {!!rows.length&&<span>{completed} de {rows.length} prontos</span>}
    </header>
    <div className="photo-scene">
      <div className="photo-scene-image">
        {preview?<Image src={preview} unoptimized width={800} height={520} alt="Foto do prato para revisar" className="photo-preview"/>:<Camera/>}
        {preview&&<div className="photo-scene-badge"><Sparkles/> {rows.length} {rows.length===1?'alimento':'alimentos'}</div>}
      </div>
      <input ref={camera} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{void analyze(e.target.files?.[0]);e.target.value=''}}/>
      <input ref={gallery} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void analyze(e.target.files?.[0]);e.target.value=''}}/>
      <div className="photo-scene-actions"><button disabled={busy||saving} onClick={()=>camera.current?.click()}><Camera/> Nova foto</button><button disabled={busy||saving} onClick={()=>gallery.current?.click()}><ImagePlus/> Galeria</button></div>
    </div>

    {busy&&<div className="photo-empty photo-loading"><LoaderCircle className="animate-spin"/><output>Reconhecendo seu prato…</output><p>Separando os alimentos para você.</p></div>}
    {error&&<p role="alert" className="photo-error">{error}</p>}
    {analyzed&&!rows.length&&<div className="photo-empty"><Search/><strong>Nenhum alimento identificado</strong><p>Tente uma foto mais nítida ou use a busca.</p><Button variant="outline" onClick={()=>{setEditing('new');setQuery('')}}><Plus/> Adicionar alimento</Button></div>}

    {activeRow&&<div className="photo-step" aria-live="polite">
      <div className="photo-progress"><span style={{width:`${((activeIndex+1)/rows.length)*100}%`}}/></div>
      <p className="photo-step-count">Alimento {activeIndex+1} de {rows.length}</p>
      <article className="photo-focus-card">
        <div className="photo-focus-icon"><UtensilsCrossed/></div>
        <button disabled={saving} className="photo-remove" aria-label={`Remover ${activeRow.name}`} onClick={()=>setRows(items=>items.filter(item=>item.key!==activeRow.key))}><Trash2/></button>
        <p className="photo-focus-label">{activeRow.food?'Encontramos':'Precisamos confirmar'}</p>
        <h3>{activeRow.food?foodDisplayName(activeRow.food):activeRow.name}</h3>
        {activeRow.food&&<button className="photo-change" onClick={()=>{setEditing(activeRow.key);setQuery(activeRow.name)}}>Não é esse? Trocar</button>}

        {!activeRow.food&&<div className={`photo-candidates ${activeRow.clarificationKind==='MEAT_TYPE'?'photo-meat-question':''}`}>
          <strong>{activeRow.clarificationKind==='MEAT_TYPE'?'Qual carne você usou?':choiceMessage(activeRow.state)}</strong>
          {activeRow.clarificationKind==='MEAT_TYPE'&&<small>A foto não mostra o corte com segurança.</small>}
          {activeRow.candidates.map(food=><button key={food.id} disabled={saving} onClick={()=>setRows(items=>items.map(item=>item.key===activeRow.key?{...item,food}:item))}>{foodDisplayName(food)}<ChevronRight/></button>)}
          <button className="photo-search-choice" onClick={()=>{setEditing(activeRow.key);setQuery(activeRow.name)}}><Search/> {activeRow.clarificationKind==='MEAT_TYPE'?'Não sei / buscar outra':'Buscar alimento'}</button>
        </div>}

        {activeRow.food&&<div className="photo-quantity">
          <label htmlFor={`photo-grams-${activeRow.key}`}>Quanto você comeu?</label>
          <MeasureInput id={`photo-grams-${activeRow.key}`} value={activeRow.grams} measure={activeRow.measure ?? gramMeasure}
            measures={activeRow.food.measures ?? [gramMeasure]} onChange={(value,measure)=>updateGrams(activeRow.key,value,measure)} />
          {safeGrams(activeRow.grams,activeRow.measure ?? gramMeasure)>0&&<p className="photo-nutrition-preview">≈ {formatNumber(scaleNutrients(activeRow.food.nutrients,safeGrams(activeRow.grams,activeRow.measure ?? gramMeasure)).values.energia_kcal)} kcal</p>}
          <Button className="photo-next" disabled={safeGrams(activeRow.grams,activeRow.measure ?? gramMeasure)<=0} onClick={()=>confirmRow(activeRow)}><Check/> {activeIndex===rows.length-1?'Concluir revisão':'Confirmar e continuar'} <ChevronRight/></Button>
        </div>}
      </article>
    </div>}

    {!!completed&&!valid&&<div className="photo-done-strip"><p><Check/> Já conferidos</p><div>{rows.filter(row=>row.confirmed).map(row=><button key={row.key} onClick={()=>editRow(row.key)}><strong>{row.food&&foodDisplayName(row.food)}</strong><span>{row.grams} {measureLabel(Number(row.grams.replace(',', '.')),row.measure ?? gramMeasure)}</span></button>)}</div></div>}

    {valid&&<section className="photo-final">
      <div className="photo-final-heading"><span><Check/></span><div><p>Tudo conferido</p><h3>Sua refeição está pronta</h3></div></div>
      <div className="photo-final-list">{rows.map(row=><button key={row.key} onClick={()=>editRow(row.key)}><span>{row.food&&foodDisplayName(row.food)}</span><strong>{row.grams} {measureLabel(Number(row.grams.replace(',', '.')),row.measure ?? gramMeasure)}</strong><ChevronRight/></button>)}</div>
      <Button variant="outline" disabled={saving||rows.length>=20} onClick={()=>{setEditing('new');setQuery('')}}><Plus/> Faltou algum alimento?</Button>
      <div className="photo-save"><label htmlFor="photo-meal">Refeição<select id="photo-meal" value={mealType} disabled={saving} onChange={e=>setMealType(e.target.value)}><option value="">Escolha a refeição</option>{MEAL_TYPES.map(meal=><option key={meal.value} value={meal.value}>{meal.label}</option>)}</select></label><Button disabled={!mealType||saving} onClick={save}>{saving?'Registrando…':'Adicionar ao Diário'}</Button></div>
    </section>}
  </section>;
}
