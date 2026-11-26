#!/usr/bin/env python3
"""
Targeted local-crop OCR for vectorized (exploded SHX) signal and shunt labels.
Only invoked when a detected real signal/shunt head has no nearby TEXT entity.

Usage:
  python signalLabelOcr.py <inputJsonPath> <outputJsonPath>
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFilter  # type: ignore[import-not-found]

try:
    import pytesseract  # type: ignore[import-not-found]
except ImportError:
    pytesseract = None  # type: ignore[assignment]

try:
    import pymupdf  # type: ignore[import-not-found]
except ImportError:
    import fitz as pymupdf  # type: ignore[import-not-found]


VALID_SIG_RE = re.compile(
    r'^(?:(?:S|SH|GS|C|IB|A|ID|D)[-]?\d{1,3}[A-DFGHJ-SU-Z]?|[1-9]\d?(?:ID|D|A|B|C|CO)?|\d{2,3}\/(?:ID|D|S|C)\d{1,3}[A-Z]?)$',
    re.IGNORECASE,
)


def normalize_ocr_token(clean: str) -> str:
    # Fix leading '1D' -> 'ID' (Inner Distant, e.g. 1DO1 -> ID01, 1D206 -> ID206)
    if re.match(r'^1D[0-9OQ]{1,3}[A-Z]?$', clean):
        clean = 'ID' + clean[2:]
    # Fix common CAD SHX OCR confusions in signal IDs (e.g. SO3 -> S03, CQO2 -> C02, COQ4 -> C04)
    m = re.match(r'^(SH|GS|IB|ID|S|C|D|A)[-]?([0-9OQ]{1,3}[A-Z]?)$', clean)
    if m:
        prefix, body = m.group(1), m.group(2)
        if re.search(r'[0-9]', body):
            body_num = re.sub(r'^([OQ]+)(\d)', lambda mm: '0' * len(mm.group(1)) + mm.group(2), body)
            body_num = re.sub(r'(\d)([OQ]+)$', lambda mm: mm.group(1) + '0' * len(mm.group(2)), body_num)
            if len(body_num) >= 3 and body_num.startswith('00') and not body.startswith('00'):
                body_num = '0' + body_num[2:]
            return f'{prefix}{body_num}'
    return clean


def parse_ocr_tokens(raw_text: str):
    tokens = []
    for raw_part in re.split(r'[\s,;:|]+', raw_text or ''):
        part_up = raw_part.strip().strip('-').upper()
        if not part_up:
            continue
        # Preserve compound labels like 201/ID02 verbatim
        if re.match(r'^\d{2,3}\/(?:ID|D|S|C)\d{1,3}[A-Z]?$', part_up):
            tokens.append(part_up)
            continue
        for slash_part in part_up.split('/'):
            slash_part = slash_part.strip('-')
            if not slash_part:
                continue
            if re.match(r'^1D[0-9OQ]{1,3}[A-Z]?$', slash_part):
                sub_parts = [slash_part]
            else:
                sub_parts = re.split(r'(?<=[0-9])(?=(?:SH|GS|IB|ID|S|C|D)[0-9OQ])', slash_part)
            for part in sub_parts:
                clean = normalize_ocr_token(part.strip('-'))
                if not clean or len(clean) > 12:
                    continue
                if clean.startswith('R-') or clean.startswith('N-') or clean in ('FM', 'UP', 'DN', 'KM', 'MAIN', 'LOOP'):
                    continue
                if VALID_SIG_RE.match(clean):
                    tokens.append(clean)
    return tokens


def ocr_word_image(img: Image.Image, psm: int = 7):
    w, h = img.size
    if w < 120 or h < 60:
        scale = max(2, 120 // max(1, w), 60 // max(1, h))
        img = img.resize((w * scale, h * scale), Image.Resampling.BICUBIC)
    gray = img.convert('L')
    if pytesseract is not None:
        txt = pytesseract.image_to_string(
            gray,
            config=f'--psm {psm} -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-',
        )
        return parse_ocr_tokens(txt)

    # Fallback: invoke tesseract CLI directly if pytesseract wrapper is not in this Python env
    tess_bin = shutil.which('tesseract') or r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if not os.path.exists(tess_bin):
        return []
    tmp_path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tf:
            tmp_path = tf.name
        gray.save(tmp_path)
        proc = subprocess.run(
            [
                tess_bin,
                tmp_path,
                'stdout',
                '--psm',
                str(psm),
                '-c',
                'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-',
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return parse_ocr_tokens(proc.stdout or '')
    except Exception:
        return []
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def ocr_word_image_with_boxes(img: Image.Image, psm: int = 6):
    w, h = img.size
    scale = 1
    if w < 120 or h < 60:
        scale = max(2, 120 // max(1, w), 60 // max(1, h))
        img = img.resize((w * scale, h * scale), Image.Resampling.BICUBIC)
    gray = img.convert('L')
    tess_bin = shutil.which('tesseract') or r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if not os.path.exists(tess_bin):
        return []
    tmp_path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tf:
            tmp_path = tf.name
        gray.save(tmp_path)
        proc = subprocess.run(
            [
                tess_bin,
                tmp_path,
                'stdout',
                '--psm',
                str(psm),
                '-c',
                'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-',
                'tsv',
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        out = []
        lines = (proc.stdout or '').splitlines()
        for line in lines[1:]:
            cols = line.split('\t')
            if len(cols) < 12:
                continue
            txt = cols[11].strip()
            if not txt:
                continue
            left = float(cols[6]) / scale
            top = float(cols[7]) / scale
            bw = float(cols[8]) / scale
            bh = float(cols[9]) / scale
            for tok in parse_ocr_tokens(txt):
                out.append((tok, left + bw / 2.0, top + bh / 2.0))
        return out
    except Exception:
        return []
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def run_pdf_ocr(pdf_path: str, page_num: int, targets: list):
    doc = pymupdf.open(pdf_path)
    jobs = []
    scale_fac = 4.0
    try:
        page = doc[max(0, min(page_num - 1, len(doc) - 1))]
        page_h = float(page.rect.height)
        page_w = float(page.rect.width)
        mat = pymupdf.Matrix(scale_fac, scale_fac)
        for t in targets:
            tid = t['id']
            cx = float(t['x'])
            cy_cad = float(t['y'])
            min_x = float(t.get('minX', cx - 10.0))
            max_x = float(t.get('maxX', cx + 10.0))
            min_y = float(t.get('minY', cy_cad - 4.0))
            max_y = float(t.get('maxY', cy_cad + 4.0))
            pad_x = float(t.get('padX', 18.0))
            # Whole-head horizontal bounds + above/below label corridors in PDF Y coordinates
            x0 = max(0.0, min_x - pad_x)
            x1 = min(page_w, max_x + pad_x)
            cy_pdf_top = page_h - max_y
            cy_pdf_bot = page_h - min_y
            corridors = [
                (max(0.0, cy_pdf_bot - 1.0), min(page_h, cy_pdf_bot + 16.0)),
                (max(0.0, cy_pdf_top - 16.0), min(page_h, cy_pdf_top + 1.0)),
            ]
            for y0, y1 in corridors:
                clip = pymupdf.Rect(x0, y0, x1, y1)
                if clip.width < 4 or clip.height < 4:
                    continue
                pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
                img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
                jobs.append((tid, x0, y0, page_h, img))
    finally:
        doc.close()

    results = {}
    if not jobs:
        return results

    def process_pdf_job(job):
        tid, x0, y0, page_h, img = job
        cx_box = round(x0 + img.width / (2.0 * scale_fac), 2)
        cy_box = round(page_h - (y0 + img.height / (2.0 * scale_fac)), 2)
        return tid, cx_box, cy_box, ocr_word_image(img, psm=6)

    with ThreadPoolExecutor(max_workers=6) as executor:
        for tid, cx_box, cy_box, toks in executor.map(process_pdf_job, jobs):
            if not toks:
                continue
            bucket = results.setdefault(tid, [])
            for tok in toks:
                if not any(ft['text'] == tok for ft in bucket):
                    bucket.append({'text': tok, 'x': cx_box, 'y': cy_box})
    return results


def run_dwg_ocr(targets: list):
    jobs = []
    for t in targets:
        tid = t['id']
        cx = float(t['x'])
        cy = float(t['y'])
        polylines = t.get('polylines', [])
        if not polylines:
            continue

        # Filter to text-sized character strokes (glyph outlines: w <= 2.5, h <= 2.5)
        glyph_polys = []
        for poly in polylines:
            if len(poly) < 2:
                continue
            xs = [float(p[0]) for p in poly]
            ys = [float(p[1]) for p in poly]
            w = max(xs) - min(xs)
            h = max(ys) - min(ys)
            if w <= 2.5 and h <= 2.5:
                glyph_polys.append((min(xs), max(xs), min(ys), max(ys), poly))

        # Scan label bands just below and just above the signal head
        for y0, y1 in [(cy - 8.0, cy - 0.8), (cy + 0.8, cy + 8.0)]:
            band = [g for g in glyph_polys if g[2] >= y0 and g[3] <= y1]
            if not band:
                continue

            # Split band into horizontal word groups whenever X gap > 1.1 units
            band.sort(key=lambda g: g[0])
            word_groups = []
            cur_grp = [band[0]]
            cur_max_x = band[0][1]
            for g in band[1:]:
                if g[0] - cur_max_x > 1.1:
                    word_groups.append(cur_grp)
                    cur_grp = [g]
                    cur_max_x = g[1]
                else:
                    cur_grp.append(g)
                    cur_max_x = max(cur_max_x, g[1])
            word_groups.append(cur_grp)

            for grp in word_groups:
                g_min_x = min(g[0] for g in grp)
                g_max_x = max(g[1] for g in grp)
                g_min_y = min(g[2] for g in grp)
                g_max_y = max(g[3] for g in grp)
                span_x = g_max_x - g_min_x
                span_y = g_max_y - g_min_y
                if span_y < 0.7 or span_x > 14.0 or (len(grp) == 1 and len(grp[0][4]) <= 2):
                    continue
                jobs.append((tid, g_min_x, g_max_x, g_min_y, g_max_y, grp))

    def process_job(job):
        tid, g_min_x, g_max_x, g_min_y, g_max_y, grp = job
        span_x = max(0.5, g_max_x - g_min_x)
        span_y = max(0.5, g_max_y - g_min_y)
        img_h = 120
        img_w = max(100, min(460, int((span_x / span_y) * 70) + 60))
        img = Image.new('L', (img_w, img_h), 255)
        draw = ImageDraw.Draw(img)
        for _, _, _, _, poly in grp:
            pts = [
                (
                    (float(p[0]) - g_min_x) / span_x * (img_w - 50) + 25,
                    (g_max_y - float(p[1])) / span_y * (img_h - 50) + 25,
                )
                for p in poly
            ]
            if len(pts) >= 2:
                draw.line(pts, fill=0, width=4)
        img = img.filter(ImageFilter.MinFilter(3))
        toks = ocr_word_image(img, psm=7)
        wx = round((g_min_x + g_max_x) / 2.0, 2)
        wy = round((g_min_y + g_max_y) / 2.0, 2)
        return tid, toks, wx, wy

    results = {}
    if not jobs:
        return results

    with ThreadPoolExecutor(max_workers=6) as executor:
        for tid, toks, wx, wy in executor.map(process_job, jobs):
            if not toks:
                continue
            bucket = results.setdefault(tid, [])
            for tok in toks:
                if not any(ft['text'] == tok for ft in bucket):
                    bucket.append({'text': tok, 'x': wx, 'y': wy})
    return results


def main():
    if len(sys.argv) < 3:
        sys.stderr.write('Usage: signalLabelOcr.py <inputJsonPath> <outputJsonPath>\n')
        sys.exit(2)

    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        payload = json.load(f)

    mode = payload.get('mode', 'dwg')
    targets = payload.get('targets', [])
    if mode == 'pdf':
        res = run_pdf_ocr(payload['filePath'], int(payload.get('pageNum', 1)), targets)
    else:
        res = run_dwg_ocr(targets)

    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
