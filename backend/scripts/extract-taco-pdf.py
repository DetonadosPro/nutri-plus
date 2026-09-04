from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ContentStream


EXPECTED_PDF_SHA256 = "2002aec5615b5b1395aaa8fa675635bbb7f712c33f278af5e332f1cac8f108c8"
TABLE_LEFT_PAGES = tuple(range(29, 69, 2))
TABLE_RIGHT_PAGES = tuple(page + 1 for page in TABLE_LEFT_PAGES)
EXPECTED_CODES = set(range(1, 598))


@dataclass(frozen=True)
class Nutrient:
    code: str
    name: str
    unit: str
    group: str
    sort_order: int
    page_half: str
    x_center: float
    sane_min: float = 0
    sane_max: float | None = None


NUTRIENTS = (
    Nutrient("umidade_percent", "Umidade", "%", "macro", 1, "left", 392, 0, 100),
    Nutrient("energia_kcal", "Energia", "kcal", "energy", 2, "left", 427, 0, 1_000),
    Nutrient("energia_kj", "Energia", "kJ", "energy", 3, "left", 456, 0, 5_000),
    Nutrient("proteina_g", "Proteína", "g", "macro", 4, "left", 489, 0, 100),
    Nutrient("lipideos_g", "Lipídeos", "g", "macro", 5, "left", 528, 0, 100),
    Nutrient("colesterol_mg", "Colesterol", "mg", "other", 6, "left", 570),
    Nutrient("carboidrato_g", "Carboidrato", "g", "macro", 7, "left", 609, 0, 100),
    Nutrient("fibra_g", "Fibra alimentar", "g", "macro", 8, "left", 647, 0, 100),
    Nutrient("cinzas_g", "Cinzas", "g", "other", 9, "left", 684, 0, 100),
    Nutrient("calcio_mg", "Cálcio", "mg", "mineral", 10, "left", 716),
    Nutrient("magnesio_mg", "Magnésio", "mg", "mineral", 11, "left", 753),
    Nutrient("manganes_mg", "Manganês", "mg", "mineral", 12, "right", 147),
    Nutrient("fosforo_mg", "Fósforo", "mg", "mineral", 13, "right", 197),
    Nutrient("ferro_mg", "Ferro", "mg", "mineral", 14, "right", 237),
    Nutrient("sodio_mg", "Sódio", "mg", "mineral", 15, "right", 279),
    Nutrient("potassio_mg", "Potássio", "mg", "mineral", 16, "right", 329),
    Nutrient("cobre_mg", "Cobre", "mg", "mineral", 17, "right", 370),
    Nutrient("zinco_mg", "Zinco", "mg", "mineral", 18, "right", 404),
    Nutrient("retinol_ug", "Retinol", "µg", "vitamin", 19, "right", 441),
    Nutrient("re_ug", "RE", "µg", "vitamin", 20, "right", 493),
    Nutrient("rae_ug", "RAE", "µg", "vitamin", 21, "right", 518),
    Nutrient("tiamina_mg", "Tiamina", "mg", "vitamin", 22, "right", 560),
    Nutrient("riboflavina_mg", "Riboflavina", "mg", "vitamin", 23, "right", 609),
    Nutrient("piridoxina_mg", "Piridoxina", "mg", "vitamin", 24, "right", 663),
    Nutrient("niacina_mg", "Niacina", "mg", "vitamin", 25, "right", 708),
    Nutrient("vitamina_c_mg", "Vitamina C", "mg", "vitamin", 26, "right", 751),
)

GROUPS = (
    "Cereais e derivados",
    "Verduras, hortaliças e derivados",
    "Frutas e derivados",
    "Gorduras e óleos",
    "Pescados e frutos do mar",
    "Carnes e derivados",
    "Leite e derivados",
    "Bebidas (alcoólicas e não alcoólicas)",
    "Ovos e derivados",
    "Produtos açucarados",
    "Miscelâneas",
    "Outros alimentos industrializados",
    "Alimentos preparados",
    "Leguminosas e derivados",
    "Nozes e sementes",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def raw_text(operand: Any) -> bytes:
    if isinstance(operand, list):
        return b"".join(raw_text(item) for item in operand if not isinstance(item, (int, float)))
    return getattr(operand, "original_bytes", b"")


def raw_rows(reader: PdfReader, page_number: int) -> dict[int, list[str]]:
    page = reader.pages[page_number - 1]
    content = ContentStream(page.get_contents(), reader)
    rows: dict[int, list[str]] = {}
    for operands, operator in content.operations:
        if operator not in (b"Tj", b"TJ") or not operands:
            continue
        decoded = re.sub(r"\s+", " ", raw_text(operands[0]).decode("cp1252", errors="replace")).strip()
        match = re.match(r"^(\d{1,3})\s+(.+)$", decoded)
        if match:
            rows.setdefault(int(match.group(1)), []).append(match.group(2))
    return rows


def repair_description(code: int, extracted: str, candidates: list[str]) -> str:
    def masked(value: str) -> str:
        return "".join("?" if character == "�" else character for character in value)

    expected_mask = masked(extracted)
    for candidate in candidates:
        prefix = candidate[: len(extracted)]
        if len(prefix) == len(extracted) and all(a == "?" or a == b for a, b in zip(expected_mask, prefix)):
            return prefix
    if "�" not in extracted:
        return extracted
    raise ValueError(f"Não foi possível recuperar os acentos da descrição do alimento {code}: {extracted!r}")


def parse_value(raw: str) -> dict[str, Any]:
    cleaned = raw.strip().replace("−", "-")
    cleaned = re.sub(r"(?<=\d)[a-z]+$", "", cleaned, flags=re.IGNORECASE)
    if not cleaned or cleaned in {"*", "-", "—", "NA", "N/A"}:
        return {"numeric_value": None, "raw_value": cleaned, "status": "missing"}
    if cleaned.casefold() == "tr":
        return {"numeric_value": None, "raw_value": "Tr", "status": "trace"}
    normalized = cleaned.replace(".", "").replace(",", ".")
    try:
        value = float(normalized)
    except ValueError as error:
        raise ValueError(f"Valor nutricional inválido: {raw!r}") from error
    return {"numeric_value": value, "raw_value": cleaned, "status": "numeric"}


def words_on_row(words: list[dict[str, Any]], top: float) -> list[dict[str, Any]]:
    return [word for word in words if abs(float(word["top"]) - top) <= 1.7]


def parse_row_nutrients(row: list[dict[str, Any]], nutrients: list[Nutrient], page: int, code: int) -> dict[str, dict[str, Any]]:
    assigned: dict[str, list[tuple[float, str]]] = {nutrient.code: [] for nutrient in nutrients}
    seen: set[tuple[float, float, str]] = set()
    for word in row:
        identity = (round(float(word["x0"]), 1), round(float(word["x1"]), 1), str(word["text"]))
        if identity in seen:
            continue
        seen.add(identity)
        word_center = (float(word["x0"]) + float(word["x1"])) / 2
        nutrient = min(nutrients, key=lambda item: abs(word_center - item.x_center))
        distance = abs(word_center - nutrient.x_center)
        if distance <= 19:
            assigned[nutrient.code].append((distance, str(word["text"])))

    parsed: dict[str, dict[str, Any]] = {}
    for nutrient in nutrients:
        raw = min(assigned[nutrient.code], default=(0, ""), key=lambda item: item[0])[1]
        try:
            parsed[nutrient.code] = parse_value(raw)
        except ValueError as error:
            positions = [(round(float(word["x0"]), 1), round(float(word["x1"]), 1), str(word["text"])) for word in row]
            raise ValueError(f"Página {page}, alimento {code}, coluna {nutrient.code}, valor {raw!r}, palavras {positions}") from error
    return parsed


def extract_rows(pdf_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    left_nutrients = [item for item in NUTRIENTS if item.page_half == "left"]
    right_nutrients = [item for item in NUTRIENTS if item.page_half == "right"]
    left_rows: dict[int, dict[str, Any]] = {}
    right_rows: dict[int, dict[str, Any]] = {}
    detected_groups: list[tuple[int, float]] = []
    reader = PdfReader(str(pdf_path))

    with pdfplumber.open(str(pdf_path)) as document:
        current_group: str | None = None
        group_index = 0
        for left_page_number, right_page_number in zip(TABLE_LEFT_PAGES, TABLE_RIGHT_PAGES):
            left_page = document.pages[left_page_number - 1]
            left_words = left_page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False, extra_attrs=["fontname", "size"])
            raw_by_code = raw_rows(reader, left_page_number)

            events: list[tuple[float, str, Any]] = []
            for word in left_words:
                if 140 < float(word["top"]) < 540 and 70 < float(word["x0"]) < 110 and re.fullmatch(r"\d{1,3}", str(word["text"])):
                    events.append((float(word["top"]), "row", word))

            line_words: dict[float, list[dict[str, Any]]] = {}
            for word in left_words:
                if 140 < float(word["top"]) < 540 and float(word["x0"]) < 360:
                    line_words.setdefault(round(float(word["top"]), 1), []).append(word)
            for top, line in line_words.items():
                if any("Bold" in str(word.get("fontname", "")) and abs(float(word.get("size", 0)) - 9) < 0.3 for word in line):
                    if not any(70 < float(word["x0"]) < 110 and re.fullmatch(r"\d{1,3}", str(word["text"])) for word in line):
                        events.append((top, "group", line))

            for top, kind, payload in sorted(events, key=lambda item: (item[0], 0 if item[1] == "group" else 1)):
                if kind == "group":
                    if group_index >= len(GROUPS):
                        raise ValueError(f"Grupo inesperado na página {left_page_number}, y={top}")
                    current_group = GROUPS[group_index]
                    detected_groups.append((left_page_number, top))
                    group_index += 1
                    continue

                code = int(str(payload["text"]))
                row = words_on_row(left_words, top)
                description_words = [word for word in row if 110 <= float(word["x0"]) < 370]
                extracted_description = " ".join(str(word["text"]) for word in sorted(description_words, key=lambda item: float(item["x0"]))).strip()
                if not current_group or not extracted_description:
                    raise ValueError(f"Linha esquerda incompleta: página {left_page_number}, alimento {code}")
                description = repair_description(code, extracted_description, raw_by_code.get(code, []))
                left_rows[code] = {
                    "source_code": str(code),
                    "description": description,
                    "group": current_group,
                    "nutrients": parse_row_nutrients(row, left_nutrients, left_page_number, code),
                    "pdf_pages": [left_page_number, right_page_number],
                }

            right_page = document.pages[right_page_number - 1]
            right_words = right_page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False)
            for word in right_words:
                if not (140 < float(word["top"]) < 540 and 70 < float(word["x0"]) < 110 and re.fullmatch(r"\d{1,3}", str(word["text"]))):
                    continue
                code = int(str(word["text"]))
                row = words_on_row(right_words, float(word["top"]))
                right_rows[code] = parse_row_nutrients(row, right_nutrients, right_page_number, code)

    if len(detected_groups) != len(GROUPS):
        raise ValueError(f"Esperados {len(GROUPS)} grupos; encontrados {len(detected_groups)}")
    if set(left_rows) != EXPECTED_CODES or set(right_rows) != EXPECTED_CODES:
        raise ValueError({
            "left_missing": sorted(EXPECTED_CODES - set(left_rows)),
            "left_extra": sorted(set(left_rows) - EXPECTED_CODES),
            "right_missing": sorted(EXPECTED_CODES - set(right_rows)),
            "right_extra": sorted(set(right_rows) - EXPECTED_CODES),
        })

    errors: list[str] = []
    foods: list[dict[str, Any]] = []
    status_counts = {"numeric": 0, "trace": 0, "missing": 0}
    fully_numeric = 0
    all_missing_foods: list[int] = []
    for code in sorted(EXPECTED_CODES):
        food = left_rows[code]
        food["nutrients"].update(right_rows[code])
        if "�" in food["description"] or "�" in food["group"]:
            errors.append(f"Alimento {code}: caractere Unicode não recuperado")
        if set(food["nutrients"]) != {item.code for item in NUTRIENTS}:
            errors.append(f"Alimento {code}: conjunto de nutrientes incompleto")
        for nutrient in NUTRIENTS:
            value = food["nutrients"][nutrient.code]
            status_counts[value["status"]] += 1
            numeric = value["numeric_value"]
            if numeric is not None and (numeric < nutrient.sane_min or (nutrient.sane_max is not None and numeric > nutrient.sane_max)):
                errors.append(f"Alimento {code} ({food['description']}): {nutrient.code}={numeric} fora de {nutrient.sane_min}..{nutrient.sane_max}")
        # Na TACO, carboidrato por diferença já engloba a fibra; somá-la novamente
        # produziria um falso excesso centesimal.
        centesimal_codes = ("umidade_percent", "proteina_g", "lipideos_g", "carboidrato_g", "cinzas_g")
        centesimal = [food["nutrients"][item]["numeric_value"] for item in centesimal_codes]
        if all(value is not None for value in centesimal) and sum(centesimal) > 105:
            errors.append(f"Alimento {code} ({food['description']}): soma centesimal impossível {sum(centesimal):.2f}")
        kcal = food["nutrients"]["energia_kcal"]["numeric_value"]
        kj = food["nutrients"]["energia_kj"]["numeric_value"]
        if kcal is not None and kcal >= 10 and kj is not None and not 3.9 <= kj / kcal <= 4.5:
            errors.append(f"Alimento {code} ({food['description']}): relação kJ/kcal inesperada {kj / kcal:.3f}")
        if all(value["status"] == "missing" for value in food["nutrients"].values()):
            all_missing_foods.append(code)
            if code != 591:
                errors.append(f"Alimento {code} ({food['description']}): ausência total não prevista")
        if all(value["status"] == "numeric" for value in food["nutrients"].values()):
            fully_numeric += 1
        foods.append(food)

    if errors:
        raise ValueError("Falhas de sanidade na extração:\n" + "\n".join(errors[:50]))
    return foods, {
        "foods": len(foods),
        "structurally_complete": sum(len(food["nutrients"]) == len(NUTRIENTS) for food in foods),
        "fully_numeric": fully_numeric,
        "with_missing_or_trace": len(foods) - fully_numeric,
        "status_counts": status_counts,
        "duplicates": len(foods) - len({food["source_code"] for food in foods}),
        "groups": len({food["group"] for food in foods}),
        "all_missing_foods": all_missing_foods,
    }


def write_csv(path: Path, foods: list[dict[str, Any]]) -> None:
    columns = ["source_code", "description", "group", "pdf_page_left", "pdf_page_right"]
    for item in NUTRIENTS:
        columns.extend([item.code, f"{item.code}_status"])
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for food in foods:
            row = {"source_code": food["source_code"], "description": food["description"], "group": food["group"], "pdf_page_left": food["pdf_pages"][0], "pdf_page_right": food["pdf_pages"][1]}
            for code, value in food["nutrients"].items():
                row[code] = value["raw_value"]
                row[f"{code}_status"] = value["status"]
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrai a TACO 4ª edição diretamente do PDF oficial local.")
    parser.add_argument("--pdf", type=Path, default=Path(__file__).parents[1] / "data" / "taco" / "taco_4_edicao.pdf")
    parser.add_argument("--json", type=Path, default=Path(__file__).parents[1] / "data" / "taco" / "taco_normalizada.json")
    parser.add_argument("--csv", type=Path, default=Path(__file__).parents[1] / "data" / "taco" / "taco_normalizada.csv")
    args = parser.parse_args()

    actual_sha = sha256(args.pdf)
    if actual_sha != EXPECTED_PDF_SHA256:
        raise ValueError(f"PDF inesperado. SHA-256 esperado {EXPECTED_PDF_SHA256}; encontrado {actual_sha}")
    foods, audit = extract_rows(args.pdf)
    payload = {
        "metadata": {
            "source": "TACO",
            "edition": "4ª edição ampliada e revisada",
            "reference_amount": 100,
            "reference_unit": "g",
            "pdf_file": args.pdf.name,
            "pdf_sha256": actual_sha,
            "table_pages": {"left": list(TABLE_LEFT_PAGES), "right": list(TABLE_RIGHT_PAGES)},
            "audit": audit,
        },
        "nutrients": [
            {"code": item.code, "name": item.name, "unit": item.unit, "group": item.group, "sort_order": item.sort_order}
            for item in NUTRIENTS
        ],
        "foods": foods,
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_csv(args.csv, foods)
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
