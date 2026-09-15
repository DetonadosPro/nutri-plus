# Piloto de velocidade — Luna

Execução paga autorizada em 09/09/2026. Todas as chamadas usaram `gpt-5.6-luna`, `store:false` e o matcher `semantic-identity-v2`. Custo total dos três ensaios: **US$ 0,009374**.

## Resultado principal

| Configuração | Imagens | Média | p50 | p95 | Máximo | Custo |
|---|---:|---:|---:|---:|---:|---:|
| Baseline anterior: low + high + reranker | 20 | 10.017 ms | 8.237 ms | 22.758 ms | 22.758 ms | US$ 0,019190 |
| Fast: none + low + uma chamada | 20 | 3.231 ms | 3.060 ms | 4.895 ms | 5.007 ms | US$ 0,003905 |
| Fast: none + high + uma chamada | 10 representativas | 3.161 ms | 3.298 ms | 4.094 ms | 4.094 ms | US$ 0,003771 |
| Fast: none + high + 768 px | 5 difíceis | 3.632 ms | 3.013 ms | 6.647 ms | 6.647 ms | US$ 0,001698 |

O modo rápido completo ficou **67,7% mais rápido** que o baseline. A redução principal veio da remoção das chamadas de desempate, que antes somavam cerca de 7,2 segundos à média do piloto. O custo por imagem de `none + low` caiu 79,7%.

## Qualidade

No ensaio completo `none + low`:

- 30/32 componentes visuais associados, 2 ausentes e 2 extras;
- top-1 aceitável TBCA em 20/27 componentes codificados;
- 17 seleções automáticas, todas aceitáveis;
- 7 componentes pediram escolha, com a opção esperada entre as cinco primeiras em 4 casos;
- nenhuma falha técnica e nenhum token de raciocínio.

O detalhe `low` juntou alface, tomate e cebola como uma única “salada” em um prato complexo. Em `high`, os seis componentes desse prato voltaram separados. Nos dez casos representativos, `high` não aumentou a latência observada, embora use mais tokens de imagem.

Em `high + 768 px`, os cinco pratos difíceis preservaram 17/17 componentes esperados e tiveram apenas dois extras de guarnição no prato de peixe. A amostra é pequena e sintética; o resultado sustenta a configuração, mas não substitui acompanhamento em fotos reais.

## Configuração escolhida

- `gpt-5.6-luna`;
- reasoning `none`;
- imagem `high` com lado máximo de 768 px;
- `store:false`;
- uma chamada de IA por foto;
- ambiguidades resolvidas por escolha curta do paciente;
- até quatro análises simultâneas quando o provedor é uma API externa.

A pasta de 200 imagens não foi usada para métricas de acurácia porque a auditoria anterior encontrou 71 pares imagem/rótulo desalinhados. Executá-la agora aumentaria o custo sem produzir uma comparação confiável.
