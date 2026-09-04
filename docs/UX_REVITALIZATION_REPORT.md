# Revitalização completa de UX do Nutri+

Data da entrega: 1 de setembro de 2026

## Diagnóstico

A interface anterior concentrava fluxos extensos em duas telas monolíticas, repetia o diário entre os perfis e apresentava muitos cartões com a mesma importância visual. A navegação por datas usava um campo técnico, a inclusão de alimentos misturava busca e configuração, e horários eram derivados do relógio do servidor. Isso tornava os fluxos menos claros no celular e poderia gerar divergência entre o momento real de consumo e o horário registrado.

## Nova arquitetura de informação

### Paciente

- Hoje: resumo prioritário, refeições, água e orientação mais recente.
- Diário: navegação horizontal por datas, refeições em linha do tempo, inclusão e edição de alimentos e análise nutricional progressiva.
- Evolução: peso, energia e hidratação ao longo do tempo.
- Orientações: mensagens do nutricionista separadas do diário.
- Perfil: dados pessoais e objetivos.

### Nutricionista

- Visão geral: situação real da carteira, pacientes com registro no dia e acessos recentes.
- Pacientes: busca, lista responsiva e criação de cadastro.
- Workspace do paciente: visão geral, diário, evolução, análise e feedback em abas próprias.

## Sistema visual e componentes

Foi criado um sistema visual coeso com tokens de cor, tipografia, espaçamento, raios, foco e movimento. A composição privilegia hierarquia, espaço em branco e leitura clínica, sem depender de um mosaico uniforme de cartões.

Componentes compartilhados principais:

- cabeçalho de página e seção;
- navegação horizontal por datas;
- diário e resumo nutricional;
- linha do tempo das refeições;
- fluxo progressivo para adicionar alimento;
- diálogo de edição de quantidade, refeição e horário;
- estados vazios, skeletons, confirmações e mensagens de sucesso ou erro.

## Data, hora e segurança dos dados

- A data atual é calculada em `America/Sao_Paulo`.
- O horário é informado pelo usuário e salvo em cada item consumido.
- A refeição é uma escolha explícita e independente do horário.
- Horários entre `00:00` e `03:59` permanecem exatamente como informados.
- Datas de calendário são manipuladas sem conversão UTC acidental.
- A migração adiciona `consumed_at` sem apagar dados e preenche registros antigos com o horário já existente da refeição.
- Edição, exclusão, cópia do diário, notas, treino, água, metas, orientações, IG/CG e detalhamento nutricional foram preservados.

## Responsividade e acessibilidade

Os dois perfis foram revisados entre 320 e 1920 pixels. A navegação muda de barra inferior no paciente móvel para sidebar no desktop; listas, abas, diálogos e folhas inferiores se adaptam sem rolagem horizontal. Controles interativos têm área mínima de toque, foco visível, textos em português e suporte a preferência por movimento reduzido.

## Validação

- tipagem do backend e frontend;
- testes automatizados de domínio e fuso de Brasília;
- lint;
- build de produção;
- auditoria da base nutricional;
- testes funcionais de criação, movimentação e exclusão de um item temporário nos horários 03:10, 15:10, 12:00, 23:55 e 00:05;
- inspeção visual dos dois perfis em celular, tablet e desktop.

Os registros temporários usados nos testes foram removidos ao final. Nenhum serviço de hospedagem ou nuvem foi configurado.
