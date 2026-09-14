# Plano Alimentar — implementação de 13/09/2026

## Arquitetura

O Plano Alimentar foi implementado como um agregado próprio e normalizado, independente de `daily_logs`, `meals` e `meal_entries`. A raiz `meal_plans` representa uma versão da prescrição; `meal_plan_meals` mantém tipos canônicos e ordenados; `meal_plan_items` liga cada prescrição ao alimento TBCA e à quantidade convertida. Nada prescrito é gravado automaticamente no Diário.

O desenho mantém chaves estáveis para uma futura comparação Plano × Diário e permite acrescentar alternativas/grupos de substituição por item sem serializar refeições em JSON.

## Migration e tabelas

A migration `026_meal_plans.sql` cria:

- `meal_plans`: paciente, autor, versão, estado, título, orientações, plano de origem, controle otimista e datas de publicação/arquivamento;
- `meal_plan_meals`: tipo canônico, posição e observação após a migration `027_meal_plan_canonical_meals.sql`;
- `meal_plan_items`: alimento, posição, quantidade, unidade, gramas equivalentes, snapshots da medida e dos nutrientes publicados, e observação.

Constraints garantem estados coerentes, versões positivas e únicas por paciente, quantidades válidas, posições válidas e textos limitados. O índice parcial `meal_plans_one_active_per_patient` impede mais de um plano ativo por paciente. As posições são únicas e deferrable para permitir reordenação transacional. Índices cobrem paciente/estado/versão, autor, plano/refeição/posição e alimento.

As migrations foram validadas tanto no fluxo completo de banco limpo quanto sobre um schema existente. Como a 026 já havia sido publicada antes desta rodada, a 027 converte os rótulos conhecidos para `meal_type`, remove `name` e `meal_time` e preserva as demais informações.

## Estados, versionamento e publicação

Estados: `draft`, `active` e `archived`. Drafts podem ser editados. Planos ativos ou arquivados são somente leitura pela API.

Duplicar ou criar nova versão copia refeições, posições, itens, observações, conversões e snapshots para um novo draft do mesmo paciente. A numeração é atribuída sob `pg_advisory_xact_lock(patient_id)` e também protegida por `UNIQUE(patient_id, version)`.

A publicação ocorre em uma única transação: adquire lock por paciente, bloqueia o draft, valida que existe refeição com item, arquiva o ativo anterior e ativa o novo plano com `published_at`. O índice parcial é a proteção final contra corrida. Falhas após o início da publicação foram injetadas em teste e comprovaram rollback integral, mantendo o ativo anterior.

## Autorização

Todas as rotas profissionais validam sessão, papel de nutricionista e vínculo real com o paciente no backend. IDs arbitrários de plano, refeição ou item atravessam novamente o vínculo antes de qualquer mutation. Pacientes acessam apenas `/api/patient/meal-plan`, que deriva o paciente da sessão e retorna somente o plano ativo; não existe mutation de plano para paciente.

## Quantidades, medidas e snapshots

Itens reutilizam `quantityInput`, `resolveQuantity`, `measureGrams`, `food_measures` e `MeasureInput`, a mesma cadeia já validada no Diário. São suportados gramas, medidas caseiras, mL e contagem. Ao salvar uma medida catalogada, o snapshot registra id, tipo, nome/plural, quantidade de referência, gramas, fonte, referência e default. O cálculo futuro usa a cópia persistida quando o item é editado, preservando o histórico mesmo se o catálogo mudar.

## Nutrientes e metas

Drafts calculam nutrientes sob demanda a partir de `food_nutrients` TBCA e `grams_equivalent`, usando `scaleNutrients` e `sumNutrientSets`. Na publicação, cada item recebe um snapshot compacto de todos os registros nutricionais do alimento, incluindo código, valor numérico, valor original e estado. Planos ativos e arquivados usam esse snapshot; novas versões voltam a usar o catálogo atual enquanto draft e recapturam os nutrientes ao serem publicadas. Assim, não há duplicação durante a edição e o histórico clínico publicado permanece reproduzível.

A meta vigente do paciente é carregada junto com o plano. Energia, macros, fibras e proteína mínima por peso podem ser comparadas na interface. As metas diretas têm precedência; quando não existem, os macros são derivados da energia e dos percentuais configurados. Percentuais são informativos e não bloqueiam publicação.

## API

Rotas profissionais:

- `GET/POST /api/nutritionist/patients/:patientId/meal-plans`
- `GET /api/nutritionist/patients/:patientId/meal-plans/active`
- `GET/PATCH /api/meal-plans/:planId`
- `POST /api/meal-plans/:planId/publish`
- `POST /api/meal-plans/:planId/duplicate`
- `POST /api/meal-plans/:planId/meals`
- `PATCH/DELETE /api/meal-plan-meals/:mealId`
- `PUT /api/meal-plans/:planId/meals/order`
- `POST /api/meal-plan-meals/:mealId/items`
- `PATCH/DELETE /api/meal-plan-items/:itemId`
- `PUT /api/meal-plan-meals/:mealId/items/order`

Rota do paciente: `GET /api/patient/meal-plan`.

Erros conhecidos retornam 400, 403, 404 ou 409 com mensagens compreensíveis. Exceções internas retornam mensagem genérica, sem SQL ou stack trace no cliente.

## Frontend

O workspace do nutricionista ganhou a área `Plano`, com estado vazio, continuidade do draft, resumo nutricional, comparação de metas, refeições em cards, editor de título/orientações, busca humanizada, `MeasureInput`, observação por item, reordenação leve por botões, mutations imediatas, status de salvamento, publicação, nova versão, duplicação e histórico read-only.

O paciente ganhou a área `Plano` read-only e um atalho mobile no Diário. A visualização mostra atualização, orientações, refeições, alimentos e porções, sem horários, IDs ou dados técnicos. O Diário continua inalterado.

O layout é limitado a 58rem no desktop, possui cards arredondados e converte editores em uma coluna no mobile. O resumo nutricional virou um único bloco compacto; controles têm área mínima de toque e estados de foco/alerta acessíveis.

## Atualização e consistência

Cada mutation retorna o agregado recalculado. Inclusão, edição, reordenação e publicação substituem o estado em memória sem reload. Exclusões são seguidas por uma leitura única do plano para atualizar simultaneamente itens e totais. `lock_version` protege edição concorrente dos metadados do draft.

## Performance

O endpoint completo usa seis queries previsíveis, independentemente do número de itens: plano, refeições, itens+alimentos+nutrientes, medidas em lote, meta e peso. Não há uma consulta por alimento. O smoke de 6 refeições/24 itens confirmou `queryCount=6` e ficou abaixo do teto local de 2 segundos.

## Testes

O teste integrado cobre criação de draft, refeições canônicas, rejeição de tipo inválido e duplicado, omelete por contagem, leite em mL, arroz/feijão em medida caseira, quantidade em gramas, edição, observação, exclusão, ordenação, nutrientes, metas, primeira publicação, leitura pelo paciente, imutabilidade, duplicação, nova versão, arquivamento, histórico, único ativo, clique duplo concorrente, rollback forçado, IDs inválidos, medida inválida, autorização cruzada, isolamento do Diário e cenário 6×24.

Os testes frontend cobrem prioridade do draft, reordenação sem perda/duplicação, progresso de metas, estados vazios, criação, busca, medidas, mutation sem reload, remoção, resumo, publicação, histórico, leitura do paciente, erro acessível e estrutura responsiva.

O smoke visual foi executado no aplicativo real, em desktop e viewports móveis, com dados sintéticos descartáveis. Foram conferidos editor profissional, refeições canônicas, medidas caseiras, contagem, mL, metas, versão read-only, histórico e navegação do paciente. A validação encontrou e corrigiu o tratamento da data de publicação na visão do paciente; a tela foi retestada após a correção.

## Extensões futuras deliberadamente adiadas

Substituições poderão ser modeladas por tabelas associadas a `meal_plan_items`, com grupos, alternativas e equivalências, sem mudar o agregado atual. Aderência poderá relacionar itens prescritos aos registros reais de `meal_entries`, mantendo as duas fontes separadas. IA, foto, notificações, lista de compras, PDF e compartilhamento não fazem parte desta versão.

## Riscos restantes

- A ordenação usa botões acessíveis em vez de drag-and-drop para evitar dependência pesada.
- A opção canônica `other` continua disponível para preservar a taxonomia completa do Diário, mas não aceita rótulo personalizado nesta versão.

## Revisão final antes da publicação

### Fingerprints do catálogo

Os hashes comparados anteriormente não medem o mesmo conteúdo:

- `4170afa41ad01612ef894955b3fe3cc22c93a4ecb313f1abf5eaf900a85b86de` é gerado por `measure-audit.ts` sobre linhas de `food_measures`, serializadas por `JSON.stringify` após ordenação por `food_id,key`. Ele inclui IDs substitutos e todas as colunas da medida, portanto caracteriza especificamente o banco local.
- `ac4d927479ed3db909c4179af5adbe6a3c3ce82ede400c232b68817e5b1f159e` usa o mesmo resultado local, mas projeta apenas `id`, `food_id` e `key`. Também depende dos IDs locais.
- `2277486e9d63c8cb3544d5711b535bedb3e9bacd7c2c6829ba52bb972dfeaa08` é o SHA-256 dos bytes do artefato versionado `backend/data/food-measures.reviewed.json`; é o fingerprint oficial e reproduzível do catálogo revisado de 8.317 medidas.
- `c736b4d473fdb20bd56fa90d5c6c92add5a3db24ef20f037f1b999de353521f6` é o fingerprint de identidade/códigos adotado pela auditoria de curadoria, sobre as colunas estruturais de `foods` ordenadas por `id`.

A migration 026 cria somente as três tabelas do Plano Alimentar. Ela não altera `foods`, `food_measures`, `food_nutrients`, códigos, aliases ou registros do Diário. A auditoria confirmou 5.874 alimentos TBCA, 8.317 medidas e os fingerprints oficiais anteriores intactos.

### Política de nutrientes históricos

A política inicial — medida congelada e nutrientes sempre atuais — manteria consistência operacional com o Diário, mas permitiria que totais de uma prescrição arquivada mudassem após uma correção do catálogo. Isso prejudicaria auditoria clínica, comparação entre versões e a futura aderência Plano × Diário.

A política final é congelar todos os nutrientes por item no momento da publicação. Drafts continuam refletindo correções legítimas do catálogo. Uma nova versão não herda o snapshot nutricional como verdade de cálculo: enquanto draft usa os dados atuais e, ao publicar, recebe um novo snapshot. O snapshot guarda somente as linhas nutricionais necessárias, não duplica o alimento nem cria cópias durante a edição.

### Concorrência e locks

Operações que alocam versão e publicações adquirem primeiro `pg_advisory_xact_lock(patient_id)`. A publicação, depois do advisory lock, relê o draft com `FOR UPDATE`. Metadados usam atualização atômica condicionada por `lock_version`; refeições e itens não usam esse controle otimista.

Testes concorrentes reais no PostgreSQL confirmaram:

- duas publicações do mesmo draft: uma resposta 200 e uma 409, com uma única ativação;
- dois drafts diferentes publicados simultaneamente: as operações são serializadas, ambas podem concluir, o primeiro fica arquivado e o último ativo; nunca existem dois ativos;
- duas edições dos mesmos metadados e mesmo `lock_version`: uma resposta 200 e uma 409;
- duas duplicações simultâneas: ambas concluem com versões distintas.

O índice parcial de plano ativo e `UNIQUE(patient_id,version)` são barreiras finais. Dentro das rotas atuais não há ciclo de locks: todas as operações serializadas usam um único advisory lock por paciente antes de qualquer row lock. Não há `lock_timeout` específico; uma operação aguarda a transação curta anterior terminar, e uma conexão encerrada libera os locks. Advisory lock, row lock, constraints e `lock_version` protegem invariantes diferentes, portanto foram preservados.

### Mudanças e riscos desta revisão

Foi acrescentado o snapshot nutricional de publicação e ampliada a cobertura concorrente. Permanecem como riscos controlados a ausência de timeout explícito para locks e o fato de mutations de refeições/itens seguirem a política de última escrita, enquanto apenas os metadados do plano usam `lock_version`.

## Refinamento final de UX e identidade visual

### Taxonomia e schema

A fonte canônica foi centralizada em `shared/meal-types.ts` e é compartilhada pelo Diário, backend e Plano: `breakfast`, `morning_snack`, `lunch`, `afternoon_snack`, `dinner`, `supper` e `other`. O frontend mantém apenas os ícones e nomes curtos de apresentação sobre essa fonte comum.

O Plano não recebe mais nome livre nem horário. Como a migration 026 já estava aplicada em produção quando esta revisão começou, ela não foi reescrita. A migration 027 converte os nomes conhecidos para `meal_type`, remove `name` e `meal_time`, valida os sete tipos canônicos e impede repetição do mesmo tipo dentro do plano. A API aceita `mealType`, rejeita valores inválidos ou já usados e posiciona novas refeições na ordem natural da taxonomia. Duplicação e nova versão preservam o tipo e a ordem.

### Experiência simplificada

O topo profissional foi reduzido a título, estado e uma ação principal de publicação. Histórico, nova versão e uso de versão anterior como base permanecem secundários. Título e orientações ficam em uma expansão discreta. O resumo nutricional passou de cinco cards concorrentes para um bloco integrado com energia, três macros e fibras em texto secundário.

As refeições usam linhas, não cards aninhados. O alimento fica compacto com nome e porção; tocar na linha revela `MeasureInput`, observação, ordenação, exclusão e salvamento. A busca continua usando o mesmo endpoint, componentes de campo e `MeasureInput` do Diário. Adicionar refeição exige abrir o seletor e tocar em um tipo; não abre teclado. Tipos já presentes ficam discretamente desabilitados.

O paciente vê somente “Plano alimentar”, a data de atualização, orientações quando existentes, refeições, alimentos e porções. Versão técnica, status interno, snapshots, gramas equivalentes e controles de edição não aparecem. Os horários foram removidos de todas as superfícies.

### Identidade e responsividade

Foram reutilizados tokens, tipografia, botões, campos, `EmptyState`, `MeasureInput`, bordas, raios e estados de foco do Nutri+. A largura útil passou a 58rem, as sombras foram suavizadas e não foi criada paleta própria. O layout usa uma coluna nos editores estreitos, seletor de refeições em duas colunas e alvos de toque de pelo menos 44–48 px. A animação de expansão é curta e respeita `prefers-reduced-motion`.

### Validação

A validação automatizada cobre taxonomia, ausência de nome/horário no contrato, ordem canônica, duplicidade, alimentos, medidas, publicação, snapshot, versionamento, histórico, concorrência, banco limpo e atualização a partir da 026.

O fluxo real foi validado no navegador com dados sintéticos em desktop amplo, monitor de 1024 × 768 px e larguras móveis de 360, 375, 390 e 430 px. Foram conferidos um rascunho totalmente vazio, plano curto, plano completo com seis refeições, os estados sem plano do nutricionista e do paciente, refeição com um item, refeição com vários itens, histórico, seletor canônico, inclusão de refeição na ordem natural, expansão do editor de alimento, busca por omelete e leitura do paciente. A busca retornou Omelete em primeiro lugar e ofereceu contagem em ovos e gramas pelo mesmo `MeasureInput` do Diário.

Não houve overflow horizontal nas quatro larguras móveis. Em 375 × 812 px, a primeira passagem revelou quebra desnecessária dos detalhes de meta dentro dos macros; esses detalhes redundantes foram removidos, preservando energia versus meta no resumo e deixando macros legíveis em uma única linha. O plano do paciente permaneceu sem controles, horário, versão técnica ou metadados internos, e a navegação inferior existente continuou íntegra.

## Revolução visual do Plano Alimentar

Rodada local de 14/09/2026, na branch `feature/meal-plan`, partindo de `e4c2d026a70b666b80175fa104d8d4248bead80e`. Esta seção registra a composição nova e substitui as decisões visuais da seção de refinamento anterior, sem modificar seu registro histórico. Sem stage, commit, push ou deploy.

### Diagnóstico e referência visual

Antes de editar, foram abertos no navegador local o Diário populado, a home do paciente, Perfil, workspace do nutricionista, navegação desktop/mobile, busca e modal de quantidades. O Diário forneceu a referência de superfícies claras, refeições identificáveis, energia azul, acentos de macros, cantos suaves e ações arredondadas.

O Plano anterior tinha cards praticamente indistinguíveis, porções afastadas dos nomes, três ações expostas em cada cabeçalho e resumo/observações antes das refeições do paciente. A tipografia do título também caía em uma fonte serifada, diferentemente dos títulos do Diário. Não foram copiados a repetição de métricas nem o empilhamento de cards internos. As inconsistências tipográficas fora do Plano não foram alteradas.

### Conceito e sistema de cores

Refeição é a unidade visual; alimento é uma linha. Nome, porção e observação têm hierarquia própria, sem dados técnicos na leitura do paciente. O cabeçalho da refeição combina ícone canônico, nome, quantidade de alimentos e superfície tonal. O fundo do conteúdo permanece claro, sem áreas grandes saturadas.

| Tipo | Identidade herdada do Diário | Fundo suave | Acento | Texto de ação |
| --- | --- | --- | --- | --- |
| breakfast | Solar / âmbar | #fff2d9 | #d28724 | #865514 |
| morning_snack | Verde fresco | #e8f4e9 | #64a06c | #416e47 |
| lunch | Coral | #fae9e6 | #c6655b | #9a4b43 |
| afternoon_snack | Pêssego | #fff0e8 | #dc8058 | #9a4d2b |
| dinner | Azul | #e9f5fa | #4e9fc2 | #326878 |
| supper | Violeta | #f1ebf8 | #8b68aa | #75538f |
| other | Neutro esverdeado | #eff3ef | #7b9185 | #4c6356 |

O mapeamento real prevaleceu sobre os exemplos conceituais do pedido: almoço continua coral, não foi remapeado para verde. O jantar reutiliza as variáveis do Diário onde disponíveis, com fallback igual. Os tons mais escuros foram reservados para texto legível; o acento original permanece pontual.

Tokens ficam em `frontend/app/meal-plan.css`, limitados a `.meal-plan-page` e aos dois componentes portais do Plano: `--plan-ink`, `--plan-muted`, `--plan-line`, `--plan-sage`, `--plan-blue`, `--plan-radius`, `--meal-soft`, `--meal-accent`, `--meal-ink`. O bloco antigo do Plano foi removido de globals.css; entrada e navegação compartilhada foram preservadas.

Contraste calculado em sRGB: texto principal/branco 11,51:1; secundário/branco 5,28:1; secundário/superfície azul 4,65:1; textos de ações sobre fundos de refeição entre 5,16:1 e 5,81:1. Identificação sempre inclui nome e ícone, nunca só cor. Opções desabilitadas também dizem “Já adicionada”.

### Composição e interação

- **Nutricionista:** título compacto, rascunho discreto, Publicar plano como ação principal; Histórico secundário. A partir de 1280px, refeições na área principal e resumo/metas/orientações em coluna lateral de 17,5rem. Em telas menores, resumo compacto acima da lista. Não foi criada ação fixa que disputasse espaço com a navegação inferior.
- **Paciente:** refeições primeiro; orientações, se existentes, depois; resumo nutricional em expansão fechada por padrão ao final. Sem editor, status interno, versão, IDs ou conversões técnicas.
- **Leitura desktop/tablet:** a partir de 768px, cada refeição do paciente ocupa uma faixa com identidade lateral e alimentos em duas colunas, respeitando a ordem no DOM. Evita o vazio entre cards com quantidades diferentes de alimentos. No celular, cabeçalho tonal acima e alimentos em coluna única.
- **Alimentos:** nome prioritário e porção abaixo, incluindo nomes longos de medidas oficiais. Observações só aparecem quando preenchidas. Tocar no alimento abre o editor; lápis discreto não depende de hover. Cancelar descarta o que não foi salvo.
- **Ações de refeição:** reordenação e exclusão dentro do menu de opções; extremos da ordem ficam desabilitados. Sem drag-and-drop. Adicionar alimento é uma ação tonal de baixo peso dentro do card.
- **Adicionar refeição:** opções coloridas com ícones existentes, sem teclado, nome livre ou horário. Tipos usados ficam desabilitados.
- **Nutrição:** energia, percentual e três macros com respectivas metas retornadas pela API, sem recalcular metas. Só há uma barra de energia. O desenho limita sua largura a 100%, mas o texto preserva percentuais acima de 100%. Testados 0%, 7–8%, 87–90%, próximo de 100% e 120%.
- **Histórico:** lista “Em edição”, “Plano atual” e “Anterior”, com data, versão secundária e indicação do plano visualizado. Versão arquivada explicita somente leitura e permite o fluxo existente “Usar como base”.
- **Publicação:** confirmação em Dialog do produto, com Cancelar/Confirmar publicação e explicação da preservação do histórico. Endpoint e transação não mudaram.
- **Vazio/loading/erro:** EmptyState acolhedor com pequeno ícone, ContentSkeleton existente, busca com carregamento e mensagem sem resultados, erro visível. O erro inicial do paciente não fica escondido por loading infinito. Respostas antigas da busca não sobrescrevem consultas novas.
- **Metadados:** o painel não recolhe a cada autosave; somente valores alterados são enviados, mantendo lock_version. Falha não é apresentada como “Salvo”. Os campos são reinicializados individualmente quando o valor persistido muda, sem remontar o painel.

Reutilizados Button, Input, Textarea, Label, EmptyState, ContentSkeleton, Dialog, DropdownMenu, MeasureInput, formatServing e os ícones/tipos canônicos. Apenas PlanNotes foi extraído como pequeno componente de apresentação local. Nenhuma dependência, fonte, imagem ou biblioteca de animação foi adicionada.

Transições de 160–180ms para expansão, entrada, hover e barra; foco visível e pressed. `prefers-reduced-motion` desativa movimento no escopo do Plano. Alvos principais de toque têm pelo menos 44px de altura.

### Passagens visuais e evidências

Foram feitas duas passagens de composição, seguidas de uma conferência corretiva em viewport estreito:

1. Baseline real, primeira composição colorida, inspeção de editor, publicação e histórico.
2. Comparação direta Diário × Plano do paciente × Plano profissional. A grade inicial do paciente deixava vazios abaixo de lanches pequenos; foi substituída por faixas de leitura, depois estendidas ao tablet.
3. A inspeção de leite em 360px revelou overflow **interno** do editor apesar de a página não apresentar scroll horizontal. O select com nomes longos impunha largura mínima à grade e cortava Salvar. Corrigidos somente os limites do container do Plano: grid minmax(0,1fr), min-width e flex do select contextual. Reaberto no navegador: editor, medidas e ações passaram a caber na mesma largura de 279px; Salvar ficou totalmente visível.

Também foram removidos os valores nutricionais “—” sem utilidade no rodapé de refeição vazia. Ajustes de acessibilidade do lint retiraram autofocus e usaram output para estado de carregamento. Um aviso de defaultValue do componente de campo durante autosave motivou a reinicialização individual dos campos; compilação e testes finais aprovados, mas esse último ajuste pontual não foi repetido em uma nova sessão visual após a limpeza das fixtures.

Capturas foram emitidas e inspecionadas **no navegador desta tarefa**, sem screenshots temporários no Git. Evidências incluem:

| Captura / interação registrada | Conteúdo |
| --- | --- |
| Baseline do Diário e Perfil | Diário com omelete, modal de quantidades, Perfil, navegação e workspace |
| Profissional desktop | Plano completo em 1440×1000 e 1920×1080, resumo lateral e editor |
| Profissional mobile | 360, 375×812, 390 e 430px; publicar, histórico e editor |
| Adicionar refeição | Seletor completo com seis tipos já usados e Outra refeição disponível |
| Adicionar/editar alimento | Leite em mL, omelete em ovos, cancelamento e salvamento |
| Paciente mobile | Plano completo e curto, empty state; nomes e porções longos |
| Paciente desktop/tablet | Faixas de refeições em 768, 1024×768, 1440 e 1920px |
| Histórico e publicação | Confirmação, plano publicado, nova versão e leitura de versão antiga |

Não houve scroll horizontal nas larguras 360, 375, 390, 430, 768, 1024, 1440 e 1920px. Além do scroll da página, foi conferida a largura interna do editor após a correção. Testes de viewport são em Chrome desktop com emulação de dimensões, não em aparelhos físicos/Safari.

Dados sintéticos realistas: omelete em ovos, leite em mL, banana por contagem, arroz e feijão em medidas caseiras oficiais, carne/frango em gramas. Não foram inventadas medidas. Avaliados profissional sem plano, criação, draft vazio, uma/três/seis refeições, um/vários alimentos, metas abaixo/próximas/acima; paciente sem plano, plano curto/completo, seis refeições, orientações curtas/longas/ausentes.

No navegador foram exercitados criação, inclusão canônica, busca, edição, cancelamento, salvamento, autosave, reordenação, publicação, histórico, nova versão e paciente read-only. Exclusão foi exercitada pela API local em item sintético e pela suíte de integração, não por clique destrutivo no navegador. O Diário registrou 2 ovos no paciente sintético; publicar o Plano não alterou esse lançamento.

### Validação funcional e preservação

- Frontend: **37 testes aprovados**, incluindo 20 específicos de view model/contratos do Plano; os testes estáticos não substituem a inspeção de navegador descrita acima.
- Backend: **243 aprovados, 22 ignorados** por condições de ambiente. Inclui execução habilitada de `meal-plans.api.test.ts` contra API/PostgreSQL locais: ciclo completo, autorização, separação do Diário, medidas, snapshot de publicação, histórico, concorrência e rollback de falha forçada. A linha de erro “forced publish failure” no log é esperada nesse teste.
- TypeScript frontend e backend: aprovados.
- Lint: aprovado.
- Build: aprovado.
- `git diff --check`: aprovado; Git apenas avisa da conversão normal LF→CRLF configurada no Windows.
- Backend, API, migrations 026/027, shared/meal-types.ts, MeasureInput, cálculos, catálogo e dependências: sem diff nesta rodada. Não foram reexecutadas migrations desnecessariamente.
- As cinco contas sintéticas e seus planos/lançamentos foram removidos por limpeza restrita ao identificador desta rodada. Artefatos locais anteriores foram preservados.

| Invariante | Resultado final |
| --- | --- |
| Alimentos TBCA | 5.874 |
| Medidas oficiais | 8.317 |
| Identidade de alimentos | `c736b4d473fdb20bd56fa90d5c6c92add5a3db24ef20f037f1b999de353521f6` |
| Nutrientes | `7c663b29885bff52dda27adf5d295126b67d68dbb79ea7965d011845ac0f55db` |
| Medidas, ordenadas por alimento/chave | `4170afa41ad01612ef894955b3fe3cc22c93a4ecb313f1abf5eaf900a85b86de` |
| Identidade das medidas | `ac4d927479ed3db909c4179af5adbe6a3c3ce82ede400c232b68817e5b1f159e` |
| Artefato oficial food-measures.reviewed.json | `2277486e9d63c8cb3544d5711b535bedb3e9bacd7c2c6829ba52bb972dfeaa08` |
| Histórico após limpeza | 37 lançamentos, 4.244 g; fingerprint `0a41cae916dbf37dc44aa2f6ffda83887bb2f3b848dda70c1e8aaf7d1d17a132` |

Identidade, nutrientes e medidas iguais antes/depois. O histórico final coincide com o baseline original registrado pelo projeto; durante a inspeção havia um lançamento adicional de 100g exclusivamente da fixture, removido na limpeza. Nenhum histórico real foi editado.

### Bundle, limites e conclusão

Comparação dos arquivos client locais antes/depois, sem gzip:

| Artefato | Antes | Depois | Diferença |
| --- | ---: | ---: | ---: |
| JavaScript total | 1.331.341 B | 1.335.877 B | +4.536 B / 0,34% |
| Chunk patient-app | 632.976 B | 637.512 B | +4.536 B / 0,72% |
| CSS total | 353.711 B | 361.296 B | +7.585 B / 2,14% |

Permanece o warning conhecido de chunk >500kB. O build também informa tempo significativo em plugins e classificação estática limitada da rota raiz pelo vinext; concluiu normalmente. Erros transitórios de HMR ocorreram enquanto o import do CSS já existia e o novo arquivo ainda estava sendo criado; não persistiram após sua criação.

As três superfícies pertencem à mesma família visual: cores e formas reconhecíveis, mas composições próprias para edição e consulta. A diferença antes/depois é estrutural, não apenas cosmética. A tela profissional estreita ainda precisa acomodar o cabeçalho do prontuário existente acima do Plano; ele ocupa espaço e não foi redesenhado por estar fora do escopo. Não há bloqueador funcional identificado. Validação em aparelhos físicos e a aceitação estética final pelo usuário continuam sendo limites desta entrega.

Arquivos desta rodada: meal-plan.tsx, novo meal-plan.css, remoção do bloco antigo em globals.css, meal-plan.test.ts e este relatório. Nada stageado. Nenhuma substituição, recomendação, equivalência, IA ou aderência foi implementada.

**REVOLUÇÃO VISUAL DO PLANO PRONTA PARA REVISÃO**
