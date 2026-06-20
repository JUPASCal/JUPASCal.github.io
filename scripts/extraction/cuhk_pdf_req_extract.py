"""
CUHK PDF Requirements Extractor
Source: Useful-Information-for-JUPAS-Applicants-{Y}.pdf

Extracts per-programme entry requirements, score calculation principles,
subject weightings, and expected scores.

Two table layouts appear in the PDF:

  Layout A (36 cols) — Arts, Business, Education, Social Science:
    Code in col[0] or col[1] (merged cell ambiguity):
      offset=0: code=0, name=3, chi=6, eng=9, math=12, cs=15, e1=18, e2=21,
                rem=24, princ=27, wt=31, exp=33
      offset=1: code=1, name=4, chi=7, eng=10, math=13, cs=16, e1=19, e2=22,
                rem=25, princ=28, wt=31, exp=34
    Continuation rows: col[31] has additional weighting bullet points.

  Layout B (30-31 cols) — Engineering, Medicine, Science, Law:
    Code always in col[0]; name in col[2].
    chi=3, eng=6, math=9, cs=12, e1=15 (or 18), princ=24, wt=26, exp=29
    Weighting is typically complete on the first row.
    Continuation rows: col[16]/col[22] have elective subject lists (not needed here).
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH     = "Reference(2026)/CUHK/Useful-Information-for-JUPAS-Applicants-2026.pdf"
OUTPUT_JSON  = "Reference(2026)/CUHK/CUHK_PDF_2026_Requirements.json"
OUTPUT_EXCEL = "Reference(2026)/CUHK/CUHK_PDF_2026_Requirements.xlsx"

DATA_YEAR = "2026"

JUPAS_RE   = re.compile(r'^JS\w+$')
FACULTY_RE = re.compile(r'^FACULTY OF|^SCHOOL OF', re.IGNORECASE)


def clean(val):
    if val is None:
        return ""
    return " ".join(str(val).split())


def get(row, col):
    return clean(row[col]) if len(row) > col else ""


# ── Layout A (36 cols) helpers ────────────────────────────────────────────────

def detect_layout_a_code(row):
    """Return (code, offset) for Layout A, or ('', None) if not found."""
    c0 = get(row, 0)
    c1 = get(row, 1)
    if JUPAS_RE.match(c0):
        return c0, 0
    if JUPAS_RE.match(c1):
        return c1, 1
    return "", None


def extract_layout_a(row, offset):
    o = offset
    return {
        "name":      get(row, o + 3),
        "req_chi":   get(row, o + 6),
        "req_eng":   get(row, o + 9),
        "req_math":  get(row, o + 12),
        "req_cs":    get(row, o + 15),
        "req_e1":    get(row, o + 18),
        "req_e2":    get(row, o + 21),
        "remarks":   get(row, o + 24),
        "principle": get(row, o + 27),
        "weight":    get(row, 31),        # always col 31
        "exp_score": get(row, o + 33),
    }


# ── Layout B (30-31 cols) helpers ─────────────────────────────────────────────

def detect_layout_b_code(row):
    """Return code if this is a Layout B programme row, else ''."""
    c0 = get(row, 0)
    return c0 if JUPAS_RE.match(c0) else ""


def extract_layout_b(row):
    # e1: use col[15] if populated, else col[18]
    e1 = get(row, 15) or get(row, 18)
    return {
        "name":      get(row, 2),
        "req_chi":   get(row, 3),
        "req_eng":   get(row, 6),
        "req_math":  get(row, 9),
        "req_cs":    get(row, 12),
        "req_e1":    e1,
        "req_e2":    get(row, 21),
        "remarks":   get(row, 22),
        "principle": get(row, 24),
        "weight":    get(row, 26),
        "exp_score": get(row, 29),
    }


def is_faculty_row(row):
    c1 = get(row, 1)
    return bool(FACULTY_RE.match(c1))


# ── Main parser ───────────────────────────────────────────────────────────────

def parse(pdf):
    results = []
    current = None
    current_faculty = ""
    current_layout = None  # "A" or "B"

    def flush():
        if current and current["jupas_code"]:
            wt = current["weight"].strip(" |")
            current["weight"] = wt if wt else "--"
            results.append(dict(current))

    for page in pdf.pages:
        for t in page.extract_tables():
            if not t:
                continue
            ncols = len(t[0])

            for row in t:
                if not any(clean(c) for c in row):
                    continue

                # Faculty header (Layout A pages)
                if ncols >= 32 and is_faculty_row(row):
                    current_faculty = get(row, 1)
                    continue

                # Faculty header (Layout B pages — appears in col[1])
                if ncols < 32:
                    c1 = get(row, 1)
                    if FACULTY_RE.match(c1):
                        current_faculty = c1
                        continue

                # ── Layout A (36 cols) ──
                if ncols >= 32:
                    code, offset = detect_layout_a_code(row)
                    if code:
                        flush()
                        fields = extract_layout_a(row, offset)
                        current = {"jupas_code": code, "faculty": current_faculty,
                                   "data_year": DATA_YEAR, **fields}
                        current_layout = "A"
                    elif current and current_layout == "A":
                        # Continuation row: collect extra weighting text
                        wt = get(row, 31)
                        if wt:
                            sep = " | " if current["weight"] and current["weight"] != "--" else ""
                            current["weight"] += sep + wt
                        # Name continuation
                        nc = get(row, 4)
                        if nc and nc not in current["name"]:
                            current["name"] = (current["name"] + " " + nc).strip()
                        # Remarks continuation
                        rc = get(row, 25)
                        if rc and rc != "--":
                            sep = " " if current["remarks"] and current["remarks"] != "--" else ""
                            current["remarks"] = (current["remarks"] + sep + rc).strip()

                # ── Layout B (30-31 cols) ──
                else:
                    code = detect_layout_b_code(row)
                    if code:
                        flush()
                        fields = extract_layout_b(row)
                        current = {"jupas_code": code, "faculty": current_faculty,
                                   "data_year": DATA_YEAR, **fields}
                        current_layout = "B"
                    # Layout B continuation rows (elective lists) are not needed

    flush()

    # Deduplicate: cross-faculty programmes appear multiple times
    seen = set()
    deduped = []
    for r in results:
        if r["jupas_code"] not in seen:
            seen.add(r["jupas_code"])
            deduped.append(r)

    return deduped


with pdfplumber.open(PDF_PATH) as pdf:
    print(f"Pages: {len(pdf.pages)}")
    results = parse(pdf)

print(f"Total extracted: {len(results)} programmes")

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

print("\nSample:")
for r in results[:5]:
    print(f"  {r['jupas_code']} {r['name'][:28]} | chi={r['req_chi']} eng={r['req_eng']} math={r['req_math']} | wt={r['weight'][:40]}")
