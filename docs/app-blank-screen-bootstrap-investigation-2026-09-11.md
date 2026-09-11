# Investigação do bootstrap e da tela branca do Nutri+

Data: 11 de setembro de 2026

Escopo: primeira navegação até a primeira interface útil

Estado: correção implementada e validada localmente; não publicada

## Sintoma

Em alguns computadores e celulares, a abertura do domínio não chegava ao login nem à interface autenticada. O navegador podia permanecer em branco ou no skeleton `Carregando Nutri+` indefinidamente. O problema acontecia antes de qualquer regra de paciente, perfil ou diário.

A investigação separou quatro classes de falha:

1. o servidor não entrega o documento;
2. o documento chega, mas um asset obrigatório não carrega;
3. o JavaScript carrega, mas React não monta ou lança erro;
4. React monta, mas a verificação inicial de sessão nunca termina.

Antes desta correção, as classes 2, 3 e 4 podiam terminar sem uma interface recuperável.

## Pipeline de inicialização

O fluxo observado é:

```text
navegador
  -> DNS A 52.67.254.0
  -> HTTPS / Nginx na Lightsail
  -> frontend Vinext em 127.0.0.1:3002
  -> HTML SSR
  -> três módulos iniciais assíncronos
  -> runtime React/Vinext
  -> RootLayout
  -> BootErrorBoundary, PwaRegister, LargeScreenScale e Toaster
  -> HomePage
  -> GET /api/auth/me
  -> login, fluxo de conta ou bundle lazy do perfil autenticado
  -> primeira interface útil
```

No build local final, o HTML tinha 28.119 bytes e continha o build ID em `<meta name="nutri-build-id">`. Os três módulos diretamente referenciados pelo documento eram:

- `rolldown-runtime-*.js`, `type="module"`, assíncrono;
- `framework-*.js`, `type="module"`, assíncrono;
- `index-*.js`, `type="module"`, assíncrono.

O documento também referencia chunks estáticos de layout, página, registro PWA, fallback de boot, fontes e CSS. Depois de uma sessão válida, `PatientApp`, `NutritionistApp` ou `AdminApp` é carregado por `React.lazy`; portanto esse chunk também integra o boot autenticado.

A única API necessária antes de decidir a primeira tela é `GET /api/auth/me`. Fluxos com `verify` ou `reset` na URL exibem a tela de conta antes dessa consulta. O frontend não precisa do restante das APIs de diário para mostrar a primeira interface.

## Hipóteses investigadas

### Service worker misturando gerações

Evidência: o `/sw.js` anterior incluía `/` no shell `nutri-app-v4`. Para navegações, tentava a rede e, em qualquer falha, entregava `caches.match('/')`. Para assets não API, fazia network-first e retornava qualquer resposta antiga do mesmo URL quando a rede falhava.

Teste: leitura do worker, inspeção do cache e simulação automatizada do ciclo de instalação/ativação.

Resultado: o caminho que entrega HTML antigo era determinístico. O cache não era identificado pelo commit e seu fallback de navegação não garantia compatibilidade com os chunks ainda existentes no servidor.

Conclusão: **comprovada como falha de arquitetura e causa provável do comportamento entre deploys**.

### HTML e chunks de versões diferentes

Evidência: o frontend publica arquivos com hash, mas o deploy substitui o diretório de build. Logs reais do frontend continham `ENOENT` para chunks anteriores, `Premature close` em CSS/JS e `Failed to find Server Action ... request might be from an older or newer deployment`. Ao mesmo tempo, o service worker podia conservar o HTML anterior.

Teste: todos os módulos obrigatórios foram bloqueados por um proxy de falha. O novo guard, que fica inline no HTML e não depende do bundle React, registrou `asset-error`, consultou o build corrente, tentou uma única recuperação e exibiu o fallback quando a segunda tentativa falhou.

Resultado: fallback visível com botão, sem ciclo infinito. A trava `nutri:boot-recovery:<build>` limitou a recuperação automática a uma tentativa por build na aba.

Conclusão: **fortemente comprovada como causa de telas quebradas logo após deploy**. Os logs e o código antigo formam evidência convergente.

### Consulta de sessão pendurada

Evidência: `HomePage` iniciava com `checking=true` e chamava `api('/auth/me')` sem timeout. O único caminho que removia o skeleton era a resolução ou rejeição da promise.

Teste antes da correção: o frontend da versão anterior foi executado com a porta da API aceitando a conexão e nunca respondendo. Após 15 segundos, `Carregando Nutri+` continuava visível, sem erro e sem botão.

Teste depois da correção: no mesmo cenário, o log chegou a `session-check-complete` por timeout em aproximadamente 10,3 segundos e exibiu `BOOT-SESSION`, `Tentar novamente` e `Recarregar`.

Resultado: reprodução direta do loading infinito e eliminação do estado.

Conclusão: **causa raiz comprovada** e suficiente para explicar ocorrências inclusive em perfil novo.

### Erro JavaScript ou de render antes da primeira UI

Evidência: não existia error boundary global, handler global de `error`/`unhandledrejection` nem fallback independente do React. Uma exceção durante importação, hidratação ou render podia deixar apenas o HTML parcial/skeleton.

Teste: falha de todos os módulos externos e testes unitários dos formatos usuais de `ChunkLoadError`.

Resultado: o script inline permaneceu ativo, mostrou fallback e registrou o estágio técnico. Erros de render dentro da árvore agora são capturados pelo boundary.

Conclusão: **lacuna comprovada**, embora não haja um stack específico que prove que todas as ocorrências de campo partiram de uma exceção React.

### CSS ou MIME incorreto

Evidência: 18 assets do build local foram consultados individualmente. JavaScript respondeu `application/javascript`, CSS respondeu `text/css` e fontes responderam `font/woff2`.

Teste: auditoria dos assets referenciados no HTML e validação de status, corpo e MIME.

Resultado: 18/18 corretos. O stress público da versão ainda publicada encontrou 16/16 corretos.

Conclusão: **descartada como falha permanente atual**. Uma falha transitória durante substituição do build continuava possível e é coberta pela recuperação.

### Suspense global ou provider pendurado

Evidência: o único `Suspense` do boot envolve os aplicativos lazy após uma sessão válida. `PwaRegister` e `LargeScreenScale` usam efeitos síncronos/não bloqueantes; `Toaster` não aguarda rede. Não há layout assíncrono no projeto.

Teste: mapeamento da árvore e marcadores `providers-mounted`, `react-entry`, `session-check-start`, `session-check-complete` e `first-ui-rendered`.

Resultado: em abertura local normal os estágios apareceram, respectivamente, até a primeira UI em 1.884 ms durante compilação dev e 72–571 ms no build de produção local quente.

Conclusão: **providers descartados como bloqueio atual**. O chunk lazy autenticado podia falhar, mas agora está dentro do boundary e da recuperação de chunk.

### Estado local corrompido

Evidência: preferências de navegação e de gráfico usam `JSON.parse` dentro de `try/catch`. A seleção de conta inicial não depende de IndexedDB. O registro PWA era a persistência capaz de afetar o documento antes do React.

Teste: busca de acessos a `localStorage`, `sessionStorage` e IndexedDB, além de abertura com nova URL e novas abas.

Resultado: não foi encontrado IndexedDB no boot. Os parse críticos já têm fallback. Operações de storage do novo mecanismo de recuperação são protegidas; se storage estiver bloqueado, não há reload automático.

Conclusão: **localStorage/IndexedDB descartados como causa principal**. O cache do service worker continua sendo persistência local relevante e foi corrigido.

### Frontend, Nginx ou upstream indisponível

Evidência: Nginx encaminha `/` para `127.0.0.1:3002` e `/api/` para `127.0.0.1:3001`. O log de erro Nginx atual não tinha `upstream timed out`, conexão recusada ou fechamento prematuro. A amostra do access log tinha 195 respostas 200 para a raiz, 97 redirecionamentos canônicos e 14 requests 400; não havia evidência de 5xx na raiz nessa amostra.

Teste: documento público, HTTP para HTTPS, domínio `www`, processos e portas.

Resultado: HTTP redirecionou 301 para HTTPS; HTTPS respondeu 200. Os três processos estavam online e sem `unstable_restarts`.

Conclusão: **descartada como indisponibilidade persistente**, mas reinícios/deploys continuam sendo janelas transitórias. A página offline agora cobre uma navegação já controlada pelo PWA quando o frontend fica inalcançável.

### Falta de memória na Lightsail

Evidência: instância com 1,9 GiB de RAM, aproximadamente 1,0 GiB disponível, swap de 2 GiB com cerca de 207 MiB em uso e disco em 40%. Backend, frontend e visão estavam perto de 60–70 MiB cada.

Teste: `free`, swap, disco, PM2 e journal do kernel desde 1º de setembro.

Resultado: nenhum OOM killer ou processo morto por falta de memória encontrado.

Conclusão: **descartada para o incidente atual**. O uso de swap merece monitoramento, mas não sustentou a hipótese de tela branca.

### DNS e HTTPS

Evidência: DNS resolve `nutriplusapp.store` para `52.67.254.0`. O certificado Let's Encrypt cobre domínio principal, `www`, `pro` e `admin`, válido de 5 de setembro a 4 de dezembro de 2026. A verificação TLS passou.

Teste: resolução DNS, conexão 443, redirecionamentos e certificado.

Resultado: domínio principal 200, HTTP e aliases 301 para o canônico.

Conclusão: **descartada como causa atual**.

## Causa raiz

Há duas causas independentes que produziam o mesmo sintoma:

1. **Promise de sessão sem limite de tempo**: se o request TCP/HTTP ficasse pendurado, React continuava montado, mas `checking=true` mantinha o skeleton para sempre. Essa causa foi reproduzida diretamente e também explica perfil novo.
2. **Cache PWA sem identidade de build e com HTML no shell**: uma instalação anterior podia receber HTML armazenado e solicitar chunks já removidos pelo deploy. Os erros de chunk observados no servidor confirmam que essa incompatibilidade ocorreu em produção.

A ausência de um fallback pré-React e de error boundary amplificava ambas: a falha não tinha uma saída visual nem evidência técnica suficiente.

## Correção implementada

- `api()` aceita timeout e combina o cancelamento externo com o timeout interno.
- `/api/auth/me` usa timeout de 10 segundos; falhas não 401 mostram uma interface recuperável com retry.
- Um script inline no `<head>` inicia antes dos módulos, instala watchdog de 12 segundos, captura falha de script/link, `window.error` e `unhandledrejection`.
- Erro de asset/chunk consulta `/api/health` sem cache. Só recarrega quando o build remoto difere e apenas uma vez por build/aba.
- Se não houver recuperação, o próprio HTML cria um fallback útil; ele não depende de React nem de CSS externo.
- Um error boundary global cobre renderização, hidratação tardia e chunks lazy.
- Cada build recebe o SHA do Git via `__NUTRI_BUILD_ID__`, exposto em meta, health do frontend, logs e telemetria.
- Marcadores: `html-loaded`, `dom-ready`, `bundle-start`, `providers-mounted`, `react-entry`, `session-check-start`, `session-check-complete`, `first-ui-rendered` e estados de erro.
- O backend aceita eventos técnicos curtos em `/api/client-boot`, limitado por IP. O schema rejeita campos extras e não recebe conta, paciente, rota clínica, imagem ou conteúdo do usuário.
- Foi criado `/healthz` separado para o frontend.

## Antes/depois

| Cenário | Antes | Depois |
|---|---|---|
| sessão nunca responde | skeleton por mais de 15 s e indefinidamente | `BOOT-SESSION` em ~10,3 s, retry e reload |
| módulos JS falham | tela parcial/branca sem garantia | guard inline, uma recuperação por build e fallback visível |
| erro React | nenhuma boundary global | `BootErrorBoundary` com interface recuperável |
| frontend offline com PWA | HTML antigo do app, potencialmente incompatível | `/offline.html` independente do bundle |
| deploy troca chunks | HTML antigo podia apontar para assets removidos | navegação nunca usa HTML do cache; mismatch tem recuperação limitada |
| diagnóstico | sem localização do estágio | ring buffer local e evento técnico terminal no backend |

## Service worker

O cache agora é `nutri-static-<BUILD_ID>`. O URL de registro também inclui `?build=<BUILD_ID>` e usa `updateViaCache: none`.

O worker:

- não coloca `/` em cache;
- sempre busca navegações com `cache: no-store`;
- em offline usa somente `/offline.html`, que não depende dos chunks React;
- ignora `/api/`, requests RSC e `_rsc`;
- mantém cache-first apenas para `/_next/static/` com hash;
- remove caches `nutri-app-*` antigos e gerações `nutri-static-*` anteriores na ativação;
- continua usando `skipWaiting` e `clients.claim`.

O teste automatizado confirmou que `/` não é precacheado, o cache `nutri-app-v4` é removido e a navegação offline retorna o documento independente.

## Cache

Produção, antes da correção:

- `/`: `no-store, must-revalidate`, correto;
- `/sw.js`: `public, max-age=3600`, inadequado para atualização crítica;
- `manifest.webmanifest`: `public, max-age=3600`, permissivo demais para descoberta rápida de mudanças;
- assets com hash: cache público; a configuração explícita de `immutable` não existia no Nginx versionado.

A configuração preparada define:

- HTML e `/healthz`: `no-store`;
- `/sw.js`: `no-cache, no-store, must-revalidate`;
- manifest, offline e reset PWA: `no-cache, must-revalidate`;
- `/_next/static/`: um ano e `immutable`;
- APIs: `no-store`.

Essas regras ainda não estão ativas em produção porque esta investigação proíbe deploy. O próximo deploy deve executar `nginx -t` antes do reload.

## Assets/chunks

O build usa nomes com hash e módulos ES. Todos os 18 assets críticos encontrados no HTML local responderam 200, com MIME correto e corpo não vazio. O stress público da versão atualmente publicada validou 16/16.

Os chunks de perfil são lazy e só são solicitados após a sessão. Falhas equivalentes a `ChunkLoadError`, `Loading chunk`, `Failed to fetch dynamically imported module` e `Importing a module script failed` são reconhecidas.

O reload não é indiscriminado: requer erro de asset/chunk, health remoto com build diferente e ausência da chave de tentativa daquele build. Caso contrário, aparece o fallback.

## Sessão/API inicial

`GET /api/auth/me` é a única dependência de API que decide a primeira tela normal. Agora possui:

- loading inicial;
- sucesso autenticado;
- 401 tratado como usuário anônimo/login;
- erro ou timeout com tela recuperável;
- retry explícito;
- encerramento garantido de `checking` em `finally`.

O frontend permanece independente do backend até o limite: se a API estiver fora, o documento, JavaScript e fallback continuam disponíveis no serviço frontend.

## Infraestrutura

- DNS: `52.67.254.0`.
- HTTPS: certificado válido e aliases cobertos.
- Nginx: separa frontend e API; sem erros atuais de upstream no log examinado.
- PM2: backend, frontend e visão online; `unstable_restarts=0`.
- Banco: PostgreSQL conectado pelo backend; health atual confirma 5.874 alimentos.
- Memória: não foi encontrado OOM; havia cerca de 1,0 GiB disponível.

Não houve alteração em produção. A configuração Nginx deste trabalho existe apenas no workspace.

## Testes

- Backend Vitest: 174 aprovados, 19 ignorados.
- Frontend Vitest: 15 aprovados em três arquivos.
- TypeScript backend: aprovado.
- TypeScript frontend: aprovado.
- Lint: aprovado.
- Build Vinext: aprovado; rota `/healthz` detectada.
- `git diff --check`: aprovado, apenas avisos locais LF/CRLF.
- Build local: `/healthz` respondeu 200, `cache-control: no-store`, serviço `frontend` e build ID.
- Mobile 390 × 844: primeira UI em 72 ms no build local quente.
- Latência artificial de 500 ms por request: primeira UI em 1.570 ms; sem loading residual.
- API pendurada: versão antiga permaneceu em loading após 15 s; versão nova mostrou fallback em ~10,3 s.
- Todos os módulos JS recusados: fallback pré-React visível, recuperação limitada a uma tentativa.
- Frontend parado com PWA ativo: página `BOOT-OFFLINE` visível com botão.
- TBCA e medidas: auditorias permanecem aprovadas e sem diferenças em arquivos de dados/migrations.

## Stress test

### Documento e assets locais

- 100/100 documentos válidos.
- mínimo 4,8 ms; média 7,9 ms; p95 11,3 ms; máximo 45,7 ms.
- 18/18 assets válidos.

### Documento e assets públicos da versão atual

- 100/100 documentos válidos.
- mínimo 20,8 ms; média 27,6 ms; p95 41,8 ms; máximo 106,4 ms.
- 16/16 assets válidos.

### Montagem completa no navegador

- 100/100 navegações chegaram a `[data-nutri-first-ui=true]`.
- mínimo 158 ms; p95 187 ms; máximo 571 ms.
- Cada rodada usou URL única para evitar reaproveitar o documento por URL, mantendo o cache normal dos assets com hash.

## Observabilidade

O navegador mantém no máximo 30 eventos em `window.__NUTRI_BOOT_DIAGNOSTICS__`. O console usa prefixo `[nutri-boot]` e inclui build e tempo desde o HTML.

Somente o evento terminal de primeira UI ou falha é enviado ao backend por `sendBeacon`. Campos permitidos:

- build ID;
- estágio;
- duração;
- detalhe técnico limitado a 180 caracteres;
- classe mobile/desktop;
- online/offline.

O endpoint possui limite de 30 eventos por minuto/IP e schema estrito. Campos desconhecidos são rejeitados.

## Arquivos modificados

- `backend/index.ts`
- `backend/boot-telemetry.ts`
- `backend/boot-telemetry.test.ts`
- `deploy/nginx/nutriplus.conf`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/app/healthz/route.ts`
- `frontend/app/components/boot-resilience.tsx`
- `frontend/app/components/pwa-register.tsx`
- `frontend/lib/app-boot.ts`
- `frontend/lib/app-boot.test.ts`
- `frontend/lib/client-api.ts`
- `frontend/lib/service-worker.test.ts`
- `frontend/public/sw.js`
- `frontend/public/offline.html`
- `frontend/vite.config.ts`
- `frontend/vitest.config.ts`
- `frontend/package.json`
- `package.json`
- `tests/app-bootstrap/stress-bootstrap.mjs`
- `tests/app-bootstrap/fault-proxy.mjs`
- `docs/app-blank-screen-bootstrap-investigation-2026-09-11.md`

Nenhum arquivo de TBCA, nutrientes, matcher, reconhecimento por foto, medidas, migrations, diário ou histórico foi modificado.

## Riscos restantes

- O teste A -> B foi exercitado por simulação determinística do worker e do mismatch, não por dois deploys públicos, pois produção não podia ser alterada.
- PWA física instalada em Android/iOS e Safari não foi automatizada neste ambiente. O comportamento padrão foi validado no Chrome desktop e viewport móvel.
- Se o primeiro request HTTP/HTTPS não alcançar sequer Nginx e não existir um service worker previamente instalado, somente a página de erro do navegador pode aparecer; código do aplicativo não pode tratar uma ausência total de documento.
- O Nginx preparado precisa de `nginx -t`, reload e verificação de headers no ciclo de publicação futuro.
- O build ID local desta revisão mostra o HEAD atual (`8d304b3...`) porque, por instrução, não houve commit. Depois de aprovado e commitado, o build publicável incorporará o SHA definitivo.
- Os avisos existentes de chunks acima de 500 kB continuam. Eles afetam tempo de download, mas não foram a causa raiz. Uma divisão futura pode melhorar rede lenta sem misturar este reparo crítico com refatoração ampla.
