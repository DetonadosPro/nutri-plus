# Atividades e balanço energético — Nutri+

Implementação local, 7 de setembro de 2026. Não altera dados TACO, valores de IG, metas alimentares ou credenciais existentes.

## Uso

- No Diário, use **Atividades do dia → Adicionar**. Escolha a modalidade, data, horário e minutos totais. Busca sem acentos, categorias, favoritos pessoais e recentes estão no mesmo formulário.
- Os 142 itens em português cobrem 15 categorias. É uma seleção abrangente do Compendium, não a tradução integral das suas 22 seções. Os subtipos mantêm códigos e METs distintos; não se estima um código ausente por semelhança.
- Musculação pode ser rápida ou detalhada: exercícios, séries, repetições, carga, segundos por série e descanso. A duração total inclui aquecimento e descansos. O tempo detalhado não pode exceder a sessão.
- **Informar gasto de outra fonte** exige nome, origem, kcal e tipo: calorias ativas/líquidas, totais/brutas ou desconhecido. Não informe o gasto de um dia inteiro como uma sessão.
- Clique no registro para consultar peso e data da pesagem, MET/código/versão, origem, bruto, líquido, detalhes e observações. Edições de cálculo exigem confirmação explícita; observações, esforço percebido e horário preservam o cálculo original. Duplicar abre um novo registro para escolher outra data ou horário.
- Na Evolução, selecione semana, últimos 30 dias ou intervalo personalizado de até 366 dias. Há gráficos de ingestão/gasto, balanço diário/acumulado, comparação das médias dos dias completos e tempo por modalidade. Clique na data da tabela para abrir as sessões e suas ações.
- O profissional consulta as mesmas entidades no prontuário, nas abas de visão geral, diário e evolução; não existe cópia dos exercícios para cada tela.

## Metodologia e decisões clínicas

`nutri-energy-1`:

1. Repouso estimado: Mifflin–St Jeor, com peso disponível até o dia analisado, altura, idade na data e constante sexual da equação. O módulo não calcula uma base se esses dados faltam, fora de 19–59 anos, ou se o profissional indicar necessidade de avaliação clínica. A estimativa não é medição de metabolismo basal em laboratório.
2. Base diária: repouso × fator. Os fatores convencionais usados como interpretação inicial do cadastro são sedentário 1,2; leve 1,375; moderado 1,55; ativo 1,725; muito ativo 1,9. São aproximações clínicas, não valores MET nem fatores do Compendium. Nível ausente/desconhecido não vira automaticamente sedentário.
3. **Padrão conservador: fator habitual já inclui exercícios.** Nenhuma sessão registrada é acrescentada à base. O cadastro anterior e as metas nutricionais são preservados.
4. Em **Evolução → Configurar cálculo**, o nutricionista pode escolher **base sem exercícios + líquido**, definir explicitamente o fator e documentar quais atividades a base já contempla. A configuração passa a valer hoje; não altera silenciosamente dias anteriores.
5. Nesse modo, só sessões marcadas pelo usuário como fora da base somam o líquido. Tarefas domésticas, deslocamentos e trabalho que já componham o fator habitual devem permanecer desmarcados. Não se deduz automaticamente pela categoria se uma atividade é adicional.
6. Bruto MET = MET × kg × minutos / 60. Líquido = (MET − 1) × kg × minutos / 60. O líquido pressupõe substituição de repouso; a diferença real pode ser outra quando o exercício substitui movimento cotidiano. Essa aproximação depende de seleção profissional adequada da base.
7. Calorias manuais ativas já são líquidas. Calorias manuais totais descontam kg × horas uma única vez, se houver peso de referência. Tipo desconhecido ou peso ausente na conversão bruta deixa o líquido indisponível. Se uma dessas sessões for adicional, o total também fica indisponível, sem omitir silenciosamente a sessão.
8. Gasto total = base + adicional elegível. Balanço = ingestão − gasto total. A interface mostra o valor absoluto e déficit/superávit estimado; diferenças menores que 0,5 kcal são apresentadas como neutras por arredondamento. Nenhum exercício altera a prescrição alimentar.

O fator e a indicação de gestação/condição clínica dependem do nutricionista. O sistema não infere gestação por sexo, idade, histórico ou observações. A opção de avaliação clínica suspende a estimativa de base atual e a equivalência; o módulo não gera metas de alteração de peso para nenhum paciente. Para idades fora do catálogo adulto, sessões podem ser registradas com gasto manual de outra fonte; não é extrapolado um MET adulto.

## Musculação e limites científicos

O catálogo conserva, entre outros, os códigos 02054 (vários exercícios, 8–15 repetições, 3,5 MET), 02050 (resistência vigorosa, 6 MET) e 02055 (superséries recíprocas em circuito, 5,8 MET). A escolha é explícita. Esforço percebido é um relato separado, não um comando para alterar automaticamente o MET.

A pesquisa encontrou protocolos experimentais com diferentes respostas ao descanso, mas não suporte suficiente para aplicar a qualquer paciente uma tabela universal de MET ativo versus MET de descanso entre séries. Portanto, a implementação usa a sessão completa e registra descansos como informação de treino. Não presume que descanso menor aumenta sempre o gasto, nem aplica bônus automático de EPOC. A limitação é particularmente relevante para esforços intermitentes e componentes anaeróbicos.

Referências consultadas:

- [2024 Adult Compendium of Physical Activities](https://pacompendium.com/adult-compendium/), referência principal; faixa adulta de 19–59 anos.
- [Conditioning Exercise — códigos de resistência e circuitos](https://pacompendium.com/conditioning-exercise/). Cada item do catálogo aponta também para sua própria página temática.
- [Ratamess et al. (2007), efeito dos intervalos sobre respostas metabólicas no supino](https://pubmed.ncbi.nlm.nih.gov/17237951/), DOI 10.1007/s00421-007-0394-y. Estudo de protocolo específico; não justifica uma regra universal por segundo de descanso.
- [Methods to Assess Energy Expenditure of Resistance Exercise (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11393209/), revisão de métodos e limitações de estimativa no treinamento resistido.
- [Pesquisa do NIDDK sobre modelos dinâmicos de peso — Hall et al.](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner). A resposta de peso ao balanço não é linear nem constante.

## Alimentação incompleta e equivalência

Sem alimentos e sem confirmação, ingestão é ausente, não zero. Um dia explicitamente confirmado como completo sem ingestão registrada pode representar zero informado. Se algum alimento não tiver energia, o balanço fica indisponível e o total conhecido é mantido separadamente no retorno da API. Inserir, editar ou excluir alimentos invalida a confirmação de completude.

O acumulado e as médias comparativas usam somente dias completos com balanço disponível. Lacunas ficam sem valor no gráfico; a cobertura de cada período é mostrada. O balanço diário pode ser parcial e recebe esse aviso. Ausência de sessão nunca é rotulada como ausência de movimento.

`acumulado / 7700` aparece apenas dentro de **equivalência energética teórica aproximada**. Não é previsão de massa corporal, meta, prescrição ou prazo. Água, glicogênio, composição da massa modificada e adaptação metabólica afetam o resultado real. A equivalência é ocultada quando os dados/faixa etária não são adequados ou há indicação clínica profissional.

## Persistência, permissões e atualização

- Migrations `008_physical_activities.sql`, `009_energy_food_completeness.sql` e `010_energy_base_revisions.sql`, transacionais no executor existente.
- Catálogo imutável por `(code, version)`; importação idempotente no início da API. Atualizações de dados exigem nova versão, sem sobrescrever a versão já usada.
- Sessões: paciente, autor, data local, hora e zona `America/Sao_Paulo`, duração, intensidade percebida, escopo adicional, JSON de cálculo e exercícios. Datas inválidas, futuras, horários sobrepostos e sessões que cruzam a meia-noite são recusados. Divida estas últimas em dois registros diários.
- Peso e MET históricos são snapshots. Alterações de peso/catálogo não recalculam sessões. Edição de parâmetros exige `recalculate=true`; a revisão anterior é preservada em `activity_revisions`. Concorrência usa revisão otimista e bloqueio do paciente para evitar sobreposição entre criações simultâneas.
- Dias anteriores ao atual guardam a base na primeira consolidação pelo módulo. Antes da instalação não havia histórico de altura/sexo/fator suficiente para reconstruir todos os dias: a primeira consolidação usa os dados disponíveis, explicitamente como estimativa. Depois de persistida, a base passada fica congelada, inclusive se estiver indisponível. Não há recálculo automático de bases históricas. O nutricionista pode abrir o dia e usar **Recalcular base deste dia**, informar o motivo e confirmar. A base anterior e a justificativa ficam em `energy_base_revisions`; as sessões permanecem intocadas. A base do dia corrente acompanha os dados atuais; as sessões continuam com seus próprios snapshots.
- Paciente acessa apenas seu diário. Nutricionista acessa seus pacientes e o próprio diário quando existente. Administradores são recusados. A mesma função de autorização é usada pelas rotas antigas e novas.
- Histórico usa seis consultas agrupadas por intervalo, sem consulta por sessão ou dia; a consolidação de snapshots é um único INSERT em lote. Agregados são calculados a partir das sessões existentes, portanto excluir não deixa totais órfãos.
- Mudanças atualizam componentes montados, notificam abas da mesma origem e revalidam ao voltar o foco. Em outra origem/dispositivo, os dados são buscados novamente ao abrir a tela/voltar o foco; não foi introduzido um serviço de sincronização em tempo real.
- Intervalos da Evolução são preferências da sessão do navegador. A navegação de voltar continua pertencendo ao componente principal, sem um segundo controlador sobrescrevendo seu histórico.

## Validação e reprodução

- `npm test`: testes unitários existentes e novos.
- No PowerShell, `$env:NUTRI_RUN_ACTIVITY_TESTS='true'; $env:NUTRI_RUN_DB_SECURITY_TESTS='true'; npm test`: também executa integração em schemas temporários e isolados do PostgreSQL local, removidos no final.
- `npx tsc --noEmit -p backend/tsconfig.json` e `npx tsc --noEmit -p frontend/tsconfig.json`.
- `npm run lint` e `npm run build`.
- Teste de navegador: com frontend/backend locais ativos, definir `NUTRI_RUN_ACTIVITY_UI=true`, `NUTRI_PLAYWRIGHT_PATH` para o pacote Playwright instalado e, se necessário, `NUTRI_TEST_ORIGIN`; executar `npx tsx scripts/activities-ui.test.ts`. Exige Chrome e origem local. Cria usuários/paciente de teste exclusivos, usa sessões reais, exercita a interface e remove apenas essas entidades no `finally`. Capturas ficam em `outputs/activities/`.

Não há implantação remota incluída nesta entrega.

### Resultado da validação local

56 testes passaram, sem testes pulados, com as duas integrações PostgreSQL habilitadas. Lint, verificação TypeScript de frontend/backend e build concluídos. O build mantém avisos não bloqueantes do Vinext sobre tamanho de alguns pacotes e classificação estática da rota.

O teste de navegador passou com sessões reais de contas temporárias: busca, favoritos, registro rápido, edição com recálculo, duplicação, musculação detalhada, visualização/exclusão pelo profissional e recálculo auditado de base histórica. Layout sem transbordamento horizontal em 360, 390, 768, 1440 e 2560 px. Contas temporárias removidas ao final.

Banco verificado: PostgreSQL local `nutri_dev`, 142 itens do catálogo, migrations 008–010 aplicadas, 597 alimentos TACO e 233 valores de IG presentes.
