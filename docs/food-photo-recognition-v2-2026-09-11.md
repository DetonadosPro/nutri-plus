# Reconhecimento alimentar por foto v2 — hotfix de qualidade

Data: 2026-09-11

Branch isolada: `hotfix/food-photo-recognition-v2`

Base: `main` / `801ab02992c9a8470321082ea7ec0fe64233f6ca`
Status da implementação: validada; a promoção para `main` e produção ocorre pelo commit que contém este relatório.

## Regressão encontrada

O pipeline não possuía uma representação estrutural que diferenciasse um componente registrável de uma preparação culinária integrada. A decisão ficava quase toda no texto livre do modelo. Além disso, a deduplicação considerava qualquer identidade compartilhada com o mesmo preparo como suficiente para unir duas detecções. Isso permitia que uma resposta composta sobrevivesse até o matcher ou que componentes parcialmente sobrepostos fossem mesclados agressivamente.

O baseline real mostrou que o problema não era uniforme:

- IMAGE 1 já retornou três itens corretos nesta execução, sem arroz;
- IMAGE 2 retornou um único item, `massa com molho e carne`, e o matcher não recuperou candidato útil.

Portanto, a regressão é intermitente e resulta da combinação entre representação incompleta, prompt que permitia decidir cedo demais pelo prato inteiro, deduplicação permissiva e amplificação dessa saída composta pelo matcher. Não há evidência suficiente para atribuí-la a um único commit.

## Commits e diffs investigados

- `74715f9`: introdução do reconhecimento por foto;
- `2fb1565`: schema/prompt semântico mais preciso;
- `6e18f42`: matcher TBCA conservador e deduplicação;
- `2d81030`: uma chamada normal por foto e reranker desabilitado no fluxo normal;
- `b87ff86`: primeira confirmação de carne fragmentada;
- `3c423fd`: revisão visual simplificada;
- `8d304b3`: estabilização recente, curadoria e regra textual de preparações integradas.

`8d304b3` melhorou o prompt ao distinguir componentes separados de lasanha/pizza/feijoada/estrogonofe, mas o schema continuou sem papel estrutural. A deduplicação também continuou sem usar essa distinção. O hotfix preserva os ganhos de todos esses commits e corrige a lacuna de contrato/pós-processamento.

## Pipeline antes

1. Uma chamada de visão para a foto completa.
2. Resposta com `name`, `preparation`, `visibleDetails`, `confidence` e `alternative`.
3. Deduplicação por qualquer interseção de identidade e preparo compatível.
4. Recuperação e matching TBCA locais.
5. Até três candidatos e revisão com `MeasureInput`.
6. Carne genérica reutilizava `ASK_IDENTITY` e podia expor candidatos de famílias misturadas.

## Pipeline depois

1. Uma chamada normal de visão para a foto completa.
2. Varredura component-first e resposta estruturada com papel e ambiguidade de identidade.
3. Deduplicação exige o mesmo papel estrutural, preparo compatível e similaridade Jaccard de identidade de pelo menos 0,67.
4. Matching TBCA permanece totalmente local e limitado a três candidatos.
5. Variantes cuja diferença é latente são agrupadas antes da diversidade de candidatos.
6. Carne genericamente identificada, ou família contradita pela alternativa do próprio modelo, entra em `ASK_MEAT_FAMILY`.
7. A resposta Frango/Porco/Carne bovina refina a detecção e executa somente recuperação/matching locais, sem nova chamada de visão.
8. A UI usa um nome de reconhecimento humanizado, preservando internamente o registro TBCA e os nutrientes originais.

## Prompt visual antes

O prompt publicado dizia, em essência:

```text
Identifique separadamente apenas os alimentos realmente visíveis.
Quando componentes estiverem visualmente separados, retorne um item por componente;
quando for claramente uma preparação única, retorne um item.
Não invente espécie, corte, sal, óleo ou ingredientes internos.
```

Ele não obrigava uma varredura antes de nomear o prato, não explicitava componentes parcialmente cobertos/sobrepostos e não registrava a decisão estrutural no schema.

## Prompt visual final

O prompt final é curto e orientado por regras gerais:

```text
Identifique somente alimentos com evidência visual e nunca complete culturalmente a refeição.
Faça primeiro uma varredura do prato inteiro, componente por componente.
Separe unidades nutricionalmente registráveis mesmo quando cobertas, misturadas ou com molho.
Massa com molho aderido pode ser um item; carne visualmente separada continua outro.
Mantenha unidas somente preparações estruturalmente integradas.
Não infira ingredientes internos, sal, óleo, marca, processo, espécie ou corte sem evidência.
Use ASK de família quando a carne for realmente indistinguível.
```

Também orienta registrar apresentação visível (`desfiado`, `em cubos`, `fatiado`) em `preparation` e cor visual do molho sem inventar o ingrediente.

## Schema

Cada item agora contém:

```ts
{
  name: string;
  preparation: string | null;
  visibleDetails: string[];
  confidence: number;
  alternative: string | null;
  componentRole: "independent" | "integrated-preparation";
  identityAmbiguity: "meat_family" | "food_identity" | null;
}
```

Não há `foodId`, código TBCA, quantidade nem nutrientes na saída visual.

## Regra component-first

- componente distinguível e registrável: item independente;
- molho aderido: atributo/preparo do alimento principal quando útil;
- carne/pedaços/fibras visíveis sobre massa: item independente;
- omelete, lasanha, pizza, feijoada, estrogonofe, purê, bolo e sopa homogênea: preparação integrada;
- nenhum alimento é adicionado para “completar” uma refeição típica.

## Deduplicação

Antes, uma interseção de identidade podia bastar. Agora a união só ocorre quando:

- `componentRole` é igual;
- o preparo é compatível;
- a sobreposição entre identidades é forte (Jaccard >= 0,67).

Os testes preservam `frango` + `frango desfiado` como duplicata, mas mantêm separados feijão/omelete/pepino, massa/frango e `massa com molho e carne`/`carne`.

## Carne / ASK_MEAT_FAMILY

O novo estado de API/UI é `ASK_MEAT_FAMILY`. Ele é usado quando a espécie é genérica ou quando o modelo retorna famílias conflitantes entre identidade principal e alternativa.

A interface pergunta `Que tipo de carne é?` com as opções:

- Frango;
- Porco;
- Carne bovina.

O endpoint `/api/foods/recognize/meat-family` valida a análise, refina somente a família e rematcheia localmente. O resultado tem no máximo três candidatos e é filtrado integralmente para a família escolhida. Para compatibilidade com o constraint histórico do banco, a telemetria persiste esse estado como o estado legado `ASK_IDENTITY`; nenhuma migration ou dado histórico foi alterado.

## Sal

`com sal` e `sem sal` são atributos latentes. Eles não participam como identidades visuais concorrentes, não ocupam duas vagas e são removidos do título apresentado no fluxo de foto. Não existe fallback `salt_default`.

## Óleo

`com óleo`, `sem óleo` e `sem gordura` seguem a mesma regra de identidade latente. O sistema não inventa presença de óleo e não transforma essa diferença em múltiplos candidatos visuais. Nenhuma pergunta global sobre óleo foi adicionada; a necessidade nutricional dessa pergunta continua como decisão futura e específica.

## Canonicalização de variantes invisíveis

As assinaturas latentes removem sal, óleo/gordura e UHT/pasteurização. Dentro de cada assinatura o representante é escolhido deterministicamente por:

1. menos atributos latentes;
2. prioridade de curadoria;
3. score de curadoria;
4. score do matcher;
5. `source_code`.

O rótulo de reconhecimento também remove detalhes parentéticos e qualificadores latentes. IDs, `source_code` e nutrientes do representante não são modificados.

## Golden case IMAGE 1

Arquivo local: `imagem 1.jpeg`

SHA-256: `6b5a8d3bf06de48e645f82f355df7041e5dfaa557805014fe5bcf4d109e0c2d0`

### Antes

- visão: feijão, omelete, pepino;
- arroz: ausente;
- matcher: feijão `ASK_ATTRIBUTE` com BRC0001T/BRC0008T/BRC0003T; omelete `NO_EXACT_TBCA_MATCH`; pepino BRC0030B;
- total: 5.136,6 ms; visão 5.004,3 ms; recuperação 83,8 ms; matcher 45,5 ms;
- tokens: 1.255 (1.135 entrada, 120 saída).

### Depois

- visão: feijão `independent`, omelete `integrated-preparation`, pepino `independent`;
- arroz e arroz com feijão: ausentes;
- matcher: feijão continua conservador com três variedades, omelete não força receita TBCA inexistente, pepino seleciona BRC0030B;
- total: 3.040,0 ms; visão 2.903,2 ms; recuperação 67,2 ms; matcher 63,0 ms;
- tokens: 1.396 (1.234 entrada, 162 saída).

Resultado: aprovado.

## Golden case IMAGE 2

Arquivo local: `imagem 2.jpeg`

SHA-256: `ce9cf4f142741f5cbcacd40f800a50bc05f5ee11d1dec2aa80f6e7c316633df5`

### Antes

- visão: um único item `massa com molho e carne`, alternativa `talharim à bolonhesa`;
- decomposição: falhou;
- matcher: zero candidato defensável;
- total: 2.661,7 ms; visão 2.656,1 ms; recuperação 2,9 ms; matcher 1,6 ms;
- tokens: 1.203 (1.135 entrada, 68 saída).

### Depois

- visão: `massa` com `molho marrom-avermelhado` e uma carne fibrosa em pedaços, em dois componentes independentes;
- o modelo oscilou entre família principal e alternativa (`carne suína` versus `frango`), portanto o pós-processamento classificou corretamente como `ASK_MEAT_FAMILY` em vez de aceitar a espécie contraditória;
- com a resposta local `Frango`, o rematch retornou somente BRC0114F, BRC0194F e BRC0113F;
- nenhum candidato bovino ou suíno permaneceu depois da resposta;
- total: 3.012,9 ms; visão 2.845,0 ms; recuperação 30,6 ms; matcher 42,6 ms;
- tokens: 1.350 (1.234 entrada, 116 saída).

Resultado: aprovado pelo caminho seguro previsto na especificação: componente de carne separado, molho avermelhado preservado, confirmação de família e rematch exclusivamente local. A visão não afirmou frango com segurança nesta execução; o usuário fornece essa informação antes da escolha TBCA.

## Testes

- backend completo: 14 arquivos aprovados, 4 condicionais ignorados; 179 testes aprovados, 19 condicionais ignorados;
- frontend completo: 4 arquivos e 17 testes aprovados;
- matcher/recognition direcionados: 73 testes aprovados;
- lifecycle da foto: incluído na suíte frontend aprovada;
- confirmação UI de família e rótulo humanizado: 2 testes aprovados;
- medidas PostgreSQL transacionais: 1 teste aprovado;
- smoke local de API do Diário, medidas caseiras, mL, edição, cópia e snapshots: aprovado ao ignorar temporariamente uma asserção antiga e não relacionada sobre a presença de `Lanche brasileiro` na busca por leite integral; o arquivo de teste foi restaurado sem diff;
- TypeScript backend, frontend, runner real e replay: aprovado;
- lint: aprovado;
- build: aprovado;
- `git diff --check`: aprovado.

Warning do build: chunks acima de 500 kB, já existente e não causado por esta feature. Warning de teste: a asserção de abrangência `Lanche brasileiro` falha na curadoria atual antes dos checks de mL; o fluxo de medidas/Diário passa quando essa asserção externa é desconsiderada.

## Chamadas reais

Provider: OpenAI Responses

Modelo: `gpt-5.6-luna`

Detail: `high`
Esforço final: `none`

Foram feitas 12 chamadas no total durante a investigação: baseline e cinco rodadas pós-ajuste, sempre uma chamada por foto e nunca uma chamada por item. Uma rodada comparativa usou esforço `low`; não houve ganho suficiente, e o hotfix manteve `none`. O provider não retornou custo monetário; tokens e latências estão preservados nos JSONs locais ignorados em `.codex-local/food-photo-recognition-v2/`.

## Performance

Na rodada final:

- IMAGE 1: visão 2.903,2 ms; recuperação 67,2 ms; matcher 63,0 ms; total 3.040,0 ms;
- IMAGE 2: visão 2.845,0 ms; recuperação 30,6 ms; matcher 42,6 ms; total 3.012,9 ms.

Não foi adicionada chamada visual normal, reranker por item ou busca externa. A escolha da família é local.

## Integridade da base e histórico

- TBCA: 5.874 ativos;
- medidas: 8.316;
- fingerprint da curadoria: `a58aea2476121a6d2aef9b4140f416759b2edda3735b6f42471654e32510d108`;
- fingerprint das medidas: `7d7dd61b1b51a5352299d739c1dde9bed8d080beca2d64556a184cd3d5742f59`;
- fingerprint de identidade das medidas: `3705f681ca9ef0dac9fdf133cc256396e4f3047725abe0b16cef500d7fd25a4e`;
- fingerprint do histórico: `0a41cae916dbf37dc44aa2f6ffda83887bb2f3b848dda70c1e8aaf7d1d17a132`;
- fingerprint de nutrientes: `7c663b29885bff52dda27adf5d295126b67d68dbb79ea7965d011845ac0f55db`.

Nenhum arquivo de curadoria, nutriente, migration, medida, histórico, snapshot, service worker, bootstrap ou Nginx foi modificado.

## Arquivos modificados

- `shared/food-recognition.ts`;
- `services/food-vision/server.ts`;
- `backend/food-recognition.ts`;
- `backend/index.ts`;
- `backend/food-recognition.test.ts`;
- `backend/food-matcher-tbca.test.ts`;
- `frontend/app/components/food-photo-review.tsx`;
- `frontend/app/types.ts`;
- `frontend/lib/food-photo-recognition.ts`;
- `frontend/lib/food-photo-recognition.test.ts`;
- `tests/food-vision-real/run-real.ts`;
- `tests/food-vision-benchmark/replay-current-matcher.ts`;
- `package.json`;
- este relatório.

As fotos reais e o manifesto local permanecem fora do Git.

## Riscos restantes

- O provedor continua probabilístico. Nas rodadas reais, ele isolou consistentemente a carne depois do novo prompt, mas nem sempre sustentou corretamente a família. O fluxo de contradição para `ASK_MEAT_FAMILY` impede a seleção silenciosa nos casos observados. Uma família errada sem alternativa conflitante ainda depende da confiança visual do provedor e da correção manual disponível na UI.
- A TBCA não possui um equivalente simples e não composto para toda omelete visível; o matcher continua abstendo em vez de inventar ingredientes.
- Alguns `friendly_name` da curadoria global ainda são técnicos. O hotfix humaniza o fluxo de foto sem recurar os 5.874 registros.
- O fallback opcional de segunda chamada não foi implementado: o novo prompt já produz dois componentes na IMAGE 2, portanto a condição restrita prevista (apenas um item composto recorrente) deixou de existir.
- A tela foi validada por TypeScript, build e testes de utilidade/fluxo; não foi feito um ensaio visual manual autenticado em navegador nesta branch.
