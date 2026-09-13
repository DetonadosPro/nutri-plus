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
import { MEAT_FAMILY_OPTIONS, recognitionFoodLabel, type MeatFamily } from '@/lib/food-photo-recognition';
import type {FoodKind,MeatVisual} from '../../../shared/food-recognition';
import {
  createPhotoSessionId,
  installPhotoLifecycleDiagnostics,
  logPhotoSession,
  PhotoAnalysisGate,
  PhotoPreviewUrl,
  takePhotoInputFile,
} from '@/lib/photo-session';

type DetectionState = 'AUTOSELECT'|'RERANK'|'ASK_USER'|'ASK_IDENTITY'|'ASK_MEAT_FAMILY'|'ASK_ATTRIBUTE'|'NO_EXACT_TBCA_MATCH'|'NO_MATCH';
type Detection = { itemToken:string;name:string;preparation:string|null;visibleDetails:string[];componentRole:'independent'|'integrated-preparation';foodKind:FoodKind;groupLabel:string|null;identityAmbiguity:'meat_family'|'food_identity'|null;meatVisual:MeatVisual|null;clarificationKind:'MEAT_FAMILY'|null;visionConfidence:number;matchConfidence:number;matchConfidenceLevel:'high'|'medium'|'low';state:DetectionState;top1Score:number;top2Score:number;margin:number;resolutionPolicy?:string|null;abstentionReason?:string|null;candidates:Food[] };
type Row = Detection & { key: string; food: Food | null; grams: string; measure?: FoodMeasure; confirmed: boolean;manualSearch:boolean };

function choiceMessage(state:DetectionState){
  if(['NO_MATCH','NO_EXACT_TBCA_MATCH'].includes(state))return 'Não encontramos uma opção segura. Busque manualmente:';
  return 'Pode ser:';
}

export function FoodPhotoReview({ date, initialMealType, initialPhoto, onInitialPhotoConsumed, onBack, onAdded }: {
  date: string; initialMealType?: string; initialPhoto?: { file: File; token: number }; onInitialPhotoConsumed?: (token: number) => void; onBack: () => void; onAdded: (summary: Summary) => void | Promise<void>;
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
  const [familyBusyKey,setFamilyBusyKey]=useState<string|null>(null);
  const saveLock = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const analyzedInitialPhoto = useRef<number | undefined>(undefined);
  const analysisGate = useRef<PhotoAnalysisGate | null>(null);
  const previewUrl = useRef<PhotoPreviewUrl | null>(null);
  const currentSession = useRef<number | null>(null);
  const pendingPickerSession = useRef<number | null>(null);
  if (!analysisGate.current) analysisGate.current = new PhotoAnalysisGate();
  if (!previewUrl.current) previewUrl.current = new PhotoPreviewUrl();

  const releasePreview = useCallback((reason: string, sessionId = currentSession.current) => {
    if (!previewUrl.current?.current()) return;
    previewUrl.current.clear();
    logPhotoSession(sessionId, 'object URL revoked', { reason });
  }, []);

  useEffect(() => {
    logPhotoSession(null, 'route mounted');
    const removeLifecycleDiagnostics = installPhotoLifecycleDiagnostics(
      () => currentSession.current,
    );
    return () => {
      logPhotoSession(currentSession.current, 'cleanup start', {
        reason: 'route unmounted',
      });
      analysisGate.current?.cancel();
      releasePreview('route unmounted');
      pendingPickerSession.current = null;
      currentSession.current = null;
      removeLifecycleDiagnostics();
      logPhotoSession(null, 'route unmounted');
    };
  }, [releasePreview]);
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

  const analyze = useCallback(async (
    file?: File,
    source: 'initial' | 'camera' | 'gallery' = 'gallery',
    initialToken?: number,
  ) => {
    if (!file || saving || saved) return;
    if (initialToken != null) onInitialPhotoConsumed?.(initialToken);
    const sourceBytes = file.size;
    const sessionId = pendingPickerSession.current ?? createPhotoSessionId();
    pendingPickerSession.current = null;
    const analysis = analysisGate.current!.start(sessionId);
    currentSession.current = sessionId;
    releasePreview('new analysis', sessionId);
    setPreview('');
    setError('');
    setRows([]); setAnalysisToken(''); setAnalyzed(false); setBusy(true);
    logPhotoSession(sessionId, 'file received', { source, sourceBytes });
    const timeout = setTimeout(() => analysis.controller.abort(), 100_000);
    try {
      const upload = await optimizeFoodPhoto(
        file,
        analysis.controller.signal,
        (event, details) => logPhotoSession(sessionId, event, details),
      );
      file = undefined;
      if (!analysisGate.current!.isCurrent(analysis)) {
        logPhotoSession(sessionId, 'stale optimization ignored');
        return;
      }
      const nextPreview = previewUrl.current!.replace(upload);
      setPreview(nextPreview);
      logPhotoSession(sessionId, 'preview created', { previewBytes: upload.size });
      logPhotoSession(sessionId, 'upload start', { uploadBytes: upload.size });
      const data = await api<{ analysisToken:string;items: Detection[] }>('/foods/recognize', {
        method: 'POST', headers: { 'Content-Type': upload.type }, body: upload, signal: analysis.controller.signal,
      });
      if (!analysisGate.current!.isCurrent(analysis)) {
        logPhotoSession(sessionId, 'stale response ignored');
        return;
      }
      logPhotoSession(sessionId, 'upload complete', { detectedItems: data.items.length });
      setAnalysisToken(data.analysisToken);
      setRows(data.items.map(item => ({ ...item, key: crypto.randomUUID(), food: ['AUTOSELECT','RERANK'].includes(item.state) ? item.candidates[0] || null : null, grams: '', confirmed: false,manualSearch:false })));
      setAnalyzed(true);
    } catch (reason) {
      if (analysisGate.current!.isCurrent(analysis)) {
        const aborted = analysis.controller.signal.aborted;
        logPhotoSession(sessionId, aborted ? 'analysis aborted' : 'analysis error', {
          name: reason instanceof Error ? reason.name : 'Error',
          message: reason instanceof Error ? reason.message : 'unknown',
        });
        setError(aborted ? 'A análise demorou mais que o esperado. Você pode usar a busca manual.' : reason instanceof Error ? reason.message : 'Reconhecimento indisponível. Use a busca manual.');
      }
    } finally {
      clearTimeout(timeout);
      if (analysisGate.current!.isCurrent(analysis)) {
        analysisGate.current!.finish(analysis);
        currentSession.current = null;
        setBusy(false);
        logPhotoSession(sessionId, 'analysis settled');
      }
    }
  }, [onInitialPhotoConsumed, releasePreview, saved, saving]);

  useEffect(() => {
    if (!initialPhoto || analyzedInitialPhoto.current === initialPhoto.token) return;
    analyzedInitialPhoto.current = initialPhoto.token;
    void analyze(initialPhoto.file, 'initial', initialPhoto.token);
  }, [initialPhoto, analyze]);

  function openPicker(
    source: 'camera' | 'gallery',
    input: HTMLInputElement | null,
  ) {
    if (!input || busy || saving) return;
    const sessionId = createPhotoSessionId();
    pendingPickerSession.current = sessionId;
    currentSession.current = sessionId;
    logPhotoSession(sessionId, 'file picker opened', { source });
    input.click();
  }

  function leavePhotoMode() {
    logPhotoSession(currentSession.current, 'cleanup start', {
      reason: 'back',
    });
    analysisGate.current!.cancel();
    releasePreview('back');
    pendingPickerSession.current = null;
    currentSession.current = null;
    setPreview('');
    onBack();
  }

  function choose(food: Food) {
    if (editing === 'new') setRows(current => [...current, { key: crypto.randomUUID(),itemToken:crypto.randomUUID(),name:foodDisplayName(food),preparation:null,visibleDetails:[],componentRole:'independent',foodKind:'unknown',groupLabel:null,identityAmbiguity:null,meatVisual:null,clarificationKind:null,visionConfidence:1,matchConfidence:1,matchConfidenceLevel:'high',state:'ASK_ATTRIBUTE',top1Score:0,top2Score:0,margin:0,candidates:[],food,grams:'',measure:food.measures?.find(m=>m.isDefault) ?? gramMeasure,confirmed:false,manualSearch:true }]);
    else setRows(current => current.map(row => row.key === editing ? { ...row, food, grams:"", measure:food.measures?.find(m=>m.isDefault) ?? gramMeasure, confirmed:false,manualSearch:true } : row));
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

  async function chooseMeatFamily(row:Row,family:MeatFamily){
    if(!analysisToken||familyBusyKey)return;
    setFamilyBusyKey(row.key);setError('');
    try{
      const detected={name:row.name,preparation:row.preparation,visibleDetails:row.visibleDetails,confidence:row.visionConfidence,alternative:null,componentRole:row.componentRole,foodKind:row.foodKind,groupLabel:row.groupLabel,identityAmbiguity:row.identityAmbiguity,meatVisual:row.meatVisual};
      const item=await api<Detection>('/foods/recognize/meat-family',{method:'POST',body:JSON.stringify({analysisToken,itemToken:row.itemToken,detected,family})});
      setRows(items=>items.map(current=>current.key===row.key?{...current,...item,food:['AUTOSELECT','RERANK'].includes(item.state)?item.candidates[0]||null:null,grams:'',measure:undefined,confirmed:false}:current));
    }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível confirmar a carne.');}
    finally{setFamilyBusyKey(null)}
  }

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
      if(analysisToken)void api('/foods/recognize/feedback',{method:'POST',body:JSON.stringify({analysisToken,items:rows.filter(row=>row.food).map(row=>({itemToken:row.itemToken,selectedFoodId:row.food!.id,manualSearch:row.manualSearch}))})}).catch(()=>undefined);
      releasePreview('meal saved');
      setPreview('');
      await onAdded(summary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); saveLock.current = false; }
  }

  if (saved) return <div className="photo-empty"><output>Refeição registrada! Seus alimentos foram adicionados ao Diário.</output><Button onClick={leavePhotoMode}>Concluir</Button></div>;
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
      <Button variant="ghost" onClick={leavePhotoMode} disabled={saving}><ArrowLeft /> Busca manual</Button>
      {!!rows.length&&<span>{completed} de {rows.length} prontos</span>}
    </header>
    <div className="photo-scene">
      <div className="photo-scene-image">
        {preview?<Image src={preview} unoptimized width={800} height={520} alt="Foto do prato para revisar" className="photo-preview"/>:<Camera/>}
        {preview&&<div className="photo-scene-badge"><Sparkles/> {rows.length} {rows.length===1?'alimento':'alimentos'}</div>}
      </div>
      <input ref={camera} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{const file=takePhotoInputFile(e.currentTarget);void analyze(file,'camera')}}/>
      <input ref={gallery} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=takePhotoInputFile(e.currentTarget);void analyze(file,'gallery')}}/>
      <div className="photo-scene-actions"><button disabled={busy||saving} onClick={()=>openPicker('camera',camera.current)}><Camera/> Nova foto</button><button disabled={busy||saving} onClick={()=>openPicker('gallery',gallery.current)}><ImagePlus/> Galeria</button></div>
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
        <h3>{activeRow.food?recognitionFoodLabel(activeRow.food):activeRow.name}</h3>
        {activeRow.food&&<button className="photo-change" onClick={()=>{setEditing(activeRow.key);setQuery(activeRow.name)}}>Trocar alimento</button>}

        {!activeRow.food&&<div className={`photo-candidates ${activeRow.clarificationKind==='MEAT_FAMILY'?'photo-meat-question':''}`}>
          <strong>{activeRow.clarificationKind==='MEAT_FAMILY'?'Que tipo de carne é?':choiceMessage(activeRow.state)}</strong>
          {activeRow.clarificationKind==='MEAT_FAMILY'&&<small>A foto não permite confirmar a família com segurança.</small>}
          {activeRow.clarificationKind==='MEAT_FAMILY'?MEAT_FAMILY_OPTIONS.map(option=><button key={option.value} disabled={saving||familyBusyKey===activeRow.key} onClick={()=>void chooseMeatFamily(activeRow,option.value)}><span>{option.label}</span>{familyBusyKey===activeRow.key?<LoaderCircle className="animate-spin"/>:<ChevronRight/>}</button>):activeRow.candidates.map((food,index)=><button key={food.id} disabled={saving} onClick={()=>setRows(items=>items.map(item=>item.key===activeRow.key?{...item,food,manualSearch:false}:item))}><span className="photo-candidate-index">{index+1}</span><span>{recognitionFoodLabel(food)}</span><ChevronRight/></button>)}
          <button className="photo-search-choice" onClick={()=>{setEditing(activeRow.key);setQuery(activeRow.name)}}><Search/> Nenhum desses / Buscar outro</button>
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

    {!!completed&&!valid&&<div className="photo-done-strip"><p><Check/> Já conferidos</p><div>{rows.filter(row=>row.confirmed).map(row=><button key={row.key} onClick={()=>editRow(row.key)}><strong>{row.food&&recognitionFoodLabel(row.food)}</strong><span>{row.grams} {measureLabel(Number(row.grams.replace(',', '.')),row.measure ?? gramMeasure)}</span></button>)}</div></div>}

    {valid&&<section className="photo-final">
      <div className="photo-final-heading"><span><Check/></span><div><p>Tudo conferido</p><h3>Sua refeição está pronta</h3></div></div>
      <div className="photo-final-list">{rows.map(row=><button key={row.key} onClick={()=>editRow(row.key)}><span>{row.food&&recognitionFoodLabel(row.food)}</span><strong>{row.grams} {measureLabel(Number(row.grams.replace(',', '.')),row.measure ?? gramMeasure)}</strong><ChevronRight/></button>)}</div>
      <Button variant="outline" disabled={saving||rows.length>=20} onClick={()=>{setEditing('new');setQuery('')}}><Plus/> Faltou algum alimento?</Button>
      <div className="photo-save"><label htmlFor="photo-meal">Refeição<select id="photo-meal" value={mealType} disabled={saving} onChange={e=>setMealType(e.target.value)}><option value="">Escolha a refeição</option>{MEAL_TYPES.map(meal=><option key={meal.value} value={meal.value}>{meal.label}</option>)}</select></label><Button disabled={!mealType||saving} onClick={save}>{saving?'Registrando…':'Adicionar ao Diário'}</Button></div>
    </section>}
  </section>;
}
