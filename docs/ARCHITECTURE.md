# Arquitetura do Nutri+

## Execução e portabilidade

O frontend conversa somente com a API Express. A API é a única camada que acessa o PostgreSQL. A conexão fica centralizada em `DATABASE_URL`; por segurança, hosts externos só são aceitos quando `NUTRI_ALLOW_REMOTE_DATABASE=true` estiver definido explicitamente no ambiente do servidor.

O `docker-compose.yml` reproduz a arquitetura completa com PostgreSQL, inicializa a base TACO de forma idempotente, executa frontend e backend separadamente e publica tudo pelo gateway Nginx. Para subir localmente:

1. copie `.env.docker.example` para `.env` e troque a senha;
2. execute `docker compose up --build`;
3. acesse `http://localhost:8080`.

Credenciais e URLs reais permanecem fora do Git. Para trocar o PostgreSQL de host sem alterar o código, basta mudar `DATABASE_URL` no ambiente correspondente.

## Portais por perfil

O frontend usa uma base compartilhada, mas cada hostname abre um portal isolado:

- `nutriplusapp.store`: paciente;
- `pro.nutriplusapp.store`: nutricionista;
- `admin.nutriplusapp.store`: administração.

O portal determina o perfil usado no login e impede que uma sessão de outro perfil abra a área incorreta. Pacientes e nutricionistas ativam a própria conta com códigos de uso único; o portal profissional identifica explicitamente o código gerado pela administração. O backend também confere o perfil associado ao código ou link, então a separação não depende apenas da interface.

Em desenvolvimento local, use `?portal=patient`, `?portal=nutritionist` ou `?portal=admin`.

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
