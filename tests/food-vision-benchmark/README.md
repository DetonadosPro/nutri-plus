# Benchmark offline de reconhecimento visual

Coloque imagens privadas fora do Git em `images/`, copie `cases.example.json` para `cases.json` e rotule códigos TBCA esperados/aceitáveis. Resultados de variantes ficam em JSON e nunca devem conter a imagem.

Execute `npm run vision:benchmark -- --cases caminho/cases.json --predictions atual.json novo.json`. O relatório compara variantes (por exemplo matcher antigo/novo ou Luna none/low) sem alterar produção.

Métricas: exact/acceptable match, top-1, top-3, precisão e cobertura de AUTOSELECT, acurácia do reranker, taxa de escolha do usuário, no-match, latência média/p50/p95 e custo médio por imagem. Custo vem do usage real e da tabela de preços informada pelo executor; o runner não embute preço sujeito a mudança.
