#!/usr/bin/env python3
"""
Coletor acadêmico de medidas caseiras da TBCA.

Estratégia recomendada:
1) obter os códigos TBCA (do JSON local já existente ou da listagem pública);
2) consultar a página individual da TBCA usando cod_produto=<código>;
3) extrair SOMENTE o que está explicitamente publicado no cabeçalho das medidas.

Importante:
- (45 g) -> grams=45
- (240 mL) -> volume_ml=240 e grams=None
  O script NÃO presume 1 mL = 1 g e NÃO inventa densidade.

Use com intervalo entre requisições e conforme a autorização/termos aplicáveis
ao seu projeto acadêmico.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

START_URL = "https://www.tbca.net.br/base-dados/composicao_alimentos_calculaveis.php"
DETAIL_URL = "https://www.tbca.net.br/base-dados-en/int_food_composition_2_edit.php"
PARSER_VERSION = 4
CODE_RE = re.compile(r"\b(?:BRC|BRD)[0-9]{4}[A-Z]\b", re.I)
MEASURE_RE = re.compile(
    r"^(?P<label>.*?)\s*\(\s*(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>g|mL)\s*\)\s*$",
    re.I,
)


def clean_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split()).strip()


def decimal_pt(value: str) -> float:
    return float(value.replace(",", "."))


def make_session(user_agent: str) -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": user_agent,
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        }
    )
    return s


class GlobalRateLimiter:
    """
    Garante um intervalo mínimo entre o INÍCIO de requisições de todas as threads.
    Ex.: min_interval=0.5 -> no máximo ~2 novas requisições/segundo globalmente.
    """
    def __init__(self, min_interval: float):
        self.min_interval = max(0.0, min_interval)
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def wait(self) -> None:
        if self.min_interval <= 0:
            return

        with self._lock:
            now = time.monotonic()
            wait_for = self._next_allowed - now
            if wait_for > 0:
                time.sleep(wait_for)
                now = time.monotonic()
            self._next_allowed = now + self.min_interval


_thread_local = threading.local()


def get_thread_session(user_agent: str) -> requests.Session:
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = make_session(user_agent)
        _thread_local.session = session
    return session


def get_with_retry(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, str] | None = None,
    timeout: float = 30,
    retries: int = 4,
) -> requests.Response:
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, timeout=timeout)
            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else 5 * (attempt + 1)
                print(f"[429] aguardando {wait:.1f}s: {r.url}", file=sys.stderr)
                time.sleep(wait)
                continue
            if 500 <= r.status_code < 600:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last_exc = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Falha ao acessar {url}: {last_exc}")


def polite_sleep(delay: float) -> None:
    # Pequeno jitter evita rajadas perfeitamente periódicas.
    time.sleep(max(0, delay) + random.uniform(0, min(0.25, max(0, delay) / 4)))


def find_listing_table(soup: BeautifulSoup):
    for table in soup.find_all("table"):
        headers = [clean_text(x.get_text(" ", strip=True)).lower() for x in table.find_all(["th", "td"])][:12]
        joined = " | ".join(headers)
        if ("código" in joined or "codigo" in joined or "code" in joined) and (
            "nome" in joined or "name" in joined
        ):
            return table
    return None


def extract_codes_from_listing(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    table = find_listing_table(soup)
    if table is None:
        # fallback conservador: códigos visíveis na página
        return sorted({m.group(0).upper() for m in CODE_RE.finditer(clean_text(soup.get_text(" ")))})

    out: list[str] = []
    for row in table.find_all("tr"):
        cells = row.find_all(["td", "th"])
        if not cells:
            continue
        text = clean_text(cells[0].get_text(" ", strip=True))
        m = CODE_RE.search(text)
        if m:
            out.append(m.group(0).upper())
    return list(dict.fromkeys(out))


def pagination_links(current_url: str, html: str) -> list[str]:
    """
    Descobre links de paginação sem assumir número total de páginas.
    Aceita a peculiaridade da TBCA de usar atuald/pagina.
    """
    soup = BeautifulSoup(html, "html.parser")
    current_host = urlparse(current_url).netloc.lower()
    links: list[str] = []

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        absolute = urljoin(current_url, href)
        parsed = urlparse(absolute)

        if parsed.netloc.lower() != current_host:
            continue
        if "composicao_alimentos" not in parsed.path:
            continue

        q = parse_qs(parsed.query)
        if "pagina" not in q:
            continue

        # Evita entrar em resultados de buscas/filtros não solicitados.
        forbidden = {"produto", "grupo", "tipo"}
        if forbidden.intersection(q):
            continue

        links.append(absolute)

    return list(dict.fromkeys(links))


def discover_all_codes(
    session: requests.Session,
    start_url: str,
    delay: float,
    max_pages: int | None = None,
) -> list[str]:
    queue = deque([start_url])
    seen_pages: set[str] = set()
    seen_codes: set[str] = set()

    while queue:
        url = queue.popleft()
        if url in seen_pages:
            continue
        if max_pages is not None and len(seen_pages) >= max_pages:
            break

        print(f"[lista {len(seen_pages)+1}] {url}", file=sys.stderr)
        r = get_with_retry(session, url)
        seen_pages.add(url)

        codes = extract_codes_from_listing(r.text)
        before = len(seen_codes)
        seen_codes.update(codes)
        print(
            f"  +{len(seen_codes)-before} códigos novos; total={len(seen_codes)}",
            file=sys.stderr,
        )

        for nxt in pagination_links(r.url, r.text):
            if nxt not in seen_pages:
                queue.append(nxt)

        polite_sleep(delay)

    return sorted(seen_codes)


def walk_json_for_codes(obj: Any, preferred_field: str | None = None) -> Iterable[str]:
    if isinstance(obj, dict):
        if preferred_field and preferred_field in obj:
            val = obj[preferred_field]
            if isinstance(val, str):
                m = CODE_RE.search(val)
                if m:
                    yield m.group(0).upper()

        # Também procura campos usuais para tornar o script tolerante ao formato.
        for key in ("codigo", "código", "code", "foodCode", "food_code", "tbcaCode", "tbca_code"):
            if key in obj and isinstance(obj[key], str):
                m = CODE_RE.search(obj[key])
                if m:
                    yield m.group(0).upper()

        for value in obj.values():
            yield from walk_json_for_codes(value, preferred_field)

    elif isinstance(obj, list):
        for item in obj:
            yield from walk_json_for_codes(item, preferred_field)

    elif isinstance(obj, str):
        # fallback útil para listas simples de códigos
        m = CODE_RE.fullmatch(obj.strip())
        if m:
            yield m.group(0).upper()


def codes_from_json(path: Path, code_field: str | None = None) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return sorted(set(walk_json_for_codes(data, code_field)))


def find_detail_table_and_header(soup: BeautifulSoup):
    """
    A TBCA possui uma linha de controles (inputs/botões) antes do cabeçalho
    real da tabela. Por isso não podemos assumir que rows[0] seja o cabeçalho.

    Retorna (table, header_row) quando encontra uma linha contendo:
    Component/Componente + Units/Unidades + 100 g.
    """
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["th", "td"])
            if not cells:
                continue

            headers = [clean_text(x.get_text(" ", strip=True)) for x in cells]
            normalized = [h.lower().replace("\xa0", " ") for h in headers]
            joined = " | ".join(normalized)
            compact = re.sub(r"\s+", "", joined)

            has_component = "component" in joined or "componente" in joined
            has_units = "units" in joined or "unidades" in joined or "unidade" in joined
            has_100g = "100g" in compact

            if has_component and has_units and has_100g:
                return table, row

    return None, None


def parse_metadata(soup: BeautifulSoup) -> tuple[str | None, str | None]:
    text = clean_text(soup.get_text("\n", strip=True))

    code_m = re.search(r"(?:Código|Codigo|Code)\s*:\s*((?:BRC|BRD)\d{4}[A-Z])", text, re.I)
    code = code_m.group(1).upper() if code_m else None

    # Pega só a primeira linha lógica de descrição.
    desc = None
    for pattern in (
        r"(?:Descrição|Description)\s*:\s*(.+?)(?=\s*<<|\s*(?:Valores|Nutrient|$))",
    ):
        m = re.search(pattern, text, re.I)
        if m:
            desc = clean_text(m.group(1))
            break

    return code, desc


def parse_detail_page(html: str, source_url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    code, description = parse_metadata(soup)
    table, header_row = find_detail_table_and_header(soup)

    if table is None or header_row is None:
        return {
            "code": code,
            "description": description,
            "source_url": source_url,
            "measures": [],
            "warning": "Tabela de composição/medidas não encontrada",
        }

    header_cells = header_row.find_all(["th", "td"])
    headers = [clean_text(x.get_text(" ", strip=True)) for x in header_cells]

    # Localiza a coluna "Valor por 100 g" e considera as posteriores como medidas.
    hundred_idx = None
    for i, h in enumerate(headers):
        hl = h.lower().replace(" ", "")
        if "100g" in hl:
            hundred_idx = i
            break

    if hundred_idx is None:
        return {
            "code": code,
            "description": description,
            "source_url": source_url,
            "measures": [],
            "warning": "Coluna '100 g' não encontrada",
        }

    measures: list[dict[str, Any]] = []
    for h in headers[hundred_idx + 1 :]:
        m = MEASURE_RE.match(h)
        if not m:
            # Guardamos o rótulo cru para auditoria, sem inventar valor.
            measures.append(
                {
                    "label": h,
                    "raw_header": h,
                    "quantity": None,
                    "unit": None,
                    "grams": None,
                    "volume_ml": None,
                    "parse_status": "unparsed",
                }
            )
            continue

        label = clean_text(m.group("label"))
        value = decimal_pt(m.group("value"))
        unit = m.group("unit")
        is_grams = unit.lower() == "g"

        measures.append(
            {
                "label": label,
                "raw_header": h,
                "quantity": value,
                "unit": "g" if is_grams else "mL",
                "grams": value if is_grams else None,
                "volume_ml": None if is_grams else value,
                "parse_status": "ok" if label else "missing_label",
            }
        )

    return {
        "code": code,
        "description": description,
        "source_url": source_url,
        "measures": measures,
        "warning": None,
    }


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_checkpoint(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def scrape_codes(
    session: requests.Session,
    codes: list[str],
    *,
    delay: float,
    out_json: Path,
    checkpoint: Path,
    workers: int = 1,
    min_interval: float = 0.5,
    user_agent: str = "USP-IC-TBCA-research/1.0",
) -> dict[str, Any]:
    """
    Coleta sequencial (workers=1) ou paralela (workers>1).

    Segurança operacional:
    - cada thread possui sua própria requests.Session;
    - há rate limit GLOBAL entre inícios de requisição;
    - checkpoint é escrito apenas pela thread principal;
    - 429/5xx continuam usando o retry/backoff existente.
    """
    state = load_checkpoint(checkpoint)

    if state.get("parser_version") == PARSER_VERSION:
        results: dict[str, Any] = state.get("results", {})
        errors: dict[str, str] = state.get("errors", {})
    else:
        if state:
            print(
                f"Checkpoint antigo/incompatível detectado; reprocessando com parser v{PARSER_VERSION}.",
                file=sys.stderr,
            )
        results = {}
        errors = {}

    total = len(codes)
    pending = [code for code in codes if code not in results]
    limiter = GlobalRateLimiter(min_interval)

    print(
        f"{total} códigos solicitados; {len(pending)} pendentes. "
        f"workers={workers}, intervalo global mínimo={min_interval:.2f}s",
        file=sys.stderr,
    )

    def fetch_one(code: str) -> tuple[str, dict[str, Any] | None, str | None]:
        try:
            limiter.wait()
            worker_session = get_thread_session(user_agent)
            r = get_with_retry(
                worker_session,
                DETAIL_URL,
                params={"cod_produto": code},
            )
            parsed = parse_detail_page(r.text, r.url)

            returned = parsed.get("code")
            if returned and returned.upper() != code.upper():
                raise RuntimeError(f"TBCA retornou código {returned}, esperado {code}")

            parsed["requested_code"] = code
            return code, parsed, None
        except Exception as exc:
            return code, None, str(exc)

    completed = total - len(pending)

    if workers <= 1:
        # Mantém modo sequencial disponível.
        for code in pending:
            print(f"[{completed+1}/{total}] {code}", file=sys.stderr)
            c, parsed, err = fetch_one(code)

            if err is None and parsed is not None:
                results[c] = parsed
                errors.pop(c, None)
            else:
                errors[c] = err or "erro desconhecido"
                print(f"  ERRO {c}: {errors[c]}", file=sys.stderr)

            completed += 1
            save_checkpoint(
                checkpoint,
                {
                    "parser_version": PARSER_VERSION,
                    "results": results,
                    "errors": errors,
                },
            )

            # Compatibilidade com o argumento antigo --delay.
            # No modo paralelo, o controle principal é --min-interval.
            if delay > 0:
                polite_sleep(delay)

    else:
        workers = max(1, min(int(workers), 16))

        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tbca") as pool:
            future_to_code = {pool.submit(fetch_one, code): code for code in pending}

            for future in as_completed(future_to_code):
                code = future_to_code[future]
                try:
                    c, parsed, err = future.result()
                except Exception as exc:
                    c, parsed, err = code, None, str(exc)

                if err is None and parsed is not None:
                    results[c] = parsed
                    errors.pop(c, None)
                    status = "ok"
                else:
                    errors[c] = err or "erro desconhecido"
                    status = f"ERRO: {errors[c]}"

                completed += 1
                print(f"[{completed}/{total}] {c} -> {status}", file=sys.stderr)

                # Escrita serializada pelo thread principal: evita corrupção do JSON.
                save_checkpoint(
                    checkpoint,
                    {
                        "parser_version": PARSER_VERSION,
                        "results": results,
                        "errors": errors,
                    },
                )

    run_results = {code: results[code] for code in codes if code in results}
    run_errors = {code: errors[code] for code in codes if code in errors}

    payload = {
        "source": "TBCA",
        "parser_version": PARSER_VERSION,
        "detail_endpoint": DETAIL_URL,
        "note": "mL é preservado como volume; não foi assumido 1 mL = 1 g.",
        "workers": workers,
        "min_interval_seconds": min_interval,
        "foods_requested": total,
        "foods_collected": len(run_results),
        "errors": run_errors,
        "foods": [run_results[k] for k in sorted(run_results)],
    }
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def export_measures_csv(payload: dict[str, Any], path: Path) -> None:
    fields = [
        "code",
        "description",
        "label",
        "quantity",
        "unit",
        "grams",
        "volume_ml",
        "parse_status",
        "raw_header",
        "source_url",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()

        for food in payload.get("foods", []):
            measures = food.get("measures") or []
            for m in measures:
                writer.writerow(
                    {
                        "code": food.get("code") or food.get("requested_code"),
                        "description": food.get("description"),
                        "label": m.get("label"),
                        "quantity": m.get("quantity"),
                        "unit": m.get("unit"),
                        "grams": m.get("grams"),
                        "volume_ml": m.get("volume_ml"),
                        "parse_status": m.get("parse_status"),
                        "raw_header": m.get("raw_header"),
                        "source_url": food.get("source_url"),
                    }
                )



def build_audit(payload: dict[str, Any]) -> dict[str, Any]:
    foods = payload.get("foods", [])
    errors = payload.get("errors", {}) or {}

    total_measures = 0
    grams_measures = 0
    ml_measures = 0
    missing_labels = 0
    unparsed = 0
    foods_without_measures = 0
    foods_with_measures = 0
    foods_with_missing_labels = 0
    foods_with_unparsed = 0

    missing_label_examples: list[dict[str, Any]] = []
    unparsed_examples: list[dict[str, Any]] = []

    for food in foods:
        measures = food.get("measures") or []
        if measures:
            foods_with_measures += 1
        else:
            foods_without_measures += 1

        food_has_missing = False
        food_has_unparsed = False

        for m in measures:
            total_measures += 1
            unit = m.get("unit")
            status = m.get("parse_status")

            if unit == "g":
                grams_measures += 1
            elif unit == "mL":
                ml_measures += 1

            if status == "missing_label":
                missing_labels += 1
                food_has_missing = True
                if len(missing_label_examples) < 50:
                    missing_label_examples.append(
                        {
                            "code": food.get("code") or food.get("requested_code"),
                            "description": food.get("description"),
                            "raw_header": m.get("raw_header"),
                            "quantity": m.get("quantity"),
                            "unit": m.get("unit"),
                            "source_url": food.get("source_url"),
                        }
                    )
            elif status == "unparsed":
                unparsed += 1
                food_has_unparsed = True
                if len(unparsed_examples) < 50:
                    unparsed_examples.append(
                        {
                            "code": food.get("code") or food.get("requested_code"),
                            "description": food.get("description"),
                            "raw_header": m.get("raw_header"),
                            "source_url": food.get("source_url"),
                        }
                    )

        if food_has_missing:
            foods_with_missing_labels += 1
        if food_has_unparsed:
            foods_with_unparsed += 1

    return {
        "source": payload.get("source"),
        "parser_version": payload.get("parser_version"),
        "foods_requested": payload.get("foods_requested", 0),
        "foods_collected": payload.get("foods_collected", 0),
        "foods_with_measures": foods_with_measures,
        "foods_without_measures": foods_without_measures,
        "measures_total": total_measures,
        "measures_in_grams": grams_measures,
        "measures_in_ml": ml_measures,
        "measures_missing_label": missing_labels,
        "measures_unparsed": unparsed,
        "foods_with_missing_labels": foods_with_missing_labels,
        "foods_with_unparsed_measures": foods_with_unparsed,
        "http_or_collection_errors": len(errors),
        "error_codes": sorted(errors.keys()),
        "missing_label_examples": missing_label_examples,
        "unparsed_examples": unparsed_examples,
        "notes": [
            "mL não é convertido automaticamente em gramas.",
            "missing_label significa que a TBCA publicou a quantidade/unidade sem texto de medida no cabeçalho capturado.",
            "unparsed significa que o cabeçalho apareceu na área de medidas, mas não seguiu o padrão '(valor g)' ou '(valor mL)'.",
        ],
    }


def save_audit(audit: dict[str, Any], path: Path) -> None:
    path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")


def print_audit(audit: dict[str, Any]) -> None:
    print("\n=== AUDITORIA TBCA ===", file=sys.stderr)
    print(f"Alimentos solicitados:      {audit['foods_requested']}", file=sys.stderr)
    print(f"Alimentos coletados:        {audit['foods_collected']}", file=sys.stderr)
    print(f"Com medidas:                {audit['foods_with_measures']}", file=sys.stderr)
    print(f"Sem medidas:                {audit['foods_without_measures']}", file=sys.stderr)
    print(f"Medidas encontradas:        {audit['measures_total']}", file=sys.stderr)
    print(f"Medidas em g:               {audit['measures_in_grams']}", file=sys.stderr)
    print(f"Medidas em mL:              {audit['measures_in_ml']}", file=sys.stderr)
    print(f"Rótulos vazios:             {audit['measures_missing_label']}", file=sys.stderr)
    print(f"Cabeçalhos não interpret.:  {audit['measures_unparsed']}", file=sys.stderr)
    print(f"Erros HTTP/coleta:          {audit['http_or_collection_errors']}", file=sys.stderr)
    print("======================\n", file=sys.stderr)

def main() -> int:
    ap = argparse.ArgumentParser(description="Extrai medidas caseiras publicadas pela TBCA.")
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--json", type=Path, help="JSON local contendo códigos TBCA.")
    source.add_argument("--discover", action="store_true", help="Descobrir códigos pela listagem da TBCA.")
    source.add_argument("--codes", nargs="+", help="Um ou mais códigos, ex.: BRC0043G BRC0030D")

    ap.add_argument("--code-field", help="Nome do campo de código no JSON, se quiser forçar.")
    ap.add_argument("--start-url", default=START_URL)
    ap.add_argument("--delay", type=float, default=1.2, help="Intervalo base entre requisições (padrão 1.2 s).")
    ap.add_argument("--max-pages", type=int, default=None, help="Útil para teste da descoberta.")
    ap.add_argument("--limit", type=int, default=None, help="Limita quantidade de alimentos para teste.")
    ap.add_argument("--out", type=Path, default=Path("tbca_measures_raw.json"))
    ap.add_argument("--csv", type=Path, default=Path("tbca_measures_raw.csv"))
    ap.add_argument("--checkpoint", type=Path, default=Path(".tbca_measures_checkpoint.json"))
    ap.add_argument("--workers", type=int, default=1,
                    help="Número de requisições concorrentes. Recomendo 4; máximo efetivo 16.")
    ap.add_argument("--min-interval", type=float, default=0.5,
                    help="Intervalo global mínimo entre inícios de requisição em segundos. Padrão 0.5.")
    ap.add_argument("--audit", type=Path, default=Path("tbca_measures_audit.json"),
                    help="Arquivo JSON com resumo de auditoria (padrão: tbca_measures_audit.json).")
    ap.add_argument(
        "--user-agent",
        default="USP-IC-TBCA-research/1.0 (academic research; contact: configure-no-script)",
        help="Identifique o projeto/contato acadêmico.",
    )
    args = ap.parse_args()

    session = make_session(args.user_agent)

    if args.json:
        codes = codes_from_json(args.json, args.code_field)
    elif args.codes:
        codes = sorted({c.upper() for c in args.codes if CODE_RE.fullmatch(c.upper())})
    else:
        codes = discover_all_codes(session, args.start_url, args.delay, args.max_pages)

    if args.limit is not None:
        codes = codes[: args.limit]

    if not codes:
        print("Nenhum código TBCA encontrado.", file=sys.stderr)
        return 2

    print(f"{len(codes)} códigos serão processados.", file=sys.stderr)
    payload = scrape_codes(
        session,
        codes,
        delay=args.delay if args.workers <= 1 else 0.0,
        out_json=args.out,
        checkpoint=args.checkpoint,
        workers=args.workers,
        min_interval=args.min_interval,
        user_agent=args.user_agent,
    )
    export_measures_csv(payload, args.csv)
    audit = build_audit(payload)
    save_audit(audit, args.audit)
    print_audit(audit)

    print(
        f"Concluído: {payload['foods_collected']}/{payload['foods_requested']} alimentos. "
        f"JSON={args.out} CSV={args.csv} AUDIT={args.audit}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
