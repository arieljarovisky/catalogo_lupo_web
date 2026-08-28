import glob
import json
import os
import re
import shutil
import fitz

SRC = r"pdfs/nuevos-catalogos"
OUT_PAGES = r"assets/pages"
OUT_PRODUCTS = r"assets/products"
os.makedirs(OUT_PAGES, exist_ok=True)
os.makedirs(OUT_PRODUCTS, exist_ok=True)

ART_RE = re.compile(
    r"A[ \t]*R[ \t]*T[ \t]*\.?[ \t]*((?:\d[ \t]*){2,5}(?:[ \t]*[·.\-][ \t]*(?:\d[ \t]*){1,3})?)",
    re.I,
)
COLOR_RE = re.compile(r"(\d{3,4})\s*[·•.\-]\s*([A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ ]{1,24})")
SIZE_RE = re.compile(
    r"\b((?:P|M|G|GG|XG|XXG|XXXG|U)(?:\s*[·•\-\/]\s*(?:P|M|G|GG|XG|XXG|XXXG))+|Talle único[^\n]{0,40}|U)\b",
    re.I,
)
SKIP_TITLE = re.compile(
    r"^(art\.?|talles?|composici[oó]n|catalogo|lupo|colecci[oó]n|www\.|poliamida|algod[oó]n|elastano|nylon|diseñado|confeccion)",
    re.I,
)
PLAIN_COLORS = [
    "Azul Marino y Blanco", "Azul Marino", "Azul Acero", "Verde Limón", "Gris Oscuro",
    "Gris Plomo", "Capuchino", "Chocolate", "Natural", "Nude", "Blanco", "Negro",
    "Gris", "Azul", "Celeste", "Bordo", "Bordó", "Rojo", "Beige", "Caqui", "Marino",
    "Verde", "Rosa", "Fucsia",
]

CATALOGS = [
    ("boxers-slips-2026", "Boxers y Slips 2026", "Ropa interior hombre", "*Boxers*"),
    ("lenceria-2026", "Lencería 2026", "Lencería", "*lenceria*"),
    ("medias-2026", "Medias 2026", "Medias", "*Medias*"),
]


def slug(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:80]


def normalize_code(raw):
    return re.sub(r"\s+", "", raw.replace("·", "-").replace(".", "-")).strip("-")


def codes_in(text):
    out = []
    for m in ART_RE.finditer(text or ""):
        code = normalize_code(m.group(1))
        if code and code not in out:
            out.append(code)
    return out


def colors_in(text):
    found = []
    seen = set()
    for m in COLOR_RE.finditer(text or ""):
        code, name = m.group(1), re.sub(r"\s+", " ", m.group(2)).strip(" ·-")
        key = name.lower()
        if key in seen or len(name) < 3:
            continue
        seen.add(key)
        found.append({"code": code, "name": name})
    if found:
        return found
    # Only keep color names that appear as short standalone lines.
    for raw_line in (text or "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip(" ·-")
        for name in PLAIN_COLORS:
            if line.lower() == name.lower() or line.lower() == f"{name.lower()} y blanco":
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                found.append({"code": name[:4].upper(), "name": name})
                break
    return found


def sizes_in(text):
    t = text or ""
    m = SIZE_RE.search(t)
    if m:
        val = re.sub(r"\s+", " ", m.group(1)).strip()
        val = val.replace("-", " • ").replace("/", " • ")
        val = re.sub(r"\s*·\s*", " • ", val)
        val = re.sub(r"(•\s*)+", " • ", val)
        return val
    if re.search(r"\bU\b|talle único", t, re.I):
        return "Único"
    return ""


def description_in(text):
    paras = []
    for chunk in re.split(r"\n+", text or ""):
        line = re.sub(r"\s+", " ", chunk).strip()
        if len(line) >= 60:
            paras.append(line)
    return " ".join(paras[:2])


def title_from_clip(page, clip):
    data = page.get_text("dict", clip=clip)
    candidates = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(s.get("text", "") for s in spans).strip()
            text = re.sub(r"\s+", " ", text)
            if not text or SKIP_TITLE.search(text) or ART_RE.search(text):
                continue
            if COLOR_RE.search(text) or len(text) > 52:
                continue
            size = max((s.get("size", 0) for s in spans), default=0)
            y = line.get("bbox", [0, 0, 0, 0])[1]
            if size >= 11:
                candidates.append((size, y, text))
    if not candidates:
        return ""
    max_size = max(c[0] for c in candidates)
    top = [c for c in candidates if c[0] >= max_size - 1.5]
    top.sort(key=lambda c: c[1])
    parts = []
    for _, _, text in top[:3]:
        if text not in parts:
            parts.append(text)
    return " ".join(parts)


def copy_pdf(globpat, dest_name):
    src = glob.glob(os.path.join(SRC, globpat))[0]
    dest = os.path.join(SRC, dest_name)
    if os.path.abspath(src) != os.path.abspath(dest):
        shutil.copy2(src, dest)
    return dest.replace("\\", "/")


def render_page(page, path, clip=None, zoom=1.6):
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    pix.save(path)
    return path.replace("\\", "/")


def photo_clip(page, key, n, idx):
    """Main product photo only, without the color-variant strip or the text column."""
    w, h = page.rect.width, page.rect.height
    if n == 1:
        if "lenceria" in key:
            return fitz.Rect(w * 0.008, h * 0.02, w * 0.56, h * 0.98)
        if "medias" in key:
            return fitz.Rect(w * 0.008, h * 0.05, w * 0.385, h * 0.95)
        return fitz.Rect(w * 0.01, h * 0.03, w * 0.38, h * 0.97)
    col_w = w / n
    x0 = col_w * idx
    inset = col_w * 0.02
    return fitz.Rect(x0 + inset, h * 0.02, x0 + col_w - inset, h * 0.60)


def extract_catalog(key, catalog_name, category, globpat):
    pdf_rel = copy_pdf(globpat, f"{key}.pdf")
    doc = fitz.open(pdf_rel)
    products = []
    for i, page in enumerate(doc):
        page_no = i + 1
        text = page.get_text("text")
        arts = codes_in(text)
        if not arts:
            continue
        page_img = os.path.join(OUT_PAGES, f"{key}-{page_no:03d}.jpg")
        render_page(page, page_img, zoom=1.35)
        w, h = page.rect.width, page.rect.height
        n = len(arts)
        for idx in range(n):
            region_rect = fitz.Rect(
                (w / n) * idx if n > 1 else 0,
                0,
                (w / n) * (idx + 1) if n > 1 else w,
                h,
            )
            region_text = page.get_text("text", clip=region_rect)
            col_codes = codes_in(region_text)
            code = col_codes[-1] if col_codes else arts[idx]
            clip = photo_clip(page, key, n, idx)
            name = title_from_clip(page, fitz.Rect(
                (w / n) * idx if n > 1 else w * 0.48,
                0,
                (w / n) * (idx + 1) if n > 1 else w,
                h,
            )) or title_from_clip(page, page.rect)
            if not name:
                name = f"Artículo {code}"
            img_rel = os.path.join(OUT_PRODUCTS, f"{key}-{slug(code)}-{page_no}.jpg")
            render_page(page, img_rel, clip=clip, zoom=1.7)
            blob = region_text if n > 1 else text
            products.append({
                "id": f"{key}-{slug(code)}-{page_no}",
                "code": code,
                "name": name,
                "category": category,
                "catalog": catalog_name,
                "pdf": pdf_rel,
                "page": page_no,
                "image": img_rel.replace("\\", "/"),
                "colors": colors_in(blob) or colors_in(text),
                "sizes": sizes_in(blob) or sizes_in(text) or "Consultar",
                "description": description_in(blob) or description_in(text),
                "tech": [],
                "fobUsd": None,
            })
    return products


def recrop_images():
    count = 0
    for key, catalog_name, category, globpat in CATALOGS:
        pdf_path = os.path.join(SRC, f"{key}.pdf")
        if not os.path.exists(pdf_path):
            pdf_path = glob.glob(os.path.join(SRC, globpat))[0]
        doc = fitz.open(pdf_path)
        n_cat = 0
        for i, page in enumerate(doc):
            arts = codes_in(page.get_text("text"))
            if not arts:
                continue
            n = len(arts)
            for idx in range(n):
                region_rect = fitz.Rect((page.rect.width / n) * idx, 0, (page.rect.width / n) * (idx + 1), page.rect.height)
                col_codes = codes_in(page.get_text("text", clip=region_rect))
                code = col_codes[-1] if col_codes else arts[idx]
                img_rel = os.path.join(OUT_PRODUCTS, f"{key}-{slug(code)}-{i + 1}.jpg")
                render_page(page, img_rel, clip=photo_clip(page, key, n, idx), zoom=2.0)
                n_cat += 1
                count += 1
        print(catalog_name, n_cat)
    print("RECROP", count)


def main():
    all_products = []
    for key, catalog_name, category, globpat in CATALOGS:
        items = extract_catalog(key, catalog_name, category, globpat)
        print(catalog_name, len(items))
        all_products.extend(items)
    all_products.sort(key=lambda p: (p["catalog"], p["code"]))
    with open("data.js", "w", encoding="utf-8") as f:
        f.write("window.PRODUCTS = ")
        json.dump(all_products, f, ensure_ascii=False)
        f.write(";\n")
    print("TOTAL", len(all_products))


if __name__ == "__main__":
    import sys
    if "--recrop" in sys.argv:
        recrop_images()
    else:
        main()
