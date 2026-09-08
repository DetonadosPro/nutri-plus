# Atividades e balanço energético — Nutri+

## Experiência simplificada — 8 de setembro de 2026

Reformulação local do frontend. Preserva alimentos, metas, autenticação e registros anteriores.

- Home/Diário: calorias ingeridas e saldo com sinal no mesmo card. Rótulos “Déficit estimado”, “Superávit estimado” ou “Neutro estimado”. Um toque abre a explicação e permite confirmar que toda a alimentação foi registrada. Enquanto incompleto, o resumo diz “Parcial até agora”: compara o consumo registrado ao gasto do dia inteiro, não a uma medição instantânea.
- Atividades ficam próximas do resumo do dia. Uma linha por sessão, com nome, duração e gasto aproximado. Abrir a linha permite editar ou excluir; o menu também permite duplicar.
- Registro: escolher uma categoria visual, informar duração/intensidade, salvar. Sem horário obrigatório nem campos científicos na tela principal. Horário, data e observações ficam em “Mais opções”.
- Recentes reutilizam modalidade, duração, intensidade e descanso, mas calculam a nova sessão com o peso disponível na data nova. Favoritos ficam disponíveis sem ocupar o fluxo principal.
- Yoga/Pilates, Dança, Esportes e Outras atividades abrem modalidades específicas. Busca sem acentos acessa todos os 142 registros de 15 categorias do catálogo existente.
- Musculação: tempo total, intensidade e descanso opcional por faixa. Séries antigas são mantidas ao editar a mesma modalidade e continuam consultáveis nos detalhes; cadastrar séries não é requisito.
- Evolução: 7 dias, 30 dias ou personalizado (até 366 dias). Um único gráfico de saldo dos dias completos e sua média. Dias incompletos são lacunas, não zeros. Lista de dias, atividades e médias de ingestão/gasto são expansíveis. Outros indicadores nutricionais também ficam em uma seção expansível.
- O nutricionista consulta e altera as mesmas sessões. Configuração da metodologia e recálculo histórico continuam restritos ao profissional. Administrador não acessa informações clínicas.

## Catálogo, intensidade e descanso

As escolhas rápidas em `activity-choices.tsx` apontam para códigos reais da versão `2024-pt-BR.1`. Não há multiplicação arbitrária por intensidade. Para caminhada/corrida, os botões indicam as faixas de velocidade; ciclismo, natação e futebol apontam para modalidades operacionais correspondentes. O usuário pode escolher outro subtipo em “Mais opções”.

Musculação leve e moderada usam a referência geral 02054 (3,5 MET); intensa usa 02050 (6 MET). A referência geral não permite inventar um valor menor exclusivo para “leve”. Isso é explicado em “Como calculamos isso?”. Descanso é somente descritivo: o MET representa a sessão inteira, incluindo pausas. Não existe bônus por intervalos curtos ou EPOC.

Quando uma modalidade específica é escolhida pela busca, a intensidade é um relato subjetivo, sem alterar o MET daquela modalidade. Para modificar a estimativa, troca-se a modalidade. A explicação permanece disponível nos detalhes.

Referências principais reconsultadas:
- [Compendium 2024 — condicionamento e resistência](https://pacompendium.com/conditioning-exercise/)
- [Caminhada](https://pacompendium.com/walking/)
- [Corrida](https://pacompendium.com/running/)

Cada registro do catálogo mantém sua própria fonte oficial. Códigos e METs são comparados ao arquivo de referência versionado pelos testes existentes.

## Estratégia energética preservada

`nutri-energy-1`:

1. Repouso estimado por Mifflin–St Jeor. Base = repouso × fator. Os fatores habituais existentes são preservados. Dados ausentes, faixa etária fora de 19–59 anos ou avaliação clínica suspensa deixam a base indisponível.
2. Padrão conservador: `habitual_includes_exercise`. O fator já inclui exercícios e nenhuma sessão aumenta o gasto total. A meta alimentar é independente desse cálculo.
3. O nutricionista pode configurar `base_plus_net`, documentando uma base sem os exercícios que serão registrados. Só sessões elegíveis (`outside_base`) acrescentam gasto líquido.
4. No fluxo novo, exercícios escolhidos têm “Exercício extra à minha rotina cotidiana” selecionado; atividades domésticas, jardinagem, trabalho, transporte e música começam desmarcadas. O controle está em “Mais opções” e pode ser corrigido. Essa sugestão não modifica a configuração profissional e não causa acréscimo no modo habitual. Registros existentes e recentes mantêm o escopo armazenado.
5. Bruto = MET × kg × horas. Líquido = (MET − 1) × kg × horas. O líquido pressupõe substituição de repouso; sua inclusão depende da definição profissional de base.
6. Gasto total = base + adicional elegível; saldo = ingestão − gasto total. Os valores exibidos são arredondados, preservando a precisão nos dados.
7. Entrada manual permanece em Outras atividades e exige origem/tipo do gasto. Calorias ativas já são líquidas. Totais descontam repouso uma vez. Tipo desconhecido não vira adicional zero.
8. Não se geram metas de déficit nem projeções de peso. A API legada mantém `theoreticalKg` sob suas restrições etárias/clínicas, mas essa equivalência não é exibida no frontend novo.

## Persistência e compatibilidade

Migrations 008–010 permanecem intactas. A migration transacional `011_simple_activity_entry.sql`:
- permite `local_time=NULL`, para sessões sem hora informada;
- adiciona `rest_period` opcional, com validação das cinco faixas.

Sem horário, não se inventa uma hora para satisfazer a API. Sobreposição é validada entre sessões com horários conhecidos; somas de duração acima de 1.440 minutos são recusadas em todos os casos. Não é possível inferir sobreposição temporal de sessões sem horário.

`GET /activities/recent` retorna até oito modalidades recentes do paciente autorizado, com os parâmetros da última sessão. Não busca registros de outros pacientes.

Peso, MET, versão e fonte continuam no snapshot. Editar duração/modalidade pelo frontend envia `recalculate=true,preserveWeight=true`: usa o peso original se a data não mudar. Trocar a data usa o peso disponível naquela data. Registros anteriores ficam em `activity_revisions`, com controle de revisão concorrente. O comportamento legado de recálculo explícito sem `preserveWeight` permanece compatível.

A base histórica permanece congelada na primeira consolidação. O recálculo profissional exige motivo e preserva a versão anterior em `energy_base_revisions`. A base de hoje acompanha os dados atuais do perfil.

Sem alimentos e sem confirmação, ingestão é ausente, não zero. Alimento sem energia torna o saldo indisponível. Inserir, alterar ou excluir alimentos invalida a conclusão do dia. Médias e acumulados usam somente dias completos.

Mudanças de atividade e alimento notificam componentes montados e outras abas na mesma origem; os dados são revalidados no foco. Não há promessa de sincronização por push entre dispositivos.

## Verificação

- Unitários e integração real com PostgreSQL em schemas isolados: `NUTRI_RUN_ACTIVITY_TESTS=true` e `NUTRI_RUN_DB_SECURITY_TESTS=true`, depois `npm test`.
- TypeScript de frontend e backend; `npm run lint`; `npm run build`.
- `scripts/activities-ui.test.ts`: contas temporárias, navegação real, escolha rápida, edição preservando peso, recentes, musculação/descanso, alimentos e saldo sem recarregar, confirmação do dia, Evolução e acesso profissional.
- Origem de teste obrigatoriamente local; fixtures removidas no `finally`. Capturas em `outputs/activities-simple/`.

Resultado em 08/09/2026: 59 testes aprovados, sem testes pulados, incluindo as duas integrações PostgreSQL. Lint, TypeScript de frontend/backend e build aprovados. Fluxo mobile com alimentos e exercícios reais de contas temporárias passou; Evolução sem overflow em 360, 390, 768, 1440 e 2560 px. Build conserva avisos não bloqueantes de tamanho de pacote e classificação estática do Vinext. Esta reformulação ainda não foi publicada em produção.
