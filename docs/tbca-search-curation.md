# Curadoria da busca TBCA

## Objetivo e limites

A curadoria mantém todos os 5.874 alimentos TBCA e simplifica a experiência do paciente sem modificar nutrientes, códigos, IDs, medidas ou histórico. Os 597 alimentos TACO continuam inativos e servem apenas como sinal conceitual durante a geração do artefato.

Não há IA, embedding ou chamada externa na busca em runtime. A API consulta somente o PostgreSQL, devolve no máximo 25 alimentos e o frontend não carrega o catálogo inteiro.

## Artefatos

- `backend/data/food-curation.v1.json`: resultado completo, ordenado por código TBCA;
- `backend/data/food-curation.v1.first-pass.json`: cópia imutável da primeira passada usada nas comparações;
- `backend/data/food-curation.v1.second-pass.json`: cópia imutável da segunda passada, baseline da revisão final;
- `backend/data/food-curation.overrides.json`: exceções humanas explícitas para nomes e prioridades importantes;
- `backend/food-curation-rules.ts`: regras puras de nomes, categorias, flags, aliases, correspondência TACO e ranking de teste;
- `backend/food-curation.ts`: geração, validação, importação transacional e auditoria;
- `backend/data/food-curation.audit.json`: relatório estruturado completo;
- `backend/data/food-curation.audit.first-pass.json`: auditoria preservada da primeira passada;
- `backend/data/food-curation.audit.second-pass.json`: auditoria preservada da segunda passada;
- `docs/tbca-curation-report.md`: relatório legível da terceira revisão, com os 174 `common`, 25 buscas antes/depois, todos os casos de baixa confiança atuais e colisões problemáticas.

O artefato contém por alimento: `friendly_name`, até oito `aliases`, `priority`, `priority_score`, `curation_category`, `details`, `specificity_flags`, `confidence`, referências TACO e agrupamento de possíveis duplicidades.

## Regras

1. O nome original TBCA nunca é sobrescrito no artefato nem no campo `description`.
2. O nome amigável parte do nome de exibição já vinculado à fonte e recebe normalizações determinísticas. Diferenças de preparo e composição são preservadas.
3. Informações como Brasil, média de amostras, presença de óleo, sal ou açúcar são mantidas em `details` quando saem do nome principal. Corte, método, pele, teor de gordura e outras diferenças nutricionais relevantes permanecem explícitos.
4. Preparações compostas, fórmulas infantis, suplementos e produtos de marca recebem sinais específicos. Descrição longa, sozinha, não torna um alimento `specific`.
5. Receitas complexas e refeições compostas só recebem aliases do nome da preparação; fragmentos automáticos de ingredientes não entram como aliases fortes.
6. A TACO é comparada semanticamente por tokens canônicos e grupo. O melhor equivalente só é aceito acima do limiar documentado no código; não há cópia de nutrientes ou dependência da TACO depois da geração.
7. Colisões de nome permanecem explícitas. O gerador não inventa sufixos apenas para tornar nomes únicos; registra os códigos e reduz a confiança para revisão.
8. Casos longos ou complexos não são excluídos. `specific` significa prioridade menor numa busca genérica, não inutilidade.
9. A terceira passada só pode mudar prioridade em itens que eram `common` na segunda; espécies simples de peixe recebem aliases e scores dirigidos, enquanto receitas complexas não recebem o alias genérico `peixe`.

## Schema e ranking

A migration `023_tbca_search_curation.sql` acrescenta campos de curadoria a `foods`, constraints e índice parcial de ranking. O ranking da API usa, nesta ordem:

1. nome amigável exato;
2. alias exato;
3. início do nome amigável;
4. início de alias;
5. nome original exato ou por prefixo;
6. `common`, `useful`, `specific`;
7. score, similaridade e código estável.

A filtragem usa o texto normalizado indexado e preserva a possibilidade de encontrar preparações específicas por termos suficientes.

## Fluxo seguro

```powershell
npm run curation:generate
npm run curation:check
npm test
npm run curation:import
npm run curation:import
npm run curation:audit
npm run measures:audit
```

`curation:import` exige exatamente 5.874 TBCA e 597 TACO no banco. Dentro de uma transação, compara fingerprints de identidades, nutrientes, medidas e `meal_entries` antes/depois. Qualquer divergência aborta a operação. A segunda execução comprova idempotência.

## Revisão humana

Os itens com `confidence: low`, colisões e pares semelhantes ficam listados no relatório JSON. O relatório Markdown também separa os casos `low` em prioridade humana alta, média e baixa, e classifica colisões em aceitável, precisa de detalhe e precisa de override humano. Para corrigir um caso, adicione um override pelo `source_code`, regenere e execute `curation:check`. Não edite milhares de linhas geradas à mão e não crie migration pontual para esconder ou desativar alimentos.
