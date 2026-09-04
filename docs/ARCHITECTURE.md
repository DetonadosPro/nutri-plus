# Arquitetura do Nutri+

## Execução local

O frontend conversa com a API Express local. A API é a única camada que acessa o PostgreSQL e recusa bancos fora de `localhost`, `127.0.0.1` ou `::1`. Não existe caminho de implantação em nuvem no fluxo do sistema.

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
