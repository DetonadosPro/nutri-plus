# Plano Alimentar — implementação de 13/09/2026

## Arquitetura

O Plano Alimentar foi implementado como um agregado próprio e normalizado, independente de `daily_logs`, `meals` e `meal_entries`. A raiz `meal_plans` representa uma versão da prescrição; `meal_plan_meals` mantém refeições customizáveis e ordenadas; `meal_plan_items` liga cada prescrição ao alimento TBCA e à quantidade convertida. Nada prescrito é gravado automaticamente no Diário.

O desenho mantém chaves estáveis para uma futura comparação Plano × Diário e permite acrescentar alternativas/grupos de substituição por item sem serializar refeições em JSON.

## Migration e tabelas

A migration `026_meal_plans.sql` cria:

- `meal_plans`: paciente, autor, versão, estado, título, orientações, plano de origem, controle otimista e datas de publicação/arquivamento;
- `meal_plan_meals`: nome, posição, horário e observação;
- `meal_plan_items`: alimento, posição, quantidade, unidade, gramas equivalentes, snapshots da medida e dos nutrientes publicados, e observação.

Constraints garantem estados coerentes, versões positivas e únicas por paciente, quantidades válidas, posições válidas e textos limitados. O índice parcial `meal_plans_one_active_per_patient` impede mais de um plano ativo por paciente. As posições são únicas e deferrable para permitir reordenação transacional. Índices cobrem paciente/estado/versão, autor, plano/refeição/posição e alimento.

A migration foi validada tanto no fluxo completo de banco limpo quanto sobre um schema parado na migration 023, preservando os registros anteriores e registrando 024, 025 e 026 normalmente.

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

O paciente ganhou a área `Plano` read-only e um atalho mobile no Diário. A visualização mostra data, orientações, refeições, horários, alimentos, porções e kcal discretas, sem IDs ou dados técnicos. O Diário continua inalterado.

O layout é limitado a 70rem no desktop, possui cards arredondados e converte grids em uma coluna no mobile. Totais viram uma faixa horizontal rolável, controles têm área mínima de toque e estados de foco/alerta acessíveis.

## Atualização e consistência

Cada mutation retorna o agregado recalculado. Inclusão, edição, reordenação e publicação substituem o estado em memória sem reload. Exclusões são seguidas por uma leitura única do plano para atualizar simultaneamente itens e totais. `lock_version` protege edição concorrente dos metadados do draft.

## Performance

O endpoint completo usa seis queries previsíveis, independentemente do número de itens: plano, refeições, itens+alimentos+nutrientes, medidas em lote, meta e peso. Não há uma consulta por alimento. O smoke de 6 refeições/24 itens confirmou `queryCount=6` e ficou abaixo do teto local de 2 segundos.

## Testes

O teste integrado cobre criação de draft, refeições customizadas, omelete por contagem, leite em mL, arroz/feijão em medida caseira, quantidade em gramas, edição, observação, exclusão, ordenação, nutrientes, metas, primeira publicação, leitura pelo paciente, imutabilidade, duplicação, nova versão, arquivamento, histórico, único ativo, clique duplo concorrente, rollback forçado, IDs inválidos, medida inválida, autorização cruzada, isolamento do Diário e cenário 6×24.

Os testes frontend cobrem prioridade do draft, reordenação sem perda/duplicação, progresso de metas, estados vazios, criação, busca, medidas, mutation sem reload, remoção, resumo, publicação, histórico, leitura do paciente, erro acessível e estrutura responsiva.

O smoke visual foi executado no aplicativo real, em desktop e viewport móvel de 375 × 812 px, com dados sintéticos descartáveis. Foram conferidos editor profissional, renomeação de refeição, medidas caseiras, contagem, mL, metas, versão read-only e navegação do paciente. A validação encontrou e corrigiu o tratamento da data de publicação na visão do paciente; a tela foi retestada após a correção.

## Extensões futuras deliberadamente adiadas

Substituições poderão ser modeladas por tabelas associadas a `meal_plan_items`, com grupos, alternativas e equivalências, sem mudar o agregado atual. Aderência poderá relacionar itens prescritos aos registros reais de `meal_entries`, mantendo as duas fontes separadas. IA, foto, notificações, lista de compras, PDF e compartilhamento não fazem parte desta versão.

## Riscos restantes

- A ordenação usa botões acessíveis em vez de drag-and-drop para evitar dependência pesada.
- A primeira versão não relaciona semanticamente refeições do plano a tipos fixos do Diário; essa associação deve ser desenhada junto da futura aderência.

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
