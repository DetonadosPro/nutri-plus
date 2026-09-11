# Quantidades e medidas de alimentos

Implementação local em 10/09/2026. Não publicada em produção.

## Auditoria e arquitetura

Os arquivos `backend/data/tbca/tbca_completa_normalizada_v2.json` e `backend/data/tbca/tbca completa normalizada.json` contêm 5.874 alimentos cada, nutrientes por 100 g e metadados de normalização. Nenhum deles contém campos de medidas caseiras, pesos de porção ou densidades. A versão com nomes amigáveis é a fonte já utilizada pelo importador atual; ambas foram preservadas. Não existe conversão de medida a recuperar nesses arquivos. Descrições de alimentos e unidades de nutrientes não são evidência de peso de porção.

Banco verificado: PostgreSQL local `127.0.0.1`, `nutri_dev`; 5.874 TBCA ativos, 597 TACO inativos preservados. Todos os alimentos ativos possuem base nutricional de 100 g. Antes e depois da validação: 37 registros alimentares, soma de 4.244 g. Nenhum nutriente foi alterado por esta feature.

`food_measures` pertence ao alimento. Campos: id, food_id, key estável de importação, kind (volume/count/household/mass), name, plural, quantity, grams, source, reference e is_default. O pipeline revisado não cadastra massa redundante: g é um fallback virtual de id 0. Medidas particulares são descrições livres, com singular/plural explícitos. Índices impedem chaves duplicadas, descrições indistinguíveis e múltiplos defaults por alimento.

O diário reutiliza `amount`, `unit`, `grams_equivalent`. O novo JSONB `measure_snapshot` armazena a definição efetivamente utilizada, incluindo fonte e relação de conversão. Não referencia uma definição mutável para recalcular o passado. Alterar ou remover uma medida do catálogo não modifica registros existentes; edição e cópia preservam o snapshot. Registros antigos em g permanecem sem snapshot.

Migrations aditivas: `019_food_measures.sql` e `020_food_measures_unique_labels.sql`. Aplicadas localmente. A primeira também amplia a restrição de texto da unidade; não reescreve registros antigos.

## Conversão e precisão

`gramas = quantidade informada × (gramas da medida / quantidade de referência)`.

O backend valida a medida do alimento, calcula a massa e aplica o limite existente de 5.000 g após a conversão. A UI não envia um peso confiável por conta própria. O cálculo nutricional existente continua sendo `scaleNutrients(basePor100g, gramas)`, preservando valores indisponíveis e a agregação vigente.

Relações no catálogo usam NUMERIC; o cálculo em JavaScript e os campos históricos mantêm a precisão double já usada pelo projeto. Não há arredondamento intermediário. Somente a exibição é arredondada. Frações e vírgula decimal são aceitas. Trocar medida preserva a massa correspondente. Valores não finitos, nulos, negativos, zero e acima do limite são rejeitados.

Volume exige relação documentada entre mL e g. O importador exige rótulo mL para kind=volume. Copos e xícaras são `household`, com peso próprio documentado. Os registros em mL desta versão usam a **equivalência de cálculo utilizada pela TBCA**, reconstruída por consenso entre as colunas de nutrientes da própria TBCA e registrada no catálogo revisado. Essa relação não representa densidade física medida experimentalmente e não autoriza aplicar uma regra genérica de 1 g/mL a outros alimentos. Não se deduz conversão pelo nome do alimento nem se utiliza IA nas conversões.

## Importação reproduzível

`backend/data/food-measures.reviewed.json` é o arquivo persistente de medidas revisadas. A versão final recebida em 10/09/2026 foi validada com 8.316 medidas TBCA para 4.878 códigos distintos: 6.087 `household`, 1.784 `count` e 445 `volume`. Todos os registros têm `source=TBCA`, `reviewed=true` e `isDefault=false`. Não inserir os valores sintéticos usados nos testes.

Cada registro deve conter: foodSource (TBCA/TACO), foodCode, key, kind (volume/count/household), name, plural, quantity, grams, source (TBCA/TACO/density/internal/manual), reference, isDefault e reviewed=true. Valores são números JSON, com ponto decimal. A referência deve identificar o documento, registro e/ou página que sustenta a conversão para o alimento específico. `reviewed=true` é uma declaração do responsável pela curadoria, não uma verificação automática da fonte.

`npm run measures:check` faz a validação completa sem alterar o banco: schema estrito, duplicidades de key e nome por alimento, defaults conflitantes e correspondência dos códigos externos. `npm run measures:import` repete essa validação e aplica upserts em lotes, dentro de uma transação, pela identidade do alimento e key. Reexecuções preservam IDs. Arquivo vazio não apaga medidas existentes. Medidas removidas do arquivo não são automaticamente removidas do banco. Não há inferência de pesos nem substituição de medidas manuais por defaults heurísticos.

`npm run tbca:import` inclui a importação do arquivo revisado dentro da transação existente. Setup/seed foram inspecionados: não reimportam o catálogo alimentar nem sobrescrevem essas medidas. O importador TACO conserva o comportamento legado e não recebe novas conversões inventadas.

## API, frontend e performance

`GET /api/foods` retorna medidas apenas dos resultados limitados da busca, com uma consulta agrupada adicional. Nomes normalizados, aliases, ranking e limites de busca continuam iguais. `GET /api/foods/:foodId/measures` atende edição e seleção por foto. Trocar unidade não faz requisição. Não existe carregamento global de medidas na inicialização.

`POST /api/meals` aceita items com foodId, quantity e measureId, ou o contrato anterior com grams. `PATCH /api/meal-entries/:entryId` aceita quantity/measureId ou grams; mudar somente a refeição conserva a quantidade original. Campos conflitantes são rejeitados. O backend nunca aceita um snapshot fornecido pelo cliente.

Registro manual, edição e confirmação por foto reutilizam `MeasureInput`: um número e um seletor, com equivalência discreta em gramas para contagem, medidas caseiras e mL. Default vem do banco; sem default retorna g. Diário do paciente e visão compartilhada com nutricionista mostram a forma original com pluralização. Não há classificação por nomes no frontend.

Verificação visual no navegador: desktop 1440×900 e celular 390×844. Com o alimento real `BRC0027G` (Leite búfala integral), o seletor ofereceu `mL`, `copos americanos pequenos` e `g`; `200 mL` exibiu `≈ 200 g` e recalculou energia e macronutrientes. A entrada decimal `125,5 mL` exibiu `≈ 125,5 g`. Depois de salvar, o diário mostrou `125,5 mL`; a edição reabriu com quantidade `125,5`, unidade `mL` e equivalência `≈ 125,5 g`. O registro temporário foi removido ao fim da verificação. Campo, seletor e rolagem do modal permaneceram utilizáveis nos dois tamanhos. Diário do paciente e visão do nutricionista compartilham `formatServing`, coberto também para `200 mL` e `125,5 mL`. A revisão por foto usa o mesmo `MeasureInput`; não foi feita nova chamada de reconhecimento por imagem nesta validação.

## Cobertura real e limitações

`npm run measures:audit` emite cobertura, origem e impressões digitais das medidas e do histórico. Resultado local após duas importações: 5.874 alimentos TBCA ativos; 4.878 com medida adicional; 996 somente g; 3.407 com `household`; 1.784 com `count`; 445 com `volume`; 8.316 medidas, todas de origem TBCA. A impressão digital completa permaneceu `7d7dd61b1b51a5352299d739c1dde9bed8d080beca2d64556a184cd3d5742f59` na segunda execução.

Extensão aprovada em 11/09/2026: a omelete simples `BRC0065J` acrescenta uma medida revisada de contagem, `1 ovo = 50 g`, referenciada na medida oficial do ovo `BRC0010J`. O estado atual passa a 8.317 medidas para 4.879 códigos, sendo 1.785 de contagem; as 8.316 medidas anteriores permanecem inalteradas.

As 7.138 medidas da versão anterior permaneceram com os mesmos IDs e conteúdo: o subconjunto até o ID 7.146 conservou 7.138 linhas e a impressão de identidade `8f2d58c97d355623d0eae5129d3ac570bc8b99e780d3e3855114f2c12e605b9c`. A nova versão acrescentou 1.178 medidas. O histórico também permaneceu idêntico: 37 registros, soma de 4.244 g e impressão `0a41cae916dbf37dc44aa2f6ffda83887bb2f3b848dda70c1e8aaf7d1d17a132`.

Os 996 alimentos restantes continuam com o fallback seguro em g. O catálogo não define `isDefault=true`; por isso g permanece selecionado inicialmente e o usuário escolhe uma das medidas TBCA disponíveis. Nenhum default foi inferido. Os rótulos foram preservados exatamente como entregues, inclusive `peça / unidade / fatia média`. Em `BRC0243C`, a medida genérica em mL foi mantida e as medidas caseiras pequenas conflitantes permaneceram excluídas conforme a revisão recebida. Nenhum nutriente foi alterado.

## Validação

- `npm run measures:check`: 8.316 registros válidos; 4.878 códigos encontrados; 0 ausentes; 0 keys duplicadas; 0 nomes duplicados; 0 defaults conflitantes; 0 pesos ou quantidades inválidos; 0 kinds inválidos; 0 referências ausentes; 0 registros sem revisão; 0 defaults. A comparação prévia confirmou 7.138 medidas inalteradas, 1.178 novas e nenhuma medida anterior ausente.
- `npm test` com `NUTRI_RUN_MEASURE_TESTS=true` e `NUTRI_MEASURE_TEST_API=http://127.0.0.1:3011/api`: 95 aprovados; 17 testes existentes de outras integrações permaneceram condicionados às próprias flags. Nenhum teste de medidas foi desabilitado.
- `npx tsc --noEmit -p backend/tsconfig.json` e `npx tsc --noEmit -p frontend/tsconfig.json`: aprovados.
- `npm run lint`: aprovado.
- `npm run build`: aprovado; aviso de bundle acima de 500 kB e classificação estática de rota do Vinext.
- `npm run measures:import`: aprovado duas vezes, 8.316 medidas processadas e 4.878 alimentos correspondentes em cada execução; 0 códigos ausentes.
- `npm run measures:audit`: cobertura acima.
- `git diff --check`: aprovado.

Testes novos: `backend/food-measures.test.ts` (aritmética, fallback, frações, mL, limites, plural, nutrientes), `backend/food-measures-catalog.test.ts` (estrutura e totais do catálogo final, incluindo 445 volumes), `backend/food-measures.integration.test.ts` (PostgreSQL, importação repetível, rejeições, snapshot e rollback), `backend/food-measures.api.test.ts` (listagem e busca com mL real de `BRC0027G`, criação com 100 mL, edição decimal para 125,5 mL, troca entre copo e mL, cópia, limites, contrato legado e exclusão via HTTP). Fixtures numéricas são sintéticas e identificadas como teste. O teste transacional faz rollback; o teste HTTP remove somente as entidades temporárias que criou.

Para o teste HTTP, iniciar o backend local com NUTRI_API_PORT=3011. Essa porta foi usada porque 3001 estava ocupada por outro aplicativo. `NUTRI_DEV_API_URL` permite apontar o proxy do frontend para essa API sem alterar o padrão 3001.

Arquivos centrais: `shared/food-measures.ts`, `backend/food-measures.ts`, `backend/measure-import.ts`, `backend/measure-audit.ts`, `backend/index.ts`, `backend/tbca-import.ts`, migrations 019/020, `frontend/app/components/measure-input.tsx`, `food-entry-sheet.tsx`, `edit-entry-dialog.tsx`, `food-photo-review.tsx`, `patient-meal-list.tsx`, `daily-journal.tsx`, tipos e CSS.
