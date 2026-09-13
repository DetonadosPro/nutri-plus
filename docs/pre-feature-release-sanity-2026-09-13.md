# Auditoria pré-feature — 13/09/2026

## Git, main e produção

- Branch auditada: `main`.
- `HEAD`, `main` e `origin/main`: `8409bea3db582a086768c2cda4ede9d339d3a669`.
- Divergência após `git fetch --prune`: `0` commits locais e `0` remotos.
- Produção confirmou o mesmo SHA em `/api/health` e `/healthz`; a página pública respondeu HTTP 200.
- Não havia alterações rastreadas ou staged no início. Havia artefatos locais não rastreados, preservados sem limpeza.

## Arquivos locais e ignorados

- `.codex-local/`, `.env.local`, certificados, dependências, builds e resultados pesados do benchmark estavam corretamente ignorados.
- `imagens reais/` não estava rastreada, mas também não estava protegida pelo `.gitignore`. Foi acrescentada somente a regra `/imagens reais/`.
- Nenhum `.env`, certificado, dump, banco, log, screenshot, imagem real ou output local foi encontrado entre os arquivos rastreados. Apenas os modelos públicos `.env.example` são versionados.
- Permanecem não rastreados documentos, ZIPs, scripts/dados de coleta TBCA e utilitários do benchmark. Não foram apagados, adicionados ou classificados automaticamente porque podem ser material de trabalho intencional.

## Branches recentes

- Integralmente contidas em `main`: `feature/food-search-meat-refinement`, `fix/food-vision-sausage-regression`, `fix/food-vision-beef-cut-context`, `feature/simple-omelet-integration` e `hotfix/food-photo-recognition-v2`.
- `feature/simple-omelet` possui um commit exclusivo (`ea4f991`), mas é a versão anterior da mudança de omelete. A versão integrada e continuada está em `feature/simple-omelet-integration` (`e77b944`) e em `main`; portanto, não há mudança útil esquecida.
- Nenhuma branch foi removida.

## Integridade do catálogo

- TBCA ativa: 5.874 alimentos.
- Medidas: 8.317, distribuídas em 6.087 caseiras, 445 de volume e 1.785 de contagem, cobrindo 4.879 alimentos.
- O baseline é idêntico localmente e em produção nos totais e distribuições.
- Fingerprint local das medidas: `4170afa41ad01612ef894955b3fe3cc22c93a4ecb313f1abf5eaf900a85b86de`.
- Fingerprint de produção: `a1a0d5c129a43d5e035fa99fc429b9ba34dddf53f9bcd1916579f31e9833d146`.
- A diferença dos hashes decorre dos IDs substitutos e faixas de sequência distintas entre os bancos (`9–47588` local e `1–16633` em produção); quantidades, tipos, fontes e cobertura coincidem.
- O banco local contém 6.471 alimentos totais: 5.874 TBCA e 597 referências TACO, todos com `id` e `source_code` únicos; 256.356 registros nutricionais cobrem os 6.471 alimentos.
- Nenhum catálogo, nutriente, ID, `source_code` ou histórico foi alterado durante a auditoria.

## Smoke alimentar descartável

Foi executado contra a API local e PostgreSQL local (`nutri_dev`), com usuário e alimento sintético identificados por UUID e removidos ao final.

- Busca: `arroz`, `leite integral`, `pepino` e `peito bovino` retornaram os itens humanizados esperados; cru não poluiu o topo de arroz/peito. A suíte de curadoria também cobriu `ovo`.
- Medida caseira: uma colher de sopa cheia de arroz produziu 20 g, snapshot TBCA e aproximadamente 26 kcal.
- Adição: resposta 201 já trouxe a entrada, gramas e nutrientes atualizados.
- Edição: quantidade e medida atualizaram imediatamente na resposta, sem duplicação.
- Exclusão: resposta 204 removeu a entrada efetiva no backend.
- mL: a medida de leite usada manteve a relação cadastrada `165 mL = 165 g`; 100 mL e 125,5 mL produziram os equivalentes esperados. O cálculo veio da medida catalogada, não de fallback genérico.
- Contagem: a fixture controlada validou `2 × 50 g = 100 g`; o catálogo também contém a medida `1 ovo = 50 g` para a omelete `BRC0065J`.
- Snapshot: criação, edição, movimentação e cópia preservaram o snapshot original; mudança posterior na medida do catálogo não reescreveu o histórico.
- O teste HTTP não apresentou 500 nem respostas inesperadas. Não houve evidência de request duplicada ou N+1 no smoke delimitado.

O ciclo funcional foi comprovado pela API real e pelos testes automatizados. Não foi feita uma nova rodada visual interativa no navegador; portanto, a atualização imediata da UI foi validada pelo contrato retornado e pela suíte frontend, não por observação manual de tela nesta auditoria.

## Testes e compilação

- Smoke específico de busca/medidas/API: 62 testes aprovados.
- Backend completo: 242 aprovados; 22 integrações condicionais ignoradas conforme configuração.
- Frontend: 17 aprovados.
- TypeScript backend e frontend: aprovado.
- Lint: aprovado.
- Build: aprovado.
- `git diff --check`: aprovado.
- Warning conhecido: chunks frontend acima de 500 kB. Nenhum warning funcional novo.
- Reconhecimento por foto não foi reaberto nem chamou IA; seus arquivos compilaram e seus testes existentes passaram na suíte backend.

## Problemas e mudanças

Problema real encontrado: ausência da regra de ignore para `imagens reais/`. Correção mínima aplicada em `.gitignore`. Este relatório foi criado. Nenhuma outra alteração funcional foi feita.

## Conclusão

O código, catálogo, banco, busca, medidas, diário, histórico, testes e produção estão coerentes. Não há mudança útil esquecida em branch antiga nem bloqueador funcional para iniciar o Plano Alimentar. O workspace não é literalmente limpo porque mantém artefatos locais não rastreados intencionais e as duas alterações documentais desta auditoria ainda não foram commitadas, conforme solicitado.

**Recomendação: PRONTO PARA NOVAS FEATURES.**
