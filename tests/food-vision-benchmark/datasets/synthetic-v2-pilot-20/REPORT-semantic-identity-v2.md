# Replay offline — identidade semântica TBCA v2

Data: 2026-09-09  
Fonte visual: respostas Luna `low` já congeladas no piloto de 20 imagens.  
Chamadas de API neste replay: **0**.

## Resultado

| Métrica | Baseline `ec436e3` | Matcher v2 local |
|---|---:|---:|
| Componentes visuais esperados | 32 | 32 |
| Componentes com códigos TBCA avaliáveis | 27 | 27 |
| Top-1 acceptable | 19/27 | **25/27** |
| Top-3 acceptable | 20/27 | **26/27** |
| Autoseleções | 6 | **23** |
| Precisão das autoseleções no piloto | 6/6 | **23/23** |
| Casos enviados ao reranker antes da chamada | 33 chamadas no pipeline | **3 componentes** |
| Ambíguos sem TBCA exata corretamente recusados | não representado | **5/5** |
| Ausência causada pela etapa visual | 1 | 1 |

O resultado novo mede retrieval e decisão determinística antes do reranker. Os três componentes restantes não foram enviados novamente ao Luna, portanto este replay não afirma o resultado final deles.

## PostgreSQL local

O replay usou o catálogo ativo com 5.874 alimentos no PostgreSQL `nutri_dev` e a busca indexada que será usada pelo endpoint.

- retrieval médio: **9,04 ms por componente**;
- retrieval p95: **18,97 ms**;
- matcher médio depois do retrieval: **37,35 ms**;
- matcher p95: **90,08 ms**.

Os valores exatos de tempo podem variar por máquina e cache. O artefato estruturado está em `report-semantic-identity-v2-db.json`.

## Casos não resolvidos automaticamente

- Arroz integral: permanece no reranker porque a descrição visual não afirmou integral versus branco.
- Peito de frango: o candidato aceitável do ground truth está em segundo lugar; as duas primeiras variantes diferem em atributos que a imagem não confirma.
- Alface: permanece no reranker quando a variedade não fica suficientemente clara.
- Coxa de frango: continua ausente porque o Luna confundiu visualmente o alimento; o matcher não pode recuperar um item que não foi detectado.

## Abstensão segura

Omelete simples, bife sem corte, farofa sem receita, peixe empanado sem especificação suficiente e queijo sem variedade agora produzem `NO_EXACT_TBCA_MATCH`. Nenhum recebe calorias silenciosamente.

## Limites desta entrega

- O prompt e o modelo Luna não foram alterados.
- O replay não avalia novamente os 11 itens extras encontrados pela visão.
- Nenhuma chamada paga, push ou alteração de produção foi feita.
