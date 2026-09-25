import argparse
import json
import re
from collections import defaultdict

import openpyxl

DATA = "data.js"
DB = "db.json"

PRESETS = {
    "capital": {
        "xlsx": "lista-agosto-2026-capital.xlsx",
        "out_json": "agosto-2026-capital-prices.json",
        "list_id": "lista-mayorista",
        "list_name": "Agosto 2026 Capital",
    },
    "interior": {
        "xlsx": "lista-agosto-2026-interior.xlsx",
        "out_json": "agosto-2026-interior-prices.json",
        "list_id": "lista-interior",
        "list_name": "Agosto 2026 Interior",
    },
}


def digits(value):
    return re.sub(r"\D", "", str(value or ""))


def compact(value):
    d = digits(value).lstrip("0")
    return d or "0"


def product_keys(code):
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
    raw = open(DATA, encoding="utf-8").read()
    raw = re.sub(r"^window\.PRODUCTS\s*=\s*", "", raw.strip()).rstrip(";")
    return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description="Importar lista de precios agosto 2026")
    parser.add_argument(
        "preset",
        nargs="?",
        choices=sorted(PRESETS),
        default="capital",
        help="Lista a importar (default: capital)",
    )
    parser.add_argument("--xlsx", help="Ruta al Excel (override)")
    parser.add_argument("--list-id", help="ID de la lista en db.json (override)")
    parser.add_argument("--list-name", help="Nombre visible de la lista (override)")
    parser.add_argument("--out-json", help="JSON seed de salida (override)")
    args = parser.parse_args()

    cfg = dict(PRESETS[args.preset])
    if args.xlsx:
        cfg["xlsx"] = args.xlsx
    if args.out_json:
        cfg["out_json"] = args.out_json
    if args.list_id:
        cfg["list_id"] = args.list_id
    if args.list_name:
        cfg["list_name"] = args.list_name

    products = load_products()
    by_key = defaultdict(list)
    for p in products:
        for key in product_keys(p["code"]):
            by_key[key].append(p)

    wb = openpyxl.load_workbook(cfg["xlsx"], data_only=True)
    ws = wb.active
    prices = {}
    matched_excel = 0
    unmatched_excel = []
    used_excel = set()

    for row in ws.iter_rows(min_row=3, values_only=True):
        code, name, price = row[:3]
        if price is None or not str(code or "").strip():
            continue
        try:
            amount = round(float(price), 2)
        except (TypeError, ValueError):
            continue
        key = compact(code)
        hits = by_key.get(key) or []
        if not hits:
            unmatched_excel.append((str(code), name, amount))
            continue
        matched_excel += 1
        used_excel.add(key)
        for p in hits:
            prices[p["id"]] = amount

    missing_catalog = []
    for p in products:
        if p["id"] in prices:
            continue
        keys = product_keys(p["code"])
        if keys & used_excel:
            continue
        missing_catalog.append(f"{p['code']} {p['name']}")

    with open(cfg["out_json"], "w", encoding="utf-8") as f:
        json.dump(prices, f, indent=2, ensure_ascii=False)
        f.write("\n")

    db = json.loads(open(DB, encoding="utf-8").read())
    lists = db.setdefault("priceLists", [])
    target = next((item for item in lists if item.get("id") == cfg["list_id"]), None)
    if not target:
        target = {"id": cfg["list_id"], "name": cfg["list_name"], "prices": {}}
        lists.append(target)
    target["name"] = cfg["list_name"]
    target["prices"] = prices

    with open(DB, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"lista: {cfg['list_id']} ({cfg['list_name']})")
    print(f"productos con precio: {len(prices)} / {len(products)}")
    print(f"filas excel matcheadas: {matched_excel}")
    print(f"filas excel sin articulo en catalogo: {len(unmatched_excel)}")
    if unmatched_excel:
        for code, name, amount in unmatched_excel[:20]:
            print(f" - {code} {name} -> {amount}")
        if len(unmatched_excel) > 20:
            print(f"   ... y {len(unmatched_excel) - 20} mas")
    if missing_catalog:
        print("en catalogo sin precio:")
        for line in missing_catalog:
            print(" -", line)


if __name__ == "__main__":
    main()
