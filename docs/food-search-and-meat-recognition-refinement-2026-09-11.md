# Refinamento da busca e do reconhecimento de carnes — 2026-09-11

## Escopo e estado

Trabalho isolado na branch `feature/food-search-meat-refinement`, criada diretamente de `main` em `8c87e241e6394f4ba0e42a42f705136bd242dcbe`. Nenhum commit, push ou deploy foi feito. A feature da omelete permanece em outra branch e não faz parte deste diff.

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
