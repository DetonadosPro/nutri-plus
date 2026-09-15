import {readFileSync,writeFileSync} from 'node:fs';

const root='tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20';
const audit=JSON.parse(readFileSync(`${root}/ground-truth.audit.json`,'utf8'));
const predictions=JSON.parse(readFileSync(`${root}/predictions-luna-baseline.json`,'utf8'));
const pct=(n:number,d:number)=>d?Number((100*n/d).toFixed(2)):0;
const pctl=(xs:number[],p:number)=>{const a=[...xs].sort((x,y)=>x-y);return Math.round(a[Math.min(a.length-1,Math.floor(a.length*p))]||0)};
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);

// Independent post-inference review. Values are expected-component index -> detected-item index.
// null means the expected component was absent; every detected item may be used at most once.
const association:Record<string,(number|null)[]>={
  'food-001':[0],'food-002':[0],'food-003':[0],'food-004':[0],'food-005':[0],
  'food-006':[0],'food-007':[0],'food-008':[2,0,1,3,4,5],'food-009':[null],
  'food-010':[0,1,2,3,4,5],'food-011':[0],'food-012':[0],'food-013':[0],
  'food-014':[0],'food-015':[0],'food-016':[0],'food-017':[0],'food-018':[0,1,2],
  'food-019':[0],'food-020':[0],
};

let visualMatched=0,visualMissing=0,extras=0,resolved=0,exact=0,acceptable=0,top1Exact=0,top1Acceptable=0,top3Exact=0,top3Acceptable=0;
let auto=0,autoCorrect=0,rerank=0,rerankCorrect=0,ask=0,noMatch=0;
const rows:any[]=[];
for(const test of audit.cases){
  const result=predictions.cases.find((x:any)=>x.id===test.id);
  if(!result)throw new Error(`Predição ausente: ${test.id}`);
  const links=association[test.id];if(!links||links.length!==test.expectedFoods.length)throw new Error(`Associação inválida: ${test.id}`);
  const used=new Set<number>();
  const components=test.expectedFoods.map((expected:any,index:number)=>{
    const predictionIndex=links[index],item=predictionIndex==null?null:result.items[predictionIndex];
    if(predictionIndex!=null){if(used.has(predictionIndex))throw new Error(`Predição duplicada: ${test.id}`);used.add(predictionIndex);visualMatched++;}else visualMissing++;
    const out:any={expectedLabel:expected.expectedLabel,catalogReviewStatus:expected.catalogReviewStatus,predictionIndex,detectedName:item?.detected?.name??null,state:item?.state??'MISSING',selectedCode:item?.selectedCode??null,topCodes:item?.topCodes??[]};
    if(expected.tbcaCode){resolved++;const allowed=new Set([expected.tbcaCode,...expected.acceptableCodes]);const selected=item?.selectedCode;const top=item?.topCodes||[];out.exact=selected===expected.tbcaCode;out.acceptable=Boolean(selected&&allowed.has(selected));out.top1Exact=top[0]===expected.tbcaCode;out.top1Acceptable=allowed.has(top[0]);out.top3Exact=top.slice(0,3).includes(expected.tbcaCode);out.top3Acceptable=top.slice(0,3).some((code:string)=>allowed.has(code));exact+=+out.exact;acceptable+=+out.acceptable;top1Exact+=+out.top1Exact;top1Acceptable+=+out.top1Acceptable;top3Exact+=+out.top3Exact;top3Acceptable+=+out.top3Acceptable;if(item?.state==='AUTOSELECT'){auto++;autoCorrect+=+out.acceptable}if(item?.state==='RERANK'){rerank++;rerankCorrect+=+out.acceptable}if(item?.state==='ASK_USER')ask++;if(item?.state==='NO_MATCH')noMatch++;}
    return out;
  });
  extras+=result.items.length-used.size;
  rows.push({id:test.id,difficulty:test.difficulty,expected:test.expectedFoods.length,detected:result.items.length,visualMatched:links.filter(x=>x!=null).length,missing:links.filter(x=>x==null).length,extras:result.items.length-used.size,latencyMs:Math.round(result.latencyMs),costUsd:result.costUsd,components});
}
const firstTelemetries=predictions.cases.map((c:any)=>c.firstTelemetry).filter(Boolean),rerankTelemetries=predictions.cases.flatMap((c:any)=>c.items.map((i:any)=>i.rerankerTelemetry).filter(Boolean));
const tokenStage=(ts:any[])=>({calls:ts.length,input:sum(ts.map(t=>t.inputTokens||0)),output:sum(ts.map(t=>t.outputTokens||0)),reasoning:sum(ts.map(t=>t.reasoningTokens||0)),costUsd:sum(ts.map(t=>((t.inputTokens||0)*.2+(t.outputTokens||0)*1.2)/1e6))});
const summarizeLatency=(xs:number[])=>({calls:xs.length,mean:Math.round(sum(xs)/(xs.length||1)),p50:pctl(xs,.5),p95:pctl(xs,.95),max:Math.round(Math.max(0,...xs))});
const latencies=rows.map(r=>r.latencyMs),firstLatencies=firstTelemetries.map((t:any)=>t.latencyMs),matcherLatencies=predictions.cases.flatMap((c:any)=>c.items.map((i:any)=>i.matcherMs)),rerankLatencies=rerankTelemetries.map((t:any)=>t.latencyMs),costTotal=sum(rows.map(r=>r.costUsd));
const difficulty=Object.fromEntries([...new Set(rows.map(r=>r.difficulty))].map(level=>{const subset=rows.filter(r=>r.difficulty===level),components=subset.flatMap(r=>r.components),coded=components.filter((c:any)=>c.catalogReviewStatus==='reviewed');return [level,{images:subset.length,visualExpected:components.length,visualMatched:components.filter((c:any)=>c.predictionIndex!=null).length,tbcaDenominator:coded.length,exact:coded.filter((c:any)=>c.exact).length,acceptable:coded.filter((c:any)=>c.acceptable).length}]}));
const report={configuration:{variant:predictions.variant,model:predictions.model,reasoningEffort:predictions.reasoningEffort,store:predictions.store,productionCommit:'ec436e3',images:20,expectedVisualComponents:32,resolvedTbcaComponents:resolved,ambiguousVisualOnly:32-resolved,detectedItems:visualMatched+extras,technicalFailures:predictions.cases.filter((c:any)=>c.error).length},visual:{matched:visualMatched,missing:visualMissing,extras,recallPercent:pct(visualMatched,32),precisionPercent:pct(visualMatched,visualMatched+extras)},tbca:{denominator:resolved,exact:{count:exact,percent:pct(exact,resolved)},acceptable:{count:acceptable,percent:pct(acceptable,resolved)},top1Exact:{count:top1Exact,percent:pct(top1Exact,resolved)},top1Acceptable:{count:top1Acceptable,percent:pct(top1Acceptable,resolved)},top3Exact:{count:top3Exact,percent:pct(top3Exact,resolved)},top3Acceptable:{count:top3Acceptable,percent:pct(top3Acceptable,resolved)}},decision:{autoSelect:{count:auto,correct:autoCorrect,precisionPercent:pct(autoCorrect,auto),coveragePercent:pct(auto,resolved)},rerank:{count:rerank,correct:rerankCorrect,accuracyPercent:pct(rerankCorrect,rerank)},askUser:{count:ask,percent:pct(ask,resolved)},noMatch:{count:noMatch,percent:pct(noMatch,resolved)}},difficulty,tokens:{first:tokenStage(firstTelemetries),reranker:tokenStage(rerankTelemetries)},costUsd:{total:costTotal,averagePerImage:costTotal/20},latencyMs:{first:summarizeLatency(firstLatencies),matcher:summarizeLatency(matcherLatencies),reranker:summarizeLatency(rerankLatencies),pipeline:summarizeLatency(latencies)},cases:rows};
writeFileSync(`${root}/report-luna-baseline.json`,JSON.stringify(report,null,2)+'\n');
const md=[
  '# Baseline corrigido — piloto de 20 imagens',
  '',`Pipeline \`ec436e3\`; modelo \`gpt-5.6-luna\`; reasoning \`low\`; \`store:false\`.`,
  '','## Resultado geral','',
  `- Visual: ${visualMatched}/32 componentes associados; ${visualMissing} ausente; ${extras} detecções extras; recall ${pct(visualMatched,32)}%; precisão ${pct(visualMatched,visualMatched+extras)}%.`,
  `- TBCA selecionado: exact ${exact}/${resolved} (${pct(exact,resolved)}%); acceptable ${acceptable}/${resolved} (${pct(acceptable,resolved)}%).`,
  `- Candidatos: top-1 acceptable ${top1Acceptable}/${resolved} (${pct(top1Acceptable,resolved)}%); top-3 acceptable ${top3Acceptable}/${resolved} (${pct(top3Acceptable,resolved)}%).`,
  `- AUTOSELECT: ${autoCorrect}/${auto} corretos; precisão ${pct(autoCorrect,auto)}%; cobertura ${pct(auto,resolved)}% sobre 27 componentes codificados.`,
  `- RERANK associado: ${rerankCorrect}/${rerank} corretos (${pct(rerankCorrect,rerank)}%); ASK_USER ${ask}/${resolved}; NO_MATCH ${noMatch}/${resolved}.`,
  '','## Custo e tokens','',
  `- Primeira chamada: ${report.tokens.first.calls} chamadas; ${report.tokens.first.input} entrada; ${report.tokens.first.output} saída, incluindo ${report.tokens.first.reasoning} de raciocínio; US$ ${report.tokens.first.costUsd.toFixed(6)}.`,
  `- Reranker: ${report.tokens.reranker.calls} chamadas; ${report.tokens.reranker.input} entrada; ${report.tokens.reranker.output} saída, incluindo ${report.tokens.reranker.reasoning} de raciocínio; US$ ${report.tokens.reranker.costUsd.toFixed(6)}.`,
  `- Total: US$ ${costTotal.toFixed(6)}; média US$ ${(costTotal/20).toFixed(8)} por imagem.`,
  '','## Por dificuldade','',
  '| Dificuldade | Imagens | Visual | TBCA exact | TBCA acceptable |','|---|---:|---:|---:|---:|',
  ...Object.entries(difficulty).map(([level,d]:any)=>`| ${level} | ${d.images} | ${d.visualMatched}/${d.visualExpected} | ${d.exact}/${d.tbcaDenominator} | ${d.acceptable}/${d.tbcaDenominator} |`),
  '','## Latência','',
  '| Estágio | Chamadas | Média | p50 | p95 | Máximo |','|---|---:|---:|---:|---:|---:|',
  ...Object.entries(report.latencyMs).map(([stage,l]:any)=>`| ${stage} | ${l.calls} | ${l.mean} ms | ${l.p50} ms | ${l.p95} ms | ${l.max} ms |`),
  '','## Casos','',
  '| Caso | Esperados | Detectados | Associados | Ausentes | Extras | Custo |','|---|---:|---:|---:|---:|---:|---:|',
  ...rows.map(r=>`| ${r.id} | ${r.expected} | ${r.detected} | ${r.visualMatched} | ${r.missing} | ${r.extras} | US$ ${r.costUsd.toFixed(6)} |`),
  '','## Observações de erro','',
  '- `food-009`: a coxa de frango foi identificada como pernil de porco; é o único componente visual esperado ausente e também gera uma detecção extra incorreta.',
  '- `food-012`: limão e alface foram detectados, mas eram guarnições excluídas previamente do gabarito.',
  '- `food-013`: salada, carne e feijão ao fundo foram detectados; permanecem extras porque a regra anterior limita o caso à mandioca em primeiro plano.',
  '- `food-016`: o prato composto foi decomposto em espaguete, molho e salsinha. Só o espaguete foi associado ao esperado para impedir dupla contagem.',
  '- `food-004`, `food-005` e `food-017`: coentro, queijo e folhas ao fundo, respectivamente, foram detecções extras.',
  '- Os cinco componentes sem código defensável (omelete simples, bife, farofa, peixe empanado e queijo) permaneceram apenas na avaliação visual.',
  '','O conjunto é pequeno e sintético. Este resultado valida o processo e revela padrões, mas não estima sozinho a acurácia final em fotos reais.'
];
writeFileSync(`${root}/REPORT-luna-baseline.md`,md.join('\n')+'\n');
console.log(JSON.stringify({...report,cases:undefined},null,2));
