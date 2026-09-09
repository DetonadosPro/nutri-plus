# Atividades e balanço energético — Nutri+

## Experiência simplificada — 8 de setembro de 2026

Reformulação local do frontend. Preserva alimentos, metas, autenticação e registros anteriores.

- Home/Diário: calorias ingeridas e saldo com sinal no mesmo card. Rótulos “Déficit estimado”, “Superávit estimado” ou “Neutro estimado”. O saldo e a Evolução são atualizados automaticamente quando alimentos ou exercícios mudam; não existe confirmação manual de encerramento do dia.
- Atividades ficam próximas do resumo do dia. Uma linha por sessão, com nome, duração e gasto aproximado. Abrir a linha permite editar ou excluir; o menu também permite duplicar.
- Registro: escolher uma categoria visual, informar duração/intensidade, salvar. Data fica em “Mais opções”; horário, observações e campos científicos não aparecem no fluxo do paciente.
- Recentes reutilizam modalidade, duração, intensidade e descanso, mas calculam a nova sessão com o peso disponível na data nova. Favoritos ficam disponíveis sem ocupar o fluxo principal.
- Yoga/Pilates, Dança, Esportes e Outras atividades abrem modalidades específicas. Busca sem acentos acessa todos os 142 registros de 15 categorias do catálogo existente.
- Musculação: tempo total, intensidade e descanso opcional por faixa. Séries antigas são mantidas ao editar a mesma modalidade e continuam consultáveis nos detalhes; cadastrar séries não é requisito.
- Evolução: 7 dias, 30 dias ou personalizado (até 366 dias). Um único gráfico de saldo dos dias com alimentação registrada e sua média. Dias sem alimentação são lacunas, não zeros. Lista de dias, atividades e médias de ingestão/gasto são expansíveis. Outros indicadores nutricionais também ficam em uma seção expansível.
- O nutricionista consulta e altera as mesmas sessões. Configuração da metodologia e recálculo histórico continuam restritos ao profissional. Administrador não acessa informações clínicas.

## Catálogo, intensidade e descanso

As escolhas rápidas em `activity-choices.tsx` apontam para códigos reais da versão `2024-pt-BR.1`. Não há multiplicação arbitrária por intensidade. Para caminhada/corrida, os botões indicam as faixas de velocidade; ciclismo, natação e futebol apontam para modalidades operacionais correspondentes. O usuário pode escolher outro subtipo em “Mais opções”.

O atalho de musculação genérica para adultos usa quatro níveis: 3,0 MET para leve, 3,5 MET para moderado, 4,0 MET para alto e 5,0 MET para intenso. Os níveis de 4,0 e 5,0 MET são uma metodologia interna conservadora, não entradas oficiais específicas do Compendium. A referência de 6,0 MET da musculação vigorosa (código 02050) permanece no catálogo, mas não é associada automaticamente ao esforço subjetivo “intenso”. O gasto base da sessão é ajustado secundariamente pela densidade indicada pelo descanso: 30 s = 1,05; 60 s = 1,033; 90 s = 1,017; 120 s = 1,00; 180 s = 0,983; 240 s = 0,967; 300 s ou mais = 0,95, com interpolação linear e limites fixos. Esta faixa conservadora de ±5% é uma heurística de modelagem do Nutri+, não um valor oficial do Compendium, e não acrescenta EPOC. Modalidades específicas do catálogo, incluindo circuitos, superséries e levantamento terra, preservam seu MET oficial e não recebem novamente ajustes de intensidade ou descanso.

Novos cálculos do atalho são identificados como `strength-effort-3`. Snapshots anteriores preservam sua versão e suas kcal originais.

Quando uma modalidade específica é escolhida pela busca, a intensidade é um relato subjetivo, sem alterar o MET daquela modalidade. Para modificar a estimativa, troca-se a modalidade. A explicação permanece disponível nos detalhes.

Referências principais reconsultadas:
- [Compendium 2024 — condicionamento e resistência](https://pacompendium.com/conditioning-exercise/)
- [Caminhada](https://pacompendium.com/walking/)
- [Corrida](https://pacompendium.com/running/)

Cada registro do catálogo mantém sua própria fonte oficial. Códigos e METs são comparados ao arquivo de referência versionado pelos testes existentes.

## Estratégia energética preservada

`nutri-energy-1`:

1. Repouso estimado por Mifflin–St Jeor. O nutricionista define nas metas o fator cotidiano que multiplica a basal, com padrão 1,00, para representar a rotina fora dos exercícios registrados.
2. O efeito térmico dos alimentos (TEF) é estimado pelos macronutrientes registrados usando o ponto central dos intervalos de referência: proteína 25%, carboidrato 7,5% e gordura 1,5% de suas respectivas energias. O TEF é somado uma única vez ao gasto.
3. Dados ausentes, faixa etária sem fórmula aplicável ou avaliação clínica suspensa deixam a base indisponível.
4. O padrão interno permanece denominado `base_plus_net` por compatibilidade com os registros existentes, mas exercícios elegíveis acrescentam o gasto bruto completo solicitado pelo produto.
5. O nutricionista pode ajustar esse fator nas metas ou usar `habitual_includes_exercise` quando a base prescrita já incorporar exercícios. Nesse modo, as sessões permanecem no histórico, mas não são somadas novamente.
6. No fluxo do paciente, exercícios escolhidos são classificados automaticamente como extras à rotina; atividades domésticas, jardinagem, trabalho, transporte e música não são. Essa classificação não modifica a configuração profissional e não causa acréscimo no modo habitual. Registros existentes e recentes mantêm o escopo armazenado.
7. O gasto contabilizado = MET × kg × horas. O gasto líquido continua preservado no snapshot histórico para auditoria, mas não é deduzido do saldo.
8. TDEE estimado = rotina diária estimada + TEF + adicional elegível; saldo = ingestão − TDEE estimado. TDEE é o resultado total, não uma parcela adicional. Os valores exibidos são arredondados, preservando a precisão nos dados.
9. Entrada manual permanece em Outras atividades e exige origem/tipo do gasto. Calorias ativas já são líquidas. Totais descontam repouso uma vez. Tipo desconhecido não vira adicional zero.
10. Não se geram metas de déficit nem projeções de peso. A API legada mantém `theoreticalKg` sob suas restrições etárias/clínicas, mas essa equivalência não é exibida no frontend novo.

## Persistência e compatibilidade

Migrations 008–010 permanecem intactas. A migration transacional `011_simple_activity_entry.sql`:
- permite `local_time=NULL`, para sessões sem hora informada;
- adiciona `rest_period` opcional, com validação das cinco faixas.

A migration `018_strength_rest_seconds.sql` preserva as faixas antigas e adiciona o intervalo exato em segundos. O snapshot `strength-density-1` guarda gasto base, fator aplicado e gasto final, portanto futuras mudanças não alteram registros históricos silenciosamente.

Sem horário, não se inventa uma hora para satisfazer a API. Sobreposição é validada entre sessões com horários conhecidos; somas de duração acima de 1.440 minutos são recusadas em todos os casos. Não é possível inferir sobreposição temporal de sessões sem horário.

`GET /activities/recent` retorna até oito modalidades recentes do paciente autorizado, com os parâmetros da última sessão. Não busca registros de outros pacientes.

Peso, MET, versão e fonte continuam no snapshot. Editar duração/modalidade pelo frontend envia `recalculate=true,preserveWeight=true`: usa o peso original se a data não mudar. Trocar a data usa o peso disponível naquela data. Registros anteriores ficam em `activity_revisions`, com controle de revisão concorrente. O comportamento legado de recálculo explícito sem `preserveWeight` permanece compatível.

A base histórica permanece congelada na primeira consolidação. O recálculo profissional exige motivo e preserva a versão anterior em `energy_base_revisions`. A base de hoje acompanha os dados atuais do perfil.

Sem alimentos, ingestão é ausente, não zero. Alimento sem energia torna o saldo indisponível. Inserir, alterar ou excluir alimentos atualiza automaticamente o saldo. Médias e acumulados usam dias que possuem alimentação com energia disponível.

Mudanças de atividade e alimento notificam componentes montados e outras abas na mesma origem; os dados são revalidados no foco. Não há promessa de sincronização por push entre dispositivos.

## Verificação

- Unitários e integração real com PostgreSQL em schemas isolados: `NUTRI_RUN_ACTIVITY_TESTS=true` e `NUTRI_RUN_DB_SECURITY_TESTS=true`, depois `npm test`.
- TypeScript de frontend e backend; `npm run lint`; `npm run build`.
- `scripts/activities-ui.test.ts`: contas temporárias, navegação real, escolha rápida, edição preservando peso, recentes, musculação/descanso, alimentos e saldo sem recarregar, confirmação do dia, Evolução e acesso profissional.
- Origem de teste obrigatoriamente local; fixtures removidas no `finally`. Capturas em `outputs/activities-simple/`.

Resultado em 08/09/2026: 59 testes aprovados, sem testes pulados, incluindo as duas integrações PostgreSQL. Lint, TypeScript de frontend/backend e build aprovados. Fluxo mobile com alimentos e exercícios reais de contas temporárias passou; Evolução sem overflow em 360, 390, 768, 1440 e 2560 px. Build conserva avisos não bloqueantes de tamanho de pacote e classificação estática do Vinext. Esta reformulação ainda não foi publicada em produção.
