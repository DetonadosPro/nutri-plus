# Revisão de intensidade e MET — 2026-09-09

## Decisão aplicada

A escala do atalho de musculação adulta passa a ser: Leve 3,0; Moderado 3,5; Alto 4,0; Intenso 5,0 MET. Os quatro nomes descrevem esforço percebido, mas o mapeamento é uma metodologia conservadora do Nutri+, não quatro categorias oficiais do Compendium. O código oficial 02050 de musculação vigorosa, 6 MET, continua no catálogo e pode ser escolhido como modalidade específica; ele não é mais acionado automaticamente por “Intenso”.

A carga absoluta levantada não entra na escolha do MET. Séries, repetições e carga podem permanecer como dados descritivos, sem a regra incorreta “mais kg = mais MET”.

## Fórmula

A fórmula adulta não mudou: `kcal brutas = MET efetivo × peso corporal (kg) × duração (h)`. O sistema também preserva `kcal líquidas = (MET − 1) × peso × duração (h)` no snapshot. No atalho de musculação, o resultado bruto recebe apenas o ajuste secundário de descanso. Não existe outro multiplicador de intensidade depois que o MET 3/3,5/4/5 foi escolhido.

No balanço diário, a implementação atual usa `ingestão − (basal × fator cotidiano + TEF + exercícios brutos fora da base)`. Basal, fator e TEF aparecem uma vez no código. Ainda existe risco conceitual de duplicar o repouso do período ao somar exercício bruto sobre a base diária; isso foi mantido por decisão anterior e não foi alterado silenciosamente nesta revisão.

## Musculação — 85 kg, 60 minutos

| Intensidade | MET | 30 s | 60 s | 90 s | 120 s | 180 s | 240 s |
|---|---:|---:|---:|---:|---:|---:|---:|
| Leve | 3,0 | 267,8 | 263,4 | 259,3 | 255,0 | 250,7 | 246,6 |
| Moderado | 3,5 | 312,4 | 307,3 | 302,6 | 297,5 | 292,4 | 287,7 |
| Alto | 4,0 | 357,0 | 351,2 | 345,8 | 340,0 | 334,2 | 328,8 |
| Intenso | 5,0 | 446,3 | 439,0 | 432,2 | 425,0 | 417,8 | 411,0 |

Fatores de descanso: 30 s 1,050; 60 s 1,033; 90 s 1,017; 120 s 1,000; 180 s 0,983; 240 s 0,967; 300 s ou mais 0,950. Há interpolação linear. Esses fatores são **HEURÍSTICA NUTRI+**, não uma tabela oficial. O efeito máximo entre extremos é limitado a ±5%.

Antes, com descanso de 120 s, a escala era 255,0; 297,5; 510,0 kcal. Agora ela é 255,0; 297,5; 340,0; 425,0 kcal. Assim, esforço subjetivo intenso deixou de acionar automaticamente 6 MET.

## Ranking dos saltos finais nas escolhas rápidas antes desta revisão

| Posição | Atividade | Penúltimo nível | Último nível | Diferença | Variação |
|---:|---|---:|---:|---:|---:|
| 1 | Musculação | 3,5 | 6,0 | +2,5 | +71,4% |
| 2 | Futebol | 7,0 | 9,5 | +2,5 | +35,7% |
| 3 | Atividades domésticas | 3,3 | 4,3 | +1,0 | +30,3% |
| 4 | Ciclismo | 7,0 | 9,0 | +2,0 | +28,6% |
| 5 | Caminhada | 3,8 | 4,8 | +1,0 | +26,3% |
| 6 | Natação | 8,0 | 9,8 | +1,8 | +22,5% |
| 7 | Corrida | 8,5 | 9,3 | +0,8 | +9,4% |

Após a correção, o salto final da musculação é 4,0 → 5,0, ou +25%. Um salto alto não foi considerado erro por si só: velocidade, competição e modalidade podem justificar diferenças reais.

## Análise e propostas por atalho

### Futebol

Atual: recreativo 7,0 e competitivo 9,5 MET, ambos referenciados. Não existe no Compendium uma entrada de futebol equivalente entre esses dois contextos. Proposta opcional: “Alto” 8,0 ou 8,25 MET, classificado como **MET INTERPOLADO / HEURÍSTICA NUTRI+**. Recomendação: não implementar agora; “competitivo” descreve contexto melhor que esforço subjetivo.

### Atividades domésticas

Atual: leve 2,8; moderada 3,3; vigorosa 4,3 MET, todos referenciados. Proposta opcional: Alto 3,8 MET, **INTERPOLADO**. Recomendação: manter três níveis, pois as categorias oficiais já descrevem tarefas combinadas e o salto absoluto é apenas 1 MET.

### Ciclismo

Atual: ritmo leve 4,3; moderado 7,0; vigoroso 9,0 MET. Existe o código oficial 01030, 8 MET, para 19,3–22,4 km/h. Proposta: adicionar “Alto — 19,3–22,4 km/h — 8 MET”, **REFERENCIADO/OFICIAL**. Recomendação: boa candidata, mas deixada apenas como proposta nesta revisão conforme solicitado.

### Caminhada

Atual: 2,8; 3,8; 4,8 MET, ligados a velocidades explícitas. Proposta: não adicionar “Alto”; oferecer mais velocidades pela busca. Velocidade é parâmetro melhor que percepção subjetiva.

### Natação

Atual: livre recreativo 5,8; crawl médio 8,0; livre rápido 9,8 MET. Os níveis misturam ritmo e descrição de estilo. Proposta: primeiro escolher estilo e depois ritmo. Não interpolar genericamente; valores intermediários existentes mudam estilo ou ambiente.

### Corrida

Atual: 6,5; 8,5; 9,3 MET, ligados a faixas de velocidade. Proposta: preservar velocidades e disponibilizar outras faixas oficiais pela busca; o salto final é pequeno.

## Origem dos números

- Os 142 códigos e METs do catálogo: **REFERENCIADO/OFICIAL**, cópia verificada do Adult Compendium 2024.
- Musculação 3,5 MET, código 02054, e musculação vigorosa 6 MET, código 02050: **REFERENCIADO/OFICIAL**.
- Escala simples 3/3,5/4/5: **METODOLOGIA/HEURÍSTICA NUTRI+**; 3,5 tem correspondência direta, os demais compõem a escala conservadora do produto.
- Fatores de descanso 0,95–1,05: **HEURÍSTICA NUTRI+**.
- Ciclismo 8 MET, código 01030: **REFERENCIADO/OFICIAL**, apenas proposto como quarto botão.
- Futebol 8–8,25 e tarefas domésticas 3,8: **INTERPOLADOS**, não implementados.

Fontes: [Adult Compendium 2024](https://pacompendium.com/adult-compendium/), [Conditioning Exercise](https://pacompendium.com/conditioning-exercise/), [Bicycling](https://pacompendium.com/bicycling/), [Walking](https://pacompendium.com/walking/), [Running](https://pacompendium.com/running/), [Water Activities](https://pacompendium.com/water-activities/), [Sports](https://pacompendium.com/sports/) e [Home Activities](https://pacompendium.com/home-activities/).

## Fluxo, versionamento e testes

Frontend, `POST /activities/estimate` e criação/edição de sessões enviam o mesmo identificador de intensidade. O backend escolhe o MET uma vez, aplica o descanso uma vez e grava MET efetivo, fatores, peso e versão no snapshot. Registros antigos com `vigorous` continuam legíveis; somente novos registros ou recálculos usam a escala exibida. A reabertura usa os valores persistidos.

Os testes cobrem: Leve < Moderado < Alto < Intenso; seis descansos monotônicos; peso; duração; limites; valores inválidos; catálogo versus fonte; prévia; salvamento PostgreSQL; leitura e revisões. O inventário completo segue abaixo.

Arquivos alterados nesta revisão: `backend/domain/activity-energy.ts`, `backend/domain/activity-energy.test.ts`, `backend/activities.ts`, `backend/activities.integration.test.ts`, `frontend/app/components/activity-choices.tsx`, `frontend/app/components/activity-editor.tsx`, `frontend/app/components/activity-panel.tsx`, `frontend/app/components/activity-types.ts`, `frontend/app/movement.css`, `docs/atividades-e-balanco-energetico.md`, `docs/auditoria-gasto-atividade-2026-09-09.md` e este relatório.

## Todas as atividades auditadas

| Código | Atividade | Categoria | MET | Origem |
|---|---|---|---:|---|
| 02050 | Musculação vigorosa, pesos livres ou máquinas | Musculação e treinamento resistido | 6 | REFERENCIADO/OFICIAL |
| 02052 | Musculação, agachamento e levantamento terra | Musculação e treinamento resistido | 5 | REFERENCIADO/OFICIAL |
| 02054 | Musculação, vários exercícios, 8–15 repetições | Musculação e treinamento resistido | 3.5 | REFERENCIADO/OFICIAL |
| 02055 | Musculação em circuito, superséries recíprocas | Musculação e treinamento resistido | 5.8 | REFERENCIADO/OFICIAL |
| 02056 | Resistência com peso corporal, geral | Musculação e treinamento resistido | 3 | REFERENCIADO/OFICIAL |
| 02057 | Resistência com peso corporal, alta intensidade | Musculação e treinamento resistido | 6.5 | REFERENCIADO/OFICIAL |
| 02032 | Circuito com peso corporal | Musculação e treinamento resistido | 6 | REFERENCIADO/OFICIAL |
| 02034 | Circuito leve | Musculação e treinamento resistido | 3.5 | REFERENCIADO/OFICIAL |
| 02035 | Circuito moderado | Musculação e treinamento resistido | 5 | REFERENCIADO/OFICIAL |
| 02040 | Circuito vigoroso com kettlebell e movimentos aeróbicos, pouco descanso | Musculação e treinamento resistido | 7.5 | REFERENCIADO/OFICIAL |
| 02048 | Elíptico, esforço moderado | Condicionamento e bem-estar | 5 | REFERENCIADO/OFICIAL |
| 02049 | Elíptico, esforço vigoroso | Condicionamento e bem-estar | 9 | REFERENCIADO/OFICIAL |
| 02065 | Escada ergométrica | Condicionamento e bem-estar | 9.3 | REFERENCIADO/OFICIAL |
| 02070 | Remo ergométrico, geral vigoroso | Condicionamento e bem-estar | 7.3 | REFERENCIADO/OFICIAL |
| 02071 | Remo ergométrico, menos de 100 watts, moderado | Condicionamento e bem-estar | 5 | REFERENCIADO/OFICIAL |
| 02072 | Remo ergométrico, 100–149 watts | Condicionamento e bem-estar | 7.5 | REFERENCIADO/OFICIAL |
| 02073 | Remo ergométrico, 150–199 watts | Condicionamento e bem-estar | 11 | REFERENCIADO/OFICIAL |
| 02000 | Ginástica aeróbica, geral | Condicionamento e bem-estar | 7.3 | REFERENCIADO/OFICIAL |
| 02005 | Dança aeróbica, baixo impacto, moderada | Condicionamento e bem-estar | 4.8 | REFERENCIADO/OFICIAL |
| 02006 | Dança aeróbica, alto impacto, vigorosa | Condicionamento e bem-estar | 8 | REFERENCIADO/OFICIAL |
| 02020 | Calistenia vigorosa | Condicionamento e bem-estar | 7.5 | REFERENCIADO/OFICIAL |
| 02022 | Calistenia moderada | Condicionamento e bem-estar | 3.8 | REFERENCIADO/OFICIAL |
| 02024 | Calistenia leve | Condicionamento e bem-estar | 2.8 | REFERENCIADO/OFICIAL |
| 02101 | Alongamento leve | Condicionamento e bem-estar | 2.3 | REFERENCIADO/OFICIAL |
| 02103 | Pilates tradicional no solo | Condicionamento e bem-estar | 1.8 | REFERENCIADO/OFICIAL |
| 02105 | Pilates geral | Condicionamento e bem-estar | 2.8 | REFERENCIADO/OFICIAL |
| 02150 | Yoga Hatha | Condicionamento e bem-estar | 2.3 | REFERENCIADO/OFICIAL |
| 02160 | Power yoga | Condicionamento e bem-estar | 4 | REFERENCIADO/OFICIAL |
| 02175 | Yoga geral | Condicionamento e bem-estar | 2.3 | REFERENCIADO/OFICIAL |
| 02185 | Yoga Vinyasa | Condicionamento e bem-estar | 2.7 | REFERENCIADO/OFICIAL |
| 02210 | Treino intervalado de alta intensidade, esforço moderado | Condicionamento e bem-estar | 7 | REFERENCIADO/OFICIAL |
| 02214 | HIIT vigoroso, burpees, escaladores e Tabata | Condicionamento e bem-estar | 11 | REFERENCIADO/OFICIAL |
| 02310 | Zumba, aula em grupo | Condicionamento e bem-estar | 6.5 | REFERENCIADO/OFICIAL |
| 02315 | Zumba, vídeo em casa | Condicionamento e bem-estar | 5.5 | REFERENCIADO/OFICIAL |
| 17151 | Caminhada muito lenta, abaixo de 3,2 km/h, terreno plano | Caminhada e trilhas | 2.3 | REFERENCIADO/OFICIAL |
| 17152 | Caminhada lenta, 3,2–3,9 km/h, terreno plano | Caminhada e trilhas | 2.8 | REFERENCIADO/OFICIAL |
| 17170 | Caminhada, 4 km/h, superfície firme e plana | Caminhada e trilhas | 3 | REFERENCIADO/OFICIAL |
| 17190 | Caminhada moderada, 4,5–5,5 km/h, terreno plano | Caminhada e trilhas | 3.8 | REFERENCIADO/OFICIAL |
| 17200 | Caminhada rápida, 5,6–6,3 km/h, terreno plano | Caminhada e trilhas | 4.8 | REFERENCIADO/OFICIAL |
| 17220 | Caminhada muito rápida, 6,4–7,1 km/h, terreno plano | Caminhada e trilhas | 5.5 | REFERENCIADO/OFICIAL |
| 17160 | Caminhada por lazer | Caminhada e trilhas | 3.5 | REFERENCIADO/OFICIAL |
| 17165 | Passear com cachorro | Caminhada e trilhas | 3 | REFERENCIADO/OFICIAL |
| 17080 | Trilha em terreno variado | Caminhada e trilhas | 6 | REFERENCIADO/OFICIAL |
| 17081 | Trilha lenta, campos e colinas, sem carga | Caminhada e trilhas | 3.8 | REFERENCIADO/OFICIAL |
| 17082 | Trilha em ritmo normal, campos e colinas, sem carga | Caminhada e trilhas | 5.3 | REFERENCIADO/OFICIAL |
| 17010 | Trilha com mochila cargueira | Caminhada e trilhas | 7 | REFERENCIADO/OFICIAL |
| 17034 | Caminhada em subida de 1–5%, ritmo moderado a rápido | Caminhada e trilhas | 5.3 | REFERENCIADO/OFICIAL |
| 17035 | Caminhada em subida de 6–10%, ritmo moderado a rápido | Caminhada e trilhas | 7 | REFERENCIADO/OFICIAL |
| 17131 | Subir escadas, geral | Caminhada e trilhas | 6.8 | REFERENCIADO/OFICIAL |
| 17133 | Subir escadas lentamente | Caminhada e trilhas | 4.5 | REFERENCIADO/OFICIAL |
| 17134 | Subir escadas rapidamente | Caminhada e trilhas | 9.3 | REFERENCIADO/OFICIAL |
| 17352 | Esteira, 4–4,7 km/h, sem inclinação | Caminhada e trilhas | 3.5 | REFERENCIADO/OFICIAL |
| 17355 | Esteira, 4,8–5,5 km/h, sem inclinação | Caminhada e trilhas | 3.8 | REFERENCIADO/OFICIAL |
| 17358 | Esteira, 5,6–6,3 km/h, sem inclinação | Caminhada e trilhas | 4.8 | REFERENCIADO/OFICIAL |
| 12020 | Trote, ritmo escolhido livremente | Corrida | 7.5 | REFERENCIADO/OFICIAL |
| 12028 | Corrida, 6,4–6,8 km/h | Corrida | 6.5 | REFERENCIADO/OFICIAL |
| 12030 | Corrida, 8–8,4 km/h | Corrida | 8.5 | REFERENCIADO/OFICIAL |
| 12050 | Corrida, 9,7–10,1 km/h | Corrida | 9.3 | REFERENCIADO/OFICIAL |
| 12060 | Corrida, 10,8 km/h | Corrida | 10.5 | REFERENCIADO/OFICIAL |
| 12080 | Corrida, 12,1 km/h | Corrida | 11.8 | REFERENCIADO/OFICIAL |
| 12140 | Corrida em terreno variado | Corrida | 9.3 | REFERENCIADO/OFICIAL |
| 01010 | Bicicleta por lazer, menos de 16 km/h | Ciclismo | 4 | REFERENCIADO/OFICIAL |
| 01009 | Mountain bike, geral | Ciclismo | 8.5 | REFERENCIADO/OFICIAL |
| 01015 | Bicicleta em ritmo leve escolhido livremente | Ciclismo | 4.3 | REFERENCIADO/OFICIAL |
| 01016 | Bicicleta em ritmo moderado escolhido livremente | Ciclismo | 7 | REFERENCIADO/OFICIAL |
| 01017 | Bicicleta em ritmo vigoroso escolhido livremente | Ciclismo | 9 | REFERENCIADO/OFICIAL |
| 01020 | Bicicleta, 16–19,2 km/h | Ciclismo | 6.8 | REFERENCIADO/OFICIAL |
| 01030 | Bicicleta, 19,3–22,4 km/h | Ciclismo | 8 | REFERENCIADO/OFICIAL |
| 01040 | Bicicleta, 22,5–25,6 km/h | Ciclismo | 10 | REFERENCIADO/OFICIAL |
| 01200 | Bicicleta ergométrica, geral | Ciclismo | 6.8 | REFERENCIADO/OFICIAL |
| 01210 | Bicicleta ergométrica, 25–30 watts | Ciclismo | 3.5 | REFERENCIADO/OFICIAL |
| 01214 | Bicicleta ergométrica, 50 watts | Ciclismo | 4 | REFERENCIADO/OFICIAL |
| 01220 | Bicicleta ergométrica, 90–100 watts | Ciclismo | 6 | REFERENCIADO/OFICIAL |
| 01228 | Bicicleta ergométrica, 126–150 watts | Ciclismo | 8 | REFERENCIADO/OFICIAL |
| 01232 | Bicicleta ergométrica, 151–199 watts | Ciclismo | 10.3 | REFERENCIADO/OFICIAL |
| 01270 | Spinning, aula de bicicleta | Ciclismo | 9 | REFERENCIADO/OFICIAL |
| 18230 | Natação livre, rápida, vigorosa | Atividades aquáticas | 9.8 | REFERENCIADO/OFICIAL |
| 18240 | Natação livre, lenta, recreativa | Atividades aquáticas | 5.8 | REFERENCIADO/OFICIAL |
| 18255 | Natação de costas, recreativa | Atividades aquáticas | 4.8 | REFERENCIADO/OFICIAL |
| 18265 | Natação de peito, recreativa | Atividades aquáticas | 5.3 | REFERENCIADO/OFICIAL |
| 18270 | Natação borboleta | Atividades aquáticas | 13.8 | REFERENCIADO/OFICIAL |
| 18290 | Natação crawl, velocidade média | Atividades aquáticas | 8 | REFERENCIADO/OFICIAL |
| 18355 | Hidroginástica geral | Atividades aquáticas | 5.5 | REFERENCIADO/OFICIAL |
| 18356 | Hidroginástica, exercícios resistidos | Atividades aquáticas | 3.8 | REFERENCIADO/OFICIAL |
| 18358 | Hidroginástica de alta intensidade | Atividades aquáticas | 7.5 | REFERENCIADO/OFICIAL |
| 18368 | Caminhada na água, moderada | Atividades aquáticas | 4.8 | REFERENCIADO/OFICIAL |
| 18100 | Caiaque, esforço moderado | Atividades aquáticas | 5 | REFERENCIADO/OFICIAL |
| 18220 | Surfe geral | Atividades aquáticas | 3 | REFERENCIADO/OFICIAL |
| 18224 | Stand up paddle geral | Atividades aquáticas | 6.5 | REFERENCIADO/OFICIAL |
| 15040 | Basquete, partida | Esportes | 8 | REFERENCIADO/OFICIAL |
| 15050 | Basquete recreativo, fora de partida | Esportes | 6 | REFERENCIADO/OFICIAL |
| 15195 | Futsal | Esportes | 7.8 | REFERENCIADO/OFICIAL |
| 15605 | Futebol competitivo | Esportes | 9.5 | REFERENCIADO/OFICIAL |
| 15610 | Futebol recreativo | Esportes | 7 | REFERENCIADO/OFICIAL |
| 15711 | Vôlei competitivo em quadra | Esportes | 6 | REFERENCIADO/OFICIAL |
| 15720 | Vôlei recreativo, equipes de 6–9 pessoas | Esportes | 3 | REFERENCIADO/OFICIAL |
| 15725 | Vôlei de praia | Esportes | 8 | REFERENCIADO/OFICIAL |
| 15675 | Tênis, esforço moderado | Esportes | 6.8 | REFERENCIADO/OFICIAL |
| 15690 | Tênis simples | Esportes | 8 | REFERENCIADO/OFICIAL |
| 15680 | Tênis em duplas | Esportes | 6 | REFERENCIADO/OFICIAL |
| 15425 | Artes marciais, prática lenta de iniciantes | Esportes | 5.3 | REFERENCIADO/OFICIAL |
| 15430 | Artes marciais, ritmo moderado | Esportes | 10.3 | REFERENCIADO/OFICIAL |
| 15433 | Judô | Esportes | 11.3 | REFERENCIADO/OFICIAL |
| 15110 | Boxe, saco de pancadas | Esportes | 5.8 | REFERENCIADO/OFICIAL |
| 15457 | Kickboxing | Esportes | 7.3 | REFERENCIADO/OFICIAL |
| 15660 | Tênis de mesa, pingue-pongue | Esportes | 4 | REFERENCIADO/OFICIAL |
| 15300 | Ginástica geral | Esportes | 3.8 | REFERENCIADO/OFICIAL |
| 15537 | Escalada, dificuldade baixa a moderada | Esportes | 5.8 | REFERENCIADO/OFICIAL |
| 15580 | Skate, esforço moderado | Esportes | 5 | REFERENCIADO/OFICIAL |
| 15590 | Patinação sobre rodas | Esportes | 7 | REFERENCIADO/OFICIAL |
| 03010 | Balé, dança moderna ou jazz, aula ou ensaio | Dança | 5 | REFERENCIADO/OFICIAL |
| 03012 | Balé, dança moderna ou jazz, apresentação vigorosa | Dança | 6.8 | REFERENCIADO/OFICIAL |
| 03030 | Dança de salão rápida | Dança | 5.5 | REFERENCIADO/OFICIAL |
| 03040 | Dança de salão lenta | Dança | 3 | REFERENCIADO/OFICIAL |
| 03070 | Dança contemporânea geral | Dança | 3.8 | REFERENCIADO/OFICIAL |
| 03090 | Salsa em dupla | Dança | 4.8 | REFERENCIADO/OFICIAL |
| 05011 | Varrer lentamente, esforço leve | Atividades domésticas | 2.3 | REFERENCIADO/OFICIAL |
| 05012 | Varrer rapidamente, esforço moderado | Atividades domésticas | 3.8 | REFERENCIADO/OFICIAL |
| 05025 | Tarefas domésticas combinadas, leves | Atividades domésticas | 2.8 | REFERENCIADO/OFICIAL |
| 05026 | Tarefas domésticas combinadas, moderadas | Atividades domésticas | 3.3 | REFERENCIADO/OFICIAL |
| 05027 | Tarefas domésticas combinadas, vigorosas | Atividades domésticas | 4.3 | REFERENCIADO/OFICIAL |
| 05043 | Aspirar a casa, esforço moderado | Atividades domésticas | 3 | REFERENCIADO/OFICIAL |
| 05050 | Cozinhar, esforço leve | Atividades domésticas | 2 | REFERENCIADO/OFICIAL |
| 05090 | Lavar, dobrar ou pendurar roupas, em pé, esforço leve | Atividades domésticas | 2.3 | REFERENCIADO/OFICIAL |
| 05120 | Mover móveis e carregar caixas | Atividades domésticas | 5.8 | REFERENCIADO/OFICIAL |
| 08066 | Jardinagem geral | Jardinagem | 2 | REFERENCIADO/OFICIAL |
| 08239 | Retirar ervas daninhas, esforço leve a moderado | Jardinagem | 3.8 | REFERENCIADO/OFICIAL |
| 08240 | Retirar ervas daninhas, esforço moderado | Jardinagem | 4.5 | REFERENCIADO/OFICIAL |
| 08230 | Regar jardim, em pé ou caminhando | Jardinagem | 4 | REFERENCIADO/OFICIAL |
| 08110 | Cortar grama com cortador manual, vigoroso | Jardinagem | 6 | REFERENCIADO/OFICIAL |
| 11475 | Trabalho manual, esforço leve | Trabalho ativo | 2.8 | REFERENCIADO/OFICIAL |
| 11476 | Trabalho manual, esforço moderado | Trabalho ativo | 4.5 | REFERENCIADO/OFICIAL |
| 11477 | Trabalho manual, esforço vigoroso | Trabalho ativo | 6.5 | REFERENCIADO/OFICIAL |
| 11792 | Caminhar no trabalho, 4,5–5,5 km/h, sem carga | Trabalho ativo | 3.8 | REFERENCIADO/OFICIAL |
| 16002 | Bicicleta como transporte, esforço moderado | Transporte ativo | 6.8 | REFERENCIADO/OFICIAL |
| 16004 | Bicicleta como transporte, esforço alto | Transporte ativo | 9.3 | REFERENCIADO/OFICIAL |
| 16060 | Caminhada como transporte, 4,5–5,1 km/h, terreno plano | Transporte ativo | 3.5 | REFERENCIADO/OFICIAL |
| 19030 | Patinação no gelo geral | Esportes de inverno | 7 | REFERENCIADO/OFICIAL |
| 19075 | Esqui geral | Esportes de inverno | 7 | REFERENCIADO/OFICIAL |
| 10040 | Tocar bateria sentado | Música | 3.8 | REFERENCIADO/OFICIAL |
| 22240 | Videogame ativo com o corpo todo, esforço moderado | Jogos ativos | 4 | REFERENCIADO/OFICIAL |
| 22320 | Videogame ativo, treino ou dança, esforço vigoroso | Jogos ativos | 7.5 | REFERENCIADO/OFICIAL |
