# Nutri+ — todas as alterações de 8 de setembro de 2026

Este documento consolida o trabalho realizado no Nutri+ em 08/09/2026. Ele descreve o estado final do código e da produção, incluindo decisões que substituíram abordagens intermediárias.

## Estado atual da produção

- Aplicação publicada em `https://nutriplusapp.store`.
- Commit atualmente publicado: `a35c42b`.
- Processos `nutriplus-backend`, `nutriplus-frontend` e `nutriplus-food-vision` online no PM2.
- Health check público validado: `ok=true`, `source=TBCA`, `foods=5874`, `version=a35c42b`.
- Banco de produção: PostgreSQL local na instância AWS Lightsail, em `127.0.0.1:5432`, banco `nutri_dev`. Não está usando RDS e não está usando o servidor PostgreSQL do computador pessoal.
- Segredos de produção continuam fora do Git. A aplicação usa AWS Secrets Manager e arquivos privados com permissões restritas para chaves específicas.

## 1. Atividades físicas e balanço energético

Foi feita uma reformulação completa da experiência de atividades físicas, priorizando poucos cliques e uso mobile.

### Interface de registro

- Criada uma seleção visual de atividades com botões grandes, coloridos e fáceis de tocar.
- Fluxo principal reduzido a: escolher atividade, informar duração/intensidade e salvar.
- Inclusão de atividades recentes para repetição rápida.
- Musculação registra duração, intensidade e descanso médio sem exigir séries, repetições ou cargas.
- Horário inicial, observações e o texto “Como calculamos isso?” foram removidos do fluxo principal.
- A opção de trocar a modalidade ficou sutil e abaixo da intensidade.
- O campo “exercício extra à minha rotina” deixou de ocupar espaço técnico no formulário do paciente. A classificação é feita de forma coerente conforme a categoria.
- Atividades passaram para depois da seção de alimentação no Diário.
- Edição, exclusão, duplicação e atualização imediata da tela foram preservadas.

### Correções do modal de atividade

- Corrigido o modal que aparecia cortado e deslocado no canto em celulares.
- Removidos posicionamentos conflitantes entre o componente de diálogo e o CSS específico.
- Modal centralizado, responsivo e com bordas arredondadas em mobile e desktop.

### Catálogo e cálculo

- Catálogo com 142 atividades em 15 categorias, baseado em referências MET reais.
- Não foram criados multiplicadores arbitrários para intensidade ou descanso.
- Em musculação, o descanso é descritivo; o MET representa a sessão completa.
- Gasto bruto: `MET × peso × horas`.
- Gasto líquido: `(MET − 1) × peso × horas`.
- No modo padrão `base_plus_net`, apenas o gasto líquido elegível do exercício é somado à base cotidiana, evitando dupla contagem do repouso.
- O peso, MET, fonte, versão e parâmetros usados ficam congelados no registro para que o histórico não mude silenciosamente.

### Faixas etárias

- Adultos de 19 a 59 anos usam o Adult Compendium 2024.
- Jovens de 6 a 18 anos usam referências compatíveis do Youth Compendium e repouso por Schofield.
- Pessoas com 60 anos ou mais usam referências correspondentes do Older Adult Compendium quando disponíveis.
- Uma atividade sem referência apropriada para a faixa etária não recebe um valor adulto arbitrário.
- O texto técnico que dizia para informar manualmente um gasto fora da faixa adulta foi substituído pelo tratamento automático quando existe referência válida.

### Fator cotidiano, TDEE e TEF

- O nutricionista passou a definir o fator cotidiano nas metas do paciente.
- A coluna `daily_activity_factor` foi adicionada às metas, aceitando valores entre `1` e `2,5`.
- Registros antigos receberam inicialmente o padrão `1,2` pela migration 012.
- O estado final para novas metas e novos pacientes usa fator cotidiano padrão `1` pela migration 013.
- Alterar esse fator recalcula imediatamente a taxa metabólica/base cotidiana mostrada na ficha.
- O TDEE estimado é calculado como base cotidiana mais o exercício líquido elegível.
- Saldo energético: `ingestão − TDEE estimado`.
- O TEF não é somado como uma parcela independente quando já está embutido no fator cotidiano, evitando contagem dupla.
- Déficit e superávit são sempre apresentados como estimativas.
- Não são criadas promessas automáticas de perda/ganho de peso nem metas agressivas.

### Atualização automática

- O balanço estimado atualiza sem F5 ao adicionar, editar ou excluir alimentos.
- O balanço também atualiza sem F5 ao adicionar, editar ou excluir exercícios.
- Foi removida a confirmação manual “Registrei toda alimentação do dia”.
- O saldo é mostrado quando existe ingestão alimentar calculável, mesmo sem exercício registrado.
- Se algum alimento não tiver energia disponível, o saldo fica indisponível em vez de assumir zero.

## 2. Home, Diário e Evolução

### Home e Diário

- Calorias ingeridas e déficit/superávit estimado passaram a dividir o mesmo resumo do dia.
- A interface prioriza somente ingestão, saldo estimado e exercícios registrados.
- Informações técnicas ficam em áreas secundárias.
- Atividades aparecem como linhas simples com modalidade, duração e gasto aproximado.
- O botão de adicionar atividade ficou grande e acessível.
- O Diário desktop foi refeito para aproveitar melhor a largura sem parecer um dashboard empresarial.
- Criados estilos específicos para desktop e movimento, preservando a experiência mobile.

### Evolução

- Mantidos os períodos de 7 dias, 30 dias e personalizado.
- O indicador principal passou de média diária para **saldo energético agregado do período**, conforme solicitado.
- Dias sem alimentação registrada são tratados como lacunas, não como zero.
- Ingestão, gasto, atividades e outros indicadores ficam em detalhes expansíveis para reduzir poluição visual.

## 3. Ativação de pacientes e e-mails

### Fator inicial do paciente

- Na criação do paciente, o fator cotidiano passou a iniciar em `1`.
- Alterações no fator atualizam o valor metabólico exibido na ficha antes de salvar.

### Código de ativação

- Adicionada máscara visual para o código de ativação.
- Adicionado limite máximo de caracteres.
- O backend normaliza e valida o código independentemente da pontuação digitada.

### Resend e e-mails transacionais

- O envio transacional foi configurado para funcionar com Resend, contornando a limitação da sandbox do AWS SES.
- O domínio `nutriplusapp.store` foi configurado/verificado para envio.
- Chaves ficaram em armazenamento privado, sem inclusão no repositório.
- O e-mail simples de confirmação foi substituído por um template visual consistente com o Nutri+.
- O mesmo padrão visual foi aplicado aos demais e-mails de conta, incluindo ativação e redefinição de senha.
- Foram adicionados testes de renderização/conteúdo dos e-mails.

## 4. Reconhecimento de alimentos por foto

### Fluxo completo

- Criado o fluxo “Reconhecer por foto” dentro do registro de alimentos.
- No menu inferior mobile, o antigo botão central de adicionar foi substituído por uma câmera.
- O botão abre diretamente a câmera traseira do celular quando o navegador permite.
- Após fotografar ou escolher uma imagem, o usuário revisa os alimentos reconhecidos antes de registrar.
- É possível trocar, remover ou adicionar itens e informar os gramas.
- Nada é gravado no Diário antes da confirmação.
- A confirmação em lote usa transação: se um item falhar, nenhum item da foto é salvo parcialmente.

### Segurança e tratamento de imagem

- Aceita JPEG, PNG e WebP, até 5 MiB e 25 milhões de pixels.
- SVG, animações e arquivos inválidos são rejeitados.
- A imagem é decodificada e regravada em JPEG com Sharp, removendo EXIF e localização.
- Fotos não são persistidas no servidor.
- Endpoint protegido por sessão, autorização do paciente e limite de cinco análises por minuto.
- Resultado da IA contém apenas nomes/alternativas; IDs, nutrientes e calorias sempre vêm do banco do Nutri+.

### Gateway de provedores

- Criado um serviço isolado em `services/food-vision`.
- O gateway permite trocar o provedor sem alterar frontend, endpoint público ou fluxo de revisão.
- Adaptadores implementados: `ollama`, `gemini`, `openai-responses` e `openai-compatible`.
- Foram criados scripts PowerShell para instalar, iniciar, conferir e configurar o provedor.
- O Ollama/Qwen3-VL 4B foi validado localmente e utilizou GPU, mas foi substituído para não depender do computador ligado.
- Gemini foi integrado e atualizado do modelo indisponível `gemini-2.5-flash-lite` para `gemini-3.5-flash-lite`.
- O estado final usa a API OpenAI com `gpt-5.6-luna` para reconhecimento visual.
- O gateway está rodando na AWS e não depende mais do túnel ou do computador local.
- Chave da OpenAI permanece fora do Git e não é enviada ao frontend.

### Navegação mobile e gesto de voltar

- Corrigido o gesto de voltar após tirar ou selecionar uma foto.
- O modal mantém um estado próprio no histórico do navegador.
- Voltar dentro dos detalhes retorna à busca/revisão correta.
- Voltar no nível principal fecha o modal em vez de navegar a página que está por baixo ou encerrar o app/PWA.
- O estado da foto é limpo ao sair, impedindo que a imagem reapareça quando o usuário abrir o fluxo novamente.
- O estado de retorno do overlay foi isolado da navegação normal do Nutri+.

## 5. Migração TACO para TBCA

### Backup anterior à troca

- Backup completo anterior: `/home/ubuntu/nutriplus-backups/nutriplus-20260909T011832Z.dump`.
- Backup específico da estrutura TACO e tabelas dependentes: `/home/ubuntu/nutriplus-backups/taco-pre-tbca-20260909T011834Z.dump`.
- O backup TACO foi validado com `pg_restore --list` e SHA-256.
- Backup completo posterior à migração: `/home/ubuntu/nutriplus-backups/nutriplus-20260909T013216Z.dump`.

### Importador TBCA

- Adicionada migration `014_tbca_catalog.sql` para permitir as fontes `TACO` e `TBCA` no schema.
- Criado `backend/tbca-import.ts` com importação transacional e repetível.
- Adicionado comando `npm run tbca:import`.
- Fonte usada: `backend/data/tbca/tbca_completa_normalizada_v2.json`.
- SHA-256 preservado: `773842a29b7198b9b07fac7799412881c06b64eaf53f51d8f7d1d37f257cb986`.
- `.gitattributes` impede que o Git altere os bytes do JSON original.
- Validação obrigatória antes de qualquer alteração no banco:
  - 5.874 alimentos;
  - 5.874 códigos únicos;
  - 41 componentes por alimento;
  - 240.834 valores;
  - 20.346 valores ausentes;
  - 5.638 traços;
  - 32.938 zeros reais;
  - zero erros.
- Decimais brasileiros são convertidos corretamente.
- `NA`, hífen e vazio viram `NULL/missing`.
- `tr` vira `NULL/trace`, preservando o valor bruto.
- Energia em kcal e kJ têm identidades distintas.
- Cinco componentes sem tagname confiável receberam identificadores internos estáveis.

### Estado final do catálogo

- Os 5.874 alimentos TBCA estão ativos para busca, foto, favoritos e novos registros.
- Os 597 alimentos TACO foram removidos do catálogo ativo.
- Os registros TACO não foram apagados fisicamente porque refeições antigas apontam diretamente para seus IDs.
- A TACO permanece inativa e invisível para novas operações, exclusivamente para preservar o histórico nutricional existente.
- A importação foi executada duas vezes: na segunda execução foram criados zero alimentos e atualizados exatamente 5.874 alimentos/240.834 valores, comprovando idempotência.
- A Home profissional e a tela de login passaram a informar “TBCA completa com 5.874 alimentos”.
- O health check passou a exigir e informar TBCA/5.874.
- A TBCA não contém índice glicêmico; os novos alimentos começam com IG indisponível e podem ser preenchidos no editor profissional.

## 6. Correção do botão X no registro de alimentos

- O botão automático de fechamento do componente-base não seguia corretamente a rotina de histórico do modal.
- Ele foi desativado apenas no `FoodEntrySheet`.
- Foi criado um botão X explícito, com `type="button"`, rótulo acessível e área de toque circular de 40 px.
- O X chama a mesma função `closeSheet()` usada pelo botão “Fechar”.
- A correção vale para mobile e desktop e foi publicada no commit `a35c42b`.

## 7. Migrations adicionadas hoje

1. `011_simple_activity_entry.sql`: horário opcional e descanso médio opcional nas atividades.
2. `012_daily_activity_factor_goal.sql`: fator cotidiano nas metas, faixa de 1 a 2,5 e migração inicial com 1,2.
3. `013_daily_activity_factor_default.sql`: padrão final de novas metas alterado para 1.
4. `014_tbca_catalog.sql`: suporte à fonte TBCA preservando a TACO legada.

## 8. Principais arquivos e módulos criados

- `frontend/app/components/activity-choices.tsx`
- `frontend/app/components/daily-energy-card.tsx`
- `frontend/app/components/food-photo-review.tsx`
- `frontend/app/movement.css`
- `frontend/app/diary-desktop.css`
- `frontend/app/food-photo.css`
- `backend/domain/age-activity-energy.ts`
- `backend/food-recognition.ts`
- `backend/photo-image.ts`
- `backend/tbca-import.ts`
- `backend/data/tbca/tbca_completa_normalizada_v2.json`
- `services/food-vision/server.ts`
- `services/food-vision/providers.ts`
- `services/food-vision/install.ps1`
- `services/food-vision/start.ps1`
- `services/food-vision/check.ps1`
- `services/food-vision/configure-provider.ps1`
- `services/food-vision/tunnel.ps1`
- `shared/food-recognition.ts`
- `shared/scale-nutrients.ts`
- `docs/food-photo-recognition.md`

## 9. Validações realizadas

- Testes unitários e de backend executados durante as entregas.
- Na entrega final da TBCA e correção do X: 53 testes aprovados e 15 testes de integração condicionais ignorados no ambiente corrente.
- Lint do frontend aprovado.
- TypeScript do backend aprovado com `tsc --noEmit`.
- Build de produção do frontend aprovado.
- Importação TBCA auditada localmente e na AWS.
- PM2 validado com os três serviços online.
- Health checks local da instância e público validados com o hash publicado.
- Há apenas avisos não bloqueantes do Vinext sobre tamanho de alguns chunks e classificação estática de rotas.

## 10. Commits de hoje, em ordem

| Commit | Alteração |
| --- | --- |
| `12632b2` | Simplificação completa do registro de atividades |
| `c7e1bcd` | Primeiro ajuste do modal de atividade no mobile |
| `1fbfc72` | Correção de transformação/posição mobile |
| `a36f04f` | Remoção de posicionamentos conflitantes do diálogo |
| `b18297c` | Remoção de campos e opções técnicas do registro |
| `af085b3` | Atualização automática do balanço após mudanças no Diário |
| `2e50b99` | Experimento de texto do balanço diário |
| `adff007` | Reversão do experimento anterior conforme orientação |
| `f6ae5fe` | Fator cotidiano configurável nas metas |
| `cb22d7c` | Documentação/clareza de TEF e TDEE |
| `08cf10b` | Remoção da confirmação manual do dia |
| `98f50e9` | Redesign do Diário desktop |
| `7391bb4` | Referências de atividade por faixa etária |
| `3ea9a71` | Ajuste inicial do texto da Evolução |
| `e90a22f` | Saldo agregado no período da Evolução |
| `2f969b5` | Fator cotidiano padrão final igual a 1 |
| `fe30bc1` | Máscara e limite do código de ativação |
| `ba332b3` | Novo visual dos e-mails transacionais |
| `74715f9` | Reconhecimento completo de alimentos por foto |
| `4faa9ce` | Arquitetura intercambiável de provedores visuais |
| `83c1a7a` | Integração Gemini |
| `eb44d6b` | Diagnóstico detalhado de falha do provedor |
| `1ea4013` | Atualização do modelo Gemini disponível |
| `8129ce7` | Documentação do Gemini no gateway |
| `be1ca61` | Mudança final para GPT-5.6 Luna |
| `96a40d0` | Câmera como ação central no menu mobile |
| `7acd466` | Correção do gesto de voltar depois da foto |
| `1a3f3c9` | Isolamento do histórico do modal de foto |
| `1733640` | Substituição do catálogo TACO pela TBCA |
| `4db3abb` | Preservação byte a byte do arquivo TBCA |
| `a35c42b` | Correção do X do registro de alimentos |

## 11. Observações para a próxima análise

- Considerar `a35c42b` como o estado base atual.
- Não apagar fisicamente os alimentos TACO inativos sem antes migrar todas as referências históricas de `meal_entries` e validar as somas antigas.
- Não colocar chaves do Resend, OpenAI, AWS ou banco no Git.
- A TBCA é a única fonte ativa para novos alimentos.
- O reconhecimento fotográfico deve continuar resolvendo nutrientes pelo banco; a IA não pode inventar IDs, calorias ou composição.
- O documento `docs/food-photo-recognition.md` ainda contém algumas descrições históricas do estágio local/Ollama e menções à TACO. O comportamento de produção atual é AWS + OpenAI + TBCA, conforme este relatório.
- O arquivo `scripts/backup-postgres.sh` possui uma modificação local deliberadamente preservada no servidor e não faz parte dos commits listados acima.
