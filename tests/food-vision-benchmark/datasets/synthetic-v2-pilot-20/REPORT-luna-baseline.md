# Baseline corrigido — piloto de 20 imagens

Pipeline `ec436e3`; modelo `gpt-5.6-luna`; reasoning `low`; `store:false`.

## Resultado geral

- Visual: 31/32 componentes associados; 1 ausente; 11 detecções extras; recall 96.88%; precisão 73.81%.
- TBCA selecionado: exact 8/27 (29.63%); acceptable 11/27 (40.74%).
- Candidatos: top-1 acceptable 19/27 (70.37%); top-3 acceptable 20/27 (74.07%).
- AUTOSELECT: 6/6 corretos; precisão 100%; cobertura 22.22% sobre 27 componentes codificados.
- RERANK associado: 5/6 corretos (83.33%); ASK_USER 13/27; NO_MATCH 1/27.

## Custo e tokens

- Primeira chamada: 20 chamadas; 24140 entrada; 2376 saída, incluindo 509 de raciocínio; US$ 0.007679.
- Reranker: 33 chamadas; 38101 entrada; 3242 saída, incluindo 2260 de raciocínio; US$ 0.011511.
- Total: US$ 0.019190; média US$ 0.00095949 por imagem.

## Por dificuldade

| Dificuldade | Imagens | Visual | TBCA exact | TBCA acceptable |
|---|---:|---:|---:|---:|
| facil | 10 | 10/10 | 1/10 | 2/10 |
| medio | 7 | 8/9 | 3/7 | 4/7 |
| dificil | 3 | 13/13 | 4/10 | 5/10 |

## Latência

| Estágio | Chamadas | Média | p50 | p95 | Máximo |
|---|---:|---:|---:|---:|---:|
| first | 20 | 2828 ms | 3068 ms | 4606 ms | 4606 ms |
| matcher | 42 | 1306 ms | 1231 ms | 1807 ms | 2316 ms |
| reranker | 33 | 2588 ms | 2271 ms | 5654 ms | 6451 ms |
| pipeline | 20 | 10017 ms | 8237 ms | 22758 ms | 22758 ms |

## Casos

| Caso | Esperados | Detectados | Associados | Ausentes | Extras | Custo |
|---|---:|---:|---:|---:|---:|---:|
| food-001 | 1 | 1 | 1 | 0 | 0 | US$ 0.000679 |
| food-002 | 1 | 1 | 1 | 0 | 0 | US$ 0.000943 |
| food-003 | 1 | 1 | 1 | 0 | 0 | US$ 0.000812 |
| food-004 | 1 | 2 | 1 | 0 | 1 | US$ 0.000797 |
| food-005 | 1 | 2 | 1 | 0 | 1 | US$ 0.001008 |
| food-006 | 1 | 1 | 1 | 0 | 0 | US$ 0.000695 |
| food-007 | 1 | 1 | 1 | 0 | 0 | US$ 0.000619 |
| food-008 | 6 | 6 | 6 | 0 | 0 | US$ 0.002158 |
| food-009 | 1 | 1 | 0 | 1 | 1 | US$ 0.000587 |
| food-010 | 6 | 6 | 6 | 0 | 0 | US$ 0.002242 |
| food-011 | 1 | 1 | 1 | 0 | 0 | US$ 0.000696 |
| food-012 | 1 | 3 | 1 | 0 | 2 | US$ 0.001404 |
| food-013 | 1 | 4 | 1 | 0 | 3 | US$ 0.001959 |
| food-014 | 1 | 1 | 1 | 0 | 0 | US$ 0.000677 |
| food-015 | 1 | 1 | 1 | 0 | 0 | US$ 0.000659 |
| food-016 | 1 | 3 | 1 | 0 | 2 | US$ 0.000740 |
| food-017 | 1 | 2 | 1 | 0 | 1 | US$ 0.000830 |
| food-018 | 3 | 3 | 3 | 0 | 0 | US$ 0.000732 |
| food-019 | 1 | 1 | 1 | 0 | 0 | US$ 0.000306 |
| food-020 | 1 | 1 | 1 | 0 | 0 | US$ 0.000647 |

## Observações de erro

- `food-009`: a coxa de frango foi identificada como pernil de porco; é o único componente visual esperado ausente e também gera uma detecção extra incorreta.
- `food-012`: limão e alface foram detectados, mas eram guarnições excluídas previamente do gabarito.
- `food-013`: salada, carne e feijão ao fundo foram detectados; permanecem extras porque a regra anterior limita o caso à mandioca em primeiro plano.
- `food-016`: o prato composto foi decomposto em espaguete, molho e salsinha. Só o espaguete foi associado ao esperado para impedir dupla contagem.
- `food-004`, `food-005` e `food-017`: coentro, queijo e folhas ao fundo, respectivamente, foram detecções extras.
- Os cinco componentes sem código defensável (omelete simples, bife, farofa, peixe empanado e queijo) permaneceram apenas na avaliação visual.

O conjunto é pequeno e sintético. Este resultado valida o processo e revela padrões, mas não estima sozinho a acurácia final em fotos reais.
