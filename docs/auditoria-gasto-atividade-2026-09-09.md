# Auditoria do gasto calórico por atividade — 2026-09-09

> Decisão posterior de produto: a partir dos 19 anos, inclusive aos 60+, valem o catálogo adulto e a fórmula MET convencional.

## Escopo e conclusão

Foram auditados catálogo, referências por idade, fórmulas, intensidade, descanso, API, persistência e balanço diário. O catálogo adulto expõe 142 atividades selecionadas e preserva exatamente os códigos e METs do snapshot do Compendium 2024 (142/142, nenhuma divergência). Não existe multiplicador universal 0,8/1,0/1,2 no sistema.

Foi encontrado um defeito relevante na aplicação posterior ao catálogo: toda entrada marcada como `resistance` recebia o perfil genérico 3,0/3,5/6,0, mesmo quando era uma modalidade específica. A correção limita intensidade e descanso ao atalho de musculação genérica para adultos. Modalidades específicas preservam seu MET publicado. Registros históricos não são recalculados.

O descanso continua alterando a estimativa no atalho genérico porque isso é uma decisão de produto solicitada, mas sua influência foi reduzida de ±15% para ±5%. **Este fator é uma heurística de modelagem e não um valor oficial do Compendium.** A literatura confirma que o intervalo muda respostas metabólicas e desempenho, mas não sustenta uma conversão universal, monotônica e exata de segundos para kcal.

## Estado atual após a correção

- Fórmula adulta do catálogo: `kcal brutas = MET × peso (kg) × duração (h)`.
- Fórmula líquida preservada para auditoria: `(MET − 1) × peso × duração (h)`.
- Atalho de musculação adulta: `MET escolhido (3,0; 3,5; 4,0; 5,0) × peso × horas × fator de descanso`.
- Modalidade específica: usa apenas o MET do código escolhido; intensidade relatada e descanso não multiplicam o MET.
- Jovens de 6–18 anos: METy × repouso de Schofield por minuto; apenas cruzamentos explícitos.
- Pessoas a partir de 19 anos, inclusive 60+: MET adulto convencional.
- Menores de 6 anos e modalidades sem cruzamento etário: exigem gasto informado por fonte profissional.
- Balanço: `ingestão − (basal × fator cotidiano + TEF + exercícios elegíveis)`.
- TEF: proteína `4 kcal/g × 25%`; carboidrato `4 kcal/g × 7,5%`; gordura `9 kcal/g × 1,5%`.
- Exercícios são adicionados uma vez quando `outside_base=true`. No modo `habitual_includes_exercise`, não são adicionados.

## Mapa da implementação

| Camada | Elemento | Responsabilidade |
|---|---|---|
| Fonte | `backend/data/activities/source-2024.json` | snapshot com 935 linhas de referência |
| Catálogo | `backend/data/activities/catalog-2024-pt-BR.json` | 142 linhas traduzidas e expostas, versão `2024-pt-BR.1` |
| Proveniência | `backend/data/activities/provenance.json` | URLs, data de coleta, versão, contagem e hash SHA-256 |
| Fórmulas | `backend/domain/activity-energy.ts` | MET, bruto/líquido, TEF, balanço, intensidade e descanso |
| Faixas etárias | `backend/domain/age-activity-energy.ts` | Adult MET e Youth METy com cruzamentos explícitos para jovens |
| API | `backend/activities.ts` | catálogo, estimativa, criação, edição, exclusão, recentes, favoritos e histórico |
| Banco | `activity_catalog` | código, versão, nome, categoria, aliases, MET, fonte e indicador resistido |
| Banco | `activity_sessions` | duração, intensidade, descanso, origem, snapshot e revisão atual |
| Banco | `activity_revisions` | versões anteriores imutáveis da sessão editada |
| Banco | `energy_settings` / `nutrition_goals` | modo e fator cotidiano vigentes |
| Banco | `energy_day_snapshots` / `energy_base_revisions` | base diária congelada e trilha de recálculo |
| Frontend | `activity-choices.tsx` | mapeamento dos atalhos visuais para códigos oficiais |
| Frontend | `activity-editor.tsx` | seleção, prévia, envio e edição |
| Frontend | `activity-panel.tsx` / `daily-energy-card.tsx` | exibição das sessões e discriminação do balanço |

Endpoints envolvidos: `GET /activities/catalog`, `POST /activities/estimate`, `GET /activities/recent`, `POST /activities/sessions`, `PUT /activities/sessions/:id`, `DELETE /activities/sessions/:id`, `GET /activities/history`, `PUT /activities/favorites` e `POST /activities/recalculate-base`.

## Fórmula antiga e fórmula nova

Antes, qualquer linha `resistance=true` usava `kcal = MET de referência × kg × h × (MET 3/3,5/6 ÷ MET de referência) × fator de descanso`. A razão cancelava o MET oficial e o substituía pelo perfil genérico; por isso uma modalidade específica podia perder seu valor publicado. O descanso variava de 0,85 a 1,15.

Agora, somente o atalho explícito `quick_strength`, para referência adulta, usa `kcal = MET 3/3,5/4/5 × kg × h × fator de descanso`, com faixa de 0,95 a 1,05. Os níveis alto de 4 MET e intenso de 5 MET são heurísticas conservadoras solicitadas após a auditoria. A referência vigorosa de 6 MET permanece no catálogo, sem associação automática ao esforço percebido. Toda seleção `catalog_specific` usa `kcal = MET oficial do código × kg × h`, sem segunda aplicação de intensidade ou descanso.

## Problemas encontrados

| Severidade | Problema | Estado |
|---|---|---|
| CRÍTICO | Perfil adulto 3/3,5/6 podia substituir METy em atividade resistida juvenil | Corrigido: perfil genérico limitado a pessoas a partir de 19 anos |
| ALTO | Circuito, supersérie, levantamento terra e outras entradas específicas recebiam novamente intensidade e descanso | Corrigido: perfil aplicado somente ao atalho genérico |
| ALTO | O saldo adiciona kcal brutas do exercício sobre uma base que contém repouso do dia | Mantido para não contrariar silenciosamente a decisão de produto anterior; requer decisão explícita sobre bruto versus líquido |
| MÉDIO | Descanso tinha faixa heurística de −15% a +15%, sem referência que sustentasse esses números exatos | Reduzido conservadoramente para −5% a +5% e identificado como heurística |
| MÉDIO | Nome `base_plus_net` não corresponde mais ao comportamento, que soma bruto | Não alterado para preservar compatibilidade; deve ser migrado em mudança própria |
| BAIXO | O campo intensidade continua sendo um relato em modalidades específicas, embora não altere kcal | Coerente com a modalidade escolhida; a interface pode explicar isso melhor futuramente |

## Intensidade

Não há fatores globais leve/moderada/intensa. Nas escolhas rápidas de caminhada, corrida, ciclismo, natação, futebol e tarefas domésticas, cada botão troca para outro código oficial do catálogo. O efeito resulta diretamente do MET desse código.

| Atalho (adulto, 85 kg, 60 min) | Leve | Moderada | Intensa | Vigorosa | Origem |
|---|---:|---:|---:|---:|---|
| Musculação, descanso 120 s | 255,0 | 297,5 | 340,0 | 425,0 | 3/3,5/4/5; 4 e 5 são metodologia Nutri+ |
| Caminhada | 238,0 | 323,0 | 408,0 | — | códigos 17152/17190/17200 |
| Corrida | 552,5 | 722,5 | 790,5 | — | códigos 12028/12030/12050 |
| Ciclismo | 365,5 | 595,0 | 765,0 | — | códigos oficiais 01015/01016/01017 |
| Natação | 493,0 | 680,0 | 833,0 | — | códigos 18240/18290/18230 |
| Em casa | 238,0 | 280,5 | 365,5 | — | códigos 05025/05026/05027 |
| Futebol | 595,0 recreativo | — | 807,5 competitivo | — | códigos 15610/15605; não há nível intermediário equivalente |

Classificação: os atalhos acima são **B — METs específicos por intensidade/modalidade**, exceto o nível leve da musculação genérica, que usa 3,0 como perfil de produto previamente aprovado. Uma entrada específica escolhida na busca também é B ou D conforme sua descrição; ela nunca recebe fator universal.

## Descanso da musculação

| Intervalo | Fator antigo | Fator novo | kcal moderada antiga | kcal moderada nova |
|---:|---:|---:|---:|---:|
| 30 s | 1,150 | 1,050 | 342,1 | 312,4 |
| 60 s | 1,100 | 1,033 | 327,3 | 307,3 |
| 90 s | 1,050 | 1,017 | 312,4 | 302,6 |
| 120 s | 1,000 | 1,000 | 297,5 | 297,5 |
| 180 s | 0,950 | 0,983 | 282,6 | 292,4 |
| 240 s | 0,900 | 0,967 | 267,8 | 287,7 |
| 300 s | 0,850 | 0,950 | 252,9 | 282,6 |

Os valores usam 85 kg, 60 min e 3,5 MET. Há interpolação linear entre pontos, limite superior em 300 s e validação de 1–1200 s na API/banco. O valor é persistido em `activity_sessions.rest_seconds`; a versão e os fatores usados ficam no snapshot JSON.

## Matriz de musculação — 85 kg, 60 min

| Intensidade | 30 s antiga → nova | 120 s antiga → nova | 240 s antiga → nova |
|---|---:|---:|---:|
| Leve (3,0 MET) | 293,3 → 267,8 | 255,0 → 255,0 | 229,5 → 246,6 |
| Moderada (3,5 MET) | 342,1 → 312,4 | 297,5 → 297,5 | 267,8 → 287,7 |
| Alto (4,0 MET, novo) | — → 357,0 | — → 340,0 | — → 328,8 |
| Intenso (5,0 MET, novo) | — → 446,3 | — → 425,0 | — → 411,0 |
| Vigorosa (6,0 MET histórica) | 586,5 → 535,5 | 510,0 → 510,0 | 459,0 → 493,2 |

A intensidade continua tendo maior efeito que o descanso. Leve + 30 s (267,8) não supera intensa + 240 s (493,2). Duração e peso permanecem lineares no modelo MET.

## Origem e força da evidência

| Número/regra | Classificação | Origem |
|---|---|---|
| METs dos 142 códigos adultos | OFICIAL/REFERENCIADO | 2024 Adult Compendium |
| MET 3,5 do código 02054 e 6,0 do 02050 | OFICIAL/REFERENCIADO | 2024 Adult Compendium |
| MET 3,0 para musculação genérica leve | DERIVADO/decisão de produto | aproximação conservadora previamente definida; não é uma entrada “musculação leve” universal |
| MET 4,0 para musculação genérica alta | HEURÍSTICA NUTRI+ | nível intermediário solicitado; não é um código oficial específico de musculação |
| MET 5,0 para musculação genérica intensa | HEURÍSTICA NUTRI+ | evita mapear automaticamente esforço subjetivo para os 6 MET vigorosos |
| Razão `MET escolhido / MET do código` | DERIVADO | conversão matemática para o perfil genérico; não é multiplicador clínico universal |
| Descanso 1,05…0,95 | HEURÍSTICA DO NUTRI+ | ajuste conservador de UX; sem tabela oficial por segundos |
| Fórmula `MET × kg × h` | DERIVADO da definição convencional do MET | aproximação populacional; não é calorimetria individual |
| TEF 25%/7,5%/1,5% | DERIVADO | pontos médios das faixas documentadas no projeto |
| Fator cotidiano 1–2,5 | DEFINIDO PELO PROFISSIONAL | configuração do Nutri+, padrão 1,0; não é inferido automaticamente |

Referências: [Compendium adulto 2024](https://pacompendium.com/adult-compendium/), [artigo da atualização 2024](https://pubmed.ncbi.nlm.nih.gov/38242596/), [Compendium para idosos](https://pacompendium.com/older-adult-compendium/), [Youth Compendium](https://pubmed.ncbi.nlm.nih.gov/28938248/), [intervalos de 1/2/3 min](https://pubmed.ncbi.nlm.nih.gov/24714546/), [intervalos de 20/60 s e EPOC](https://pubmed.ncbi.nlm.nih.gov/10589865/) e [30 s/1 min no supino](https://pubmed.ncbi.nlm.nih.gov/17237951/).

## Fluxo e persistência

- Frontend: `activity-choices.tsx` escolhe códigos; `activity-editor.tsx` solicita prévia e envia o mesmo perfil ao salvar.
- API: `POST /activities/estimate` e `POST/PUT /activities/sessions` usam a mesma função central.
- Banco: `activity_sessions` persiste duração, intensidade, descanso, snapshot, revisão e datas; `activity_revisions` preserva o registro anterior.
- Reabertura: a sessão retorna os valores persistidos e as kcal do snapshot. Alterações relevantes exigem `recalculate=true`; edição no mesmo dia pode preservar o peso original.
- Histórico: snapshots antigos permanecem inalterados; `strength-density-2` vale para novos recálculos no perfil genérico.

## Arquivos e testes

Arquivos modificados: `backend/domain/activity-energy.ts`, `backend/domain/activity-energy.test.ts`, `backend/activities.ts`, `backend/activities.integration.test.ts`, `frontend/app/components/activity-editor.tsx`, `docs/atividades-e-balanco-energetico.md` e este relatório.

Testes cobrem catálogo versus fonte, intensidade, sete descansos, matriz 3×3, duração, peso, NaN/Infinity/negativos, limite absurdo, perfil específico sem dupla correção, prévia versus persistência e revisões. O catálogo completo auditado aparece abaixo.

## Limitações científicas

MET é média populacional e pode divergir do gasto individual por aptidão, técnica, composição corporal, eficiência, carga e execução. Descanso isolado não determina densidade real: número de séries, repetições, carga, proximidade da falha e volume também mudam. A literatura não sustenta a precisão decimal dos fatores de descanso; eles continuam sendo uma aproximação conservadora. O uso de kcal brutas no saldo ainda pode contar o repouso do período do exercício duas vezes e deve ser decidido explicitamente antes de qualquer mudança.

## Catálogo adulto auditado (142/142)

| Código | Atividade | Categoria | MET | Classificação | Fonte |
|---|---|---|---:|---|---|
| 02050 | Musculação vigorosa, pesos livres ou máquinas | Musculação e treinamento resistido | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02052 | Musculação, agachamento e levantamento terra | Musculação e treinamento resistido | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02054 | Musculação, vários exercícios, 8–15 repetições | Musculação e treinamento resistido | 3.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02055 | Musculação em circuito, superséries recíprocas | Musculação e treinamento resistido | 5.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02056 | Resistência com peso corporal, geral | Musculação e treinamento resistido | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02057 | Resistência com peso corporal, alta intensidade | Musculação e treinamento resistido | 6.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02032 | Circuito com peso corporal | Musculação e treinamento resistido | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02034 | Circuito leve | Musculação e treinamento resistido | 3.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02035 | Circuito moderado | Musculação e treinamento resistido | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02040 | Circuito vigoroso com kettlebell e movimentos aeróbicos, pouco descanso | Musculação e treinamento resistido | 7.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02048 | Elíptico, esforço moderado | Condicionamento e bem-estar | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02049 | Elíptico, esforço vigoroso | Condicionamento e bem-estar | 9 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02065 | Escada ergométrica | Condicionamento e bem-estar | 9.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02070 | Remo ergométrico, geral vigoroso | Condicionamento e bem-estar | 7.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02071 | Remo ergométrico, menos de 100 watts, moderado | Condicionamento e bem-estar | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02072 | Remo ergométrico, 100–149 watts | Condicionamento e bem-estar | 7.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02073 | Remo ergométrico, 150–199 watts | Condicionamento e bem-estar | 11 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02000 | Ginástica aeróbica, geral | Condicionamento e bem-estar | 7.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02005 | Dança aeróbica, baixo impacto, moderada | Condicionamento e bem-estar | 4.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02006 | Dança aeróbica, alto impacto, vigorosa | Condicionamento e bem-estar | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02020 | Calistenia vigorosa | Condicionamento e bem-estar | 7.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02022 | Calistenia moderada | Condicionamento e bem-estar | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02024 | Calistenia leve | Condicionamento e bem-estar | 2.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02101 | Alongamento leve | Condicionamento e bem-estar | 2.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02103 | Pilates tradicional no solo | Condicionamento e bem-estar | 1.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02105 | Pilates geral | Condicionamento e bem-estar | 2.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02150 | Yoga Hatha | Condicionamento e bem-estar | 2.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02160 | Power yoga | Condicionamento e bem-estar | 4 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02175 | Yoga geral | Condicionamento e bem-estar | 2.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02185 | Yoga Vinyasa | Condicionamento e bem-estar | 2.7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02210 | Treino intervalado de alta intensidade, esforço moderado | Condicionamento e bem-estar | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02214 | HIIT vigoroso, burpees, escaladores e Tabata | Condicionamento e bem-estar | 11 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02310 | Zumba, aula em grupo | Condicionamento e bem-estar | 6.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 02315 | Zumba, vídeo em casa | Condicionamento e bem-estar | 5.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/conditioning-exercise/) |
| 17151 | Caminhada muito lenta, abaixo de 3,2 km/h, terreno plano | Caminhada e trilhas | 2.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17152 | Caminhada lenta, 3,2–3,9 km/h, terreno plano | Caminhada e trilhas | 2.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17170 | Caminhada, 4 km/h, superfície firme e plana | Caminhada e trilhas | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17190 | Caminhada moderada, 4,5–5,5 km/h, terreno plano | Caminhada e trilhas | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17200 | Caminhada rápida, 5,6–6,3 km/h, terreno plano | Caminhada e trilhas | 4.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17220 | Caminhada muito rápida, 6,4–7,1 km/h, terreno plano | Caminhada e trilhas | 5.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17160 | Caminhada por lazer | Caminhada e trilhas | 3.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17165 | Passear com cachorro | Caminhada e trilhas | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17080 | Trilha em terreno variado | Caminhada e trilhas | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17081 | Trilha lenta, campos e colinas, sem carga | Caminhada e trilhas | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17082 | Trilha em ritmo normal, campos e colinas, sem carga | Caminhada e trilhas | 5.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17010 | Trilha com mochila cargueira | Caminhada e trilhas | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17034 | Caminhada em subida de 1–5%, ritmo moderado a rápido | Caminhada e trilhas | 5.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17035 | Caminhada em subida de 6–10%, ritmo moderado a rápido | Caminhada e trilhas | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17131 | Subir escadas, geral | Caminhada e trilhas | 6.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17133 | Subir escadas lentamente | Caminhada e trilhas | 4.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17134 | Subir escadas rapidamente | Caminhada e trilhas | 9.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17352 | Esteira, 4–4,7 km/h, sem inclinação | Caminhada e trilhas | 3.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17355 | Esteira, 4,8–5,5 km/h, sem inclinação | Caminhada e trilhas | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 17358 | Esteira, 5,6–6,3 km/h, sem inclinação | Caminhada e trilhas | 4.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/walking/) |
| 12020 | Trote, ritmo escolhido livremente | Corrida | 7.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 12028 | Corrida, 6,4–6,8 km/h | Corrida | 6.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 12030 | Corrida, 8–8,4 km/h | Corrida | 8.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 12050 | Corrida, 9,7–10,1 km/h | Corrida | 9.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 12060 | Corrida, 10,8 km/h | Corrida | 10.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 12080 | Corrida, 12,1 km/h | Corrida | 11.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 12140 | Corrida em terreno variado | Corrida | 9.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/running/) |
| 01010 | Bicicleta por lazer, menos de 16 km/h | Ciclismo | 4 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01009 | Mountain bike, geral | Ciclismo | 8.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01015 | Bicicleta em ritmo leve escolhido livremente | Ciclismo | 4.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01016 | Bicicleta em ritmo moderado escolhido livremente | Ciclismo | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01017 | Bicicleta em ritmo vigoroso escolhido livremente | Ciclismo | 9 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01020 | Bicicleta, 16–19,2 km/h | Ciclismo | 6.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01030 | Bicicleta, 19,3–22,4 km/h | Ciclismo | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01040 | Bicicleta, 22,5–25,6 km/h | Ciclismo | 10 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01200 | Bicicleta ergométrica, geral | Ciclismo | 6.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01210 | Bicicleta ergométrica, 25–30 watts | Ciclismo | 3.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01214 | Bicicleta ergométrica, 50 watts | Ciclismo | 4 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01220 | Bicicleta ergométrica, 90–100 watts | Ciclismo | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01228 | Bicicleta ergométrica, 126–150 watts | Ciclismo | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01232 | Bicicleta ergométrica, 151–199 watts | Ciclismo | 10.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 01270 | Spinning, aula de bicicleta | Ciclismo | 9 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/bicycling/) |
| 18230 | Natação livre, rápida, vigorosa | Atividades aquáticas | 9.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18240 | Natação livre, lenta, recreativa | Atividades aquáticas | 5.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18255 | Natação de costas, recreativa | Atividades aquáticas | 4.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18265 | Natação de peito, recreativa | Atividades aquáticas | 5.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18270 | Natação borboleta | Atividades aquáticas | 13.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18290 | Natação crawl, velocidade média | Atividades aquáticas | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18355 | Hidroginástica geral | Atividades aquáticas | 5.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18356 | Hidroginástica, exercícios resistidos | Atividades aquáticas | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18358 | Hidroginástica de alta intensidade | Atividades aquáticas | 7.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18368 | Caminhada na água, moderada | Atividades aquáticas | 4.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18100 | Caiaque, esforço moderado | Atividades aquáticas | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18220 | Surfe geral | Atividades aquáticas | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 18224 | Stand up paddle geral | Atividades aquáticas | 6.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/water-activities/) |
| 15040 | Basquete, partida | Esportes | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15050 | Basquete recreativo, fora de partida | Esportes | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15195 | Futsal | Esportes | 7.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15605 | Futebol competitivo | Esportes | 9.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15610 | Futebol recreativo | Esportes | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15711 | Vôlei competitivo em quadra | Esportes | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15720 | Vôlei recreativo, equipes de 6–9 pessoas | Esportes | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15725 | Vôlei de praia | Esportes | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15675 | Tênis, esforço moderado | Esportes | 6.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15690 | Tênis simples | Esportes | 8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15680 | Tênis em duplas | Esportes | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15425 | Artes marciais, prática lenta de iniciantes | Esportes | 5.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15430 | Artes marciais, ritmo moderado | Esportes | 10.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15433 | Judô | Esportes | 11.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15110 | Boxe, saco de pancadas | Esportes | 5.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15457 | Kickboxing | Esportes | 7.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15660 | Tênis de mesa, pingue-pongue | Esportes | 4 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15300 | Ginástica geral | Esportes | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15537 | Escalada, dificuldade baixa a moderada | Esportes | 5.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15580 | Skate, esforço moderado | Esportes | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 15590 | Patinação sobre rodas | Esportes | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/sports/) |
| 03010 | Balé, dança moderna ou jazz, aula ou ensaio | Dança | 5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/dancing/) |
| 03012 | Balé, dança moderna ou jazz, apresentação vigorosa | Dança | 6.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/dancing/) |
| 03030 | Dança de salão rápida | Dança | 5.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/dancing/) |
| 03040 | Dança de salão lenta | Dança | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/dancing/) |
| 03070 | Dança contemporânea geral | Dança | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/dancing/) |
| 03090 | Salsa em dupla | Dança | 4.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/dancing/) |
| 05011 | Varrer lentamente, esforço leve | Atividades domésticas | 2.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05012 | Varrer rapidamente, esforço moderado | Atividades domésticas | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05025 | Tarefas domésticas combinadas, leves | Atividades domésticas | 2.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05026 | Tarefas domésticas combinadas, moderadas | Atividades domésticas | 3.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05027 | Tarefas domésticas combinadas, vigorosas | Atividades domésticas | 4.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05043 | Aspirar a casa, esforço moderado | Atividades domésticas | 3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05050 | Cozinhar, esforço leve | Atividades domésticas | 2 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05090 | Lavar, dobrar ou pendurar roupas, em pé, esforço leve | Atividades domésticas | 2.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 05120 | Mover móveis e carregar caixas | Atividades domésticas | 5.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/home-activities/) |
| 08066 | Jardinagem geral | Jardinagem | 2 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/lawn-garden/) |
| 08239 | Retirar ervas daninhas, esforço leve a moderado | Jardinagem | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/lawn-garden/) |
| 08240 | Retirar ervas daninhas, esforço moderado | Jardinagem | 4.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/lawn-garden/) |
| 08230 | Regar jardim, em pé ou caminhando | Jardinagem | 4 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/lawn-garden/) |
| 08110 | Cortar grama com cortador manual, vigoroso | Jardinagem | 6 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/lawn-garden/) |
| 11475 | Trabalho manual, esforço leve | Trabalho ativo | 2.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/occupation/) |
| 11476 | Trabalho manual, esforço moderado | Trabalho ativo | 4.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/occupation/) |
| 11477 | Trabalho manual, esforço vigoroso | Trabalho ativo | 6.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/occupation/) |
| 11792 | Caminhar no trabalho, 4,5–5,5 km/h, sem carga | Trabalho ativo | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/occupation/) |
| 16002 | Bicicleta como transporte, esforço moderado | Transporte ativo | 6.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/transportation/) |
| 16004 | Bicicleta como transporte, esforço alto | Transporte ativo | 9.3 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/transportation/) |
| 16060 | Caminhada como transporte, 4,5–5,1 km/h, terreno plano | Transporte ativo | 3.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/transportation/) |
| 19030 | Patinação no gelo geral | Esportes de inverno | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/winter-activities/) |
| 19075 | Esqui geral | Esportes de inverno | 7 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/winter-activities/) |
| 10040 | Tocar bateria sentado | Música | 3.8 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/music-playing/) |
| 22240 | Videogame ativo com o corpo todo, esforço moderado | Jogos ativos | 4 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/video-games/) |
| 22320 | Videogame ativo, treino ou dança, esforço vigoroso | Jogos ativos | 7.5 | OFICIAL/REFERENCIADO | [Compendium](https://pacompendium.com/video-games/) |
