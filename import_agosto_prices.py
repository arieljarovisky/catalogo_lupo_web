import json
import re
from collections import defaultdict

import openpyxl

DATA = "data.js"
DB = "db.json"
XLSX = "lista-agosto-2026-capital.xlsx"
OUT_JSON = "agosto-2026-capital-prices.json"


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
    products = load_products()
    by_key = defaultdict(list)
    for p in products:
        for key in product_keys(p["code"]):
            by_key[key].append(p)

    wb = openpyxl.load_workbook(XLSX, data_only=True)
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

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(prices, f, indent=2, ensure_ascii=False)
        f.write("\n")

    db = json.loads(open(DB, encoding="utf-8").read())
    lists = db.setdefault("priceLists", [])
    mayorista = next((item for item in lists if item.get("id") == "lista-mayorista"), None)
    if not mayorista:
        mayorista = {"id": "lista-mayorista", "name": "Agosto 2026 Capital", "prices": {}}
        lists.insert(0, mayorista)
    mayorista["name"] = "Agosto 2026 Capital"
    mayorista["prices"] = prices

    with open(DB, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"productos con precio: {len(prices)} / {len(products)}")
    print(f"filas excel matcheadas: {matched_excel}")
    print(f"filas excel sin articulo en catalogo: {len(unmatched_excel)}")
    if missing_catalog:
        print("en catalogo sin precio:")
        for line in missing_catalog:
            print(" -", line)


if __name__ == "__main__":
    main()
