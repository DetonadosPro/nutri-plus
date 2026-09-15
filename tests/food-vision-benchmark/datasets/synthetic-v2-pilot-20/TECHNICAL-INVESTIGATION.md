# Investigação técnica — reconhecimento de alimentos por foto

Data: 2026-09-09  
Escopo observado: pipeline publicado em `ec436e3`, baseline Luna low do piloto corrigido de 20 imagens.  
Natureza deste trabalho: investigação e proposta. Nenhum código de produção, prompt, threshold, alias, banco ou ground truth foi alterado; nenhuma chamada paga adicional foi feita.

## 1. Conclusão executiva

O reconhecimento visual já funciona melhor que a resolução nutricional: 31 dos 32 componentes foram identificados visualmente, enquanto apenas 11 dos 27 componentes codificáveis terminaram com um código TBCA aceitável selecionado. A diferença entre top-1 acceptable (19/27) e seleção acceptable (11/27) acontece principalmente porque nove componentes tinham um candidato aceitável em primeiro lugar, mas terminaram em `ASK_USER`; um reranker recuperou um caso cujo top-1 não era aceitável. O saldo líquido é a diferença de oito pontos observada no relatório.

O gargalo principal é estrutural. O código tenta comparar diretamente uma descrição visual curta com 5.874 registros nutricionais muito específicos. Ele ainda não representa separadamente:

- identidade visual canônica;
- atributos realmente observáveis;
- atributos invisíveis;
- família e subtipo alimentar;
- variante nutricional TBCA;
- ausência legítima de correspondência exata.

O score satura em `1,0` para muitos candidatos semanticamente diferentes. Empates provocam chamadas visuais que tentam decidir sal, óleo, receita ou ingrediente interno, algo que a imagem não contém. A preferência de produto pela variante “com sal” não está implementada; empates acabam ordenados principalmente pelo código TBCA.

**Eu recomendo para o Nutri+ uma arquitetura hierárquica de identidade visual canônica e famílias de variantes TBCA, com filtros determinísticos e opção explícita de abstenção.** O reranker visual deve ser reservado a diferenças observáveis e, quando necessário, executado uma vez por foto com todos os itens ainda ambíguos. Embeddings podem ser avaliados posteriormente como mecanismo auxiliar de recall, nunca como autoridade de seleção.

## 2. Arquitetura atual encontrada

O fluxo real é:

```text
imagem JPEG/PNG/WebP
  -> sanitização, rotação, resize para até 1024 px e JPEG sem metadados
  -> gpt-5.6-luna, reasoning low, store:false
  -> name + preparation + visibleDetails + confidence + alternative
  -> deduplicação lexical
  -> carregamento dos 5.874 alimentos TBCA do PostgreSQL
  -> ranking de todos os alimentos em JavaScript para cada detecção
  -> AUTOSELECT | RERANK | NO_MATCH
  -> nova chamada Luna por item classificado como RERANK
  -> RERANK selecionado | ASK_USER
  -> UI de revisão, quantidade e refeição
  -> feedback depois que a refeição é salva
```

### Visão e contrato

`services/food-vision/server.ts` contém os dois prompts. O primeiro proíbe códigos, nutrientes, quantidades e atributos invisíveis. O schema em `shared/food-recognition.ts` permite até 15 itens e, para cada item, `name`, `preparation`, até seis `visibleDetails`, `confidence` e uma `alternative`. O contrato é estrito e rejeita campos inventados.

O provider em `services/food-vision/providers.ts` envia a imagem com detalhe alto pela Responses API. Para Luna, fixa `reasoning.effort=low`, `store=false`, Structured Outputs e verbosity baixa. O teste do provider verifica essas propriedades.

### Normalização e consultas canônicas

`normalizeFoodName` remove acentos, pontuação e caixa. O stemmer trata somente algumas flexões de cozido, grelhado, frito e assado, depois remove qualquer `s` final. `canonicalQueries` cria:

1. nome detectado;
2. nome + preparo;
3. detalhes considerados “traços” + nome + preparo;
4. alternativa + preparo.

Porém `usefulDetails` retém apenas preparo ou os traços `peito`, `coxa`, `sobrecoxa`, `file`, `integral`, `branco`, `branca`, `refinado`, `refinada` e `pele`. Descrições como “gema inteira”, “clara branca”, “grãos marrons”, “palitos”, “com osso”, “fatias brancas” e “folhas crespas” são descartadas antes do ranking.

### Retrieval e ranking

O endpoint de foto não usa os índices trigram do PostgreSQL. Ele lê todos os alimentos ativos e executa `rankSemanticFoodCandidates` em memória para cada detecção. Com 42 detecções no piloto, o matcher levou em média 1,31 s por item.

O score atual soma:

- 48% de correspondência lexical;
- 27% de tokens de identidade;
- 16% de preparo;
- 9% de traço;
- bônus ou penalidade de 0,12 conforme a identidade apareça nos dois primeiros tokens;
- penalidade de 0,22 por contradição;
- penalidade limitada de especificidade, prato composto e ingrediente acrescentado.

O resultado é limitado a 0–1. Como os bônus podem levar o valor bruto acima de 1, muitos candidatos diferentes ficam igualmente em `1,0`; a saturação destrói margem e ordem útil.

As contradições cobrem somente quatro grupos: cru/cozido, frito/grelhado/assado/cozido, integral/branco/refinado e peito/coxa/sobrecoxa. Não existem relações estruturadas para espécie animal, alimento inteiro versus parte, embutido versus carne, variedade vegetal, componente simples versus receita ou ingrediente principal versus ingrediente secundário.

### Decisão e reranker

- `AUTOSELECT`: top-1 ≥ 0,84, margem ≥ 0,06, confiança visual ≥ 0,65 e sem contradição.
- `RERANK`: ao menos dois candidatos e top-1 ≥ 0,55.
- `NO_MATCH`: demais situações.
- Após o reranker, confiança ≥ 0,72 e escolha não incerta resultam em seleção; o restante vira `ASK_USER`.

O reranker recebe os candidatos situados até 0,10 do top-1, limitado aos cinco já recuperados. Ele recebe novamente a imagem inteira. Não existe regra para impedir a chamada quando os candidatos diferem apenas em atributo invisível.

### Catálogo, aliases e busca manual

O PostgreSQL mantém nome original, nome amigável, aliases e versões normalizadas. Existem índices GIN trigram sobre nome amigável e texto de busca. A busca manual usa tokens com `LIKE` e ordena por igualdade, prefixos, aliases e `similarity`. A rota de foto, entretanto, não usa essa busca nem os índices; usa uma varredura completa em JavaScript.

Os aliases são parte do arquivo TBCA importado e não há taxonomia de identidade visual ou relacionamento explícito entre variantes. Um candidato agrega tokens de display name, todos os aliases e nome original em um único conjunto; isso pode fazer atributos provenientes de representações distintas parecerem simultaneamente confirmados.

### UI e telemetria

`frontend/app/components/food-photo-review.tsx` seleciona automaticamente linhas em `AUTOSELECT` e `RERANK`; `ASK_USER` mostra até três nomes TBCA; `NO_MATCH` orienta busca manual. A interface não distingue identidade não reconhecida de identidade reconhecida sem TBCA exata. Todas as linhas precisam ter alimento e gramas, então uma guarnição incidental também bloqueia o salvamento até ser excluída ou resolvida.

As tabelas de telemetria guardam modelo, esforço, tokens, latência agregada, contagem dos quatro estados, score, margem e IDs previsto/final. Elas não guardam, nem mesmo de forma normalizada, identidade detectada, candidatos apresentados, motivo da abstenção, papel visual ou pergunta feita. O feedback só é enviado depois do salvamento e não registra explicitamente itens removidos ou rejeitados.

## 3. Por que top-1 acceptable foi 70,37% e a seleção caiu para 40,74%

Os 19 top-1 aceitáveis se decompõem assim:

- 6 viraram `AUTOSELECT` e permaneceram corretos;
- 4 passaram pelo reranker e terminaram aceitáveis;
- 9 ficaram em `ASK_USER`, embora o primeiro candidato já fosse aceitável.

Além disso, o reranker recuperou um caso cujo top-1 não era aceitável: a alface de `food-010`. Portanto:

```text
seleções aceitáveis = 6 AUTOSELECT + 4 reranks que já tinham top-1 aceitável
                      + 1 recuperação do reranker
                    = 11

diferença para top-1 = 9 top-1 aceitáveis retidos em ASK_USER
                       - 1 caso recuperado pelo reranker
                     = 8
```

Os nove top-1 aceitáveis retidos foram arroz branco (`food-001`, `food-008`, `food-010`), feijão preto (`food-004`, `food-010`), ovo cozido (`food-006`), feijão carioca (`food-008`), mandioca (`food-013`) e batata cozida (`food-014`). O padrão dominante é empate entre variantes ou identidades próximas, seguido de abstenção correta do reranker. Isso mostra que simplesmente reduzir thresholds seria perigoso: o top-1 está frequentemente correto, mas o score não contém evidência suficiente para separar o primeiro dos demais.

## 4. Diagnóstico dos 27 componentes com TBCA resolvida

`Pos.` é a primeira posição de um código aceito entre os cinco candidatos; `—` significa ausente dos cinco. Score e margem são os valores antes do reranker.

| Caso | Esperado | Visão | Pos. | Score | Margem | Final | Rerank | Responsável principal |
|---|---|---|---:|---:|---:|---|---|---|
| 001 | Arroz branco cozido | arroz/cozido | 1 | 1,000 | 0 | ASK | sim | variantes invisíveis empatadas |
| 002 | Arroz integral cozido | arroz/cozido | 2 | 1,000 | 0 | ASK | sim | visão omitiu “integral”; ranking saturado |
| 003 | Feijão carioca cozido | feijão/cozido | — | 1,000 | 0 | ASK | sim | visão omitiu tipo; retrieval não usa cor observada |
| 004 | Feijão preto cozido | feijão-preto/cozido | 1 | 1,000 | 0 | ASK | sim | sal, óleo e método empatados |
| 005 | Ovo frito | ovo/frito | 1 | 1,000 | 0 | RERANK aceitável | sim | variante de sal; rerank desnecessário |
| 006 | Ovo de galinha cozido | ovo/cozido | 1 | 0,9832 | 0 | ASK | sim | galinha/codorna/inteiro/clara sem hierarquia |
| 008-F | Peito de frango grelhado | frango/grelhado | — | 0,8980 | 0,0500 | ASK | sim | “frango” como ingrediente de linguiça domina |
| 008-A | Arroz branco cozido | arroz/cozido | 1 | 1,000 | 0 | ASK | sim | variantes invisíveis empatadas |
| 008-B | Feijão carioca cozido | feijão/cozido | 1 | 1,000 | 0 | ASK | sim | tipo omitido; várias espécies empatadas |
| 008-L | Alface crua | alface/crua | 1 | 1,000 | 0 | RERANK aceitável | sim | variedades de alface empatadas |
| 008-T | Tomate cru | tomate/cru | 1 | 1,000 | 0,0808 | AUTOSELECT | não | correto; identidade e preparo claros |
| 008-C | Cebola crua | cebola/crua | 1 | 1,000 | 0,0048 | RERANK exato | sim | branca versus roxa, diferença visível |
| 009 | Coxa de frango assada | pernil suíno/assado | — | 0 | 0 | ausente | não | erro de visão; matcher coerente com a visão errada |
| 010-A | Arroz branco cozido | arroz/cozido | 1 | 1,000 | 0 | ASK | sim | variantes invisíveis empatadas |
| 010-B | Feijão preto cozido | feijão-preto/cozido | 1 | 1,000 | 0 | ASK | sim | variantes invisíveis empatadas |
| 010-L | Alface crua | alface/cru | 5 | 0,7400 | 0 | RERANK exato | sim | `cru` e `crua` viram contradição; saladas compostas sobem |
| 010-T | Tomate cru | tomate/cru | 1 | 1,000 | 0,0808 | AUTOSELECT | não | correto |
| 011 | Filé de peixe grelhado | filé de peixe; alternativa salmão | — | 0,9560 | 0 | RERANK incorreto | sim | alternativa visual força espécie sem evidência suficiente |
| 013 | Mandioca cozida | mandioca/cozida | 1 | 1,000 | 0 | ASK | sim | óleo, sal e cozida/assada empatados |
| 014 | Batata inglesa cozida | batata/cozida | 1 | 1,000 | 0 | ASK | sim | inglesa, doce e baroa empatadas |
| 015 | Batata inglesa frita | batata frita | 4 | 1,000 | 0,0060 | ASK | sim | receita com bacon/queijo vence; penalidade satura |
| 016 | Espaguete ao molho de tomate | espaguete/cozido | — | 0 | 0 | NO_MATCH | não | lacuna entre “espaguete” e “macarrão”/aliases |
| 017 | Lasanha bolonhesa | lasanha/assada | 1 | 1,000 | 0,0748 | AUTOSELECT | não | correto; detalhes estruturais sustentam identidade |
| 018-L | Alface crua | alface/crua | 1 | 1,000 | 0 | RERANK aceitável | sim | variedades empatadas |
| 018-T | Tomate cru | tomate/cru | 1 | 1,000 | 0,0808 | AUTOSELECT | não | correto |
| 018-P | Pepino cru | pepino/cru | 1 | 1,000 | 0,1660 | AUTOSELECT | não | correto |
| 019 | Tomate cru | tomate/cru | 1 | 1,000 | 0,0808 | AUTOSELECT | não | correto |

Os cinco candidatos, scores, contradições, detalhes visuais e códigos de cada linha estão em `offline-diagnosis.json`.

## 5. Cinco identidades sem TBCA defensável

### Omelete simples (`food-007`)

A visão reconheceu corretamente “omelete”, frita, com formato dobrado e superfície dourada. Os cinco primeiros candidatos acrescentam vegetais, carne, queijo ou frios. O problema é ausência de preparação exata e receita desconhecida, não falha visual. UX ideal: mostrar “Omelete” como identidade reconhecida e perguntar, em uma única etapa, se havia recheio. “Sem recheio” não pode ser ligado a um omelete TBCA específico inexistente; deve levar a composição por ingredientes confirmados ou busca manual. Até essa infraestrutura existir, não registrar nutrição sem confirmação.

### Bife bovino grelhado (`food-010`)

A visão reconheceu bife bovino grelhado, mas o catálogo oferece cortes e receitas específicas. Os primeiros resultados atuais são bife a cavalo, à parmegiana e à rolê, embora esses preparos não apareçam. O problema combina corte desconhecido, ausência de variante genérica e ranking inadequado. UX ideal: identidade “Bife bovino grelhado” e pergunta opcional sobre corte, com “Não sei” explícito. Sem corte, o sistema deve permanecer em `NO_EXACT_TBCA_MATCH`; não deve assumir maminha, picanha ou contrafilé.

### Farofa (`food-010`)

A visão identificou farofa, mas todos os candidatos incorporam carne, linguiça, bacon, ovos, farinha específica ou outra receita. O problema é receita desconhecida. UX ideal: uma pergunta curta sobre o tipo quando o usuário souber, com busca manual. Uma composição por ingredientes só é segura se o usuário informar os ingredientes; a aparência bege não autoriza inferi-los.

### Filé de peixe empanado (`food-012`)

A visão identificou “filé de peixe empanado”, frito, e ofereceu frango empanado como alternativa. O único candidato próximo força pescada, empanamento e fritura. O problema é espécie desconhecida e possível ambiguidade de identidade. UX ideal: primeiro confirmar “peixe ou frango”; depois perguntar espécie somente se o usuário souber. Se confirmar peixe sem saber a espécie, manter a identidade genérica e sinalizar ausência de TBCA exata.

### Queijo (`food-020`)

A visão retornou apenas “queijo”, com fatias claras e pequenos furos. A intenção de geração dizia muçarela, mas isso não é evidência visual. Os primeiros candidatos são diferentes queijos light. O problema é variedade desconhecida. UX ideal: mostrar poucas famílias visualmente plausíveis, permitir “Não sei” e busca manual. O sistema não deve transformar automaticamente “queijo” em muçarela.

Esses cinco casos pedem um estado de domínio próprio: `NO_EXACT_TBCA_MATCH`. Eles foram corretamente excluídos do denominador de pareamento, mas o produto atual ainda não consegue representá-los de forma diferente de `ASK_USER`/`NO_MATCH`.

## 6. As 11 detecções extras

| Classe | Quantidade | Casos | Tratamento recomendado |
|---|---:|---|---|
| Objeto/identidade errada | 2 | queijo inexistente sobre o ovo em 005; pernil em vez de coxa em 009 | revisão normal; nunca autoincluir |
| Guarnição real | 2 | limão e alface em 012 | ocultar por padrão; oferecer “incluir” se porção relevante |
| Alimento real ao fundo | 5 | coentro em 004; salada, carne e feijão em 013; folhas em 017 | classificar como background e não criar linha principal |
| Parte real de preparação composta | 2 | molho de tomate e salsinha em 016 | anexar como evidência da preparação, sem duplicar no diário |

Nenhum dos 11 deve ser registrado automaticamente como uma linha separada. A primeira visão precisa retornar `role` (`MAIN`, `SIDE`, `GARNISH`, `BACKGROUND`, `INTEGRATED`) e uma noção de significância da porção. O backend deve manter componentes incidentais como sugestões recolhidas ou ignoradas, não como campos obrigatórios que bloqueiam o salvamento.

## 7. Causas raiz

Nos 27 componentes codificáveis, a atribuição principal foi:

- 7 empates de variantes invisíveis;
- 6 fluxos corretos;
- 3 identidades visuais subespecificadas;
- 2 empates de variedade;
- 2 ausências de hierarquia de identidade;
- 1 vazamento de ingrediente secundário para identidade principal;
- 1 erro de normalização com viés para preparação composta;
- 1 penalidade de especificidade insuficiente;
- 1 rerank útil por variedade visível;
- 1 erro visual;
- 1 excesso de especificidade visual;
- 1 lacuna de alias/retrieval.

Os problemas estruturais são:

1. **Comparação de níveis diferentes.** Uma identidade visual genérica é comparada diretamente com receitas nutricionais específicas.
2. **Score saturado e não calibrado.** Muitos itens recebem 1,0; margem zero deixa de informar risco.
3. **Sem taxonomia.** Tokens não sabem que linguiça de frango não é frango em filé, que ovo de codorna difere de ovo de galinha, ou que clara não é ovo inteiro.
4. **Detalhes observados descartados.** A maior parte de `visibleDetails` nunca influencia a decisão.
5. **Contradições incompletas e erro morfológico.** `cru` e `crua` não são unificados; atributos de espécie, parte e receita não têm oposição.
6. **Penalidade posterior fraca.** Receita específica pode obter score máximo antes que a penalidade faça diferença.
7. **Reranker aplicado ao problema errado.** A mesma foto é usada para decidir atributos invisíveis.
8. **Sem estado de catálogo aberto.** Ausência de item exato é confundida com baixa qualidade do matcher.
9. **Retrieval caro e pouco seletivo.** Há varredura completa em JavaScript por componente apesar dos índices PostgreSQL existentes.
10. **Telemetria insuficiente para causa.** Produção não preserva candidatos, motivo de abstenção nem papel visual.

## 8. O que funciona e deve ser preservado

- PostgreSQL/TBCA permanece a única fonte de códigos e nutrientes.
- O Luna não recebe nem devolve IDs, códigos, calorias ou nutrientes.
- Structured Outputs e schemas estritos limitam a superfície de erro.
- A imagem é decodificada, redimensionada e regravada sem metadados.
- `store:false`, autenticação local e rate limit já existem.
- O sistema abstém em vez de autoselecionar agressivamente: 6/6 AUTOSELECT foram corretos neste piloto.
- A UI permite trocar, buscar, remover e adicionar alimento antes de salvar.
- O feedback usa IDs oficiais e não altera catálogo/aliases automaticamente.
- O benchmark separa top-k, seleção final, custo, latência e denominadores.

## 9. Arquiteturas consideradas

### A — Refinar o matcher lexical atual

Funcionamento: corrigir stemming, ampliar contradições, endurecer a penalidade de receitas, aplicar a regra de sal e usar detalhes visuais adicionais.

- Impacto esperado: melhora imediata em ovos, frango, batata e flexões; menos resultados absurdos.
- Risco: regras continuam concorrendo dentro de uma soma saturável; alta chance de exceções e regressões fora do piloto.
- Complexidade: baixa a média.
- Custo/latência: menor se eliminar rerankers invisíveis; varredura completa continua.
- Banco: nenhuma migration obrigatória.
- Frontend: pouca mudança; não resolve estados novos adequadamente.
- Sem TBCA exata: continuaria fraco, exigindo exceções.
- Teste: replay offline e conjunto amplo de pares positivos/negativos.

Serve como correção temporária, mas não como arquitetura final.

### B — Identidade canônica + famílias de variantes TBCA + abstenção

Funcionamento: a visão produz identidade e atributos estruturados; um resolver escolhe primeiro a identidade canônica; o catálogo possui vínculo auditável entre identidade e variantes TBCA, separando atributos visíveis e invisíveis. Filtros determinísticos eliminam espécie, parte e preparo contraditórios antes do ranking. A variante só é resolvida automaticamente quando as evidências e a política permitem.

- Impacto esperado: elimina a maioria dos empates inúteis, impede receitas incompatíveis e cria resposta correta para itens fora do catálogo exato.
- Risco: exige curadoria/versionamento da taxonomia; agrupamento incorreto pode esconder opção válida.
- Complexidade: média a alta, implementável por fases.
- Custo/latência: retrieval pequeno por família; reranker apenas em ambiguidade observável e potencialmente uma vez por foto.
- Banco: novas tabelas de identidades, aliases e vínculos de variantes; `foods` permanece oficial e intacta.
- Frontend: passa a exibir identidade amigável, pergunta curta de atributo ou estado sem TBCA exata.
- Sem TBCA exata: estado de primeira classe; confirmação, busca ou composição confirmada.
- Regressão: controlada por replay offline e regras invariantes de família/preparo.
- Teste: unidade, catálogo, replay, shadow e benchmark real independente.

É a arquitetura recomendada.

### C — Busca híbrida com embeddings e reranker semântico

Funcionamento: lexical/trigram + vetor geram candidatos; um modelo textual ou multimodal reordena.

- Impacto esperado: melhor recall para sinônimos e descrições incomuns.
- Risco: similaridade vetorial também aproxima receitas semanticamente relacionadas, sem provar atributos; pode tornar decisões menos explicáveis.
- Complexidade: alta; possível dependência de pgvector/modelo de embeddings e reindexação.
- Custo/latência: embeddings do catálogo podem ser pré-computados, mas consultas e rerank adicionam operação e custo.
- Banco: extensão/coluna vetorial ou serviço externo.
- Frontend: mesmos estados da arquitetura B ainda seriam necessários.
- Sem TBCA exata: embeddings não resolvem; é obrigatório manter abstenção.
- Teste: recall@k, precisão por família, drift do modelo e latência.

Pode ser adicionado depois da arquitetura B como fallback de recall. Não recomendo começar por ele.

O PostgreSQL já oferece full-text search e `pg_trgm`, inclusive índices e operadores próprios para similaridade e vizinhos próximos; isso é suficiente para um primeiro retrieval estruturado e explicável ([Full Text Search](https://www.postgresql.org/docs/current/textsearch.html), [`pg_trgm`](https://www.postgresql.org/docs/17/pgtrgm.html)). Embeddings não são necessários para corrigir as falhas centrais observadas.

## 10. Arquitetura recomendada

```text
imagem sanitizada
  -> visão estruturada
       identidade canônica sugerida
       preparo e forma observáveis
       espécie/parte/variedade somente quando visíveis
       papel: principal, acompanhamento, guarnição, fundo, integrado
       confiança por identidade e por atributo
  -> normalização/taxonomia
  -> retrieval de identidades canônicas
       aliases + trigram + família
  -> filtros determinísticos
       tipo, origem animal, parte, preparo, simples versus composto
  -> ranking de identidade
  -> resolução da família de variantes TBCA
       atributos visíveis preservados
       “com sal” somente quando sal for a única diferença
       nenhum padrão automático para óleo, açúcar, espécie, corte ou receita
  -> decisão
       AUTOSELECT
       ASK_IDENTITY
       ASK_ATTRIBUTE
       NO_EXACT_TBCA_MATCH
       NO_VISUAL_IDENTITY
  -> reranker visual opcional e batched
       apenas se candidatos diferirem por algo realmente visível
  -> UI: código oculto, uma identidade amigável, quantidade
```

Essa separação segue a ideia de classificação seletiva: cobertura deve ser aumentada mantendo o risco dos casos aceitos sob controle, e o sistema precisa poder rejeitar classes ou variantes fora do conjunto conhecido. A literatura de selective classification formaliza o compromisso risco-cobertura ([Geifman e El-Yaniv, 2017](https://arxiv.org/abs/1705.08500)); open-set recognition trata explicitamente a necessidade de rejeitar entradas que não pertencem às classes conhecidas ([Bendale e Boult, CVPR 2016](https://openaccess.thecvf.com/content_cvpr_2016/html/Bendale_Towards_Open_Set_CVPR_2016_paper.html)). A proposta usa esses princípios como desenho de produto, sem importar automaticamente os modelos desses artigos.

### Estados de saída

- `AUTOSELECT`: identidade e variante TBCA defensáveis; nutrição pronta.
- `ASK_IDENTITY`: duas ou três identidades visualmente plausíveis, como peixe versus frango empanado.
- `ASK_ATTRIBUTE`: identidade conhecida, mas falta um atributo que o usuário pode saber, como corte ou recheio.
- `NO_EXACT_TBCA_MATCH`: identidade visual segura, nenhuma variante do catálogo compatível sem inventar informação.
- `NO_VISUAL_IDENTITY`: a própria comida não foi reconhecida com segurança.
- `IGNORED_INCIDENTAL`: alimento real classificado como fundo/guarnição pequena; não bloqueia o fluxo.

`NO_EXACT_TBCA_MATCH` não pode gerar calorias. A UI pode manter a identidade visual enquanto pede ajuste, mas uma entrada nutricional exige um `food_id` oficial ou uma composição criada com ingredientes confirmados. Uma composição do aplicativo precisa ter proveniência, versão e ingredientes auditáveis; não deve ser uma média silenciosa de receitas TBCA.

### Regra de sal

A regra deve atuar depois de identidade, preparo e todos os demais atributos estarem iguais. Dentro de um grupo de variantes cuja única diferença seja sal, escolhe-se “com sal” e registra-se `resolution_policy=salt_default`. Se qualquer diferença adicional existir, não se aplica. Isso é política do produto, não inferência visual.

### Reranker

Não chamar reranker para pares que diferem somente em sal ou outro atributo invisível. Usá-lo apenas quando a resposta puder ser encontrada na imagem: branca versus roxa, inteira versus clara, coxa versus peito quando visível, peixe versus frango. Agrupar todas as dúvidas observáveis de uma foto em uma chamada estruturada reduz o pior caso de uma chamada por componente. A seleção ainda passa por filtros determinísticos; o reranker não cria candidatos nem códigos.

## 11. Modelo de dados proposto

Sem alterar a tabela oficial `foods`, uma migration futura criaria estruturas equivalentes a:

- `food_visual_identities`: nome canônico, família, categoria, identidade pai e estado ativo;
- `food_visual_identity_aliases`: alias, origem e versão;
- `food_visual_variants`: identidade, `food_id` TBCA, atributos visíveis, atributos invisíveis, tipo simples/composto e prioridade de política;
- `food_resolution_policies`: política versionada, incluindo o padrão de sal;
- extensões de telemetria para estado, motivo, identidade, candidatos e papel visual.

JSONB pode guardar assinaturas durante a primeira versão, mas campos usados como filtros centrais — família, espécie/origem, parte, preparo e tipo de receita — devem ser colunas ou relações controladas. A geração inicial do agrupamento pode ser automatizada, mas precisa de validação semântica e relatório de cobertura antes de ativação.

## 12. UX recomendada

### Caso seguro

```text
Arroz branco cozido                 [100 g]
✓ Identificado
```

Variantes internas de sal não aparecem. A política usada fica disponível apenas em detalhes.

### Dúvida de identidade

```text
O empanado era:
[ Peixe ] [ Frango ] [ Buscar outro ]
```

### Identidade conhecida, catálogo insuficiente

```text
Omelete reconhecida
Precisamos saber o recheio para calcular.
[ Sem recheio ] [ Queijo ] [ Outro ]
```

Se “sem recheio” ainda não tiver uma composição confiável, a interface explica brevemente e abre a composição/busca. Códigos e nomes técnicos longos permanecem ocultos.

Guarnições e fundo ficam recolhidos em “Também vimos”, sem impedir o botão de confirmar. Uma porção significativa pode ser incluída pelo usuário.

## 13. Impacto qualitativo esperado

Sem inventar percentuais, a arquitetura deve:

- preservar a precisão conservadora de AUTOSELECT;
- converter empates de sal em decisão determinística auditável;
- retirar receitas incompatíveis antes do score;
- reduzir ASK_USER causado por variantes invisíveis;
- diminuir candidatos apresentados;
- reduzir chamadas de reranker;
- melhorar explicabilidade e telemetria;
- diferenciar erro visual, retrieval, ambiguidade e ausência de item exato;
- reduzir a latência do matcher por trabalhar em conjuntos menores e indexados.

O caso da coxa/pernil continua sendo um erro de visão. O schema mais estruturado pode pedir origem animal e parte com confiança própria, mas uma imagem sintética não justifica regra específica. A correção precisa ser avaliada em várias coxas, pernis, sobrecoxas e cortes suínos reais.

## 14. Riscos e controles

- **Taxonomia incorreta:** revisão humana, versionamento e constraints de família.
- **Padrão nutricional indevido:** políticas só atuam quando todas as demais dimensões coincidem.
- **Confiança autorreportada não calibrada:** avaliar curva risco-cobertura com dados rotulados; não tratar `confidence` do Luna como probabilidade.
- **Overfitting ao piloto:** conjunto real separado, casos negativos e congelamento do ground truth antes do teste.
- **Compostos versus componentes:** regra explícita de exclusividade e associação um-para-um.
- **Privacidade na telemetria:** armazenar IDs/taxonomia e motivos; evitar imagem e texto livre quando não necessários.
- **Regressão de recall:** retrieval deve medir recall@k antes de qualquer autoseleção.
- **Migration grande:** gerar relatório offline completo e ativar por feature flag depois da validação.

## 15. Plano de implementação proposto

1. Congelar `ec436e3`, o piloto e as predições atuais como baseline.
2. Definir o schema de identidade, atributos, papéis visuais e estados de saída.
3. Criar um artefato offline de taxonomia/variantes e auditar cobertura dos 5.874 alimentos.
4. Implementar normalização morfológica e filtros de identidade em módulos puros.
5. Implementar retrieval PostgreSQL por identidade/alias/trigram; medir recall@k e latência.
6. Implementar resolução de variantes e política estrita de sal.
7. Adicionar `NO_EXACT_TBCA_MATCH`, `ASK_IDENTITY`, `ASK_ATTRIBUTE` e `IGNORED_INCIDENTAL` ao domínio.
8. Reproduzir as 42 detecções salvas pelo novo pipeline offline, sem Luna.
9. Só então criar migration das relações aprovadas e atualizar backend/telemetria.
10. Atualizar a UI mobile com identidade amigável e perguntas curtas.
11. Rodar shadow mode sem autoseleção nova para coletar evidência.
12. Executar benchmark pago após aprovação, seguido de fotos reais autorizadas e independentes.

## 16. Arquivos que precisariam mudar

### Existentes

- `shared/food-recognition.ts`: contratos, estados e separação entre identidade/retrieval/decisão.
- `services/food-vision/server.ts`: schema e prompt estruturado; reranker batched e condicionado a atributo visível.
- `services/food-vision/providers.ts`: apenas se o contrato batched exigir adaptação; preservar Luna low/store false.
- `backend/food-recognition.ts`: novos contratos de serviço.
- `backend/index.ts`: orquestração, retrieval indexado, políticas, resposta e telemetria.
- `backend/tbca-import.ts`: validar vínculos versionados sem modificar dados oficiais.
- `frontend/app/components/food-photo-review.tsx`: novos estados e perguntas.
- `frontend/app/food-photo.css`: apresentação mobile dos estados.
- `backend/food-matcher-tbca.test.ts`, `backend/food-recognition.test.ts` e `services/food-vision/providers.test.ts`.
- documentação e runners em `tests/food-vision-benchmark`.

### Novos módulos sugeridos

- `shared/food-identity.ts`: tipos e invariantes.
- `backend/food-identity-repository.ts`: retrieval por identidade/família.
- `backend/food-variant-resolver.ts`: filtros e política de variante.
- `backend/food-resolution-policy.ts`: regra de sal e futuras políticas explícitas.
- `backend/migrations/postgres/017_food_visual_identity.sql`.
- `backend/migrations/postgres/018_food_vision_decision_telemetry.sql`.
- gerador/auditor offline da taxonomia em `scripts/` ou `tests/food-vision-benchmark/`.

## 17. Plano de testes

### Unitários

- flexões (`cru/crua`, `cozido/cozida`) e sinônimos;
- frango versus linguiça de frango;
- ovo de galinha inteiro versus codorna/clara/gema;
- batata inglesa versus doce/baroa;
- alimento simples versus receita com bacon/queijo;
- filtros de preparo e parte;
- regra de sal aplicada somente quando for a única diferença;
- nenhuma decisão nutricional para `NO_EXACT_TBCA_MATCH`.

### Catálogo e matcher

- todo vínculo referencia TBCA ativa;
- cada variante pertence a identidade compatível;
- nenhum grupo padrão mistura óleo, açúcar, espécie, corte ou receita;
- recall@1/@3/@5 por identidade e preparação;
- candidatos absurdos eliminados antes do ranking.

### Replay sem API

Usar `predictions-luna-baseline.json` como entrada imutável. Recalcular retrieval, ranking, variante e estados para os 42 itens. O script `analyze-pilot-20-offline.ts` já demonstra o padrão de replay e gera `offline-diagnosis.json` sem chamadas pagas.

### Casos sem item exato

Omelete simples, bife sem corte, farofa sem receita, peixe sem espécie e queijo sem variedade devem produzir estado explícito e jamais código arbitrário.

### Benchmark pago posterior

Somente depois do replay e aprovação: mesmo piloto congelado, custo/latência por estágio, associação um-para-um e comparação cega. Em seguida, conjunto maior de fotos reais autorizadas, com divisão de desenvolvimento e teste.

## 18. Critérios para considerar a nova versão melhor

No piloto congelado:

- nenhuma regressão nos 6 AUTOSELECT corretos;
- nenhum dos cinco casos sem TBCA exata recebe código silenciosamente;
- top-3 acceptable não cai abaixo de 20/27;
- seleção acceptable supera 11/27 por resolução defensável, sem afrouxar thresholds;
- receitas incompatíveis de frango e batata não aparecem entre as opções principais;
- estados de erro visual, dúvida de identidade e ausência no catálogo ficam distintos;
- chamadas de reranker ficam abaixo de 33 nas mesmas 20 fotos;
- latência média e p95 não pioram;
- itens de fundo/guarnição não bloqueiam salvar a refeição.

Em produção/shadow:

- medir precisão e cobertura de AUTOSELECT com feedback final;
- medir taxa de troca, remoção e abandono por estado;
- medir distribuição e resolução de `NO_EXACT_TBCA_MATCH`;
- comparar risco-cobertura em conjunto real independente;
- manter rollback por feature flag.

## 19. Decisões que ainda precisam de aprovação

1. Adotar a arquitetura B como direção oficial.
2. Aprovar identidades canônicas que podem existir sem `food_id` TBCA.
3. Definir se composições por ingredientes entram na primeira implementação ou em fase posterior.
4. Aprovar a UX de “Não sei” para corte, espécie, receita e queijo.
5. Aprovar migration de taxonomia e telemetria somente após a auditoria offline dos 5.874 itens.
6. Decidir se itens incidentais ficam ocultos por padrão em “Também vimos” ou são descartados completamente.

Até essas decisões, nenhuma alteração no produto deve ser aplicada.
