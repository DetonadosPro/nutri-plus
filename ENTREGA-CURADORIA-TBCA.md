# Pacote da curadoria TBCA do Nutri+

Este pacote contém os arquivos criados e modificados para implementar a camada determinística de curadoria e busca dos 5.874 alimentos TBCA, incluindo a terceira e última passada automática de qualidade.

## Conteúdo principal

- artefato completo da curadoria e relatório estruturado;
- overrides humanos por `source_code`;
- regras determinísticas, importador transacional e auditoria;
- migration PostgreSQL;
- ranking da API e apresentação no frontend;
- testes automatizados;
- documentação e relatório com exemplos antes/depois.
- cópias imutáveis dos artefatos da primeira e da segunda passadas para comparação e rastreabilidade.

## Dependências não incluídas

A fonte nutricional `backend/data/tbca/tbca completa normalizada.json` não foi criada nesta tarefa e não está duplicada no ZIP. Ela permanece no projeto Nutri+ e é validada pelo SHA-256 `25bf7e2e60763e404be42b61011fc99256c6f944c43ed93b23ec4b14ec7d53a7`.

Os dados nutricionais, medidas e histórico também não estão no pacote. Nenhum deles foi alterado pela curadoria.

## Resultados validados

- 5.874 TBCA ativos e classificados;
- 597 TACO inativos;
- 8.316 medidas preservadas;
- 89 `common`, 2.626 `useful` e 3.159 `specific`;
- 10.189 aliases atuais;
- os 174 `common` da segunda passada foram revisados: 89 mantidos, 46 rebaixados para `useful` e 39 para `specific`;
- 178 nomes naturalizados nesta passada final, com regras dirigidas de português e peixes;
- 25 buscas comparadas antes/depois, incluindo 10 buscas específicas de controle;
- os 455 casos `confidence=low` da baseline foram priorizados; 453 permanecem após distinguir duas Corvinas pela origem registrada na TBCA;
- 132 grupos de colisão atuais classificados para revisão humana;
- 513 correspondências TACO para TBCA;
- 129 testes aprovados, 19 ignorados de forma preexistente, TypeScript, lint e build aprovados;
- fingerprints de identidade, nutrientes, medidas e histórico invariáveis em duas importações locais consecutivas;
- nenhuma publicação em produção.

Leia primeiro `docs/tbca-search-curation.md` e `docs/tbca-curation-report.md`.
