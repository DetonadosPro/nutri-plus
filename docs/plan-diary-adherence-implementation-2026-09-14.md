# Aderência Plano × Diário — v1

## Escopo

Esta camada é somente leitura. Ela compara a prescrição publicada válida em cada data com os registros do Diário, sem alterar plano, diário, alimentos ou substituições. Não produz nota global nem classificação moral do paciente.

## Regra histórica e temporal

- O dia é identificado por `daily_logs.log_date` em `America/Sao_Paulo`.
- Para cada dia, vale a versão publicada mais recente cujo dia local de `published_at` seja anterior à data do Diário; a vigência começa no próximo `log_date`.
- O dia da publicação permanece associado à versão anterior. Sem hora confiável da refeição, essa regra evita atribuir retrospectivamente uma prescrição publicada à tarde ao café da manhã daquele mesmo dia.
- Dia sem plano publicado é `no_plan` e não entra no denominador de refeições elegíveis.
- Mudança de plano no período é informada e cada dia conserva sua versão histórica.

## Correspondência determinística

1. A comparação ocorre somente dentro do mesmo `meal_type` canônico.
2. Cada item planejado e cada registro podem participar de no máximo uma correspondência.
3. A identidade original é priorizada antes de uma substituição aprovada.
4. Uma substituição só é aceita se estiver registrada historicamente no item daquela versão do plano.
5. Entre candidatos da mesma classe, vence a menor diferença proporcional de gramas; posições e ids estáveis encerram empates.
6. Um alimento não aprovado nunca é tratado como equivalente: aparece como adicional e o planejado permanece sem correspondente.

O pareamento usa atribuição bipartida determinística. Não há IA, aproximação semântica nem inferência de identidade alimentar.

## Quantidade

A comparação usa apenas `grams_equivalent` já persistido no plano, na substituição e no Diário. A aplicação não inventa conversão.

- `within_target`: diferença de até 10% **ou** até 5 g.
- `near_target`: diferença de até 25% **ou** até 10 g.
- `outside_target`: fora dos limites acima.
- `not_evaluable`: gramas ausentes ou não positivos.

Os pisos absolutos evitam penalizar desproporcionalmente porções pequenas. Volume e unidades contáveis só são comparáveis quando já possuem equivalente em gramas armazenado.

## Estados e denominadores

Itens: original correspondente, substituição aprovada, diferença relevante de quantidade, planejado sem registro e registro adicional. Refeições: compatível, parcialmente compatível, diferente ou sem registro suficiente.

- Cobertura: itens planejados com correspondência registrada / itens planejados elegíveis.
- Itens compatíveis: correspondências válidas / itens registrados avaliáveis, inclusive adicionais.
- Quantidade próxima: correspondências dentro ou próximas / correspondências com quantidade avaliável.
- Datas sem plano e ausência de registro não são chamadas de não aderência.

## Segurança, desempenho e manutenção

- O endpoint do paciente usa sua própria identidade; o endpoint profissional reutiliza a autorização de vínculo existente.
- O intervalo máximo é 90 dias.
- A leitura executa três consultas em lote: plano e itens, substituições das versões encontradas e Diário do período. Não há consulta por dia ou por item.
- As regras ficam versionadas como `plan-diary-adherence-v1` e os limites de quantidade são declarativos.
- A v1 não cria migração nem novo dado derivado persistente; a resposta sempre pode ser reproduzida a partir do histórico existente.

## Arquitetura e API

O módulo `backend/plan-diary-adherence.ts` concentra a leitura histórica, o pareamento e a agregação. O frontend consome um único contrato tipado nas duas experiências:

- `GET /api/patient/adherence?from=AAAA-MM-DD&to=AAAA-MM-DD`;
- `GET /api/nutritionist/patients/:patientId/adherence?from=AAAA-MM-DD&to=AAAA-MM-DD`.

A resposta contém período, timezone, indicação de troca de plano, resumo com denominadores, dias, versão numérica vigente, refeições, itens e estados humanos. IDs internos, telemetria, comentários clínicos e custos do matching não são expostos. O profissional só acessa paciente vinculado; o paciente só acessa a própria leitura.

Não foi necessária migration. Os índices existentes já cobrem paciente/data do Diário, relacionamento de refeições e itens, e paciente/status/versão do Plano. Também não foi criado cache: o custo é limitado a três consultas em lote.

## UX

Na área profissional, o painel aparece uma única vez no início da aba **Análise** da ficha do paciente, antes da composição nutricional existente. Ele apresenta quatro métricas principais, três contagens secundárias e detalhes expansíveis por dia, refeição e item, incluindo planejado e registrado.

Na área do paciente, o mesmo resultado aparece após o Plano Alimentar com o título **Como seu diário se aproximou do plano**. A versão simples omite identificadores, detalhes técnicos e contagens secundárias. Ambas oferecem 7 dias, 30 dias e período personalizado.

Os estados não dependem somente de cor: todos possuem rótulo textual. Dias e refeições usam controles nativos expansíveis, erros usam `role="alert"`, os seletores usam `aria-pressed` e animações são removidas com `prefers-reduced-motion`. Os layouts foram limitados a 76 rem, usam grades com `minmax(0, 1fr)` e colapsam em mobile sem tabela horizontal.

## Alterações retroativas

A análise é calculada sob demanda. Editar uma entrada antiga do Diário recalcula sua identidade/quantidade na próxima leitura; excluir uma entrada pode tornar a refeição `not_evaluable`. Isso reflete o estado histórico atualmente registrado no Diário sem alterar o Plano. Publicar uma nova versão de Plano não reescreve datas anteriores, porque a seleção continua baseada em `published_at`.

## Verificação da v1

Os testes cobrem alimento original, substituição aprovada e não aprovada, quantidades igual/próxima/diferente, pisos absolutos, alimento adicional, ausência de registro, gramas ausentes, duplicados, atribuição 1:1, barreira de `meal_type`, datas sem plano, período entre versões, substituições diferentes por versão, edição e exclusão retroativas, autorização dos três perfis e intervalos de 7/30 dias com contagem fixa de consultas.

Foram usados alimentos reais do catálogo TBCA nos cenários integrados: arroz branco cozido, feijão carioca cozido, peito de frango grelhado sem pele, leite integral pasteurizado e ovo de galinha cozido. Medidas visuais diferentes, inclusive mL/copo e unidades/gramas, só são comparadas pelos equivalentes históricos já armazenados.

Medição inicial com fixture de interface: 7 dias, 3 consultas, 19,95 ms e 9.754 bytes; 30 dias, 3 consultas, 3,58 ms e 19.114 bytes. Os tempos são uma amostra local e podem variar; o número de consultas é invariável no intervalo.

O catálogo permaneceu em 5.874 alimentos ativos e 8.317 medidas. Nenhum arquivo de catálogo, fingerprint, substituição ou migration foi alterado.

## Limitações conhecidas

- A vigência é diária e conservadora: a nova versão começa no `log_date` seguinte, mesmo se tiver sido publicada à meia-noite.
- A v1 não tenta aproximar refeições de tipos diferentes, nem mesmo `other`.
- Identidade compatível depende de `food_id` original ou de alternativa explicitamente publicada; não há similaridade automática.
- Sem `grams_equivalent` confiável, a identidade ainda pode ser compatível, mas a quantidade permanece `not_evaluable`.
- Não há revisão semanal, recomendação clínica automática, edição inline, score único, gamificação, notificação ou IA.

## Revisão semântica final

### Fórmulas e regras

- **Coverage:** `coveredPlannedItems / eligiblePlannedItems`. Numerador: `matched_original`, `matched_substitution` e `matched_quantity_difference`. Denominador: todo item planejado em dia com plano vigente. `planned_not_recorded` fica somente no denominador; adicionais e `no_plan` não entram.
- **Compatibility dos registros:** `compatibleItems / evaluableRecordedItems`. Numerador: os três estados de match. Denominador: registros em dias com plano, incluindo `extra_recorded`. Isso descreve os registros, não pune o item planejado: um extra não reduz coverage nem muda sozinho o estado da refeição.
- **Quantity alignment:** `quantityAlignedItems / quantityEvaluableItems`. Numerador: matches `within_target` ou `near_target`. Denominador: somente matches com `grams_equivalent` válido dos dois lados. Missing, extra, `no_plan` e quantidade `not_evaluable` ficam fora.

Estados de refeição:

- `not_evaluable`: nenhum item registrado na refeição; ausência não é diferença.
- `different`: há registro, mas nenhuma identidade original ou substituição aprovada encontrou correspondência.
- `mostly_aligned`: existe ao menos um match, mas algum item planejado ficou sem correspondente ou algum match tem quantidade `outside_target`.
- `aligned`: todos os itens planejados têm match e não existe diferença de quantidade conhecida fora da faixa. Extras não alteram esse estado; quantidade não avaliável também não vira diferença sem evidência.
- `no_plan`: estado do dia anterior à primeira vigência, fora de todos os denominadores.

### Matriz de 20 cenários

`C` indica impacto em coverage, `I` em compatibility dos registros e `Q` em quantity alignment.

| # | Planejado | Diário | Matches | Missing | Extras | Quantidade | Refeição | Métricas |
|---:|---|---|---|---|---|---|---|---|
| 1 | arroz 100 | arroz 100 | original | 0 | 0 | within | aligned | C 1/1; I 1/1; Q 1/1 |
| 2 | arroz 100 | arroz 105 | original | 0 | 0 | within | aligned | C 1/1; I 1/1; Q 1/1 |
| 3 | arroz 100 | arroz 120 | original | 0 | 0 | near | aligned | C 1/1; I 1/1; Q 1/1 |
| 4 | arroz 100 | arroz 150 | quantidade diferente | 0 | 0 | outside | mostly | C 1/1; I 1/1; Q 0/1 |
| 5 | arroz | nenhum | 0 | arroz | 0 | N/A | not_evaluable | C 0/1; I 0/0; Q 0/0 |
| 6 | arroz, feijão, frango | arroz | original | feijão, frango | 0 | within | mostly | C 1/3; I 1/1; Q 1/1 |
| 7 | arroz | arroz, tomate | original | 0 | tomate | within | aligned | C 1/1; I 1/2; Q 1/1 |
| 8 | arroz, alternativa mandioca | batata | 0 | arroz | batata | N/A | different | C 0/1; I 0/1; Q 0/0 |
| 9 | arroz | arroz, batata | original | 0 | batata | within | aligned | C 1/1; I 1/2; Q 1/1 |
| 10 | arroz, alternativa mandioca | mandioca | substituição | 0 | 0 | within | aligned | C 1/1; I 1/1; Q 1/1 |
| 11 | arroz 100, arroz 200 | arroz 190, arroz 105 | 100↔105; 200↔190 | 0 | 0 | within/within | aligned | C 2/2; I 2/2; Q 2/2 |
| 12 | A aceita mandioca; B é mandioca | mandioca | original B | A | 0 | within | mostly | C 1/2; I 1/1; Q 1/1 |
| 13 | dois itens aceitam mandioca | uma mandioca | uma substituição | um item | 0 | within | mostly | C 1/2; I 1/1; Q 1/1 |
| 14 | dois candidatos de custo igual | um registro | match estável | um item | 0 | within | mostly | resultado idêntico em 20 execuções |
| 15 | arroz sem gramas | arroz 100 | original | 0 | 0 | not_evaluable | aligned | C 1/1; I 1/1; Q 0/0 |
| 16 | arroz 100 | arroz sem gramas | original | 0 | 0 | not_evaluable | aligned | C 1/1; I 1/1; Q 0/0 |
| 17 | nenhum nesse meal_type | arroz | 0 | 0 | arroz | N/A | different | C 0/0; I 0/1; Q 0/0 |
| 18 | arroz, feijão | arroz, batata | original | feijão | batata | within | mostly | C 1/2; I 1/2; Q 1/1 |
| 19 | arroz; alternativa 180 | alternativa 250 | substituição | 0 | 0 | outside | mostly | C 1/1; I 1/1; Q 0/1 |
| 20 | dois itens | dois registros near | dois originais | 0 | 0 | near/near | aligned | C 2/2; I 2/2; Q 2/2 |

### Ambiguidade, histórico e tempo

O Húngaro escolheu 100↔105 e 200↔190 no caso duplicado. Quando dois itens aceitam a mesma substituição e existe uma só entrada, apenas um recebe match; o outro permanece missing. O mesmo empate foi executado 20 vezes com resultado idêntico.

Os golden tests confirmam v1 com mandioca, v2 com alternativa diferente, período cruzando versões, `no_plan`, edição e exclusão retroativas. `created_at` e `consumed_at` não escolhem a versão do plano; aparecem apenas na ordenação estável das entradas dentro da mesma refeição.

Foram avaliadas três opções para publicação no meio do dia. Aplicar a versão no mesmo dia atribuiria prescrição futura a refeições anteriores; usar horário de criação/registro inventaria uma precisão que o Diário retroativo não garante; tornar todo o dia não avaliável descartaria inclusive dados legitimamente comparáveis com o plano anterior. A decisão final é iniciar a nova versão no próximo `log_date`.

### Benchmark repetido

Com 30 dias, três refeições e três itens por refeição — 270 entradas reais de volume — foram feitas dez iterações alternadas após aquecimento:

- 7 dias: mínimo 3,54 ms; mediana 5,09 ms; média 5,36 ms; máximo 7,56 ms; payload 21.585 bytes.
- 30 dias: mínimo 5,84 ms; mediana 6,68 ms; média 6,97 ms; máximo 8,94 ms; payload 90.912 bytes.
- 1, 7 e 30 dias: exatamente três queries em todos os casos.

Alterações desta revisão: coverage passou de refeições para itens planejados, o texto de compatibility foi tornado explicitamente orientado aos registros, a vigência passou para o dia seguinte à publicação e foram adicionados golden tests semânticos. Não houve mudança de thresholds, arquitetura, catálogo, substituições ou persistência.
