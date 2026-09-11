# Benchmark offline de reconhecimento visual

Coloque imagens privadas fora do Git em `images/`, copie `cases.example.json` para `cases.json` e rotule códigos TBCA esperados/aceitáveis. Resultados de variantes ficam em JSON e nunca devem conter a imagem.

Execute `npm run vision:benchmark -- --cases caminho/cases.json --predictions atual.json novo.json`. O relatório compara variantes (por exemplo matcher antigo/novo ou Luna none/low) sem alterar produção.

O fluxo atual do produto faz uma chamada de visão por foto e resolve todos os candidatos no matcher local. O endpoint `/rerank` e os campos de reranker dos executores antigos são mantidos apenas para reproduzir benchmarks históricos; não fazem parte do caminho do produto.

Para reaproveitar detecções visuais já salvas sem nova chamada de IA, execute `npm run vision:replay-matcher -- caminho/predictions.json`. Esse replay consulta o catálogo atual em modo somente leitura, aplica a resolução usada pelo produto e informa latência, estados e violações do limite de três candidatos. Use `--details` para listar cada detecção e seus candidatos.

Métricas: exact/acceptable match, top-1, top-3, precisão e cobertura de AUTOSELECT, acurácia do reranker, taxa de escolha do usuário, no-match, latência média/p50/p95 e custo médio por imagem. Custo vem do usage real e da tabela de preços informada pelo executor; o runner não embute preço sujeito a mudança.

Para o dataset sintético revisado localmente:

1. `npx tsx tests/food-vision-benchmark/prepare-cases.ts`
2. inicie o gateway privado com a mesma configuração de produção;
3. `npx tsx tests/food-vision-benchmark/execute-baseline.ts`
4. `npx tsx tests/food-vision-benchmark/report-baseline.ts`

O executor salva um checkpoint após cada imagem e nunca lê o gabarito. `prepare-cases.ts` resolve o gabarito separadamente; `report-baseline.ts` só combina inferências e rótulos depois que o lote termina. Revise visualmente qualquer dataset antes de usar seus números para calibração. O lote histórico de 200 imagens não deve ser usado para calibrar thresholds enquanto seus pares imagem-rótulo não forem reparados e revisados; replay técnico não equivale a evidência de acurácia.
