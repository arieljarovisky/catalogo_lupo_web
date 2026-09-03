#!/usr/bin/env python3
"""Extrae artículos de los catálogos Lupo Pijamas Invierno / Verano y los fusiona en data.js."""

import json
import os
import re

import fitz

OUT_PRODUCTS = "assets/products"
OUT_PAGES = "assets/pages"
OUT_COLORS = "assets/colors"
DATA = "data.js"

CATALOGS = [
    {
        "key": "lupo-pijamas-invierno",
        "name": "Lupo Pijamas Invierno",
        "pdf": "pdfs/nuevos-catalogos/pijamas-invierno.pdf",
        "category_fallback": "Pijamas",
    },
    {
        "key": "lupo-pijamas-verano",
        "name": "Lupo Pijamas Verano",
        "pdf": "pdfs/nuevos-catalogos/pijamas-verano.pdf",
        "category_fallback": "Pijamas",
    },
]

CODE_RE = re.compile(r"\b(\d{4,5}-\d{2,3})\b")
SIZE_RE = re.compile(
    r"Tamanho\s*((?:P|M|G|GG|XG|XXG|U|\d{1,2})[^\n]*)",
    re.I,
)
NAME_HINT = re.compile(
    r"^(Pijama|Camisola|Short\s*Doll|Bata|Cueca|Calcinha|Baby\s*Doll|Conjunto)\b",
    re.I,
)
SKIP_LINE = re.compile(
    r"^(Lupo|LAN[CÇ]AMENTO|Tecnologia|Cor|Tamanho|FEMININO|MASCULINO|"
    r"ADUL\s*TO|M[ÃA]E E FILHA|FAMILIA|KIDS|INFANTIL|Blusa|Calça|Short|"
    r"Normal|Renda|Viscose|Algod[aã]o|Elastano|Poliamida|Poli[eé]ster|"
    r"www\.|\d{1,3}$)",
    re.I,
)
COLOR_NAME_CODE = re.compile(
    r"^([A-Za-zÁÉÍÓÚÂÊÔÃÕáéíóúâêôãõÇç][A-Za-zÁÉÍÓÚÂÊÔÃÕáéíóúâêôãõÇç\s]{1,28})\s+(\d{3,4})$"
)
COLOR_CODE_LINE = re.compile(r"^(\d{3,4})$")
COLOR_NAME_LINE = re.compile(
    r"^([A-Za-zÁÉÍÓÚÂÊÔÃÕáéíóúâêôãõÇç][A-Za-zÁÉÍÓÚÂÊÔÃÕáéíóúâêôãõÇç\s]{1,28})$"
)


def slug(s):
    return re.sub(r"[^a-zA-Z0-9]+", "-", str(s)).strip("-").lower()[:80]


def load_products():
    raw = open(DATA, encoding="utf-8").read().strip()
    raw = re.sub(r"^window\.PRODUCTS\s*=\s*", "", raw).rstrip(";")
    return json.loads(raw)


def save_products(products):
    with open(DATA, "w", encoding="utf-8") as f:
        f.write("window.PRODUCTS = ")
        json.dump(products, f, ensure_ascii=False)
        f.write(";\n")


def lines(text):
    return [re.sub(r"\s+", " ", ln).strip() for ln in (text or "").splitlines() if ln.strip()]


def category_from_text(text):
    t = text or ""
    if re.search(r"M[ÃA]E E FILHA", t, re.I):
        return "Mãe e Filha"
    if re.search(r"PAI E FILHO", t, re.I):
        return "Pai e Filho"
    if re.search(r"\bFAMILIA\b", t, re.I):
        return "Família"
    if re.search(r"ADUL\s*TO\s*MASCULINO|MASCULINO", t, re.I):
        return "Adulto Masculino"
    if re.search(r"ADUL\s*TO\s*FEMININO|FEMININO", t, re.I):
        return "Adulto Feminino"
    if re.search(r"\bKIDS\b|\bINFANTIL\b", t, re.I):
        return "Kids"
    return "Pijamas"


def product_name(text, code):
    for ln in lines(text):
        if code in ln:
            continue
        if NAME_HINT.search(ln) and len(ln) <= 80:
            return ln
    # fallback: first non-skip line after the code
    found_code = False
    for ln in lines(text):
        if code in ln:
            found_code = True
            continue
        if not found_code:
            continue
        if SKIP_LINE.search(ln) or COLOR_CODE_LINE.match(ln) or len(ln) < 4:
            continue
        if len(ln) <= 80 and not re.search(r"\d{2,}%", ln):
            return ln
    return f"Artigo {code}"


def sizes_in(text):
    m = SIZE_RE.search(text or "")
    if not m:
        return "Consultar"
    val = re.sub(r"\s+", " ", m.group(1)).strip(" •")
    val = val.replace(" · ", " • ").replace(" - ", " • ")
    return val or "Consultar"


def description_in(text):
    paras = []
    for chunk in re.split(r"\n+", text or ""):
        line = re.sub(r"\s+", " ", chunk).strip()
        if len(line) >= 70 and not CODE_RE.search(line) and not SKIP_LINE.search(line):
            paras.append(line)
    return " ".join(paras[:2])


def colors_in(text):
    """Parse color pairs from Cor block and/or 'Name Code' footer lines."""
    found = []
    seen = set()

    def add(code, name):
        name = re.sub(r"\s+", " ", name).strip(" ·-")
        key = (code, name.lower())
        if not name or len(name) < 3 or key in seen:
            return
        if SKIP_LINE.match(name) or name.lower() in {
            "blusa", "calça", "short", "normal", "renda", "viscose", "algodão", "elastano"
        }:
            return
        seen.add(key)
        found.append({"code": code, "name": name})

    for ln in lines(text):
        m = COLOR_NAME_CODE.match(ln)
        if m:
            add(m.group(2), m.group(1))

    # Cor block: code then 1–2 name lines
    ls = lines(text)
    try:
        cor_i = next(i for i, ln in enumerate(ls) if ln.lower() == "cor")
    except StopIteration:
        return found

    end = len(ls)
    for i in range(cor_i + 1, len(ls)):
        if ls[i].lower() in {"tamanho", "tecnologia"} or NAME_HINT.search(ls[i]):
            end = i
            break
    block = ls[cor_i + 1 : end]
    i = 0
    while i < len(block):
        if not COLOR_CODE_LINE.match(block[i]):
            i += 1
            continue
        code = block[i]
        name_parts = []
        j = i + 1
        while j < len(block) and COLOR_NAME_LINE.match(block[j]) and not COLOR_CODE_LINE.match(block[j]):
            part = block[j]
            if part.lower() in {"blusa", "calça", "short", "normal", "renda"}:
                break
            name_parts.append(part)
            j += 1
            if len(name_parts) >= 2:
                break
        if name_parts:
            add(code, " ".join(name_parts))
        i = j if name_parts else i + 1
    return found


def is_primary_page(text, code):
    """Primary pages have a product title; continuation pages only list more colors."""
    return bool(NAME_HINT.search(text or "")) or product_name(text, code) != f"Artigo {code}"


def largest_image_clip(page):
    best = None
    best_area = 0
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 1:
            continue
        x0, y0, x1, y1 = block["bbox"]
        area = (x1 - x0) * (y1 - y0)
        if area > best_area:
            best_area = area
            best = fitz.Rect(x0, y0, x1, y1)
    if best is None:
        w, h = page.rect.width, page.rect.height
        return fitz.Rect(w * 0.40, h * 0.02, w * 0.84, h * 0.98)
    return best


def color_swatch_clips(page):
    """Filled vector squares in the left info column (actual color chips)."""
    w, h = page.rect.width, page.rect.height
    swatches = []
    for d in page.get_drawings():
        r = d.get("rect")
        fill = d.get("fill")
        if not r or not fill:
            continue
        bw, bh = r.width, r.height
        if r.x0 > w * 0.40 or r.y0 < h * 0.08:
            continue
        if bw < 18 or bh < 18 or bw > 55 or bh > 55:
            continue
        if abs(bw - bh) > 12:
            continue
        # skip near-white / near-yellow badges
        if fill[0] > 0.85 and fill[1] > 0.85 and fill[2] < 0.45:
            continue
        swatches.append(fitz.Rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1))
    swatches.sort(key=lambda rect: (rect.y0, rect.x0))
    return swatches


def render(page, path, clip=None, zoom=1.8):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False)
    pix.save(path)
    return path.replace("\\", "/")


def extract_catalog(cfg):
    key, catalog_name, pdf = cfg["key"], cfg["name"], cfg["pdf"]
    doc = fitz.open(pdf)
    by_code = {}
    order = []

    for i, page in enumerate(doc):
        page_no = i + 1
        text = page.get_text("text")
        codes = []
        for m in CODE_RE.finditer(text or ""):
            if m.group(1) not in codes:
                codes.append(m.group(1))
        if not codes:
            continue
        code = codes[0]
        colors = colors_in(text)
        primary = is_primary_page(text, code)

        if code not in by_code and primary:
            page_img = os.path.join(OUT_PAGES, f"{key}-{page_no:03d}.jpg")
            render(page, page_img, zoom=1.2)
            img_rel = os.path.join(OUT_PRODUCTS, f"{key}-{slug(code)}-{page_no}.jpg")
            render(page, img_rel, clip=largest_image_clip(page), zoom=2.0)
            product = {
                "id": f"{key}-{slug(code)}-{page_no}",
                "code": code,
                "name": product_name(text, code),
                "category": category_from_text(text) or cfg["category_fallback"],
                "catalog": catalog_name,
                "pdf": pdf,
                "page": page_no,
                "image": img_rel.replace("\\", "/"),
                "colors": colors,
                "sizes": sizes_in(text),
                "description": description_in(text),
                "tech": [],
                "fobUsd": None,
            }
            by_code[code] = product
            order.append(code)
            # No adjuntar swatches de color como foto del producto:
            # son chips sólidos y se ven mal en el modal.
        elif code in by_code:
            # continuation page: merge new colors
            existing = {c["code"] for c in by_code[code]["colors"]}
            new_colors = [c for c in colors if c["code"] not in existing]
            if new_colors:
                by_code[code]["colors"].extend(new_colors)
            if not by_code[code].get("description"):
                by_code[code]["description"] = description_in(text)

    return [by_code[c] for c in order]


def main():
    os.makedirs(OUT_PRODUCTS, exist_ok=True)
    os.makedirs(OUT_PAGES, exist_ok=True)
    os.makedirs(OUT_COLORS, exist_ok=True)

    existing = load_products()
    keys = {c["key"] for c in CATALOGS}
    kept = [p for p in existing if not any(str(p.get("id", "")).startswith(k) for k in keys)]
    # also drop old empty pijamas catalog products if any
    kept = [p for p in kept if p.get("catalog") not in {c["name"] for c in CATALOGS}]

    new_products = []
    for cfg in CATALOGS:
        items = extract_catalog(cfg)
        print(cfg["name"], len(items), "artículos")
        for p in items:
            print(f"  {p['code']:12} {p['name'][:50]:50} colors={len(p['colors'])} sizes={p['sizes'][:40]}")
        new_products.extend(items)

    all_products = kept + new_products
    save_products(all_products)
    print("TOTAL data.js", len(all_products), "(+" + str(len(new_products)) + ")")


if __name__ == "__main__":
    main()
