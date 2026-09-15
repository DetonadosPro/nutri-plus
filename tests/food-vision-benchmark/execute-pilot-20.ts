import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {deduplicateDetections,decideMatch,MATCH_THRESHOLDS,rankSemanticFoodCandidates,type DetectedFood} from '../../shared/food-recognition';

const root='tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20';
const audit=JSON.parse(readFileSync(`${root}/ground-truth.audit.json`,'utf8'));
const output=`${root}/predictions-luna-baseline.json`;
const token=readFileSync('.codex-local/vision-token','utf8').trim();
const raw=JSON.parse(readFileSync('backend/data/tbca/tbca completa normalizada.json','utf8'));
const foods=raw.map((f:any)=>({source_code:f.codigo,description:f.nome_original,displayName:f.nome_exibicao,searchAliases:f.aliases_busca}));
const saved:any=existsSync(output)?JSON.parse(readFileSync(output,'utf8')):{variant:'pilot-20-production-ec436e3-luna-low',model:'gpt-5.6-luna',reasoningEffort:'low',store:false,pricing:{inputPerMillionUsd:.2,outputPerMillionUsd:1.2},cases:[]};
const cost=(telemetry:any)=>((telemetry?.inputTokens||0)*.2+(telemetry?.outputTokens||0)*1.2)/1_000_000;
const spent=()=>saved.cases.reduce((sum:number,c:any)=>sum+(c.costUsd||0),0);
async function call(path:string,body:BodyInit,type:string){const r=await fetch(`http://127.0.0.1:11435${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':type},body});if(!r.ok)throw new Error(`${path} ${r.status} ${await r.text()}`);return r.json() as Promise<any>}

for(const c of audit.cases){
  if(saved.cases.some((x:any)=>x.id===c.id))continue;
  if(spent()>=.03)throw new Error(`Limite de US$ 0,03 atingido antes de ${c.id}`);
  const start=performance.now();
  try{
    const image=readFileSync(`${root}/${c.image}`),first=await call('/recognize',image,'image/jpeg'),items=[];
    let caseCost=cost(first.telemetry);
    for(const detected of deduplicateDetections(first.detection.items as DetectedFood[])){
      const ms=performance.now(),matches=rankSemanticFoodCandidates(detected,foods,5),matcherMs=performance.now()-ms,initial=decideMatch(detected,matches),nearby=matches.filter(x=>matches[0].matchConfidence-x.matchConfidence<=.10),plausible=nearby.length>=2?nearby:matches.slice(0,2);
      let state:'AUTOSELECT'|'RERANK'|'ASK_USER'|'NO_MATCH'=initial.state,selectedCode=state==='AUTOSELECT'?matches[0].food.source_code:null,reranker=null;
      if(state==='RERANK'){
        if(spent()+caseCost>=.03)throw new Error('Limite de custo atingido antes do reranker');
        const rr=await call('/rerank',JSON.stringify({image:image.toString('base64'),detected,candidates:plausible.map(x=>x.food.displayName)}),'application/json');reranker=rr;caseCost+=cost(rr.telemetry);
        if(!rr.decision.uncertain&&rr.decision.candidateIndex!=null&&rr.decision.confidence>=MATCH_THRESHOLDS.RERANK_MIN_CONFIDENCE)selectedCode=plausible[rr.decision.candidateIndex].food.source_code;else state='ASK_USER';
      }
      items.push({state,selectedCode,topCodes:matches.slice(0,3).map(x=>x.food.source_code),topNames:matches.slice(0,3).map(x=>x.food.displayName),top1Score:initial.top1Score,top2Score:initial.top2Score,margin:initial.margin,visualConfidence:detected.confidence,detected,matcherMs,firstTelemetry:first.telemetry,rerankerTelemetry:reranker?.telemetry||null,rerankerDecision:reranker?.decision||null});
    }
    saved.cases.push({id:c.id,difficulty:c.difficulty,latencyMs:performance.now()-start,costUsd:caseCost,firstTelemetry:first.telemetry,items});
  }catch(error){saved.cases.push({id:c.id,difficulty:c.difficulty,error:error instanceof Error?error.message:'unknown',latencyMs:performance.now()-start,costUsd:0,items:[]});}
  writeFileSync(output,JSON.stringify(saved,null,2));console.log(`${saved.cases.length}/${audit.cases.length} ${c.id} US$ ${spent().toFixed(6)}`);
}
