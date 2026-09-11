# Reconhecimento semântico de alimentos por foto

## Responsabilidades e fluxo

O fluxo do produto usa uma única inferência visual:

`foto sanitizada → detecção visual estruturada → matcher local TBCA → confirmação → MeasureInput → diário`.

A visão responde somente “o que parece existir na imagem?”. O matcher responde “quais registros TBCA representam melhor essa identificação?”. O modelo não recebe o catálogo e não produz código, `foodId`, nutrientes ou quantidade.

O frontend envia JPEG, PNG ou WebP para `POST /api/foods/recognize`. O backend autentica, limita o upload e o encaminha pelo loopback para `POST /recognize` no gateway privado em `127.0.0.1:11435`. O gateway valida, redimensiona, regrava a imagem sem metadados e só então chama o provedor visual. Isso evita uma segunda decodificação idêntica no backend público. O gateway retorna Structured Output compatível com:

```json
{
  "items": [
    {
      "name": "peito de frango",
      "preparation": "grelhado",
      "visibleDetails": ["sem pele"],
      "confidence": 0.91,
      "alternative": null
    }
  ]
}
```

`confidence` é somente a confiança visual (`visionConfidence`). Quantidade e medida permanecem vazias até a confirmação do paciente. Componentes visualmente separados viram itens separados; preparações únicas reconhecíveis, como lasanha ou feijoada, permanecem um item.

## Recuperação e matching TBCA

`backend/food-identity-repository.ts` recupera uma família limitada de alimentos TBCA ativos usando os índices e campos normalizados do PostgreSQL. A consulta usa nome amigável, aliases, prioridade `common/useful/specific`, `priority_score`, similaridade e código estável.

`shared/food-recognition.ts` então calcula `matchConfidence` local e deterministicamente. O score considera:

- identidade alimentar: peso 0,34;
- nome amigável/alias/descrição: peso 0,22, com bônus para nome amigável ou alias exato;
- preparo: peso 0,10;
- atributos visíveis: peso 0,08, com reforço para polaridades como `com pele`/`sem pele`;
- alimento como identidade principal: bônus 0,05;
- prioridade, score, categoria e confiança da curadoria;
- penalidades por receita não observada, ingredientes acrescentados, subtipo não observado e contradições de preparo, variedade, pele ou osso.

Os sinais da curadoria desempataram representantes comuns sem substituir evidência semântica. Nutrientes, IDs, códigos e medidas não participam do score e não são alterados.

## Regra de candidatos

O matcher ranqueia internamente até 24 registros para poder eliminar equivalentes antes da resposta. A interface recebe no máximo três:

- `AUTOSELECT`: `matchConfidence >= 0,86`, margem para a próxima alternativa distinta `>= 0,08`, `visionConfidence >= 0,65`, nenhuma contradição e nenhum atributo material invisível; retorna uma opção;
- `ASK_ATTRIBUTE`: existe correspondência suficiente, mas há variação real de preparo, espécie, variedade, corte ou outro atributo; retorna uma a três opções;
- `ASK_IDENTITY`: carne fragmentada não sustenta corte/tipo automático; retorna no máximo três opções;
- `NO_EXACT_TBCA_MATCH`: a preparação reconhecida exigiria ingredientes internos que a imagem não permite resolver; não expõe candidato e segue para busca manual;
- `NO_MATCH`: melhor score abaixo de 0,46; não força candidato e abre caminho para busca manual.

Somente candidatos com diferença máxima de 0,16 para o primeiro e sem contradição adicional permanecem elegíveis. A deduplicação agrupa variantes que diferem apenas por procedência, amostra, processamento invisível ou detalhes técnicos. Para leite genérico, por exemplo, UHT e pasteurizado integrais formam uma família; as opções úteis são integral, desnatado e semidesnatado. Para peixe genérico, as opções são diversificadas por espécie.

O limite `candidates.length <= 3` é aplicado na função pura, novamente no endpoint e coberto por testes de catálogo completo. O backend do produto não chama `/rerank`; dúvidas são resolvidas pelo paciente, sem uma chamada adicional de IA por alimento.

## Confirmação, medidas e salvamento

Alta confiança mostra o alimento preselecionado, quantidade, medida e `Trocar alimento`. Ambiguidade mostra `Pode ser:` e até três opções, além de `Nenhum desses / Buscar outro`.

Depois da escolha, o frontend carrega `GET /api/foods/:foodId/measures` e reutiliza `MeasureInput`. Gramas são o fallback; medidas caseiras, contagem e mL aparecem somente quando existem para o `foodId`. Trocar o alimento zera a quantidade anterior e carrega as medidas do novo registro.

O diário recebe somente o `foodId` confirmado, a quantidade digitada e o `measureId`. O reconhecimento nunca estima gramas a partir da foto.

## Modelo, privacidade e telemetria

A configuração local aprovada usa `gpt-5.6-luna` pelo adaptador OpenAI Responses, `reasoning.effort=none`, detalhe de imagem `high`, `store=false`, Structured Outputs estrito e até 900 tokens de saída. Outros provedores continuam disponíveis no gateway por configuração.

Fotos são normalizadas e têm metadados removidos; não são persistidas nem registradas em logs. `NUTRI_VISION_DEBUG_MATCHING=true` habilita somente logs locais de rótulo, códigos candidatos, scores, estado e seleção. A imagem não entra no log.

As tabelas existentes preservam modelo, esforço, tokens, latência, decisão, scores e IDs previsto/final. Os campos históricos de rerank permanecem compatíveis, mas ficam zerados no fluxo atual de uma chamada.

## Validação

Os testes determinísticos carregam os 5.874 itens do artefato de curadoria junto da descrição original TBCA. Eles cobrem alimentos comuns, aliases, preparo, atributos, fallback, ambiguidades, exclusão de receitas e o teto de três opções.

O benchmark antigo de 200 imagens deve permanecer apenas como evidência histórica: a auditoria encontrou associações imagem-rótulo inválidas em 71/200 casos. Não se deve calibrar score ou thresholds com esse conjunto até a revisão dos pares. Fixtures e predições preservadas podem ser usadas para replay offline, sem nova chamada de IA.
