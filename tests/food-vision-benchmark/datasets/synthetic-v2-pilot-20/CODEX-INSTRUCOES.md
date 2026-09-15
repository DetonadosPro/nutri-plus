# Codex — importar e testar o piloto real de 20 imagens do Nutri+

O ChatGPT gerou e entregou um novo pacote contendo exatamente 20 imagens individuais originais. Ele substitui o conjunto anterior de colagens para uma nova avaliação, mas não deve apagar o histórico do experimento inválido.

O pacote foi extraído em:
`tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20/`

Contém `images/food-001.png` a `food-020.png`, `labels.review.json`, `labels.review.csv`, `preview-review.jpg` e `README-PILOT-20.md`.

## 1. Inspecionar antes de executar
Leia a infraestrutura existente do benchmark, especialmente o runner, preparação dos casos, relatórios e auditoria anterior. Confirme o esquema realmente aceito pelo executor, em vez de presumir que o novo JSON já seja compatível. Preserve o baseline antigo e todos os arquivos existentes.

Não gere novas imagens. Não recorte colagens. Não substitua as 20 imagens. Não modifique o sistema de produção.

## 2. Validar os arquivos e o gabarito
Verifique que existem exatamente 20 PNGs individuais, com 1448 × 1086 pixels, e que os hashes SHA-256 correspondem aos registrados no manifesto. Os arquivos devem ser decodificáveis, sem texto ou rótulos embutidos. Confirme o vínculo entre cada ID, arquivo e rótulo.

O manifesto contém 32 componentes esperados provisórios. Realize uma revisão visual independente, principalmente dos pratos mistos 008 e 010 e da salada 018. Verifique a presença de todos os componentes, ingredientes extras, oclusões e possíveis duplicações. Não use a resposta do modelo gerador como prova de identidade.

Uma revisão preliminar foi feita, mas não há aprovação final do gabarito TBCA. Marque rejeições ou correções com justificativa e preserve o rótulo original. Se um alimento de fundo ou guarnição não for pontuado, documente a regra antes da inferência.

## 3. Resolver códigos TBCA oficiais
Consulte exclusivamente o catálogo oficial atual do PostgreSQL, com 5.874 alimentos. Resolva cada componente para um código existente, considerando nome original, display_name, aliases, preparação e ingredientes conhecidos. Não invente códigos nem confie no primeiro resultado de busca sem revisão semântica.

Não utilize o pipeline de reconhecimento a ser avaliado para decidir o gabarito. A resolução textual pode gerar candidatos para revisão, mas não deve produzir automaticamente uma verdade de referência.

Preencha tbcaCode e acceptableCodes somente após revisão. Preserve atributos invisíveis como pendências: espécie de peixe, corte bovino, quantidade de óleo, composição exata de lasanha, omelete e farofa, e variedade de queijo. Se não existir correspondência exata defensável, sinalize para revisão ou use uma regra de ambiguidade pré-aprovada; não force o código mais próximo.

Quando a única diferença relevante for com sal versus sem sal e isso não for observável, prefira com sal como código principal. Sem sal pode ser equivalência aceitável quando justificado. Não extrapole essa preferência para outras diferenças nutricionais.

## 4. Preparar e aprovar o conjunto
Converta o manifesto para o formato que o runner realmente espera. Não altere os códigos ou a lógica do pipeline para fazer o benchmark passar.

Valide:
- 20 imagens e 20 registros únicos;
- 32 componentes provisórios ou uma contagem revisada com justificativa;
- hashes, dimensões e decodificação;
- códigos TBCA existentes;
- equivalências revisadas, sem duplicações indevidas;
- nenhum caso pendente incluído silenciosamente na métrica exata;
- associação um-para-um entre componentes esperados e previsões.

Gere uma folha de auditoria e um relatório de aprovação do gabarito. Mostre-me o resultado e aguarde minha autorização antes de executar chamadas pagas. Se o catálogo não tiver equivalência defensável para algum caso, explique e peça uma decisão em vez de inventar.

## 5. Baseline após autorização
Execute somente este novo dataset, sem reutilizar respostas ou gabaritos do conjunto antigo. Use exclusivamente gpt-5.6-luna com reasoning effort low e o pipeline publicado no commit ec436e3, ou identifique explicitamente qualquer diferença de versão.

Não altere system prompt, ranking, pesos, thresholds, aliases, reranker ou banco nutricional. Não faça push, deploy ou migrations. Use a configuração e os segredos já existentes, sem revelá-los.

Não envie ao Luna expectedLabel, tbcaCode, acceptableCodes, dificuldade, notas de auditoria ou qualquer dado que revele o gabarito. A comparação ocorre somente após a inferência. Mantenha store:false e as proteções atuais de imagem e acesso.

## 6. Métricas
Meça separadamente por imagem e por componente:
- imagens avaliadas e componentes esperados;
- componentes detectados, ausentes e extras;
- exact e acceptable match;
- top-1 e top-3;
- AUTOSELECT precision e coverage;
- RERANK accuracy e taxa de incerteza;
- ASK_USER e NO_MATCH;
- latência da primeira chamada, matcher, reranker e pipeline total;
- input, output e reasoning tokens e custo real por estágio.

A associação entre esperado e previsto deve ser um-para-um. Uma previsão não pode contar duas vezes. Evite contar uma preparação composta e seus ingredientes como acertos duplicados. Separe erros de identificação visual de erros de pareamento TBCA e de ambiguidades não observáveis.

Use o usage real da API e os preços oficiais aplicáveis, sem contar reasoning tokens duas vezes. Calcule custo total, custo médio por foto e projeções claramente identificadas. Informe os denominadores de cada percentual.

## 7. Relatório e limites
Gere um novo relatório, sem sobrescrever o anterior, com resultados por imagem, componente, dificuldade e categoria. Inclua os principais erros, scores, margem, candidatos e decisões, quando disponíveis.

Não calibre thresholds usando um gabarito incompleto. Não ajuste automaticamente o algoritmo após o baseline. Primeiro quero analisar o resultado com o ChatGPT.

O piloto de 20 imagens é pequeno e sintético: serve para validar o processo e detectar problemas, não para afirmar a acurácia final de produção. Uma avaliação posterior deve incluir fotos reais autorizadas e um conjunto de teste independente.

Ao terminar, informe quantas imagens e componentes foram efetivamente avaliados, quantos tiveram acerto exato e aceitável, o custo real e quais casos permaneceram ambíguos ou pendentes. Não declare um teste concluído se ele ainda não foi executado.
