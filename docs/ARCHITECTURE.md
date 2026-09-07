# Arquitetura do Nutri+

## Execução e portabilidade

O frontend conversa somente com a API Express. A API é a única camada que acessa o PostgreSQL. A conexão fica centralizada em `DATABASE_URL`; por segurança, hosts externos só são aceitos quando `NUTRI_ALLOW_REMOTE_DATABASE=true` estiver definido explicitamente no ambiente do servidor.

O `docker-compose.yml` reproduz a arquitetura completa com PostgreSQL, inicializa a base TACO de forma idempotente, executa frontend e backend separadamente e publica tudo pelo gateway Nginx. Para subir localmente:

1. copie `.env.docker.example` para `.env` e troque a senha;
2. execute `docker compose up --build`;
3. acesse `http://localhost:8080`.

Credenciais e URLs reais permanecem fora do Git. Para trocar o PostgreSQL de host sem alterar o código, basta mudar `DATABASE_URL` no ambiente correspondente.

## Entrada única e perfis

O frontend oferece uma única entrada em `nutriplusapp.store`. O login envia somente e-mail e senha; o backend identifica o perfil cadastrado e o frontend abre automaticamente a área de paciente, nutricionista ou administração.

Os convites também não pedem que a pessoa escolha um perfil. O administrador cria exclusivamente contas de nutricionista, e o nutricionista cria exclusivamente contas de paciente vinculadas a ele. Cada código é hashado, de uso único, possui validade e referencia uma conta cujo perfil já foi definido pelo emissor autorizado. Antes do cadastro, a interface consulta o código e informa automaticamente qual conta será criada.

As permissões continuam verificadas no backend em todas as rotas; a entrada comum não mistura dados nem concede acesso entre perfis.

## Backups

`scripts/backup-postgres.sh` cria um dump PostgreSQL em formato verificável, valida o arquivo e remove cópias locais antigas. Quando `NUTRI_BACKUP_S3_URI` estiver configurada, a mesma rotina envia uma cópia para armazenamento S3. A rotina deve ser ativada no servidor somente depois de criar e restringir o destino externo.

## Base nutricional

A fonte única é a TACO 4ª edição ampliada e revisada. `backend/scripts/extract-taco-pdf.py` lê a tabela diretamente do PDF oficial por coordenadas, combina as páginas esquerda/direita pelo código do alimento e produz JSON e CSV auditáveis. O texto é extraído sem OCR; os nomes são recuperados dos bytes textuais do próprio PDF.

`backend/taco-import.ts` valida 597 códigos únicos, 26 nutrientes por alimento, unidades e estados antes de escrever. O UPSERT usa `(source, source_code)`, portanto pode ser repetido sem duplicar alimentos ou valores.

## Modelo de dados

- `foods`: 597 identidades TACO, grupos e nomes pesquisáveis;
- `nutrients`: catálogo fixo de 26 componentes;
- `food_nutrients`: valor, representação original e estado `numeric`, `trace` ou `missing`;
- `nutrition_import_runs`: trilha de cada importação;
- tabelas clínicas: usuários, pacientes, sessões, pesos, metas, diários, refeições, favoritos e anotações.

## Cálculos e interface

`backend/domain/nutrition.ts` centraliza escala por gramas, soma, energia 4/4/9 e proteína por quilo. Um valor indisponível torna o total daquele nutriente indisponível; ele nunca entra como zero. A mesma resposta diária abastece paciente e nutricionista, inclusive a composição expansível de macros, minerais e vitaminas.

A busca normaliza acentos e caixa, usa tokens parciais e similaridade textual, e retorna somente alimentos TACO ativos.
