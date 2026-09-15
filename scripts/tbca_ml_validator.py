#!/usr/bin/env python3
"""
Valida em massa as medidas TBCA em mL e estima o "grama equivalente de cálculo"
usado pela própria tabela, SEM assumir densidade física e SEM aplicar 1 mL = 1 g
por regra.

Método:
- lê tbca_measures_full.json;
- seleciona somente alimentos com medidas em mL;
- abre a página individual da TBCA;
- localiza a mesma coluna pelo raw_header;
- para cada nutriente numérico não-zero calcula:
      gramas_equivalentes = 100 * valor_da_porção / valor_por_100g
- usa mediana robusta e consenso entre vários nutrientes;
- classifica cada medida como validated / insufficient / inconsistent.

O resultado "validated" significa:
"A própria tabela TBCA está calculando esta coluna como uma massa equivalente
consistente em gramas."
Não significa densidade física experimental.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

DETAIL_URL = "https://www.tbca.net.br/base-dados-en/int_food_composition_2_edit.php"
SCRIPT_VERSION = 1

_thread_local = threading.local()


def clean_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split()).strip()


def parse_num(text: str) -> float | None:
    t = clean_text(text).lower()
    if not t or t in {"na", "nd", "tr", "-", "*"}:
        return None
    t = t.replace(".", "").replace(",", ".") if "," in t else t
    # Evita textos misturados; células nutricionais devem ser basicamente numéricas.
    m = re.fullmatch(r"[-+]?\d+(?:\.\d+)?", t)
    if not m:
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


class GlobalRateLimiter:
    def __init__(self, min_interval: float):
        self.min_interval = max(0.0, float(min_interval))
        self.lock = threading.Lock()
        self.next_allowed = 0.0

    def wait(self):
        if self.min_interval <= 0:
            return
        with self.lock:
            now = time.monotonic()
            wait_for = self.next_allowed - now
            if wait_for > 0:
                time.sleep(wait_for)
                now = time.monotonic()
            self.next_allowed = now + self.min_interval


def get_session(user_agent: str) -> requests.Session:
    s = getattr(_thread_local, "session", None)
    if s is None:
        s = requests.Session()
        s.headers.update({
            "User-Agent": user_agent,
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        })
        _thread_local.session = s
    return s


def get_with_retry(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, str],
    timeout: float,
    retries: int,
) -> requests.Response:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, timeout=timeout)

            if r.status_code == 429:
                ra = r.headers.get("Retry-After")
                wait = float(ra) if ra and ra.isdigit() else 4.0 * (attempt + 1)
                print(f"[429] {r.url} -> pausa {wait:.1f}s", file=sys.stderr)
                time.sleep(wait)
                continue

            if 500 <= r.status_code < 600:
                time.sleep(2 ** attempt)
                continue

            r.raise_for_status()
            return r

        except requests.RequestException as exc:
            last = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)

    raise RuntimeError(f"Falha HTTP: {last}")


def find_table_and_header(soup: BeautifulSoup):
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if not cells:
                continue
            headers = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            joined = " | ".join(x.lower() for x in headers)
            compact = re.sub(r"\s+", "", joined)
            if (
                ("component" in joined or "componente" in joined)
                and ("units" in joined or "unidades" in joined or "unidade" in joined)
                and "100g" in compact
            ):
                return table, row, headers
    return None, None, None


def parse_page_columns(html: str) -> tuple[list[str], list[dict[str, Any]]]:
    soup = BeautifulSoup(html, "html.parser")
    table, header_row, headers = find_table_and_header(soup)
    if table is None or header_row is None or not headers:
        raise RuntimeError("Tabela/cabeçalho nutricional não encontrado")

    all_rows = table.find_all("tr")
    try:
        header_index = all_rows.index(header_row)
    except ValueError:
        header_index = 0

    nutrient_rows: list[dict[str, Any]] = []

    for row in all_rows[header_index + 1:]:
        cells = row.find_all(["th", "td"])
        values = [clean_text(c.get_text(" ", strip=True)) for c in cells]
        if len(values) < 3:
            continue

        # Alinha apenas até o número de colunas do cabeçalho.
        if len(values) < len(headers):
            values += [""] * (len(headers) - len(values))
        values = values[:len(headers)]

        component = values[0]
        unit = values[1]
        if not component:
            continue

        nutrient_rows.append({
            "component": component,
            "unit": unit,
            "values": values,
        })

    return headers, nutrient_rows


def estimate_grams_for_column(
    headers: list[str],
    rows: list[dict[str, Any]],
    raw_header: str,
    *,
    min_consensus: int = 4,
    rel_tolerance: float = 0.025,
    abs_tolerance_g: float = 2.0,
) -> dict[str, Any]:

    # Tenta correspondência exata primeiro.
    candidate_indexes = [i for i, h in enumerate(headers) if clean_text(h) == clean_text(raw_header)]

    if not candidate_indexes:
        # fallback por normalização de espaços/case
        target = clean_text(raw_header).lower()
        candidate_indexes = [
            i for i, h in enumerate(headers)
            if clean_text(h).lower() == target
        ]

    if len(candidate_indexes) != 1:
        return {
            "status": "column_not_unique",
            "matchingColumnIndexes": candidate_indexes,
            "ratios": [],
        }

    col_idx = candidate_indexes[0]

    # Localiza a coluna Value for 100g.
    hundred_idx = None
    for i, h in enumerate(headers):
        if "100g" in re.sub(r"\s+", "", h.lower()):
            hundred_idx = i
            break

    if hundred_idx is None:
        return {"status": "missing_100g_column", "ratios": []}

    estimates = []

    for row in rows:
        vals = row["values"]
        if col_idx >= len(vals) or hundred_idx >= len(vals):
            continue

        base = parse_num(vals[hundred_idx])
        portion = parse_num(vals[col_idx])

        if base is None or portion is None:
            continue
        if base <= 0 or portion < 0:
            continue

        # Evita razões dominadas por arredondamento de valores minúsculos.
        # Aceita linhas mais estáveis: valor da porção >= 0,10 e base >= 0,10.
        if base < 0.10 or portion < 0.10:
            continue

        grams = 100.0 * portion / base

        if not math.isfinite(grams) or grams <= 0 or grams > 10000:
            continue

        estimates.append({
            "component": row["component"],
            "unit": row["unit"],
            "per100g": base,
            "portion": portion,
            "gramsEstimate": grams,
        })

    if not estimates:
        return {"status": "insufficient_numeric_rows", "ratios": []}

    vals = [x["gramsEstimate"] for x in estimates]
    median = statistics.median(vals)

    tol = max(abs_tolerance_g, abs(median) * rel_tolerance)
    inliers = [x for x in estimates if abs(x["gramsEstimate"] - median) <= tol]

    if len(inliers) >= 2:
        refined = statistics.median(x["gramsEstimate"] for x in inliers)
        tol2 = max(abs_tolerance_g, abs(refined) * rel_tolerance)
        inliers = [x for x in estimates if abs(x["gramsEstimate"] - refined) <= tol2]
    else:
        refined = median

    inlier_vals = [x["gramsEstimate"] for x in inliers]
    if inlier_vals:
        spread = max(inlier_vals) - min(inlier_vals)
        rel_spread = spread / refined if refined else None
    else:
        spread = None
        rel_spread = None

    status = "validated" if len(inliers) >= min_consensus else "insufficient_consensus"

    return {
        "status": status,
        "gramsEquivalentMedian": refined,
        "gramsEquivalentRounded": round(refined, 3),
        "numericRows": len(estimates),
        "consensusRows": len(inliers),
        "spreadGrams": spread,
        "relativeSpread": rel_spread,
        "ratios": inliers,
        "outliers": [x for x in estimates if x not in inliers],
    }


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_json_atomic(path: Path, payload: Any):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path, help="tbca_measures_full.json")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--min-interval", type=float, default=0.25)
    ap.add_argument("--batch-size", type=int, default=100)
    ap.add_argument("--batch-pause", type=float, default=2.0)
    ap.add_argument("--timeout", type=float, default=20)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--checkpoint-every", type=int, default=20)
    ap.add_argument("--checkpoint", type=Path, default=Path(".tbca_ml_validation_checkpoint.json"))
    ap.add_argument("--out", type=Path, default=Path("tbca_ml_validation.json"))
    ap.add_argument("--audit", type=Path, default=Path("tbca_ml_validation_audit.json"))
    ap.add_argument("--limit-foods", type=int)
    ap.add_argument(
        "--user-agent",
        default="USP-IC-TBCA-ml-validation/1.0 (academic research)",
    )
    args = ap.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))

    # Um request por alimento, não por medida.
    foods: dict[str, dict[str, Any]] = {}
    for f in data.get("foods", []):
        ml_measures = [
            m for m in (f.get("measures") or [])
            if m.get("unit") == "mL"
        ]
        if ml_measures:
            code = f.get("code") or f.get("requested_code")
            foods[code] = {
                "code": code,
                "description": f.get("description"),
                "sourceUrl": f.get("source_url"),
                "mlMeasures": ml_measures,
            }

    codes = sorted(foods)
    if args.limit_foods:
        codes = codes[:args.limit_foods]

    state = load_checkpoint(args.checkpoint)
    if state.get("script_version") == SCRIPT_VERSION:
        results = state.get("results", {})
        errors = state.get("errors", {})
    else:
        results, errors = {}, {}

    pending = [c for c in codes if c not in results]

    workers = max(1, min(args.workers, 12))
    batch_size = max(1, args.batch_size)
    limiter = GlobalRateLimiter(args.min_interval)

    print(
        f"Alimentos com mL: {len(codes)} | pendentes: {len(pending)} | "
        f"workers={workers} | min_interval={args.min_interval}s",
        file=sys.stderr,
    )

    def fetch_food(code: str):
        limiter.wait()
        s = get_session(args.user_agent)
        r = get_with_retry(
            s,
            DETAIL_URL,
            params={"cod_produto": code},
            timeout=args.timeout,
            retries=args.retries,
        )
        headers, rows = parse_page_columns(r.text)

        out_measures = []
        for m in foods[code]["mlMeasures"]:
            estimate = estimate_grams_for_column(
                headers,
                rows,
                m.get("raw_header") or "",
            )

            ml_value = m.get("volume_ml") or m.get("quantity")
            derived = estimate.get("gramsEquivalentMedian")

            if estimate.get("status") == "validated" and derived and ml_value:
                diff = derived - float(ml_value)
                rel = abs(diff) / float(ml_value)
                estimate["differenceFromNumericMlGrams"] = diff
                estimate["relativeDifferenceFromMl"] = rel
                estimate["matchesNumericMlWithin1PercentOr1g"] = (
                    abs(diff) <= 1.0 or rel <= 0.01
                )

            out_measures.append({
                "label": m.get("label"),
                "rawHeader": m.get("raw_header"),
                "ml": ml_value,
                "originalParseStatus": m.get("parse_status"),
                "tbcaCalculationEvidence": estimate,
            })

        return {
            "foodCode": code,
            "description": foods[code]["description"],
            "sourceUrl": r.url,
            "measures": out_measures,
        }

    done = len(codes) - len(pending)
    since_cp = 0
    total_batches = (len(pending) + batch_size - 1) // batch_size if pending else 0

    for bi, start in enumerate(range(0, len(pending), batch_size), start=1):
        batch = pending[start:start + batch_size]
        print(f"\n--- lote {bi}/{total_batches} ({len(batch)}) ---", file=sys.stderr)

        # Reinicia threads/sessions por lote.
        _thread_local.__dict__.clear()

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(fetch_food, code): code for code in batch}

            for fut in as_completed(futs):
                code = futs[fut]
                try:
                    results[code] = fut.result()
                    errors.pop(code, None)
                    status = "ok"
                except Exception as exc:
                    errors[code] = str(exc)
                    status = f"ERRO: {exc}"

                done += 1
                since_cp += 1
                print(f"[{done}/{len(codes)}] {code} -> {status}", file=sys.stderr)

                if since_cp >= args.checkpoint_every:
                    save_json_atomic(args.checkpoint, {
                        "script_version": SCRIPT_VERSION,
                        "results": results,
                        "errors": errors,
                    })
                    since_cp = 0

        save_json_atomic(args.checkpoint, {
            "script_version": SCRIPT_VERSION,
            "results": results,
            "errors": errors,
        })

        if bi < total_batches and args.batch_pause > 0:
            time.sleep(args.batch_pause)

    run_results = [results[c] for c in codes if c in results]

    flattened = []
    for food in run_results:
        for m in food["measures"]:
            ev = m["tbcaCalculationEvidence"]
            flattened.append({
                "foodCode": food["foodCode"],
                "description": food["description"],
                "sourceUrl": food["sourceUrl"],
                "label": m["label"],
                "rawHeader": m["rawHeader"],
                "ml": m["ml"],
                "originalParseStatus": m["originalParseStatus"],
                "status": ev.get("status"),
                "gramsEquivalent": ev.get("gramsEquivalentRounded"),
                "consensusRows": ev.get("consensusRows", 0),
                "numericRows": ev.get("numericRows", 0),
                "relativeSpread": ev.get("relativeSpread"),
                "matchesNumericMlWithin1PercentOr1g": ev.get("matchesNumericMlWithin1PercentOr1g"),
                "evidence": ev,
            })

    out_payload = {
        "source": "TBCA",
        "method": (
            "Grama equivalente reconstruído pela razão entre valores nutricionais "
            "da coluna da medida e valores por 100 g. Não é densidade física."
        ),
        "foodsRequested": len(codes),
        "foodsCollected": len(run_results),
        "errors": {c: errors[c] for c in codes if c in errors},
        "measures": flattened,
    }
    save_json_atomic(args.out, out_payload)

    statuses = {}
    for x in flattened:
        statuses[x["status"]] = statuses.get(x["status"], 0) + 1

    validated = [x for x in flattened if x["status"] == "validated"]
    equalish = [x for x in validated if x["matchesNumericMlWithin1PercentOr1g"]]
    different = [x for x in validated if x["matchesNumericMlWithin1PercentOr1g"] is False]

    audit = {
        "foodsWithMlRequested": len(codes),
        "foodsCollected": len(run_results),
        "httpErrors": len(out_payload["errors"]),
        "mlMeasuresTotal": len(flattened),
        "statusCounts": statuses,
        "validatedMeasures": len(validated),
        "validatedMatchingNumericMlWithin1PercentOr1g": len(equalish),
        "validatedDifferentFromNumericMl": len(different),
        "differentExamples": [
            {
                "foodCode": x["foodCode"],
                "description": x["description"],
                "label": x["label"],
                "ml": x["ml"],
                "gramsEquivalent": x["gramsEquivalent"],
                "sourceUrl": x["sourceUrl"],
            }
            for x in different[:100]
        ],
        "interpretation": (
            "validated = múltiplos nutrientes da própria TBCA convergem para a mesma "
            "massa equivalente. Isso documenta o fator de cálculo da tabela, não uma "
            "densidade experimental."
        ),
    }
    save_json_atomic(args.audit, audit)

    print("\n=== AUDITORIA mL TBCA ===", file=sys.stderr)
    print(f"Alimentos:                {len(codes)}", file=sys.stderr)
    print(f"Medidas mL:               {len(flattened)}", file=sys.stderr)
    print(f"Validadas por consenso:   {len(validated)}", file=sys.stderr)
    print(f"≈ mesmo número mL em g:   {len(equalish)}", file=sys.stderr)
    print(f"Equivalência diferente:   {len(different)}", file=sys.stderr)
    print(f"Erros HTTP:               {len(out_payload['errors'])}", file=sys.stderr)
    print(f"Status: {statuses}", file=sys.stderr)
    print("==========================", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
