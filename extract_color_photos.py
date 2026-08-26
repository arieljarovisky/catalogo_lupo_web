import json
import os
import re
import unicodedata

import fitz

DATA = "data.js"
OUT = "assets/colors"


def norm(s):
    text = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"[^a-z0-9]+", "", text.encode("ascii", "ignore").decode())


def load_products():
    raw = open(DATA, encoding="utf-8").read()
    raw = re.sub(r"^window\.PRODUCTS\s*=\s*", "", raw.strip()).rstrip(";")
    return json.loads(raw)


def save_products(products):
    with open(DATA, "w", encoding="utf-8") as f:
        f.write("window.PRODUCTS = ")
        json.dump(products, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


def lines_in(page, clip):
    out = []
    data = page.get_text("dict", clip=clip)
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
            if text:
                out.append((text, tuple(line["bbox"])))
    return out


def match_color(color, labels, used):
    name = norm(color.get("name"))
    code = norm(color.get("code"))
    if not name:
        return None
    best_i = None
    best = -1
    for i, (text, _bbox) in enumerate(labels):
        if i in used:
            continue
        t = norm(text)
        if not t:
            continue
        score = 0
        if t == name or t == code + name:
            score = 50
        elif t.endswith(name) and (not code or code in t):
            score = 40
        elif name in t and len(name) >= 4:
            score = 20 + min(len(name), 10)
        elif code and len(code) >= 3 and t.startswith(code):
            score = 15
        if name == "gris" and "oscuro" in t:
            score = 0
        if score > best:
            best = score
            best_i = i
    return best_i if best >= 15 else None


def crop_above(page, bbox, prev_bbox, pdf):
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) / 2
    path = (pdf or "").lower()
    if "media" in path:
        half = 38
        default_h = 92
    elif "lencer" in path:
        half = 70
        default_h = 150
    else:
        half = 102
        default_h = 96
    gap = y0 - prev_bbox[3] if prev_bbox else default_h
    height = max(56, min(170, gap - 4 if prev_bbox else default_h))
    top = max(page.rect.y0, y0 - height)
    bottom = max(top + 36, y0 - 1)
    left = max(page.rect.x0, cx - half)
    right = min(page.rect.x1, cx + half)
    return fitz.Rect(left, top, right, bottom)


def article_clip(page, arts, code):
    if len(arts) <= 1:
        return page.rect
    try:
        idx = arts.index(code)
    except ValueError:
        return page.rect
    col = page.rect.width / len(arts)
    return fitz.Rect(page.rect.x0 + col * idx, page.rect.y0, page.rect.x0 + col * (idx + 1), page.rect.y1)


def codes_in(text):
    out = []
    for m in re.finditer(
        r"A[ \t]*R[ \t]*T[ \t]*\.?[ \t]*((?:\d[ \t]*){2,5}(?:[ \t]*[·.\-][ \t]*(?:\d[ \t]*){1,3})?)",
        text or "",
        re.I,
    ):
        code = re.sub(r"\s+", "", m.group(1).replace("·", "-").replace(".", "-")).strip("-")
        if code and code not in out:
            out.append(code)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    products = load_products()
    docs = {}
    found = 0
    missing = 0
    for p in products:
        pdf = p.get("pdf")
        page_no = int(p.get("page") or 0)
        colors = p.get("colors") or []
        if not pdf or page_no < 1 or not colors:
            continue
        if pdf not in docs:
            docs[pdf] = fitz.open(pdf)
        page = docs[pdf][page_no - 1]
        arts = codes_in(page.get_text("text"))
        clip = article_clip(page, arts, p.get("code"))
        labels = lines_in(page, clip)
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
        for _y, _x, idx, bbox in placed:
            col_key = round(((bbox[0] + bbox[2]) / 2) / 40)
            prev = prev_by_col.get(col_key)
            rect = crop_above(page, bbox, prev, pdf)
            prev_by_col[col_key] = bbox
            rel = f"{OUT}/{p['id']}-{idx + 1:02d}.jpg".replace("\\", "/")
            pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), clip=rect, alpha=False)
            pix.save(rel)
            colors[idx]["image"] = rel
            found += 1
        for idx, color in enumerate(colors):
            if not color.get("image"):
                missing += 1
        p["colors"] = colors
    save_products(products)
    print("color photos", found, "missing", missing, "products", len(products))


if __name__ == "__main__":
    main()
