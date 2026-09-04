# Relatório da TACO 4ª edição

## Fonte e método

- arquivo: `backend/data/taco/taco_4_edicao.pdf`;
- SHA-256: `2002aec5615b5b1395aaa8fa675635bbb7f712c33f278af5e332f1cac8f108c8`;
- tabela principal: páginas 29 a 68 do PDF;
- método: extração textual por coordenadas, união das páginas em pares e validação pelo código 1 a 597;
- OCR: não utilizado.

## Resultado normalizado

- 597 alimentos em 15 grupos;
- 26 nutrientes e 15.522 células nutricionais;
- 11.545 valores numéricos;
- 1.862 ocorrências `Tr` preservadas como `trace`;
- 2.115 ausências preservadas como `missing`;
- 193 zeros numéricos preservados como zeros reais;
- o alimento 591, coco-verde cru, permanece totalmente indisponível porque o PDF oficial apresenta asteriscos em toda a linha;
- nenhum código duplicado e nenhum alimento estruturalmente incompleto.

Os arquivos `taco_normalizada.json` e `taco_normalizada.csv` mantêm o código, descrição, grupo, páginas de origem, valor original, valor numérico e estado. O JSON também registra edição, hash do PDF, páginas e contagens de auditoria.

## Amostragem visual

Foram conferidos diretamente no PDF alimentos dos grupos de cereais, frutas, óleos, carnes, leites, ovos e leguminosas, incluindo arroz, banana, óleo de soja, carne bovina, leite, ovo e feijão. As quantidades e os estados especiais coincidiram com a saída normalizada.

## Reimportação

`npm run taco:import` pode ser repetido. A segunda execução atualiza os mesmos 597 alimentos e 15.522 valores, sem criar duplicatas.
