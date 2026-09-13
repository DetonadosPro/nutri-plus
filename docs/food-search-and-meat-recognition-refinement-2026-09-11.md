# Refinamento da busca e do reconhecimento de carnes — 2026-09-11

## Escopo e estado

O trabalho começou na branch `feature/food-search-meat-refinement`, criada de `main` em `8c87e241e6394f4ba0e42a42f705136bd242dcbe` e consolidada no commit `5f2b6fb21c9d3a79ccdf8944679a6a57a29b4add`. O histórico atual seguiu de forma linear: a integração da omelete entrou em `e77b9443e605faf075e60720f9c7dfd76c376d52` e as correções posteriores de linguiça/bisteca foram registradas em `3f5b341334fb579b64559aefa92b6fefd3f0fac6`, commit apontado por `main` e `fix/food-vision-sausage-regression`. A auditoria estrutural mais recente foi continuada, ainda sem commit, na branch `fix/food-vision-sausage-regression`, que contém todo o trabalho anterior e representa o estado atual descrito neste relatório. Não há merge commit, rebase ou cherry-pick entre essas duas linhas no histórico atual: o commit de `feature/food-search-meat-refinement` é ancestral direto da branch atual.

Esta rodada não altera linhas nutricionais, medidas, IDs, `source_code`, diário ou curadoria persistida. As mudanças são de apresentação, busca contextual, matching, schema visual e telemetria de feedback.

## Diagnóstico

### Busca humana

A consulta SQL retornava até 25 linhas antes de qualquer canonicalização. Como sal, óleo, manteiga e gordura fazem parte de muitos títulos TBCA, variações tecnicamente distintas ocupavam quase todo o topo. Não havia filtro contextual para formas cruas nem uma face específica para o paciente.

Exemplo real no catálogo: `peito bovino` possui linhas separadas para cru, grelhado sem sal, grelhado com manteiga, cozido sem óleo e frito com óleo. O banco precisa preservá-las porque seus nutrientes podem diferir, mas a interface não precisa apresentá-las como identidades concorrentes.

### Pós-ASK_MEAT_FAMILY

O problema principal não era falta de uma segunda chamada ao modelo. Após o usuário escolher Porco, `refineMeatFamily` produzia algo como `carne suína`; a recuperação exigia todos esses tokens. Isso descartava cortes cujos títulos começavam diretamente por `Bisteca`, `Lombo`, `Pernil` ou `Costela` e favorecia a linha genérica `Preparada suíno`.

Além disso, a primeira resposta visual só conservava nome, preparação e detalhes livres. Não havia campos estáveis para formato do corte, osso, gordura ou hipótese de família, portanto o matcher não tinha sinais estruturados para reaproveitar.

### Feedback

O banco já guardava alimento previsto e alimento final, mas não guardava o item visual, família sugerida/escolhida, top candidatos ou uso de busca manual. Assim, uma correção não podia ser analisada por contexto nem usada em um desempate futuro.

## Implementação

### Canonicalização voltada ao paciente

`shared/food-catalog-presentation.ts` cria uma camada de apresentação sem reescrever o catálogo:

- remove do título visível sal, óleo, manteiga, gordura e processamento técnico;
- corrige nomes de cortes mais naturais, como `Bisteca suína` e `Lombo suíno assado`;
- mostra `Pepino`, `Alface` e `Tomate` sem o sufixo cru;
- omite arroz, feijão, massa e carnes cruas em buscas comuns, mas permite encontrá-los quando `cru/crua` é solicitado explicitamente;
- agrupa resultados pelo nome humano e conserva como representante o primeiro item já ordenado pela curadoria;
- amplia a recuperação interna para 150 linhas antes de filtrar e devolve no máximo 25 itens limpos.

O representante mantém seu ID, código, nutrientes e medidas. Nenhum valor é combinado ou recalculado.

### Uma leitura visual com sinais de carne

O Structured Output agora inclui `meatVisual`, nulo para itens sem carne, com:

- `familyCandidate` e `familyConfidence`;
- `cutStyle`: bife, filé, desfiado, moído, cubos, tiras, costela, peça inteira ou desconhecido;
- `visibleFatLevel`;
- presença de osso;
- até três `shapeHints` defensáveis, como bisteca, lombo, pernil, peito ou sobrecoxa.

O prompt proíbe inferir cortes sem evidência e mantém uma única chamada visual por foto. Família com confiança suficiente segue direto; família incerta continua em `ASK_MEAT_FAMILY`.

### Reranking local por família

Depois da escolha do usuário, o backend recupera a família completa sem exigir a palavra `carne`. O score local combina:

- família escolhida e exclusão de entradas misturando famílias;
- preparação observada;
- `cutStyle` e `shapeHints` da primeira leitura;
- osso e gordura visíveis;
- prioridade, score, categoria e confiança da curadoria;
- penalização de linhas genéricas, rótulos ambíguos e receitas com muitos ingredientes;
- penalização de formas cruas quando a foto não indicou alimento cru;
- feedback histórico limitado a 0,08, somente como desempate.

Não existe busca textual genérica após a escolha da família e não foi adicionada uma segunda chamada à IA.

### Trilha de feedback

A migration `024_food_vision_feedback_context.sql` acrescenta às previsões:

- `detected_payload`, sem bytes ou referência da imagem;
- `suggested_family`;
- `chosen_family`;
- `candidate_food_ids`;
- `manual_search`.

O fluxo atual grava os candidatos iniciais, atualiza família e candidatos após `ASK_MEAT_FAMILY` e, ao salvar a refeição, registra o alimento final e se ele veio da busca manual. Estatísticas de correções por família e formato podem desempatar o reranking, com teto conservador.

## Evidência determinística

Os testes cobrem:

- `peito bovino` iniciando em `Peito bovino grelhado`, sem variantes de sal/óleo/gordura ou cru;
- `Pepino`, sem `cru` no título;
- arroz cozido acima das formas cruas, com formas cruas omitidas na busca normal;
- colapso de nomes canônicos sem trocar o ID representante;
- família visual confiante sem pergunta e família incerta com `ASK_MEAT_FAMILY`;
- escolha de porco, frango ou bovino mantendo somente a família escolhida;
- uso de bisteca, lombo, pernil e peito quando os sinais visuais os sustentam;
- penalização de `Preparada suíno` e rótulos bovinos genéricos;
- máximo de três candidatos;
- persistência transacional de contexto, candidatos, correção e busca manual;
- feedback limitado a desempate.

O teste da API real confirmou busca limpa e preservou criação/edição/cópia de refeições, medidas caseiras, snapshots e mL.

## Comparação pequena do modelo

Foram usadas as duas únicas fotos reais locais disponíveis e quatro respostas bem-sucedidas: duas em `gpt-5.6-luna` com esforço `none` e duas com `low`. Uma primeira tentativa `low` falhou no transporte com `fetch failed`; a repetição foi bem-sucedida. Os JSONs completos estão em `.codex-local/food-vision-real/` e permanecem fora do Git.

| Configuração | Fotos | Latência visual média | Tokens de entrada | Tokens de saída, incluindo raciocínio | Custo estimado |
|---|---:|---:|---:|---:|---:|
| Luna `none` | 2 | 4,45 s | 2.926 | 399 | US$ 0,001064 |
| Luna `low` | 2 | 4,99 s | 2.926 | 618 | US$ 0,001327 |

Estimativa calculada com a tarifa já registrada no benchmark local: US$ 0,20/milhão de tokens de entrada e US$ 1,20/milhão de tokens de saída, sem contar tokens de raciocínio duas vezes. A tentativa de transporte sem resposta não forneceu usage e não entrou na estimativa.

Nas duas configurações, a primeira foto separou omelete, feijão e pepino. Na foto de massa com carne parcialmente coberta, `none` foi conservador (`unknown`, desfiada, confiança familiar 0,38) e `low` sugeriu bovino/moída com confiança 0,52; ambos corretamente mantiveram `ASK_MEAT_FAMILY`. O modo `low` ficou cerca de 12% mais lento e 25% mais caro nesta amostra, sem ganho qualitativo evidente.

Esta amostra não contém casos rotulados de porco e bovino suficientes para comparar modelos de forma estatisticamente válida. O benchmark anterior de 200 imagens também não pode calibrar o sistema: 71/200 pares imagem-rótulo estavam desalinhados. Portanto, a decisão responsável é manter Luna `none`. O limite atual está principalmente na recuperação, canonicalização e perda de atributos — pontos corrigidos nesta rodada — e não há evidência para pagar por um modo/modelo mais forte agora.

## Integridade

Estado versionado após a integração da omelete simples:

- 5.874 alimentos TBCA;
- 8.317 medidas em 4.879 códigos: 6.087 caseiras, 1.785 contagens e 445 volumes;
- nutrientes: `7c663b29885bff52dda27adf5d295126b67d68dbb79ea7965d011845ac0f55db`;
- identidade/códigos: `c736b4d473fdb20bd56fa90d5c6c92add5a3db24ef20f037f1b999de353521f6`;
- histórico/snapshots: `019666543e65d1932532d9fd1910b308480a1c155849e675680dcb5d28e50335`;
- SHA-256 do catálogo revisado de medidas: `2277486e9d63c8cb3544d5711b535bedb3e9bacd7c2c6829ba52bb972dfeaa08`.

A extensão adiciona somente `1 ovo = 50 g` à omelete simples `BRC0065J`; medidas anteriores, nutrientes e históricos permanecem inalterados.

## Revisão final da migration 024 e do feedback

As migrations 024 e 025 foram validadas em dois schemas temporários e isolados no PostgreSQL local. No primeiro, o fluxo normal `migrate()` aplicou, em ordem, as migrations 001 a 025 sobre schema vazio. No segundo, foram aplicadas inicialmente as migrations 001 a 023, inseridos uma previsão no formato legado e o alimento `BRC0065J`, e então executado o mesmo `migrate()` para aplicar a telemetria e a omelete como atualização de banco existente.

O registro legado permaneceu idêntico em todas as colunas anteriores. As novas colunas receberam os defaults esperados: objeto JSON vazio, array vazio, `manual_search=false` e famílias nulas. `detected_payload`, `candidate_food_ids` e `manual_search` são `NOT NULL`; as famílias são nullable porque não se aplicam a todo alimento, mas aceitam somente `chicken`, `pork` ou `beef`. O índice parcial inclui apenas previsões finalizadas. A migration e seu registro em `schema_migrations` são executados na mesma transação pelo deploy; uma falha reverte ambos.

Como reversão operacional, é seguro primeiro desativar o consumo das novas colunas no backend e depois, em janela controlada, remover o índice e as cinco colunas. O teste também confirmou que esse DDL é transacional no PostgreSQL: após um `ROLLBACK`, schema e dados permaneceram intactos. Não há downgrade automático e a remoção das colunas descartaria somente a nova telemetria, nunca alimentos, nutrientes ou histórico alimentar.

A auditoria do feedback encontrou que a implementação inicial permitia influência de `0,02` já com uma seleção e agregava de forma ampla quando o formato era desconhecido. Foi aplicada uma proteção localizada:

- a chave é família escolhida + `cutStyle` exato + primeiro `shapeHint`, quando presente;
- sem `cutStyle` e sem `shapeHint`, feedback global da família não é usado;
- menos de três exemplos no mesmo contexto produz influência zero;
- a partir de três exemplos, suavização estatística cresce gradualmente e nunca ultrapassa `0,08`;
- correções conflitantes são contadas separadamente por alimento; nenhuma elimina ou sobrescreve outra;
- o valor não entra mais no score de compatibilidade nem muda thresholds ou estados de decisão;
- ele ordena somente candidatos na mesma faixa centesimal do score visual/semântico;
- candidatos de outra família são excluídos antes do ranking;
- incompatibilidades de corte, `shapeHints`, osso, preparação e atributos visíveis continuam no score principal e sempre dominam o desempate.

Assim, uma escolha isolada ou pouco histórico não altera o top 3. Várias escolhas coerentes podem apenas desempatar candidatos praticamente equivalentes no mesmo contexto visual. Banco sem feedback mantém exatamente a ordenação determinística normal.

## Regressão da linguiça suína — imagem 3

### Caso real e diagnóstico

Golden case local: `C:\Users\Detona\Documents\Nutri+\imagens reais\imagem 3.jpg`. A imagem permaneceu fora do Git; resultados e instrumentação estão somente em `.codex-local/food-vision-real/`. Foram feitas exatamente duas leituras visuais controladas: uma antes e uma depois. Cada execução fez uma única chamada normal ao modelo `gpt-5.6-luna`, esforço `none`.

Na execução anterior, a visão separou sete componentes. Para a linguiça retornou `name=linguiça`, `preparation=inteira, grelhada`, confiança 0,97, alternativa `salsicha` e família suína com confiança 0,72. O formato, porém, foi forçado a `whole_piece`, representação criada para cortes frescos. Para a bisteca retornou componente independente, `cutStyle=steak`, `shapeHints=[bisteca]` e família incerta, mantendo corretamente `ASK_MEAT_FAMILY`.

O retrieval da linguiça estava correto: 68 linhas foram recuperadas, incluindo `BRC0188F` (frango grelhada), `BRC0189F` (suína grelhada), `BRC0763F/BRC0764F` (mista grelhada/assada), `BRC0901F` (calabresa à milanesa) e formas cruas/cozidas. `BRC0189F` não desaparecia no SQL nem na canonicalização; aparecia em segundo com o mesmo score 0,8304 da linguiça de frango.

A perda acontecia em `selectDistinctFoodCandidates`. O eixo de família existia para `carne`, mas não para a identidade `linguiça`; assim, frango e suíno recebiam a mesma chave de diversidade `prep:grelhado`. O desempate anterior colocava `BRC0188F` primeiro e descartava `BRC0189F` como duplicata. Em paralelo, `BRC0901F` sobrevivia com 0,7213 porque um `empanado` inesperado não era registrado como contradição quando a preparação esperada era `grelhado`. O resultado visível eram precisamente duas escolhas ruins: frango grelhada e calabresa à milanesa. A canonicalização apenas agrupou corretamente variantes técnicas da mesma linguiça, por exemplo `BRC0763F/BRC0764F`; ela não confundiu linguiça com `Preparada suíno`.

### Correção localizada

- `cutStyle` passou a aceitar `sausage`; o prompt usa esse valor para embutidos cilíndricos e não para cortes frescos;
- o eixo de identidade de linguiça agora preserva famílias suína, bovina e frango no dedup;
- quando a família visual é defensável, a compatibilidade familiar entra no score local: família única compatível `+0,10`, mistura `-0,04`, família contrária `-0,30`; candidato sem família explícita permanece neutro;
- ao responder `ASK_MEAT_FAMILY`, a identidade continua `linguiça suína/de frango/bovina`, em vez de virar a busca genérica `carne ...`;
- `empanado` inesperado agora contradiz uma preparação visível grelhada/cozida/frita/assada;
- `Linguiça suíno` é humanizada para `Linguiça suína` somente na apresentação;
- thresholds globais, catálogo, IDs, nutrientes, medidas e número de chamadas não mudaram.

Não foi criado um campo `foodForm` separado: ampliar o enum estrutural já existente com `sausage` resolveu a diferença entre embutido e corte fresco com menor superfície de mudança e compatibilidade com payloads anteriores. A chave de feedback já contém `cutStyle`; portanto, feedback de `sausage` fica automaticamente isolado de bisteca/lombo/pernil, mantendo mínimo de três exemplos, teto 0,08 e uso somente como desempate.

### Before / after

| Componente | Antes | Depois |
|---|---|---|
| Bisteca | visão: carne, bife grelhado, `steak`, hint `bisteca`, família incerta; `ASK_MEAT_FAMILY`; após Porco: `BRC0160F` Bisteca suína em primeiro | visão: carne bovina com alternativa suína, `steak`, hint `bisteca`; continua `ASK_MEAT_FAMILY`; após Porco: `BRC0160F`, score 0,99, primeiro e único candidato seguro |
| Linguiça | visão: linguiça grelhada, família pork 0,72, formato incorreto `whole_piece`; pool 68; `BRC0189F` entrava com 0,8304, mas era removida pelo dedup; visíveis: frango grelhada e calabresa à milanesa | visão: linguiça grelhada, formato `sausage`, família visual abstida; pool inicial 68 e `ASK_MEAT_FAMILY`; após Porco: pool familiar filtrado 101, `BRC0189F` Linguiça suína grelhada, score 0,7924, único candidato seguro |

Decomposição final de `BRC0189F` após Porco: identidade 0,17; lexical 0,0682; preparação 0,10; evidência visível 0,08; identidade principal 0,05; curadoria 0,0842; família 0,10; formato sausage 0,14; demais sinais e penalizações zero; score final 0,7924. `Preparada suíno` ficou em 0,2783: recebeu `-0,035` por incompatibilidade de formato e `-0,18` por genericidade, abaixo do piso 0,46. Formas suínas cruas ficaram em 0,3924/0,3833 devido à contradição de preparação `grelhado!=cru`. Nenhuma opção foi adicionada apenas para completar três.

### Performance, testes e riscos

Antes: visão 5.940,7 ms, retrieval total do prato 247,8 ms, matcher 206,9 ms, total 6.400,5 ms. Depois: visão 6.287,0 ms, retrieval 182,7 ms, matcher 155,3 ms, total 6.636,1 ms. A variação total foi +235,6 ms (+3,7%), concentrada na chamada remota; retrieval e matcher ficaram mais rápidos nessa amostra. A correção local adiciona apenas regex/testes de conjuntos constantes e nenhuma chamada, consulta ou rerank remoto.

Testes automatizados cobrem linguiça suína direta, escolha de família Porco, precedência sobre família errada e preparado genérico, variantes técnicas, canonicalização, dedup sem fundir identidades, preparação empanada incompatível, bisteca preservada, componentes independentes, máximo de três, ausência de preenchimento artificial, abstinência sob o piso, feedback incapaz de trocar identidade e buscas manuais por peito bovino, pepino, arroz, linguiça, linguiça suína, bisteca, lombo e pernil.

Risco restante: a família animal de um embutido inteiro pode não ser visualmente defensável. O comportamento intencional é perguntar a família e então apresentar somente correspondências compatíveis; não inferir pela cor. O caso real fez exatamente isso depois da correção.

## Auditoria geral das imagens reais e componentização atômica

### Escopo e método

A pasta local `imagens reais` continha quatro arquivos: `imagem 1.jpeg`, `imagem 2.jpeg`, `imagem 3.jpg` e `imagem 4.jpg`. As fotos não foram copiadas nem adicionadas ao Git. O manifest humano, os resultados integrais e o replay determinístico ficaram em `.codex-local/food-vision-real/`, também ignorado pelo Git.

Foi feita exatamente uma chamada visual por arquivo antes e uma depois da alteração, sempre com `gpt-5.6-luna`, esforço `none` e detalhe alto. Não houve crop, chamada por componente, rerank remoto ou repetição para escolher uma resposta favorável. A inspeção humana definiu as expectativas antes de interpretar a rodada final; inferência do modelo não foi tratada como ground truth.

### Matriz comparativa

| Imagem | Expectativa humana | Visão antes / decisão final antes | Falhas antes | Visão depois / decisão final depois | Situação final |
|---|---|---|---|---|---|
| `imagem 1.jpeg` | feijão, omelete e pepino; arroz proibido | omelete `BRC0065J`, feijão `BRC0001T`, pepino `BRC0030B`; três `AUTOSELECT` | nenhuma; arroz não foi inventado | mesmos três componentes e códigos; `foodKind` coerente; nenhuma pergunta de carne | aprovada |
| `imagem 2.jpeg` | massa longa com molho e carne/frango visível em componente separado | massa em `ASK_ATTRIBUTE`; carne separada em `ASK_MEAT_FAMILY` | a visão não sustentou diretamente frango, mas abstém corretamente na família; não houve merge | massa e carne continuam independentes; massa em `ASK_ATTRIBUTE`, carne em `ASK_MEAT_FAMILY` | aprovada, com incerteza animal explícita |
| `imagem 3.jpg` | ovo, bisteca, linguiça, arroz, couve, preparação granulada/com feijão e item empanado/frito | sete componentes; linguiça e bife independentes; o item `empanado` tinha pool zero, mas recebia `ASK_MEAT_FAMILY` | `invalid_meat_gate` no empanado; preparação granulada permanece visualmente ambígua | sete componentes; ovo e arroz automáticos; bife e linguiça em `ASK_MEAT_FAMILY`; farofa em `NO_EXACT_TBCA_MATCH`; item frito de baixa confiança em `NO_MATCH` no replay final | correção de linguiça/bisteca preservada; identidade do item frito não é forçada |
| `imagem 4.jpg` | arroz, feijão, alface, tomate, cebola e corte de carne; pequena região amarela pode ser ignorada | os seis componentes apareceram separados nesta execução; cebola foi incorretamente para `ASK_MEAT_FAMILY` | merge alface/tomate relatado é intermitente no estágio visual; `invalid_meat_gate` determinístico na cebola | seis componentes separados; alface/tomate em `groupLabel=salada`; carne/cebola em `groupLabel=carne com cebola`; cebola em `ASK_ATTRIBUTE`, nunca família; região amarela não foi inventada | aprovada |

### Causas raízes e estágios

O agrupamento de alface e tomate acontecia no primeiro Structured Output. O contrato dizia para percorrer componentes, mas não definia explicitamente a atomicidade nutricional, permitia nomes livres e não tinha grupo visual separado da identidade. Depois disso não havia validação semântica para um nome independente contendo duas identidades catalogáveis. Portanto o matcher recebia um componente já fundido e não tinha como recuperar duas porções.

O erro da cebola acontecia depois de um retrieval correto. A visão desta auditoria retornou `name=cebola`, `meatVisual=null` e os primeiros candidatos locais eram cebolas, mas `needsMeatFamilyConfirmation` procurava palavras de carne em `name + preparation + visibleDetails`. A frase espacial `fatias ... sobre a carne` continha “carne” e abria o gate sem consultar o pool. O mesmo desenho explicava o empanado da imagem 3: `identityAmbiguity=meat_family` forçava a pergunta mesmo com zero candidatos recuperados. Não houve compartilhamento de objetos entre componentes; a contaminação era semântica, causada por usar contexto do vizinho como identidade local.

Classes observadas: `merged_components` no relato intermitente de salada; `invalid_meat_gate` na cebola e no empanado; `wrong_identity`/baixa confiança no item frito da imagem 3; e ambiguidade segura de identidade na preparação granulada. Não foram observados `over_split_component`, arroz alucinado na imagem 1, merge massa/carne, merge bisteca/linguiça, `dedup_failure` ou `unsafe_auto_select` após as barreiras finais.

### Alteração arquitetural

O Structured Output ganhou dois campos pequenos:

- `foodKind`: `meat_cut`, `processed_meat`, `egg`, `grain_starch`, `legume`, `vegetable`, `fruit`, `dairy`, `bakery`, `composite` ou `unknown`;
- `groupLabel`, opcional e sem efeito em matching, nutrientes, medidas ou diário.

O prompt agora exige uma lista flat: alimentos distinguíveis, porcionáveis e nutricionalmente relevantes são itens independentes mesmo quando encostam. `groupLabel` pode representar “salada” ou “carne com cebola” sem fundir identidades. Receitas integradas continuam únicas; microtemperos não são obrigatórios. `meatVisual` deve ser nulo fora de `meat_cut` e `processed_meat`, mas o backend não confia nesse campo sozinho.

Foi adicionada uma segunda barreira inteiramente local para nomes explicitamente compostos. Ela só separa um item `independent` com separador explícito quando cada parte, isoladamente, resolve com score mínimo 0,72 e todos os tokens de identidade aparecem no candidato vencedor. Preparações `integrated-preparation`, partes fracas e nomes sem duas identidades fortes são preservados. Não existe `.split(" e ")` global: a separação depende do papel visual e de confirmação semântica pelo catálogo. No split seguro, detalhes, ambiguidade e `meatVisual` não são copiados para a parte vegetal; o grupo visual é preservado.

### Nova regra do gate de carne

`ASK_MEAT_FAMILY` passou a ocorrer somente quando todas as condições abaixo são verdadeiras:

1. a família ainda não está defensavelmente determinada, ou existe alternativa animal conflitante;
2. `foodKind`, o nome/alternativa ou a ambiguidade local colocam o próprio componente no domínio carne/embutido;
3. o melhor candidato local acima do piso é realmente carne;
4. o conjunto local acima do piso contém pelo menos duas famílias animais explícitas e materialmente possíveis.

`visibleDetails` e `preparation` continuam influenciando preparo e score, mas não podem, sozinhos, declarar que a identidade é carne. Se o primeiro candidato forte é vegetal, ou se o pool está vazio, a pergunta é bloqueada. Uma identidade de baixa confiança com alternativa materialmente diferente passa para `NO_MATCH`, em vez de promover um candidato arbitrário.

Na imagem 4, antes, a cebola recuperou 400 linhas e tinha como top 3 `BRC0018B`, `BRC0114B` e `BRC0356B`, todos cebola, porém o gate ignorava isso. Depois, ela recuperou novamente 400 linhas; `BRC0112B` cebola refogada ficou em primeiro com 0,7263 e o estado foi `ASK_ATTRIBUTE`. Alface retornou três variedades em `ASK_ATTRIBUTE`; tomate retornou `BRC0035B` em `AUTOSELECT`; arroz `BRC0018A` e feijão `BRC0001T` foram automáticos. O corte bovino permaneceu em escolha de atributo entre cortes bovinos porque a família veio direta com confiança 0,83. A região amarela não gerou componente.

Na imagem 3, `cutStyle=sausage`, dedup por família e independência entre bife e linguiça permaneceram. A escolha Porco mantém `BRC0189F` para linguiça e os testes/replay familiar preservam `BRC0160F` para bisteca. O item frito, devolvido nesta única rodada como “farinha de mandioca frita” com alternativa “croquete” e confiança 0,73, não recebe sugestão segura: o replay final determinístico o colocou em `NO_MATCH`. Isso registra a presença visual sem inventar a identidade interna.

### Performance e chamadas

| Métrica média por foto | Antes | Depois | Variação |
|---|---:|---:|---:|
| visão | 5.328,8 ms | 5.329,4 ms | +0,6 ms |
| retrieval | 79,8 ms | 98,9 ms | +19,1 ms |
| matcher | 174,8 ms | 193,9 ms | +19,1 ms |
| pós-processamento atômico | não isolado | 1,8 ms | +1,8 ms |
| total | 5.595,6 ms | 5.646,6 ms | +51,0 ms (+0,9%) |

A oscilação por imagem foi dominada pela chamada remota. A barreira atômica adicionou em média 1,8 ms de CPU fora do SQL nesta amostra. Foram quatro chamadas antes e quatro depois, exatamente uma por foto em cada rodada. O replay final usou as respostas já salvas e fez zero chamadas externas.

### Suíte local, regressões e riscos

O manifest local cobre as quatro imagens, componentes obrigatórios, arroz proibido na imagem 1 e caminhos familiares conhecidos. Testes unitários adicionais cobrem alface/tomate separados com grupo comum, split semântico seguro, receitas integradas não divididas, parte fraca não dividida, não propagação de `meatVisual`, bloqueio do gate para cebola/tomate/alface/arroz/feijão, carne e linguiça ambíguas, exigência de múltiplas famílias locais, pool vegetal dominando sinal visual errado, abstinência de identidade insegura e máximo de três candidatos. Os testes anteriores continuam cobrindo uma chamada, busca humanizada, cru/cozido, bisteca, linguiça, feedback contextual e ausência de preenchimento artificial.

Riscos restantes: uma única leitura visual ainda pode omitir um componente parcialmente oculto; `foodKind` também é predição e por isso nunca é autoridade isolada; o split local só age quando o nome contém separador explícito e ambas as identidades são fortes; “couve” ainda recupera variantes de couve-flor, mas fica em escolha humana, sem seleção insegura; e preparações granuladas ou empanadas sem interior visível podem terminar em abstinência. Esses casos exigem mais imagens humanas rotuladas, não redução global de thresholds.

## Regressão pós-deploy — família correta, corte bovino genérico

### Reprodução e diagnóstico

O registro de produção de `2026-09-13 18:54:49 -03` confirmou o caso: `name=carne bovina`, confiança visual 0,78, `foodKind=meat_cut`, `componentRole=independent`, preparação `grelhada ou frita`, detalhes `pedaço escuro de carne` e `fibras visíveis`, família bovina com confiança 0,64, `cutStyle=whole_piece`, `shapeHints=[]`, `bone=without` e gordura média. O ranking persistido terminou em `NO_MATCH`, embora os scores fossem 0,6179 e 0,6172. Como a versão então publicada não persistia `alternative`, a string alternativa original não pode ser recuperada; pelo código, um `NO_MATCH` acima do piso com confiança 0,78 só podia vir da proteção de baixa confiança com alternativa ou de ambiguidade de identidade.

A foto correspondente é `imagens reais/imagem 4.jpg`, que contém uma peça bovina escura com cebola, além de arroz, feijão, alface e tomate. A reprodução controlada local usou essa foto exatamente uma vez antes e uma vez depois, com `qwen3-vl:4b-instruct`, esforço `none`, sem crop, rerank remoto ou chamada por componente. As duas leituras devolveram exatamente o mesmo payload para a carne: `name=carne`, `alternative=null`, confiança 0,95, `foodKind=meat_cut`, `componentRole=independent`, `groupLabel=carne com cebola`, preparação `fatia`, detalhes `corte de carne com gordura visível` e `com cebola frita ao lado`, família bovina 0,85, `cutStyle=unknown`, `shapeHints=[]`, `bone=unknown` e gordura média. Assim, a comparação do matcher não depende de uma resposta visual mais favorável.

Antes da correção, a identidade `carne` gerava as queries `carne`, `carne fatia` e `carne fatia frito`, com pool de 400 linhas. `fatia` não era convertida em evidência de formato quando `cutStyle` vinha `unknown`. O top 3 visível era:

| Candidato antes | Score | Motivo relevante |
|---|---:|---|
| `BRC0025F` Carne bovina moída cozida | 0,9755 | identidade genérica, lexical e curadoria fortes; nenhuma incompatibilidade estrutural |
| `BRC0023F` Contrafilé bovino grelhado | 0,9168 | família e identidade compatíveis, mas sem ganho por formato |
| `BRC0032F` Costela bovina assada | 0,9161 | família compatível; osso/formato de costela não eram exigidos |

No fluxo explícito de família, `refineMeatFamily` já fazia spread do objeto e, portanto, não apagava fisicamente `preparation`, `visibleDetails`, `foodKind`, `componentRole`, `groupLabel`, `cutStyle`, `shapeHints`, `bone` ou `visibleFatLevel`. A família bovina substituía o nome por `carne bovina` e o retrieval familiar buscava 497 linhas bovinas — não chamava `/api/foods?search=carne bovina`. Porém, a compatibilidade de corte era fraca: um formato incompatível recebia somente `-0,035`, `whole_piece` não reconhecia os cortes bovinos usuais como peças inteiras, forma livre como `fatia` era descartada e costela não dependia de osso/shape. Além disso, `alternative` era omitida na resposta, no payload enviado pela interface e na telemetria persistida. O único fallback textual genérico ocorria depois de `NO_MATCH`, quando o usuário acionava `Nenhum desses / Buscar outro`: a tela manual era pré-preenchida apenas com `row.name`, isto é, `carne bovina`.

### Causa raiz e correção

A causa não era perda total do objeto no family refinement, mas perda efetiva de autoridade dos sinais visuais em três pontos: transporte incompleto de `alternative`, ausência de normalização conservadora do formato observável e penalidade insuficiente para incompatibilidade forte. A busca manual e o matcher por foto permanecem fluxos separados.

O matcher agora deriva a forma somente de sinais locais defensáveis: `cutStyle` estruturado tem precedência; quando ele é `unknown`, termos explícitos como bife/fatia/achatado, peça/pedaço/corte, moído, desfiado, cubos, tiras, costela e linguiça podem recuperar a classe visual. Os candidatos também recebem classe estrutural. Formatos fragmentados incompatíveis recebem `-0,60`; costela sem `bone=with`, `shapeHint=costela` ou `cutStyle=rib` recebe `-0,55`; conflito explícito de osso recebe até `-0,45`; conflito explícito de gordura recebe `-0,24`. Compatibilidade de forma soma apenas 0,06, enquanto `shapeHint` compatível soma 0,32 e incompatível recebe `-0,10`. Esses valores são locais ao matching de carne; nenhum threshold global mudou.

Depois da correção, o mesmo payload e o mesmo pool inicial de 400 linhas produziram `ASK_ATTRIBUTE`, margem 0,0007 e somente três cortes inteiros plausíveis:

| Candidato depois | Score | Motivo relevante |
|---|---:|---|
| `BRC0023F` Contrafilé bovino grelhado | 0,9768 | família, peça/fatia e preparo compatíveis |
| `BRC0036F` Filé-mignon bovino grelhado | 0,9761 | família, peça/fatia e preparo compatíveis |
| `BRC0045F` Patinho bovino grelhado | 0,9761 | família, peça/fatia e preparo compatíveis |

Carne moída caiu abaixo do piso devido à incompatibilidade `steak!=ground`; costela ficou fora por não haver osso, shape de costela ou `cutStyle=rib`. A repetição determinística do passo de família com o mesmo payload preservou preparação, detalhes, `foodKind`, `groupLabel`, gordura e osso, ampliou o pool para 497 bovinos e retornou o mesmo top 3. Quando não há formato, shape ou osso defensável para um `meat_cut` de família resolvida, a decisão agora é `NO_MATCH`, em vez de transformar o catálogo bovino em menu. `bone=with` junto de `cutStyle=rib`/shape de costela permite costela; `shapeHints` compatíveis alteram efetivamente a ordem. A busca manual por `carne bovina` continua inalterada.

### Testes, performance e riscos

Os testes adicionados cobrem peça/bife inteiro contra carne moída; restrição por `cutStyle=steak`; costela bloqueada sem osso e permitida com evidência; influência de `shapeHints`; preservação de grelhado; preservação de `cutStyle`, `shapeHints`, osso, gordura, preparo, detalhes, grupo e papel após escolha da família; conflito explícito entre famílias; exclusão de porco/frango do pool bovino; máximo de três; ausência de candidatos estruturalmente incompatíveis; `NO_MATCH` sem corte defensável; busca manual `carne bovina`; e exatamente uma requisição ao provedor por reconhecimento. As regressões anteriores de arroz ausente na imagem 1, massa/carne separadas, bisteca/linguiça independentes, `sausage`, dedup por família, alface/tomate separados, cebola fora do meat gate, feedback contextual e cru/cozido permanecem na suíte completa.

Na execução real antes: visão 46.450,7 ms, retrieval 431,3 ms, matcher 825,0 ms, pós-processamento 5,9 ms e total 47.768,1 ms. Depois: visão 39.011,2 ms, retrieval 235,6 ms, matcher 653,3 ms, pós-processamento 9,8 ms e total 39.944,8 ms. A diferença total é dominada pela inferência local e cache/estado do banco; esta amostra única não é benchmark de velocidade. A correção adiciona somente regex e conjuntos em memória, sem nova consulta e sem segunda chamada visual. Os arquivos locais `beef-cut-before.json` e `beef-cut-after.json` registram `providerCalls=1` cada.

Riscos restantes: uma foto pode sustentar apenas a classe “peça bovina”, sem anatomia suficiente para separar contrafilé, filé-mignon e patinho; nesse caso a escolha humana entre até três opções continua correta. Termos livres só viram formato quando são explícitos, para não converter cor ou contexto culinário em corte. O catálogo nem sempre explicita osso/gordura no nome, portanto sinais ausentes não são inventados; apenas conflitos explícitos ou costela sem suporte são barrados. Não houve alteração de nutrientes, medidas, IDs, histórico ou dados TBCA.
