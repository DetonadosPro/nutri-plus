# Substituições Inteligentes — implementação de 14/09/2026

## Escopo e arquitetura

Esta primeira versão troca **um alimento dentro de uma refeição**. Ela não troca a refeição inteira, não registra consumo no Diário e não usa IA, LLM, serviço remoto, aprendizado ou personalização comportamental.

A arquitetura tem quatro partes pequenas:

1. `backend/smart-substitutions.ts`: classificação declarativa, compatibilidade semântica, equivalência nutricional, arredondamento e ranking determinísticos.
2. `meal_plan_item_substitutions`: alternativas aprovadas e ordenadas por item prescrito.
3. rotas do Plano Alimentar: sugestão, equivalência manual e CRUD autorizado das alternativas.
4. UI do Plano: painel de decisão do nutricionista e expansão compacta, somente leitura, para o paciente.

O algoritmo opera sobre os dados locais já existentes em `foods`, `food_nutrients`, `food_measures` e nos campos de curadoria. Nenhum campo do catálogo foi alterado e nenhuma classificação foi gravada nos 5.874 alimentos.

## Schema e migration

A migration `028_meal_plan_item_substitutions.sql` é a próxima após as migrations 001–027. Ela cria uma tabela aditiva com:

- `meal_plan_item_id` e `food_id`;
- `position`, restrita a 0, 1 ou 2;
- `amount`, `unit` e `grams_equivalent`;
- `measure_snapshot`;
- `nutrient_snapshot`, nulo no rascunho e congelado na publicação;
- `origin` (`suggestion` ou `manual`);
- `algorithm_version`;
- `equivalence_metadata` com grupo, erro, diferenças e quantidade ideal/final;
- timestamps.

As constraints únicas `(meal_plan_item_id, food_id)` e `(meal_plan_item_id, position)`, o `CHECK position BETWEEN 0 AND 2` e o lock transacional do plano impedem duplicidade e mais de três alternativas inclusive sob concorrência. A FK do item usa cascade; a do alimento usa restrict.

## Grupos e classificação

Os oito grupos explicáveis são:

- carboidrato;
- leguminosa;
- proteína animal;
- ovo;
- lácteo;
- fruta;
- vegetal;
- gordura.

`unknown` é um resultado deliberado, não um erro. A classificação combina categoria TBCA, `curation_category`, `curation_confidence`, `curation_flags`, nome/descrição normalizados, papel culinário e preparação. Só `base_food` e `simple_preparation` com confiança não baixa podem entrar. Receitas compostas, marcas/especificidades bloqueadas, alimentos processados incompatíveis e evidência estrutural insuficiente ficam fora.

Auditoria local dos 5.874 TBCA ativos:

| Grupo | Alimentos |
|---|---:|
| Carboidrato | 207 |
| Leguminosa | 60 |
| Proteína animal | 626 |
| Ovo | 22 |
| Lácteo | 48 |
| Fruta | 106 |
| Vegetal | 322 |
| Gordura | 35 |
| `unknown` | 4.448 |

Há 1.426 classificações positivas e 4.448 abstenções. As abstenções se dividem em: 2.952 curadorias não individuais, 962 sem evidência estrutural suficiente, 453 com confiança baixa e 81 compostos/específicos bloqueados. A cobertura conservadora é intencional.

## Compatibilidade e preparação

A ordem é semântica antes de matemática:

1. ambos precisam ter grupo conhecido;
2. o grupo precisa coincidir;
3. papéis culinários específicos precisam coincidir (leite, iogurte, queijo; óleo, pasta de gordura);
4. preparações estritas (`raw`, `fresh`, `fried`, `liquid`) precisam coincidir;
5. cozido/grelhado/assado podem se relacionar com penalidade controlada;
6. famílias são diversificadas em carboidratos, leguminosas, proteínas, frutas e vegetais;
7. alimento principal, IDs já aprovados e o mesmo `duplicate_group` são excluídos.

Exemplos negativos: arroz cru não entra no lugar de arroz cozido; sanduíches, pizza e receitas compostas não entram como alimento simples; omelete com carne/cogumelo não entra como alternativa automática ao ovo simples; ervilha em vagem não entra como alternativa a feijão; escolha entre grupos diferentes só pode seguir pelo fluxo manual com aviso explícito.

## Equivalência nutricional

Para uma porção original, o vetor-alvo é:

`t_k = nutriente_original_por_100g × gramas_originais / 100`

Para o candidato, `c_k` é o nutriente por grama. A quantidade ideal `g` minimiza o erro quadrático ponderado normalizado:

`E(g) = Σ w_k × ((g × c_k - t_k) / max(|t_k|, floor_k))²`

A solução fechada usada é:

`g* = [Σ w_k × c_k × t_k / scale_k²] / [Σ w_k × c_k² / scale_k²]`

com `scale_k = max(|t_k|, floor_k)`. Os pisos são 20 kcal, 1 g de proteína, 1 g de carboidrato, 0,5 g de lipídio e 0,5 g de fibra. Isso impede divisões instáveis quando um nutriente é zero ou muito pequeno. Energia e pelo menos mais um nutriente precisam existir.

### Pesos, tolerâncias e limites

| Grupo | Pesos (energia / proteína / carbo / lipídio / fibra) | Erro máx. | Faixa absoluta | Razão vs. original |
|---|---|---:|---:|---:|
| Carboidrato | .35 / .05 / .50 / .03 / .07 | .24 | 25–450 g | .28–4.2 |
| Leguminosa | .24 / .27 / .25 / .04 / .20 | .30 | 30–400 g | .35–3.2 |
| Proteína animal | .27 / .52 / .01 / .20 / 0 | .30 | 30–350 g | .35–3.0 |
| Ovo | .30 / .45 / .02 / .23 / 0 | .28 | 25–300 g | .40–2.5 |
| Lácteo | .30 / .27 / .20 / .23 / 0 | .30 | 40–500 g | .35–3.0 |
| Fruta | .35 / .02 / .50 / .01 / .12 | .25 | 35–300 g | .30–3.0 |
| Vegetal | .22 / .12 / .24 / .02 / .40 | .40 | 20–600 g | .25–5.0 |
| Gordura | .35 / 0 / 0 / .65 / 0 | .18 | 3–80 g | .20–4.0 |

Além do erro total, cada grupo define tolerâncias para os nutrientes relevantes. Por exemplo, carboidratos limitam energia a 25% e carboidrato a 22%; proteína animal limita energia a 32% e proteína a 22%; gordura limita energia a 18% e lipídios a 15%. Uma porção fora do limite absoluto ou da razão plausível é rejeitada automaticamente.

## Medidas e arredondamento

As medidas vêm exclusivamente de `food_measures`. Não há medida inventada, densidade inferida ou regra `1 mL = 1 g`.

- medidas caseiras: passos de 0,5 e no máximo 6 unidades da medida;
- contagem: números inteiros, no máximo 10 unidades;
- volume: passos de 10 mL abaixo de 100 e de 25 mL a partir de 100;
- fallback de massa: múltiplos de 5 g.

Cada opção arredondada é recalculada e precisa continuar dentro das tolerâncias automáticas. O ranking de porção equilibra erro e praticidade, preferindo medida real quando seu custo nutricional é pequeno. `mL` e contagem usam a razão real `grams / quantity` cadastrada; os testes de API exercitam ambos. O snapshot da medida preserva nome, plural, tipo, quantidade, gramas, fonte e referência.

## Ranking e abstention

Depois do filtro semântico e nutricional, o score é estável:

- 58% qualidade nutricional;
- 22% compatibilidade de preparação;
- 12% praticidade da medida;
- 8% score da curadoria.

O desempate final usa `source_code`. Só uma alternativa de cada família é retornada e o máximo é três. O sistema prefere retornar zero quando o original é `unknown`, faltam nutrientes, a preparação não combina, a quantidade é implausível, nenhuma porção arredondada passa nas tolerâncias, o candidato é duplicado ou a curadoria é insegura.

## Casos reais auditados

### Arroz branco cozido, 100 g (`BRC0018A`)

Em uma repetição final aquecida, 182 ms: 696 candidatos iniciais, 8 após todos os filtros e 3 retornados.

- macarrão de trigo sem ovos cozido (`BRC0195A`): 2 colheres de servir cheias = 100 g, erro .1323;
- mandioca cozida (`BRC0053B`): 4,5 colheres de sopa rasas = 99 g, erro .2192;
- cuscuz de semolina marroquino cozido (`BRC0698A`): 110 g, erro .2352.

### Peito de frango grelhado, 100 g (`BRC0114F`)

Em uma repetição final aquecida, 150 ms: 685 iniciais, 47 aprovados pelos filtros e 3 retornados.

- maminha bovina grelhada (`BRC0041F`): 110 g, erro .0560;
- camarão cozido sem casca (`BRC0001E`): 4,5 colheres de servir cheias = 180 g, erro .0285;
- peito de peru sem pele cozido (`BRC0789F`): 1 peça/fatia média = 110 g, erro .0287.

### Banana nanica, 100 g (`BRC0007C`)

Caso de fruta fresca: maçã com casca (`BRC0063C`), 1 unidade média = 130 g; lichia in natura (`BRC0304C`), 120 g. Alternativas acima de 300 g ou três vezes a porção original são rejeitadas.

### Feijão carioca cozido, 100 g (`BRC0001T`)

Lentilha cozida drenada (`BRC0018T`), 2 colheres de servir cheias = 70 g, e grão-de-bico cozido (`BRC0106T`), 0,5 concha cheia = 60 g, passam. Ervilha em vagem é deliberadamente excluída por papel culinário incompatível.

### Zero seguro

Omelete com queijo (`BRC0025J`) é receita composta e fica `unknown`, com zero sugestões. Leite integral UHT retornou apenas uma alternativa que atingiu o corte, demonstrando que o sistema não completa artificialmente uma lista de três.

## API e fluxos

Rotas do nutricionista em rascunho:

- `GET /meal-plan-items/:itemId/substitution-suggestions`;
- `GET /meal-plan-items/:itemId/substitution-equivalence?foodId=...`;
- `POST /meal-plan-items/:itemId/substitutions`;
- `PATCH /meal-plan-item-substitutions/:id`;
- `DELETE /meal-plan-item-substitutions/:id`;
- `PUT /meal-plan-items/:itemId/substitutions/order`.

O nutricionista abre “Adicionar substituição”, vê de zero a três sugestões, porção e diferenças nutricionais, e decide aprovar. A busca manual reutiliza o catálogo TBCA; calcula uma porção inicial e permite ajuste por medida real. Se for outro grupo/preparo ou falhar os critérios automáticos, aparece um aviso clínico que não depende apenas de cor.

O painel também expõe os textos de preferências, restrições e alergias, mas declara que **não são filtros automáticos**. Esses campos existentes são texto livre e não permitem uma exclusão estrutural confiável; interpretá-los heuristicamente poderia dar falsa segurança. A responsabilidade de aprovação permanece visível para o nutricionista.

O paciente recebe somente alternativas persistidas e aprovadas. “Trocar” abre “No lugar de...” com nome e porção. Essa seleção é exclusivamente visual, não é salva e não cria `meal_entries`.

## Publicação, snapshot, versão e histórico

No rascunho, o alimento principal e as alternativas usam nutrientes atuais. Publicar trava o plano e congela `nutrient_snapshot` dos itens e de todas as alternativas na mesma transação. Plano ativo/arquivado lê o snapshot e é imutável.

“Nova versão” clona refeições, itens, ordem, quantidades, medidas, alternativas, origem e metadados, mas não carrega snapshots nutricionais. Assim o novo rascunho preserva as escolhas e recalcula com o catálogo atual; o histórico anterior continua reproduzível.

## Autorização e concorrência

As rotas reutilizam o vínculo nutricionista–paciente. Paciente e nutricionista externo recebem 404 nas sugestões; apenas o dono acessa e só enquanto o plano é rascunho. Toda mutação trava a linha do plano com `FOR UPDATE`. O mesmo lock é usado pela publicação, serializando aprovação, quarta alternativa e publicação.

O teste concorrente dispara três inclusões após uma alternativa existente: duas retornam 201 e uma retorna 409; a tabela termina com posições 0, 1 e 2. A constraint rejeita diretamente posição 3. Publicação concorrente com mutações não deixa alternativa fora do snapshot.

## Performance e queries

A sugestão não faz N+1 sobre 5.874 alimentos. A consulta inicial limita por categorias e curadoria; classificação semântica acontece antes de carregar medidas; uma consulta agregada carrega nutrientes e uma consulta em lote carrega medidas somente dos semanticamente compatíveis.

Benchmarks locais de ranking ficaram aproximadamente entre 10 e 202 ms, incluindo partida fria, nos casos documentados. A leitura do plano 6 refeições/24 itens permanece em queries constantes: passou de 6 para 7 queries por causa do lote único de alternativas e mediu 21,5 ms no teste de API local.

## UI, acessibilidade e inspeção visual

O painel é um dialog semântico, com título/descrição, labels, mensagens de erro, foco visível e controles de pelo menos 44 px. As diferenças são texto, não apenas cor. O aviso fora do grupo tem conteúdo explícito. A regra `prefers-reduced-motion` inclui o dialog portado.

Inspeção real com dados sintéticos (removidos depois):

- nutricionista e paciente em 360×812, 375×812, 390×812 e 430×812;
- 1024×768;
- 1440×900;
- painel aberto, lista aprovada, sugestões, busca manual e aviso fora do grupo;
- “Trocar” do paciente aberto com nome longo e navegação inferior.

O único defeito encontrado foi a propriedade CSS independente `translate` do componente-base no bottom sheet móvel. A correção mínima adicionou `translate: none` no breakpoint móvel. A reinspeção confirmou zero overflow horizontal em todas as larguras.

## Testes e integridade

Cobertura específica:

- unidade: classificação, `unknown`, compatibilidade, preparação, mínimos quadrados, determinismo, medida e fluxo manual entre grupos;
- catálogo real: arroz, feijão, frango, ovo, leite, fruta e receita composta; IDs TBCA reais, medidas reais, estabilidade e família sem contaminação pelo texto “sem óleo”;
- API: autorização, sugestão, manual, duplicidade, limite/concurrency, ordem, edição, remoção, mL, contagem, totais, publicação, snapshots, paciente, histórico, nova versão e Diário intacto;
- frontend: fluxos e garantias estáticas do Plano, mobile, acessibilidade e reduced-motion;
- regressões completas de backend/frontend, TypeScript, lint, build e `git diff --check`.

Baseline final:

| Invariante | Resultado |
|---|---|
| TBCA ativos | 5.874 |
| Medidas | 8.317 |
| Alimentos | `c736b4d473fdb20bd56fa90d5c6c92add5a3db24ef20f037f1b999de353521f6` |
| Nutrientes | `7c663b29885bff52dda27adf5d295126b67d68dbb79ea7965d011845ac0f55db` |
| Artefato de medidas | `2277486e9d63c8cb3544d5711b535bedb3e9bacd7c2c6829ba52bb972dfeaa08` |
| Histórico/measure snapshots | `019666543e65d1932532d9fd1910b308480a1c155849e675680dcb5d28e50335` |

## Limitações deliberadas

- A cobertura é baixa por desenho; `unknown` é preferível a sugestão ruim.
- Alergias, restrições e preferências atuais são texto livre e exigem revisão humana.
- O ranking não aprende comportamento e não usa o Diário.
- A escolha visual do paciente não é registrada.
- Não há troca da refeição inteira, listas de compras, alertas ou notificações.
- Novos tipos de alimento só entram automaticamente quando houver regra estrutural auditável; não se deve ampliar regex apenas para aumentar cobertura.
