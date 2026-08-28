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


def labels_in_clip(page, clip):
    return [
        (text, bbox)
        for text, bbox in lines_in(page, clip)
        if clip.x0 <= (bbox[0] + bbox[2]) / 2 <= clip.x1
    ]


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


def image_blocks(page):
    return [
        block["bbox"]
        for block in page.get_text("dict").get("blocks", [])
        if block.get("type") == 1
    ]


def swatch_rect_for_label(page, label_bbox, pdf=None, clip=None):
    """Use the embedded swatch image above a color label (lencería PDF layout)."""
    if "lencer" not in (pdf or "").lower():
        return None
    lx0, ly0, lx1, ly1 = label_bbox
    lcx = (lx0 + lx1) / 2
    best = None
    best_score = -1
    for bx0, by0, bx1, by1 in image_blocks(page):
        bw, bh = bx1 - bx0, by1 - by0
        if bw > 320 or bh > 160 or bw < 60 or bh < 40:
            continue
        if bx1 < lx0 - 30 or bx0 > lx1 + 30:
            continue
        if by0 > ly0 + 5 or by1 < ly0 - 30:
            continue
        bcx = (bx0 + bx1) / 2
        score = 120 - abs(bcx - lcx) - abs(by1 - ly0) * 3 - max(0, bh - 130) * 2
        if score > best_score:
            best_score = score
            best = (bx0, by0, bx1, by1)
    if not best:
        return None
    bx0, by0, bx1, by1 = best
    left = bx0 + 3
    right = bx1 - 3
    if clip is not None:
        left = max(left, clip.x0 + 6)
        right = min(right, clip.x1 - 6)
    top = by0 + 3
    bottom = min(by1 - 3, ly0 - 1)
    block_h = by1 - by0
    if block_h > 118:
        top = max(top, by0 + block_h * 0.55)
    if bottom - top < 48:
        top = bottom - 48
    if right - left < 36 or bottom - top < 36:
        return None
    return fitz.Rect(left, top, right, bottom)


def crop_rect_for_color(page, bbox, prev_bbox, pdf, clip=None):
    rect = swatch_rect_for_label(page, bbox, pdf, clip)
    if rect is not None:
        return rect
    return crop_above(page, bbox, prev_bbox, pdf, clip)


def crop_above(page, bbox, prev_bbox, pdf, clip=None):
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) / 2
    path = (pdf or "").lower()
    if "media" in path:
        half = 38
        default_h = 92
    elif "lencer" in path:
        half = 55
        default_h = 88
        max_h = 108
    else:
        half = 102
        default_h = 96
        max_h = 170
    if "lencer" not in path and "media" not in path:
        max_h = 170
    gap = y0 - prev_bbox[3] if prev_bbox else default_h
    height = max(56, min(max_h if "lencer" in path else 170, gap - 4 if prev_bbox else default_h))
    top = max(page.rect.y0, y0 - height)
    bottom = max(top + 36, y0 - 1)
    left = max(page.rect.x0, cx - half)
    right = min(page.rect.x1, cx + half)
    if clip is not None:
        left = max(left, clip.x0 + 6)
        right = min(right, clip.x1 - 6)
    return fitz.Rect(left, top, right, bottom)


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
    try:
        return arts.index(code)
    except ValueError:
        return 0


def article_clip(page, arts, code):
    if len(arts) <= 1:
        return page.rect
    idx = column_index_for_code(page, code)
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
        for _y, _x, idx, bbox in placed:
            col_key = round(((bbox[0] + bbox[2]) / 2) / 40)
            prev = prev_by_col.get(col_key)
            rect = crop_rect_for_color(page, bbox, prev, pdf, clip)
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
