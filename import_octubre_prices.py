#!/usr/bin/env python3
"""Importar lista de precios Octubre 2026 desde el PDF mayorista."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

DATA = Path("data.js")
DB = Path("db.json")
DEFAULT_PDF = Path("pdfs/Lupo_Lista_Octubre_2026.pdf")

# Códigos de la lista que en el catálogo AR figuran con otro sufijo.
CODE_ALIASES = {
    "18471-01": ["18471-02"],
    "40460-01": ["40460-003", "40460-03"],
    "5694-01": ["5694-003", "5694-03"],
    "3290-11": ["03290-114", "3290-114"],
}

PRESETS = {
    "capital": {
        "list_id": "lista-mayorista",
        "list_name": "Octubre 2026",
        "out_json": "octubre-2026-capital-prices.json",
        "multiplier": 1.0,
        "replace_seed": True,
    },
    "interior": {
        "list_id": "lista-interior",
        "list_name": "Octubre 2026 Interior",
        "out_json": "octubre-2026-interior-prices.json",
        # Misma diferencia histórica Capital → Interior (+4%).
        "multiplier": 1.04,
        "replace_seed": True,
    },
}


def digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def compact(value: object) -> str:
    d = digits(value).lstrip("0")
    return d or "0"


def product_keys(code: object) -> set[str]:
    raw = str(code or "").strip()
    keys = {compact(raw)}
    if "-" not in raw:
        return keys
    base, suffix = raw.split("-", 1)
    base = base.lstrip("0") or "0"
    suffix = suffix.strip()
    keys.add(compact(base + suffix))
    keys.add(compact(base + suffix.lstrip("0")))
    if len(suffix) >= 2:
        keys.add(compact(base + suffix[-2:]))
    if len(suffix) >= 3 and suffix.startswith("0"):
        keys.add(compact(base + suffix[1:]))
    keys.add(compact(base))
    return {k for k in keys if k}


def load_products():
    raw = DATA.read_text(encoding="utf-8")
    raw = re.sub(r"^window\.PRODUCTS\s*=\s*", "", raw.strip()).rstrip(";")
    return json.loads(raw)


def extract_pdf_text(pdf_path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def expand_codes(raw: str) -> list[str]:
    """523-02/03 -> dos códigos; 3270/3170-89 -> dos bases."""
    m = re.match(r"^(\d+)-(\d+)/(\d+)$", raw)
    if m:
        base, s1, s2 = m.groups()
        return [f"{base}-{s1}", f"{base}-{s2}"]
    m = re.match(r"^(\d+)/(\d+)-(\d+)$", raw)
    if m:
        b1, b2, suf = m.groups()
        return [f"{b1}-{suf}", f"{b2}-{suf}"]
    return [raw]


def parse_pdf_entries(text: str) -> list[dict]:
    price_re = re.compile(r"\$\s*([\d.]+),(\d{2})")
    code_re = re.compile(r"^(\d[\d/]*-\d[\d/]*)\s*·")
    lines = [ln.rstrip() for ln in text.splitlines()]
    entries: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = price_re.search(line)
        if m:
            name = price_re.sub("", line).strip()
            amount = float(m.group(1).replace(".", "") + "." + m.group(2))
            j = i + 1
            code_line = None
            while j < len(lines) and j <= i + 4:
                cl = lines[j].strip()
                if not cl:
                    j += 1
                    continue
                cm = code_re.match(cl)
                if cm:
                    code_line = cm.group(1)
                    break
                if (
                    price_re.search(cl)
                    or cl.startswith("Los precios")
                    or cl.startswith("LUPO")
                    or "art." in cl
                ):
                    break
                name = f"{name} {cl}".strip() if name else cl
                j += 1
            if code_line:
                entries.append(
                    {
                        "raw_code": code_line,
                        "name": name,
                        "price": round(amount, 2),
                    }
                )
                i = j
        i += 1
    return entries


def codes_for_entry(raw_code: str) -> list[str]:
    codes: list[str] = []
    for code in expand_codes(raw_code):
        codes.append(code)
        codes.extend(CODE_ALIASES.get(code, []))
    # unique preserve order
    seen = set()
    out = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def match_prices(entries: list[dict], products: list[dict], multiplier: float):
    by_key: dict[str, list] = defaultdict(list)
    for p in products:
        for key in product_keys(p["code"]):
            by_key[key].append(p)

    prices: dict[str, float] = {}
    matched_rows = 0
    unmatched: list[tuple] = []
    used_keys: set[str] = set()

    for entry in entries:
        row_matched = False
        amount = round(entry["price"] * multiplier, 2)
        for code in codes_for_entry(entry["raw_code"]):
            key = compact(code)
            hits = by_key.get(key) or []
            if not hits:
                continue
            row_matched = True
            used_keys.add(key)
            for p in hits:
                prices[p["id"]] = amount
        if row_matched:
            matched_rows += 1
        else:
            unmatched.append((entry["raw_code"], entry["name"], amount))

    return prices, matched_rows, unmatched, used_keys


def argentina_products(products: list[dict]) -> list[dict]:
    arg_cats = {
        "Lencería 2026",
        "Medias 2026",
        "Boxers y Slips 2026",
        "Lupo Pijamas Invierno",
        "Lupo Pijamas Verano",
    }
    return [p for p in products if p.get("catalog") in arg_cats]


def main():
    parser = argparse.ArgumentParser(description="Importar lista Octubre 2026 desde PDF")
    parser.add_argument(
        "preset",
        nargs="?",
        choices=sorted(PRESETS),
        default="capital",
        help="Lista a importar (default: capital)",
    )
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF, help="Ruta al PDF")
    parser.add_argument("--list-id", help="ID de la lista en db.json")
    parser.add_argument("--list-name", help="Nombre visible de la lista")
    parser.add_argument("--out-json", help="JSON seed de salida")
    parser.add_argument(
        "--multiplier",
        type=float,
        help="Multiplicador de precios (interior suele ser 1.04)",
    )
    args = parser.parse_args()

    cfg = dict(PRESETS[args.preset])
    if args.list_id:
        cfg["list_id"] = args.list_id
    if args.list_name:
        cfg["list_name"] = args.list_name
    if args.out_json:
        cfg["out_json"] = args.out_json
    if args.multiplier is not None:
        cfg["multiplier"] = args.multiplier

    if not args.pdf.exists():
        raise SystemExit(f"No existe el PDF: {args.pdf}")

    text = extract_pdf_text(args.pdf)
    entries = parse_pdf_entries(text)
    if len(entries) < 80:
        raise SystemExit(f"Se esperaban ~94 artículos; se parsearon {len(entries)}")

    products = load_products()
    prices, matched_rows, unmatched, used_keys = match_prices(
        entries, products, cfg["multiplier"]
    )

    # Seed JSON: solo productos AR del catálogo local (como agosto).
    arg_ids = {p["id"] for p in argentina_products(products)}
    seed_prices = {pid: price for pid, price in prices.items() if pid in arg_ids}

    out_path = Path(cfg["out_json"])
    out_path.write_text(
        json.dumps(seed_prices, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    db = json.loads(DB.read_text(encoding="utf-8"))
    lists = db.setdefault("priceLists", [])
    target = next((item for item in lists if item.get("id") == cfg["list_id"]), None)
    if not target:
        target = {"id": cfg["list_id"], "name": cfg["list_name"], "prices": {}}
        lists.append(target)

    target["name"] = cfg["list_name"]
    existing = dict(target.get("prices") or {})

    # Solo aplicar a catálogo Argentina; conservar precios previos
    # de artículos que no vienen en esta lista (p. ej. pijamas).
    arg_ids = {p["id"] for p in argentina_products(products)}
    for pid, amount in prices.items():
        if pid in arg_ids:
            existing[pid] = amount
    target["prices"] = existing

    DB.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    missing = []
    for p in argentina_products(products):
        if p["id"] in seed_prices:
            continue
        keys = product_keys(p["code"])
        if keys & used_keys:
            continue
        # Solo reportar medias / lencería / boxers (no pijamas).
        if p["catalog"] in {"Lupo Pijamas Invierno", "Lupo Pijamas Verano"}:
            continue
        missing.append(f"{p['code']} {p['name']}")

    print(f"lista: {cfg['list_id']} ({cfg['list_name']})")
    print(f"artículos PDF: {len(entries)}")
    print(f"filas matcheadas: {matched_rows}")
    print(f"productos con precio (todos): {len(prices)}")
    print(f"seed AR: {len(seed_prices)} -> {out_path}")
    print(f"filas PDF sin artículo en catálogo: {len(unmatched)}")
    for code, name, amount in unmatched:
        print(f" - {code} {name} -> {amount}")
    if missing:
        print("en catálogo AR (medias/lencería/boxers) sin precio octubre:")
        for line in missing:
            print(" -", line)


if __name__ == "__main__":
    main()
