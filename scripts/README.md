# Coletor acadêmico de medidas caseiras da TBCA

## Estratégia recomendada

Como o projeto já possui os códigos TBCA no JSON local, **não é necessário percorrer manualmente todas as páginas da listagem**.

O script consulta a página individual por código usando:

`https://www.tbca.net.br/base-dados-en/int_food_composition_2_edit.php?cod_produto=BRC0043G`

Isso evita depender dos parâmetros criptografados usados em alguns links da interface.

## Instalação

```bash
python -m pip install -r requirements.txt
```

## Teste com poucos códigos

```bash
python tbca_measures_scraper.py --codes BRC0043G BRC0030D --delay 1.5
```

## Usando o JSON TBCA que vocês já têm

Se o script reconhecer automaticamente o campo:

```bash
python tbca_measures_scraper.py \
  --json backend/data/tbca/tbca_completa_normalizada_v2.json \
  --delay 1.5
```

Se precisar informar o campo:

```bash
python tbca_measures_scraper.py \
  --json backend/data/tbca/tbca_completa_normalizada_v2.json \
  --code-field codigo \
  --delay 1.5
```

Teste primeiro só 10:

```bash
python tbca_measures_scraper.py \
  --json backend/data/tbca/tbca_completa_normalizada_v2.json \
  --limit 10 \
  --delay 1.5
```

## Descoberta pela listagem

Também existe modo de descobrir os códigos pelas páginas:

```bash
python tbca_measures_scraper.py --discover --max-pages 2 --delay 1.5
```

Depois remova `--max-pages` quando validar.

## Saídas

- `tbca_measures_raw.json`
- `tbca_measures_raw.csv`
- `.tbca_measures_checkpoint.json` (permite retomar sem repetir alimentos já coletados)

## Regra importante para mL

O coletor é propositalmente conservador:

- `Colher sopa cheia (20 g)` -> `grams = 20`
- `Copo americano (240 mL)` -> `volume_ml = 240`, `grams = null`

Ele **não transforma mL em gramas** e não presume densidade. Assim, a coleta bruta continua fiel ao que está explicitamente apresentado no cabeçalho da TBCA.

Depois da coleta, vocês podem decidir separadamente como representar os casos em mL no modelo do Nutri+, com a referência da fonte preservada.

## Boas práticas

- usar atraso entre requisições;
- não usar dezenas de threads em paralelo;
- manter checkpoint;
- identificar o projeto acadêmico no User-Agent;
- validar uma amostra manual antes de rodar o conjunto inteiro;
- respeitar a autorização e as condições de uso aplicáveis ao projeto.
