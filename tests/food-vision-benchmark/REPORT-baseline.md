# Baseline do reconhecimento por foto — Luna low

Configuração de produção `ec436e3`; 200 imagens sintéticas; preços: US$ 0,20/M tokens de entrada e US$ 1,20/M tokens de saída.

## Resultado geral

| Métrica | Resultado |
|---|---:|
| Exact match | 20/200 (10%) |
| Acceptable match | 24/200 (12%) |
| Top-1 | 18/200 (9%) |
| Top-3 | 49/200 (24.5%) |
| AUTOSELECT | 29; 6 corretos; 23 incorretos; precisão 20.69%; cobertura 14.5% |
| RERANK | 244 enviados; 87 resolvidos; 18 corretos; 152 incertos |
| ASK_USER | 157 (56.27% dos itens detectados) |
| NO_MATCH | 6 (2.15% dos itens detectados) |
| Falhas técnicas | 0 |

## Por dificuldade

| Dificuldade | Casos | Exato | Aceitável |
|---|---:|---:|---:|
| medio | 79 | 0/79 (0%) | 1/79 (1.27%) |
| facil | 91 | 17/91 (18.68%) | 20/91 (21.98%) |
| dificil | 30 | 3/30 (10%) | 3/30 (10%) |

## Tokens e custo

- Primeira chamada: 195400 entrada; 35395 saída, dos quais 20709 de raciocínio; US$ 0.081554.
- Rerankers: 225647 entrada; 25638 saída, dos quais 18366 de raciocínio; US$ 0.075895.
- Total: 482080 tokens contabilizados; US$ 0.157449; média US$ 0.00078725/imagem.
- Projeções lineares: 1.000 = US$ 0.7872; 10.000 = US$ 7.8724; 100.000 = US$ 78.7245.

## Latência (ms)

| Estágio | Média | Mediana/p50 | p95 | Máximo |
|---|---:|---:|---:|---:|
| first | 3364 | 3138 | 5808 | 9887 |
| matcher | 3124 | 2508 | 7424 | 10679 |
| reranker | 2399 | 2211 | 3835 | 8896 |
| pipeline | 9462 | 8010 | 17586 | 32749 |

## Erros

Detalhes completos, incluindo detecção, resultado, top-3, scores, margem, confiança visual e reranker, estão em `report-baseline.json` (180 casos sem exact match).

## Validade do dataset

Este resultado bruto **não deve ser usado para calibrar produção**. Uma auditoria conservadora encontrou 71/200 imagens (35,5%) sem qualquer identidade alimentar em comum entre o rótulo original e a detecção cega. A inspeção visual confirmou desalinhamentos claros: `food-006` está rotulada como peito de frango, mas mostra pão; `food-009` está rotulada como carne bovina, mas mostra waffle; `food-010` está rotulada como carne bovina cozida, mas mostra brownie/cereal de chocolate.

Portanto, os 20 acertos exatos e 24 aceitáveis são resultados contra o arquivo de rótulos fornecido, mas não medem de forma confiável a qualidade real do pipeline. O dataset precisa ter o vínculo imagem-rótulo corrigido e revisado antes de qualquer decisão sobre thresholds, aliases, pesos ou prompts.

## Padrões observados

- O maior problema é o desalinhamento imagem-rótulo, presente de forma evidente em alimentos como carnes, frango, peixes e alguns vegetais.
- Mesmo nos pares coerentes, variantes TBCA que diferem em sal, óleo, espécie ou corte geram muitos empates. Isso explica parte dos 157 itens em `ASK_USER`.
- O AUTOSELECT foi pouco frequente (14,5% de cobertura) e teve baixa precisão contra os rótulos atuais (20,69%), mas essa precisão está contaminada pelos rótulos incompatíveis.
- O matcher consumiu em média 3,1 s por imagem, valor alto e independente da API; é um possível alvo futuro de otimização, depois que o conjunto for corrigido.
- Não recomendo calibrar nenhum parâmetro com estes números. Primeiro é necessário corrigir ou substituir as 71 associações suspeitas e revisar visualmente as demais.
