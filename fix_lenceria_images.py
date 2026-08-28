#!/usr/bin/env python3
"""Re-crop lencería product and color images using the correct PDF column per code."""

import json
import os
import re

import fitz

from extract_color_photos import crop_rect_for_color, labels_in_clip, lines_in, match_color, norm
from extract_new_catalogs import codes_in, photo_clip, slug

PDF = "pdfs/nuevos-catalogos/lenceria-2026.pdf"
DATA = "data.js"
OUT_PRODUCTS = "assets/products"
OUT_COLORS = "assets/colors"
KEY = "lenceria-2026"


def column_index_for_code(page, code):
    w, h = page.rect.width, page.rect.height
    arts = codes_in(page.get_text("text"))
    if len(arts) <= 1:
        return 0
    n = len(arts)
    for idx in range(n):
        region = page.get_text("text", clip=fitz.Rect((w / n) * idx, 0, (w / n) * (idx + 1), h))
        col_codes = codes_in(region)
        if col_codes and col_codes[-1] == code:
            return idx
    return arts.index(code) if code in arts else 0


def render_page(page, path, clip=None, zoom=1.7):
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    pix.save(path)
    return path.replace("\\", "/")


def load_products():
    text = open(DATA, encoding="utf-8").read()
    m = re.search(r"window\.PRODUCTS\s*=\s*(\[.*\])\s*;", text, re.S)
    if not m:
        raise SystemExit("Could not parse data.js")
    return json.loads(m.group(1))


def save_products(products):
    with open(DATA, "w", encoding="utf-8") as f:
        f.write(f"window.PRODUCTS = {json.dumps(products, ensure_ascii=False, indent=2)};\n")


def recrop_color_photos(page, p, pdf):
    arts = codes_in(page.get_text("text"))
    n = len(arts)
    if n <= 1:
        clip = page.rect
    else:
        idx = column_index_for_code(page, p["code"])
        col = page.rect.width / n
        clip = fitz.Rect(page.rect.x0 + col * idx, page.rect.y0, page.rect.x0 + col * (idx + 1), page.rect.y1)
    colors = p.get("colors") or []
    labels = labels_in_clip(page, clip)
    ordered = sorted(enumerate(colors), key=lambda item: -len(norm(item[1].get("name"))))
    used = set()
    matched = {}
    for idx, color in ordered:
        hit = match_color(color, labels, used)
        if hit is None:
            continue
        used.add(hit)
        matched[idx] = labels[hit][1]
    placed = sorted(((bbox[1], bbox[0], idx, bbox) for idx, bbox in matched.items()))
    prev_by_col = {}
    updated = 0
    for _y, _x, idx, bbox in placed:
        col_key = round(((bbox[0] + bbox[2]) / 2) / 40)
        prev = prev_by_col.get(col_key)
        rect = crop_rect_for_color(page, bbox, prev, pdf, clip)
        prev_by_col[col_key] = bbox
        rel = f"{OUT_COLORS}/{p['id']}-{idx + 1:02d}.jpg".replace("\\", "/")
        pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), clip=rect, alpha=False)
        pix.save(rel)
        colors[idx]["image"] = rel
        updated += 1
    p["colors"] = colors
    return updated


def main():
    os.makedirs(OUT_PRODUCTS, exist_ok=True)
    os.makedirs(OUT_COLORS, exist_ok=True)
    doc = fitz.open(PDF)
    products = load_products()
    product_count = 0
    color_count = 0
    for p in products:
        if p.get("catalog") != "Lencería 2026":
            continue
        page_no = int(p.get("page") or 0)
        if page_no < 1:
            continue
        page = doc[page_no - 1]
        arts = codes_in(page.get_text("text"))
        if len(arts) < 2:
            continue
        n = len(arts)
        idx = column_index_for_code(page, p["code"])
        if idx == arts.index(p["code"]) if p["code"] in arts else True:
            # Still recrop if on a multi-art page — order may have been wrong before
            pass
        img_rel = os.path.join(OUT_PRODUCTS, f"{KEY}-{slug(p['code'])}-{page_no}.jpg")
        clip = photo_clip(page, KEY, n, idx)
        p["image"] = render_page(page, img_rel, clip=clip, zoom=1.7)
        product_count += 1
        color_count += recrop_color_photos(page, p, PDF)
        print(f"  {p['code']} col={idx} -> {p['name']}")
    save_products(products)
    print(f"Re-cropped {product_count} products, {color_count} color photos")


if __name__ == "__main__":
    main()
