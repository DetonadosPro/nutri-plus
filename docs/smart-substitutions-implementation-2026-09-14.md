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
| Carboidrato | 195 |
| Leguminosa | 56 |
| Proteína animal | 554 |
| Ovo | 22 |
| Lácteo | 41 |
| Fruta | 106 |
| Vegetal | 322 |
| Gordura | 33 |
| `unknown` | 4.545 |

Há 1.329 classificações positivas e 4.545 abstenções. As abstenções se dividem em: 2.952 curadorias não individuais, 1.012 sem evidência estrutural suficiente, 453 com confiança baixa, 126 compostos/específicos bloqueados e 2 gorduras sem uso culinário equivalente. A cobertura conservadora é intencional.

## Compatibilidade e preparação

A ordem é semântica antes de matemática:

1. ambos precisam ter grupo conhecido;
2. o grupo precisa coincidir;
3. papéis culinários específicos precisam coincidir (leite, iogurte, queijo; óleo, pasta de gordura);
4. preparações estritas (`raw`, `fresh`, `fried`, `liquid`) precisam coincidir;
5. cozido/grelhado/assado podem se relacionar com penalidade controlada;
6. pertencer à mesma família não bloqueia um candidato válido; o ranking prefere famílias distintas na primeira passagem e só completa vagas com a mesma família quando necessário;
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

O desempate final usa `source_code`. A família é preferência de diversidade, não bloqueio: primeiro entram famílias distintas e, se ainda houver vagas, alternativas válidas da mesma família. `duplicate_group` continua sendo o bloqueio de variantes redundantes. O máximo é três. O sistema prefere retornar zero quando o original é `unknown`, faltam nutrientes, a preparação não combina, a quantidade é implausível, nenhuma porção arredondada passa nas tolerâncias, o candidato é duplicado ou a curadoria é insegura.

## Casos reais auditados

### Arroz branco cozido, 100 g (`BRC0018A`)

Em uma repetição final aquecida, 182 ms: 696 candidatos iniciais, 8 após todos os filtros e 3 retornados.

- macarrão de arroz cozido (`BRC0937A`): 2,5 colheres de servir cheias = 125 g, erro .0595;
- macarrão de trigo sem ovos cozido (`BRC0195A`): 2 colheres de servir cheias = 100 g, erro .1323;
- mandioca cozida (`BRC0053B`): 4,5 colheres de sopa rasas = 99 g, erro .2192.

### Peito de frango grelhado, 100 g (`BRC0114F`)

Em uma repetição final aquecida, 150 ms: 685 iniciais, 47 aprovados pelos filtros e 3 retornados.

- maminha bovina grelhada (`BRC0041F`): 110 g, erro .0560;
- camarão cozido sem casca (`BRC0001E`): 4,5 colheres de servir cheias = 180 g, erro .0285;
- peito de peru sem pele cozido (`BRC0789F`): 1 peça/fatia média = 110 g, erro .0287.

### Banana nanica, 100 g (`BRC0007C`)

Caso de fruta fresca: banana-ouro (`BRC0010C`), 2 unidades = 80 g; maçã com casca (`BRC0063C`), 1 unidade média = 130 g; lichia in natura (`BRC0304C`), 120 g. Alternativas acima de 300 g ou três vezes a porção original são rejeitadas.

### Feijão carioca cozido, 100 g (`BRC0001T`)

Feijão-fradinho cozido (`BRC0003T`), 6 colheres de sopa = 102 g; ervilha em grão (`BRC0071T`), 5,5 colheres rasas = 77 g; e lentilha (`BRC0018T`), 2 colheres de servir = 70 g, são as três primeiras. Grão-de-bico também passa o corte. Ervilha em vagem é deliberadamente excluída por papel culinário incompatível.

### Zero seguro

Omelete com queijo (`BRC0025J`) é receita composta e fica `unknown`, com zero sugestões. Azeite e manteiga retornaram zero na matriz final; manteiga de cacau foi removida do papel de gordura culinária. Leite integral UHT retornou duas alternativas em mL real, sem completar artificialmente três.

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

Na matriz final de 31 casos, benchmarks aquecidos ficaram entre 7 e 141 ms, média de 91 ms; a maior observação incluindo variação de partida foi 176 ms. A leitura do plano 6 refeições/24 itens permanece em queries constantes: passou de 6 para 7 queries por causa do lote único de alternativas e mediu 21,5 ms no teste de API local.

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

## Revisão clínica/comportamental final

### O que os contadores significam

`initialCandidates` é o tamanho do lote SQL depois de categoria TBCA, `base_food`/`simple_preparation` e confiança não baixa, mas **antes** da classificação no grupo exato. Por isso arroz parte de 696 registros das categorias “Cereais e derivados” e “Vegetais e derivados”, embora somente 195 alimentos do catálogo inteiro terminem classificados como carboidrato. Proteína parte de 685 registros das categorias de carnes e pescados, embora 554 terminem classificados como proteína animal.

Depois disso, `semanticCandidates` conta somente registros que passaram por classificação, mesmo grupo, papel culinário e preparação. Nos casos de arroz foram 69; nos casos proteicos, 213. Só então as medidas são carregadas e a matemática é executada. `eligibleCandidates` é o número que também passou por quantidade plausível, arredondamento e tolerâncias nutricionais; é o contador historicamente exposto como `classifiedCandidates`, mantido por compatibilidade. Assim, nenhum grupo incompatível chega ao cálculo nutricional automático.

### Família e duplicidade

A revisão confirmou um bug: `same_food_family` bloqueava toda alternativa da mesma família, inclusive banana-nanica → banana-prata (erro .0426) e feijão carioca → feijão vermelho (erro .1982). Isso não era equivalente a `duplicate_group`. A correção removeu o bloqueio semântico por família. A família agora é apenas uma preferência de diversidade: a primeira passagem escolhe famílias distintas e uma segunda passagem pode completar vagas com a mesma família. O próprio alimento, IDs já aprovados e `duplicate_group` repetido continuam bloqueados.

Também foi eliminada contaminação da família por qualificadores como “sem óleo”; famílias de gordura agora só são inferidas dentro do grupo gordura. `laranja-pera` permanece na família laranja.

### Falhas reais encontradas e correções mínimas

- Radicais como `linguic`, `empanad` e `apresunt` tinham uma fronteira regex depois do radical e não bloqueavam “linguiça”, “empanado” e “apresuntado”. A expressão foi corrigida e ampliada somente com processados observados: fiambre, bacon, charque, paio e defumados.
- Empada de frango, cuscuz com atum/camarão/legumes, quibe, falafel, homus, enroladinho, iogurte com granola composta e preparações equivalentes observadas passaram pela classificação estrutural. Esses padrões demonstrados agora ficam `unknown`.
- Miúdos que ocupavam papel culinário diferente — bucho, moela, língua, rabo e pé — foram separados da proteína animal automática.
- Manteiga de cacau e óleo de cobertura de conserva deixaram de ser gorduras culinárias automáticas. Azeite e manteiga passaram a retornar zero na matriz, como comportamento conservador.
- `porção ANVISA` era escolhida antes de mL/gramas e ovo podia preferir “porção média” a uma unidade real. Medidas regulatórias/genéricas foram rebaixadas; o algoritmo testa a marca arredondada e um passo vizinho para encontrar, por exemplo, 200 mL válidos. Para iogurte, o rótulo genérico com “fatia” perde prioridade para mL real.
- O texto “classificação segura” foi substituído por “classificação confiável”; a UI não promete segurança para alergias ou restrições.

### Matriz de preparação

| Par | Resultado | Score de preparo | Exemplo real |
|---|---|---:|---|
| cru → cru | compatível | 1,00 | alface → chicória |
| cozido → cozido | compatível | 1,00 | feijão → lentilha |
| cozido ↔ grelhado | compatível com penalidade | .78 | camarão cozido ↔ frango grelhado |
| grelhado ↔ assado | compatível com penalidade | .78 | proteína grelhada ↔ assada |
| frito → frito | compatível | 1,00 | somente mesmo grupo/papel |
| frito ↔ outra preparação | bloqueado | 0 | batata frita não entra para batata cozida |
| fresco → fresco | compatível | 1,00 | banana → maçã |
| fresco ↔ outra preparação | bloqueado | 0 | fruta fresca não recebe fruta cozida/desidratada |
| líquido → líquido | compatível | 1,00 | leite UHT → leite pasteurizado |
| líquido ↔ sólido | bloqueado | 0 | leite não recebe queijo |
| `other` original → cozido/grelhado/assado | permitido com cautela | .62 | omelete sem marcador → ovo cozido |
| cozido/grelhado/assado → `other` | bloqueado | 0 | preparação conhecida não perde especificidade |

### Matriz TBCA real

Todos os casos usam 100 g para comparação uniforme. “Alvo” está em kcal/proteína/carboidrato/lipídios/fibra. Contadores são inicial/semântico/elegível. Cada opção registra gramas ideais → porção final e erro antes → depois do arredondamento. A ordem final usa 58% qualidade nutricional, 22% preparação, 12% medida e 8% curadoria; `source_code` é o desempate estável.

| Original | Código | Grupo/preparo | Alvo | Candidatos | Opções finais |
|---|---|---|---|---:|---|
| Arroz branco cozido | BRC0018A | carboidrato/cozido | 130/2,4/30/0,4/1,2 | 696/69/14 | Bifum BRC0937A 126,8→125 g (.058→.060); macarrão BRC0195A 102,8→100 g (.130→.132); mandioca BRC0053B 99,4→99 g (.219→.219) |
| Macarrão cozido | BRC0195A | carboidrato/cozido | 125/3,5/27,3/0,5/1 | 696/69/11 | arroz BRC0018A 93,8→90 g (.093→.101); macarrão BRC0116A 117,6→112,5 g (.142→.148); cuscuz BRC0698A 109,2→110 g (.183→.183) |
| Mandioca cozida | BRC0053B | carboidrato/cozido | 120/0,6/29,8/0,2/1,8 | 696/69/7 | mandioca BRC0908B 100,5→100 g (.003→.005); batata-baroa BRC0054B 141,7→140 g (.189→.189); mandioca BRC0873B 99,7→100 g (.013→.013) |
| Batata inglesa cozida | BRC0117B | carboidrato/cozido | 51/1,3/12,2/0,1/1,5 | 696/69/39 | cará BRC0046B 64,9→66,5 g (.073→.077); batata-baroa BRC0054B 66,9→70 g (.143→.150); arroz integral BRC0016A 49,9→50 g (.158→.158) |
| Cuscuz de milho cozido | BRC0409A | carboidrato/cozido | 109/2,2/24,7/0,7/2 | 696/69/36 | arroz integral BRC0016A 100,9→100 g (.067→.068); batata-baroa BRC0054B 135,7→137,5 g (.165→.165); mandioca BRC0053B 88,6→88 g (.219→.219) |
| Cará cozido | BRC0046B | carboidrato/cozido | 77/1,5/18,9/0,1/2,6 | 696/69/26 | batata BRC0117B 151,2→150 g (.084→.085); cará BRC0910B 100,3→100 g (.003→.004); arroz BRC0018A 62,1→60 g (.199→.202) |
| Peito de frango grelhado | BRC0114F | proteína/grelhado | 150/32,1/0/2,5/0 | 685/213/51 | maminha BRC0041F 107,6→110 g (.051→.056); camarão BRC0001E 183,7→180 g (.020→.028); peru BRC0789F 110,7→110 g (.028→.029) |
| Contrafilé grelhado | BRC0023F | proteína/grelhado | 266/32,1/0/15,3/0 | 685/213/121 | salmão BRC0066E 123,7→120 g (.083→.088); bovino BRC0281F 104→110 g (.050→.076); bisteca BRC0160F 100,3→100 g (.115→.115) |
| Lombo suíno assado | BRC0163F | proteína/assado | 200/35,7/0/6,4/0 | 685/213/96 | caça BRC0864F 119→110 g (.108→.131); vitela BRC0853F 107,6→110 g (.054→.059); frango BRC0109F 124,9→120 g (.078→.087) |
| Sardinha assada | BRC0068E | proteína/assado | 176/27/10,3/3/0 | 685/213/64 | cabrito BRC0850F 105,2→110 g (.149→.156); frango BRC0113F 93,6→95 g (.152→.153); caranguejo BRC0004E 146,7→150 g (.146→.148) |
| Atum cozido | BRC0131E | proteína/cozido | 137/31,9/0/1,1/0 | 685/213/13 | atum BRC0132E 100,2→100 g (.002→.002); lagosta BRC0006E 160,4→160 g (.069→.069); peixe BRC0182E 137,1→135 g (.016→.022) |
| Camarão cozido | BRC0001E | proteína/cozido | 82/17,7/0/1,3/0 | 685/213/57 | pintado BRC0096E 79,8→80 g (.008→.008); pescadinha BRC0174E 93,9→100 g (.082→.104); lula BRC0235E 84,8→85 g (.004→.004) |
| Feijão carioca | BRC0001T | leguminosa/cozido | 70/4,8/15,3/0,5/7,1 | 142/36/21 | feijão-fradinho BRC0003T 100,1→102 g (.089→.091); ervilha BRC0071T 77→77 g (.156→.156); lentilha BRC0018T 75,3→70 g (.179→.192) |
| Lentilha | BRC0018T | leguminosa/cozido | 98/7,3/19,6/0,5/6,4 | 142/36/19 | feijão vermelho BRC0029T 89,7→87,5 g (.053→.059); ervilha BRC0071T 99,5→102 g (.099→.102); lentilha BRC0256T 100,4→100 g (.002→.004) |
| Grão-de-bico | BRC0017T | leguminosa/cozido | 115/7,5/20,8/1,9/7,5 | 142/36/30 | grão-de-bico BRC0106T 100,7→99 g (.002→.017); lentilha BRC0077T 109→108 g (.045→.045); feijão BRC0254T 82,3→80 g (.135→.138) |
| Ervilha em grão | BRC0071T | leguminosa/cozido | 90/7,5/17,6/0,6/7,3 | 142/36/20 | ervilha BRC0072T 100,8→102 g (.010→.015); feijão BRC0029T 88,7→87,5 g (.069→.071); lentilha BRC0018T 97,8→94,5 g (.095→.101) |
| Banana nanica | BRC0007C | fruta/fresco | 91/1,3/21,8/0,2/1,7 | 179/58/16 | banana-ouro BRC0010C 75,9→80 g (.056→.077); maçã BRC0063C 121,3→130 g (.215→.226); lichia BRC0304C 119,9→120 g (.036→.036) |
| Maçã | BRC0063C | fruta/fresco | 65/0,2/16,6/0,3/2 | 179/58/30 | banana-maçã BRC0009C 62,6→65 g (.139→.144); manga BRC0025C 101,2→100 g (.054→.056); laranja BRC0019C 138,6→140 g (.226→.226) |
| Laranja-lima | BRC0019C | fruta/fresco | 43/0,9/10,3/0,3/2 | 179/58/39 | melão BRC0028C 176,9→180 g (.040→.044); caju BRC0049C 98,2→100 g (.082→.084); laranja-pera BRC0020C 120,1→120 g (.065→.065) |
| Manga | BRC0025C | fruta/fresco | 64/0,5/16/0,3/2,1 | 179/58/33 | banana-maçã BRC0009C 61,5→65 g (.128→.140); maçã BRC0063C 98,3→100 g (.053→.056); laranja BRC0019C 139,5→140 g (.171→.171) |
| Melancia | BRC0027C | fruta/fresco | 29/0,7/6,5/0,1/0,1 | 179/58/1 | romã BRC0086C 43,8→45 g (.102→.105) |
| Leite integral UHT | BRC0044G | lácteo/líquido | 65/2,4/7,2/3/0 | 94/5/2 | leite pasteurizado BRC0043G 91→100 mL (.225→.245); semidesnatado BRC0046G 97,1→100 mL (.289→.290) |
| Iogurte integral | BRC0011G | lácteo/outro | 75/3,1/10,9/2,2/0,2 | 94/12/9 | iogurte pêssego BRC0019G 108,9→100 mL (.108→.135); iogurte maçã BRC0014G 111,8→110 g (.089→.090); iogurte com aveia BRC0110G 57,2→55 g (.105→.112) |
| Muçarela | BRC0047G | lácteo/outro | 310/21,4/3,4/23,5/— | 94/20/7 | minas frescal BRC0052G 124,8→125 g (.069→.069); brie BRC0156G 97,2→95 g (.094→.096); meia cura BRC0154G 96,7→95 g (.029→.033) |
| Alface | BRC0009B | vegetal/cru | 9/1,1/1,8/0,1/1,8 | 414/76/43 | chicória BRC0071B 75,5→75 g (.116→.116); folha BRC0067B 38,6→36 g (.102→.118); jambu BRC0715B 32,3→30 g (.102→.121) |
| Abobrinha | BRC0040B | vegetal/cozido | 14/1/2,8/0,2/1,5 | 414/124/102 | couve-flor BRC0052B 75,8→75 g (.069→.070); rabanete BRC0320B 88,8→87,5 g (.088→.089); abóbora BRC0166B 68,4→70 g (.107→.109) |
| Pepino | BRC0030B | vegetal/cru | 10/0,7/2,2/0,1/1 | 414/76/51 | tomate BRC0035B 62,3→63 g (.047→.047); repolho BRC0033B 53,3→55 g (.045→.053); catalonha BRC0070B 47,1→45 g (.084→.092) |
| Omelete simples | BRC0065J | ovo/outro | 146/12,2/2,3/9,8/0 | 33/4/4 | ovo cozido BRC0010J 116,4→115 g (.046→.048); ovo com sal BRC0023J 117,3→115 g (.047→.051); codorna BRC0052J 92,4→90 g (.080→.084) |
| Ovo cozido | BRC0010J | ovo/cozido | 125/10,4/1,4/8,7/0 | 33/3/3 | ovo BRC0023J 100,8→2 unidades/100 g (.002→.008); codorna BRC0052J 79,7→80 g (.048→.048); codorna BRC0060J 79,7→80 g (.048→.048) |
| Azeite de oliva | BRC0002D | gordura/outro | 900/0/0/100/0 | 41/21/0 | 0 — nenhuma porção passou |
| Manteiga | BRC0004D | gordura/outro | 673/0,4/0,5/74,4/0 | 41/5/0 | 0 — manteiga de cacau foi abstida |

Distribuição: 27 casos com 3 sugestões, 1 com 2, 1 com 1 e 2 com zero. Isso não é meta de cobertura: os casos de gordura permaneceram em abstention e melancia retornou somente uma opção.

### Revisão de thresholds

Os thresholds foram preservados. A amostra encontrou candidatos bons próximos ao limite e rejeições imediatamente do outro lado, sem padrão de grupo permissivo ou restritivo que justificasse recalibração:

- arroz: macarrão `BRC0834A` passa com .2387; inhame `BRC0347B` falha com .2401 para limite .24;
- frango: arraia `BRC0505E` passa com .2721; carnes de caça próximas de .30 falham por tolerância individual mesmo quando o erro agregado fica ligeiramente abaixo de .30;
- fruta: romã passa com .2316; rambutão falha com .2657 para limite .25;
- leite: semidesnatado passa com .2903; leite de cabra integral falha com .3062;
- vegetal: jalapeño passa com .3991; champignon falha com .4039 para limite .40.

### Golden tests adicionados

A suíte pequena protege os casos estáveis revelados pela revisão: mesmo-grupo/mesma-família permitido, banana com uma alternativa de banana e uma maçã, feijão com outra variedade e lentilha, bloqueio de empada/linguiça/empanado/apresuntado/fiambre, iogurte com granola composta, manteiga de cacau, preparação incompatível, mL real para leite e contagem real para ovo. Não foi criado snapshot do catálogo inteiro.

### Rounding auditado

Foram revisadas 84 sugestões; variação média de massa 2,38%, máxima 9,9%, e maior aumento de erro .027. Os 15 maiores deslocamentos foram:

| Original → candidato | Ideal → final | Diferença | Erro antes → depois |
|---|---:|---:|---:|
| BRC0044G → BRC0043G | 91 → 100 mL | 9 g / 9,9% | .2250 → .2448 |
| BRC0011G → BRC0019G | 108,9 → 100 mL | 8,9 g / 8,1% | .1076 → .1346 |
| BRC0163F → BRC0864F | 119 → 110 g | 9 g / 7,6% | .1077 → .1313 |
| BRC0007C → BRC0063C | 121,3 → 130 g | 8,7 g / 7,2% | .2147 → .2257 |
| BRC0009B → BRC0715B | 32,3 → 30 g | 2,3 g / 7,2% | .1025 → .1208 |
| BRC0001T → BRC0018T | 75,3 → 70 g | 5,3 g / 7,0% | .1790 → .1918 |
| BRC0009B → BRC0067B | 38,6 → 36 g | 2,6 g / 6,7% | .1020 → .1181 |
| BRC0001E → BRC0174E | 93,9 → 100 g | 6,1 g / 6,5% | .0822 → .1044 |
| BRC0023F → BRC0281F | 104 → 110 g | 6 g / 5,8% | .0500 → .0762 |
| BRC0025C → BRC0009C | 61,5 → 65 g | 3,5 g / 5,6% | .1284 → .1397 |
| BRC0007C → BRC0010C | 75,9 → 80 g | 4,1 g / 5,3% | .0563 → .0774 |
| BRC0117B → BRC0054B | 66,9 → 70 g | 3,1 g / 4,6% | .1426 → .1496 |
| BRC0068E → BRC0850F | 105,2 → 110 g | 4,8 g / 4,5% | .1492 → .1557 |
| BRC0030B → BRC0070B | 47,1 → 45 g | 2,1 g / 4,4% | .0839 → .0920 |
| BRC0195A → BRC0116A | 117,6 → 112,5 g | 5,1 g / 4,3% | .1422 → .1484 |

Todas continuaram dentro das tolerâncias depois do arredondamento. O teste de um passo vizinho não relaxa limites: apenas encontra outra marca real que também precisa passar pelos mesmos critérios.

### Cross-group, alergias e linguagem

Arroz → frango pelo fluxo manual continua retornando `automaticCompatible=false` e `different_group`; a UI diz explicitamente que a escolha não atende aos critérios automáticos e pede confirmação clínica. O profissional pode aprovar; depois disso o paciente vê somente alimento e porção, sem score ou aviso técnico. A ação não altera o Diário.

Preferências, restrições e alergias continuam como texto livre. Quando preenchidas, aparecem no painel com o aviso de que não filtram sugestões; quando todas estão vazias, o bloco não é exibido. Não existe parser nem promessa de opção “segura”.

### Observação fora do score v1

A auditoria identificou diferenças grandes de sódio em alguns pares macro-equivalentes, especialmente arroz → bifum e proteínas → frutos do mar. Não foi adicionado sódio ao score porque o v1 foi deliberadamente definido por energia/macros/fibra e a amostra inclui sódio intrínseco legítimo em pescados. Esse ponto permanece explícito para futura política clínica, sem fingir uma segurança que o motor não calcula.
