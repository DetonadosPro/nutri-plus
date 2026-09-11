# Investigação do crash móvel no reconhecimento por foto — 2026-09-11

## Resumo executivo

O defeito não estava no reconhecimento de IA nem no matcher TBCA. A causa era a combinação de retenção do `File` original entre montagens do fluxo e pressão de memória durante a segunda preparação de imagem.

Antes da correção, a foto iniciada pelo botão central permanecia em `PatientApp.cameraCapture`. Ao sair da revisão e entrar novamente em **Reconhecer por foto**, um novo `FoodPhotoReview` recebia o mesmo `File`, o ref local de deduplicação começava vazio e a foto anterior era analisada outra vez sem nova seleção. Ao mesmo tempo, a preparação da próxima foto mantinha o preview anterior vivo, decodificava o arquivo novo em resolução integral e deixava a liberação do `<img>` e do canvas para o coletor de lixo.

A correção libera a referência original assim que ela é consumida, revoga o preview antes de decodificar a próxima foto, reduz imagens grandes durante `createImageBitmap`, fecha o bitmap, zera o canvas, invalida sessões antigas e aborta a requisição ao sair.

## Pipeline anterior

1. `PatientApp.openCamera()` acionava um `<input type="file" accept="image/*" capture="environment">` persistente.
2. O `change` guardava `{ file, token }` em `PatientApp.cameraCapture` e abria `FoodEntrySheet`.
3. `FoodEntrySheet` ativava `photoMode` sempre que recebia `initialPhoto`.
4. `FoodPhotoReview` detectava `initialPhoto` em um effect e chamava `analyze(initialPhoto.file)`.
5. `optimizeFoodPhoto()`:
   - criava uma Object URL temporária do arquivo original;
   - carregava a foto em `HTMLImageElement`, decodificando a resolução integral;
   - criava canvas de até 768 px;
   - desenhava a imagem e gerava JPEG com `canvas.toBlob()`;
   - podia escolher novamente o arquivo original se ele tivesse menos bytes que o JPEG reduzido.
6. `FoodPhotoReview` criava uma segunda Object URL, agora para o preview/upload escolhido.
7. O `File` ou Blob era enviado diretamente no `POST /api/foods/recognize`.
8. O backend normalizava orientação/metadata com Sharp, fazia uma chamada visual e executava o matcher TBCA local.
9. A tela mantinha apenas o resultado estruturado, alimentos TBCA e quantidades; não existia histórico global de imagens.
10. Ao trocar o preview, a URL anterior era revogada somente no cleanup do effect disparado depois do novo render.
11. Ao desmontar `FoodPhotoReview`, a requisição era abortada e a Object URL do preview era revogada.
12. O `File` original no estado de `PatientApp` só era limpo em alguns fechamentos do sheet.

### Componentes e funções envolvidos

| Etapa | Arquivo | Elemento |
| --- | --- | --- |
| Captura inicial móvel | `frontend/app/components/patient-app.tsx` | `cameraInput`, `openCamera`, `cameraCapture` |
| Sheet persistente | `frontend/app/components/food-entry-sheet.tsx` | `photoMode`, `initialPhoto`, `reset`, `close` |
| Captura/galeria durante revisão | `frontend/app/components/food-photo-review.tsx` | inputs `camera` e `gallery`, `analyze` |
| Resize e compressão | `frontend/lib/food-photo.ts` | `loadImage`, `optimizeFoodPhoto` |
| Preview | `frontend/app/components/food-photo-review.tsx` | estado `preview`, `<Image>` |
| Upload | `frontend/lib/client-api.ts` | `api()`/`fetch` com body Blob/File |
| Normalização do servidor | `backend/photo-image.ts` | `normalizePhoto`/Sharp |
| Reconhecimento e matching | `backend/index.ts`, `backend/food-recognition.ts` | rota `/foods/recognize` |
| Revisão e medidas | `food-photo-review.tsx` | candidatos, `MeasureInput` |

Não existe `getUserMedia`, `MediaStream`, `FileReader`, base64, `toDataURL`, cache de imagens de reconhecimento ou store global de previews. A câmera nativa é aberta exclusivamente pelo atributo `capture` do input.

## Sintoma reproduzido antes da correção

Ambiente: build local servido por HTTPS, navegador Chromium do Codex, viewport 390 × 844, imagem sintética não pessoal.

Sequência reproduzida:

1. abrir o diário;
2. acionar **Fotografar alimento**;
3. selecionar uma imagem;
4. aguardar o término da tentativa de reconhecimento;
5. clicar em **Busca manual**;
6. clicar em **Reconhecer por foto** sem selecionar outro arquivo.

Resultado anterior: o preview antigo reapareceu e o componente voltou a processar o mesmo `initialPhoto`. A evidência de código era o novo mount zerar `analyzedInitialPhoto`, seguido pelo effect que chamava novamente `analyze(initialPhoto.file)`. A evidência visível foi a foto anterior reaparecer sem um novo evento de seleção.

O fechamento do processo móvel por OOM não pôde ser reproduzido em hardware Android/iOS neste ambiente. Esse tipo de encerramento também pode não produzir `window.onerror`, stack ou `unhandledrejection`.

## Causa raiz

### 1. `File` original sobrevivia ao ciclo

`PatientApp.cameraCapture` armazenava o arquivo de câmera. O valor era apagado quando `onOpenChange(false)` era chamado, mas não quando a foto já tinha sido entregue ao otimizador. Em um fechamento programático após salvar, `setAddOpen(false)` também não passava pelo callback que limpava `cameraCapture`.

Consequências:

- o JPEG original, que pode ter vários megabytes, permanecia referenciado;
- remontar a revisão reutilizava o mesmo token em uma nova instância e disparava outra análise;
- uma foto anterior podia coexistir com a próxima captura e com as superfícies de decodificação.

### 2. O preview anterior permanecia vivo durante a próxima decodificação

A URL do preview só era revogada depois de `setPreview(newUrl)`. Portanto, `optimizeFoodPhoto()` terminava toda a decodificação e o resize da nova foto enquanto o `<img>` anterior continuava montado.

### 3. Superfícies grandes dependiam exclusivamente de GC

O caminho anterior criava um `HTMLImageElement` com a foto integral e um canvas. Ao terminar, revogava a URL de carregamento, mas não limpava `image.src`, não zerava o canvas e não possuía um `ImageBitmap.close()` determinístico.

Revogar a Object URL impede novos acessos ao Blob, mas não obriga o navegador a descartar imediatamente a superfície já decodificada.

### 4. O critério de reutilização considerava bytes, não pixels

Depois de reduzir a foto, o código podia retornar o arquivo original quando `file.size <= compressed.size`. Uma imagem muito comprimida, mas com muitos megapixels, ainda poderia ser usada no preview e no upload. O tamanho JPEG/WebP em disco não representa o custo RGBA da decodificação.

## Estimativa de memória anterior

Uma foto 4000 × 3000 ocupa aproximadamente:

`4000 × 3000 × 4 = 48.000.000 bytes`, cerca de 45,8 MiB, somente para uma superfície RGBA.

Uma foto 8000 × 6000 ocupa aproximadamente:

`8000 × 6000 × 4 = 192.000.000 bytes`, cerca de 183,1 MiB.

No segundo ciclo, o pico anterior incluía:

- `File` original anterior no estado pai: até 20 MB codificados;
- preview anterior decodificado: normalmente cerca de 1,7 MiB, mas até 183,1 MiB se o original de 48 MP fosse reutilizado;
- arquivo original novo;
- decodificação integral nova: até 183,1 MiB;
- canvas 768 × 576: cerca de 1,7 MiB;
- Blob JPEG novo e buffers internos do encoder/fetch.

O caso desfavorável com dois previews/fontes integrais de 48 MP ultrapassava 366 MiB apenas em superfícies RGBA, sem contar processo, DOM, GPU, encoder e buffers. Isso é compatível com encerramento do renderer/PWA sob pressão de memória.

## Correção implementada

### Lifecycle e referências

- `PatientApp` agora remove `cameraCapture` quando o token é consumido e também antes do fechamento programático após salvar.
- Limpar `initialPhoto` não desativa `photoMode` durante a análise atual.
- Reentrar em **Reconhecer por foto** começa vazio; não remonta a foto anterior.
- O input é zerado antes do trabalho assíncrono, permitindo inclusive selecionar novamente o mesmo arquivo.

### Preview e memória

- A Object URL vigente é revogada antes de iniciar outra análise.
- A URL também é revogada ao voltar, salvar e desmontar.
- Dimensões JPEG/PNG/WebP são lidas de até 1 MiB do cabeçalho, sem decodificar os pixels.
- Em navegadores com `createImageBitmap`, imagens maiores que 768 px são decodificadas já com alvo reduzido.
- O `ImageBitmap` é fechado no `finally`.
- O fallback remove `src` e handlers do `HTMLImageElement`.
- O canvas é limpo e reduzido para 1 × 1 no `finally`.
- O arquivo original só pode ser reutilizado quando a própria imagem tem no máximo 768 px.
- O limite de origem continua sendo 20 MB e passou a existir limite defensivo de 64 MP.
- Sem `createImageBitmap`, o fallback aceita até 24 MP; acima disso retorna erro controlado para não arriscar OOM. Fotos de 12 MP continuam aceitas.

### Concorrência e cancelamento

`PhotoAnalysisGate` atribui um ID monotônico a cada sessão:

- iniciar outra análise aborta a anterior;
- somente a sessão atual pode alterar a UI;
- voltar ou desmontar aborta a sessão;
- uma resposta antiga é ignorada;
- o timeout pertence à sessão e é sempre removido.

Teste de cancelamento no navegador: a sessão 12 iniciou a leitura de uma imagem de 48 MP e o sheet foi fechado antes do fim da decodificação. O log registrou `cleanup start`, a decodificação concluída já abortada e `decode surfaces released`; não houve preview, upload, atualização tardia nem erro não capturado.

## Instrumentação

Use `?photoDebug=1` na URL ou, no console de desenvolvimento, `localStorage.setItem('nutri:photo-debug', '1')`.

Os logs incluem somente:

- ID da sessão;
- eventos de mount/unmount e lifecycle;
- origem câmera/galeria;
- tipo, bytes e dimensões;
- caminho de decodificação;
- criação/revogação do preview;
- início/fim/aborto da requisição;
- heap JavaScript quando `performance.memory` existe.

Nenhuma imagem, nome de arquivo, paciente, alimento ou conteúdo pessoal é logado. O histórico em memória é limitado a 250 eventos em `window.__NUTRI_PHOTO_DIAGNOSTICS__`.

São observados, sem cleanup destrutivo, `visibilitychange`, `pagehide`, `pageshow`, `focus`, `blur`, `error` e `unhandledrejection`. Isso permite distinguir a abertura da câmera nativa do retorno do arquivo.

## Evidências depois da correção

### Viewport móvel simulado

Foram executados 10 ciclos no viewport 390 × 844:

- ciclos 1 e 2: abrir, selecionar, aguardar, fechar e abrir novamente;
- ciclos 3 a 10: manter a revisão montada e acionar **Nova foto** repetidamente;
- alternância entre JPEGs sintéticos de 12 MP (4000 × 3000) e 48 MP (8000 × 6000).

Resultado:

- 10/10 sessões concluíram a preparação;
- todas usaram `ImageBitmap resized`;
- todas produziram somente um preview 768 × 576;
- todas registraram `decode surfaces released`;
- nenhum loading permaneceu preso;
- zero `window error` e zero `unhandledrejection`;
- nenhuma foto anterior reapareceu após voltar e reentrar.

Heap JavaScript após cada sessão, em bytes:

`25.285.548, 16.848.286, 16.872.478, 18.752.949, 17.013.755, 18.798.197, 18.512.689, 20.708.687, 18.518.687, 17.935.201`

Intervalo: 16,8–25,3 MB. Valor final: 17,9 MB. Não houve crescimento monotônico.

`performance.memory` mede heap JavaScript e não inclui toda a memória nativa/GPU de imagens. A evidência complementar é o uso do decode reduzido, o fechamento explícito do bitmap e a liberação registrada em todas as sessões.

### Desktop

Foram feitos 10 uploads consecutivos da imagem sintética `food-008.png`, usando a primeira abertura e depois **Nova foto**. Resultado: 10/10 com um único preview, sem crash, congelamento ou loading preso.

### Galeria versus câmera

Os dois inputs foram exercitados com seleção automatizada. A automação consegue simular o retorno de arquivo, mas não a interface nativa da câmera. O lifecycle real de Chrome Android, PWA instalada e Safari/iOS continua exigindo verificação em aparelho.

### Provedor

O gateway visual local respondeu com a mensagem de indisponibilidade durante estes testes. Isso permitiu estressar o caminho de arquivo, resize, preview, request, erro, retorno e cleanup sem custo repetido, mas não validou uma resposta de IA bem-sucedida nesta execução. O matcher e a tela de medidas foram cobertos pelas suítes existentes e não foram alterados por esta correção.

## PWA e service worker

O projeto registra `/sw.js` e possui manifest instalável. A auditoria do worker mostrou:

- requisições não `GET` são ignoradas;
- caminhos `/api/` são ignorados;
- navegação e assets usam rede primeiro, com cache apenas como fallback;
- o worker não lê, clona nem mantém o Blob enviado ao reconhecimento.

Portanto, o service worker não participa do `POST /foods/recognize` e não explica a retenção reproduzida. Uma PWA antiga/offline ainda pode carregar um bundle em cache, mas não foi encontrada relação causal com este crash e nenhum cache foi apagado.

## Matriz de reprodução e validação

| Fluxo | Cobertura nesta execução | Resultado |
| --- | --- | --- |
| A — reconhecer, home, nova foto | Chromium local, 2 ciclos 12/48 MP | passou após correção |
| B — reconhecer, voltar à captura, outra foto | remount e 8 trocas no mesmo sheet | passou; foto velha não voltou |
| C — confirmar alimento, voltar, nova foto | lifecycle de save auditado; provedor indisponível | preview e `File` são limpos no save; validação visual pendente |
| D — cancelar, nova foto | fechamento durante decode de 48 MP | passou; sessão abortada e superfície liberada |
| E — galeria, voltar, outra | input de galeria e retorno exercitados | passou no Chromium |
| F — 5–10 fotos seguidas | 10 móvel simulado + 10 desktop | passou |
| Chrome Android aba/PWA | não havia aparelho conectado | checklist manual pendente |
| Safari/iOS | não havia aparelho conectado | checklist manual pendente |

## Testes automatizados

`frontend/lib/food-photo.test.ts` cobre:

- leitura de dimensões sem decode integral;
- resize de 48 MP para 768 × 576;
- proibição de reutilizar original grande por tamanho em bytes;
- cancelamento da análise anterior;
- invalidação de resultado antigo;
- dez sessões mantendo somente a atual;
- revogação de Object URL na troca e no dispose;
- reset do file input.
- orientação EXIF aplicada antes do cálculo do alvo de resize.

O teste de câmera nativa permanece necessariamente manual.

## Checklist manual em aparelho

Executar separadamente em Chrome Android como aba, PWA instalada e Safari/iOS suportado:

1. ativar `photoDebug=1`;
2. capturar e reconhecer uma foto;
3. voltar à home e repetir 10 vezes;
4. repetir 10 vezes usando **Nova foto** sem fechar o sheet;
5. repetir com galeria;
6. cancelar o picker e confirmar que o fluxo permanece utilizável;
7. fechar durante resize e durante upload;
8. selecionar a mesma foto duas vezes;
9. alternar rapidamente entre câmera e galeria;
10. verificar nos logs uma sessão por arquivo, uma liberação de superfícies por sessão e revogação do preview nas saídas.

Se houver DevTools remoto, capturar o perfil de memória nativa/processo, pois o heap JS isoladamente não mede bitmaps/GPU.

## Integridade

Esta correção não modificou:

- matcher TBCA, scores ou limite de candidatos;
- curadoria e aliases;
- TBCA/TACO, nutrientes ou IDs;
- migrations;
- medidas ou `MeasureInput`;
- registros de diário ou snapshots históricos.

Arquivos funcionais alterados nesta investigação:

- `frontend/app/components/patient-app.tsx`;
- `frontend/app/components/food-entry-sheet.tsx`;
- `frontend/app/components/food-photo-review.tsx`;
- `frontend/lib/food-photo.ts`;
- `frontend/lib/photo-session.ts`;
- `frontend/lib/food-photo.test.ts`;
- `frontend/vitest.config.ts`;
- `frontend/package.json`.

### Validações finais

- Backend: 172 testes passaram; 19 testes condicionais preexistentes foram ignorados.
- Lifecycle de foto: 8 testes passaram.
- TypeScript backend: aprovado.
- TypeScript frontend: aprovado.
- Lint: aprovado.
- Build Vinext: aprovado.
- `git diff --check`: aprovado para arquivos rastreados e novos arquivos da feature.
- Curadoria: 5.874/5.874 alimentos classificados; fingerprint `a58aea2476121a6d2aef9b4140f416759b2edda3735b6f42471654e32510d108`.
- Medidas: 8.316; fingerprint de identidade `3705f681ca9ef0dac9fdf133cc256396e4f3047725abe0b16cef500d7fd25a4e`.
- Histórico: 37 lançamentos, 4.244 g, zero snapshots; fingerprint `0a41cae916dbf37dc44aa2f6ffda83887bb2f3b848dda70c1e8aaf7d1d17a132`.

Warnings não bloqueantes do build: chunks acima de 500 kB, tempo de plugins e rota não classificada estaticamente pelo Vinext. O Git também informa a conversão futura LF/CRLF no Windows; nenhuma falha de whitespace foi encontrada.

## Deploy

Nenhum commit, push ou deploy foi realizado.
