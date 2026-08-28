#!/usr/bin/env python3
"""Fix lencería products where PDF column order swapped codes vs titles."""

import json
import re

import fitz

from extract_new_catalogs import (
    colors_in,
    codes_in,
    description_in,
    sizes_in,
    title_from_clip,
)

PDF = "pdfs/nuevos-catalogos/lenceria-2026.pdf"
DATA = "data.js"


def column_products(page, page_no):
    w, h = page.rect.width, page.rect.height
    arts = codes_in(page.get_text("text"))
    if len(arts) < 2:
        return []
    n = len(arts)
    out = []
    for idx in range(n):
        region_rect = fitz.Rect((w / n) * idx, 0, (w / n) * (idx + 1), h)
        region_text = page.get_text("text", clip=region_rect)
        col_codes = codes_in(region_text)
        if not col_codes:
            continue
        code = col_codes[-1]
        title_rect = fitz.Rect(
            (w / n) * idx if n > 1 else w * 0.48,
            0,
            (w / n) * (idx + 1) if n > 1 else w,
            h,
        )
        out.append({
            "code": code,
            "name": title_from_clip(page, title_rect) or f"Artículo {code}",
            "colors": colors_in(region_text),
            "sizes": sizes_in(region_text) or "Consultar",
            "description": description_in(region_text),
            "page": page_no,
        })
    return out


def load_products():
    text = open(DATA, encoding="utf-8").read()
    m = re.search(r"window\.PRODUCTS\s*=\s*(\[.*\])\s*;", text, re.S)
    if not m:
        raise SystemExit("Could not parse data.js")
    return json.loads(m.group(1))


def save_products(products):
    with open(DATA, "w", encoding="utf-8") as f:
        f.write(f"window.PRODUCTS = {json.dumps(products, ensure_ascii=False, indent=2)};\n")


def merge_colors(old_colors, new_colors):
    by_name = {}
    by_code = {}
    for c in old_colors or []:
        name = (c.get("name") or "").lower()
        code = (c.get("code") or "").upper()
        if name:
            by_name[name] = c
        if code:
            by_code[code] = c
    merged = []
    for nc in new_colors:
        oc = by_name.get((nc.get("name") or "").lower()) or by_code.get((nc.get("code") or "").upper())
        item = {"code": nc["code"], "name": nc["name"]}
        if oc and oc.get("image"):
            item["image"] = oc["image"]
        merged.append(item)
    return merged


def main():
    doc = fitz.open(PDF)
    fixes = {}
    for i, page in enumerate(doc):
        for item in column_products(page, i + 1):
            fixes[item["code"]] = item

    products = load_products()
    changed = []
    for p in products:
        fix = fixes.get(p.get("code"))
        if not fix or p.get("catalog") != "Lencería 2026":
            continue
        before = p.get("name")
        p["name"] = fix["name"]
        p["sizes"] = fix["sizes"]
        if fix["description"]:
            p["description"] = fix["description"]
        p["colors"] = merge_colors(p.get("colors"), fix["colors"])
        if before != p["name"]:
            changed.append((p["code"], before, p["name"]))

    save_products(products)
    print(f"Updated {len(changed)} products:")
    for code, before, after in changed:
        print(f"  {code}: {before!r} -> {after!r}")


if __name__ == "__main__":
    main()
