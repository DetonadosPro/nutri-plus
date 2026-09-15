# Nutri+ — piloto sintético de 20 imagens

Este pacote substitui o dataset defeituoso de colagens apenas como novo conjunto de avaliação. Não sobrescreva os arquivos ou relatórios anteriores.

## Conteúdo
- `images/food-001.png` a `food-020.png`: 20 imagens individuais originais, copiadas byte a byte dos arquivos gerados. Todas têm 1448 × 1086 pixels. Não houve recorte, upscaling, recompressão ou inserção de texto.
- `labels.review.json`: rótulos provisórios, componentes esperados, notas de incerteza, proveniência e hashes.
- `labels.review.csv`: planilha de revisão, com uma linha por componente.
- `preview-review.jpg`: folha de contato somente para revisão humana, nunca para inferência.
- `CODEX-INSTRUCOES.md`: instruções de importação, auditoria e execução controlada.

## Estado do gabarito
Existem 20 imagens e 32 componentes esperados provisórios. Os códigos TBCA estão intencionalmente nulos. Nenhuma equivalência nutricional foi aprovada. A revisão visual inicial não substitui uma auditoria independente nem a revisão do catálogo.

Apenas a aparência e a intenção de geração não estabelecem espécie exata de peixe, corte bovino, receita, quantidade de óleo, teor de sal ou variedade de queijo. O arquivo registra essas incertezas. O alimento que não tiver código exato defensável deve permanecer pendente ou ser avaliado por um critério de ambiguidade previamente aprovado.

## Regra de sal
Quando a única diferença relevante for com sal versus sem sal e ela não puder ser observada, preferir com sal no código principal. Uma alternativa sem sal só entra em acceptableCodes após revisão. A regra não autoriza inferir óleo, corte, espécie, composição ou outros atributos invisíveis.

## Instalação
Extraia a pasta `synthetic-v2-pilot-20` dentro de:
`C:\Users\Detona\Documents\Nutri+\tests\food-vision-benchmark\datasets\`

Se o diretório `datasets` não existir, crie-o. Mantenha intactos README.md, run.ts e demais arquivos existentes na raiz do benchmark. Não copie o conteúdo diretamente sobre o dataset antigo.

## Execução
Primeiro o Codex deve revisar o runner real, conferir os 20 arquivos e os 32 componentes, resolver os códigos oficiais, revisar equivalências e preparar um manifesto compatível. O gabarito jamais pode entrar no prompt enviado ao Luna. Peça autorização antes de executar as chamadas pagas. Não altere produção, pesos, thresholds ou aliases durante o baseline.
