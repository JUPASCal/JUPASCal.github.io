"""
CUHK PDF Extractor — Admission-Grades-{Y-1}.pdf

Extracts per-programme data from CUHK's annual Admission Grades PDF, which contains:
  - 2025 actual admission scores (UQ / Median / LQ weighted totals)
  - 2025 selection principle and subject weightings
  These are used for the 2026 calculator (compare against 2025 actuals).

Column layout (16 cols):
  0: JUPAS code (merged cell → appears on one row of the 3-row group)
  1: Programme name (may be split across rows)
  2: Percentile (UQ / M / LQ)
  3: CHI | 4: ENG | 5: MATH | 6: CSD | 7: LS | 8: M1/M2
  9: 1st Elective | 10: 2nd Elective | 11: 3rd Elective | 12: 4th Elective
  13: Programme Weighted Total (admission score)
  14: Selection Principle
  15: Subject Weighting (may span multiple continuation rows)

Merged cell pattern: each programme spans 3 rows (UQ, M, LQ).
pdfplumber assigns JUPAS code to ONE of those rows; others get None or ''.
Weighting text may continue onto additional rows.
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH     = "Reference(2026)/CUHK/Admission-Grades-2025.pdf"
OUTPUT_JSON  = "Reference(2026)/CUHK/CUHK_PDF_2025_Extracted.json"
OUTPUT_EXCEL = "Reference(2026)/CUHK/CUHK_PDF_2025_Extracted.xlsx"

DATA_YEAR_SCORES    = "2025"
DATA_YEAR_WEIGHTINGS = "2025"

VALID_PERCENTILES = {"UQ", "M", "LQ"}
JUPAS_RE = re.compile(r'^JS\w+$')
FACULTY_RE = re.compile(r'^Faculty of|^School of|^CUHK', re.IGNORECASE)

COL_CODE      = 0
COL_NAME      = 1
COL_PCT       = 2
COL_CHI       = 3
COL_ENG       = 4
COL_MATH      = 5
COL_CSD       = 6
COL_LS        = 7
COL_M12       = 8
COL_E1        = 9
COL_E2        = 10
COL_E3        = 11
COL_E4        = 12
COL_SCORE     = 13
COL_PRINCIPLE = 14
COL_WEIGHT    = 15


def clean(val):
    if val is None:
        return ""
    return " ".join(str(val).split())  # collapse whitespace/newlines


def is_data_row(row):
    pct = clean(row[COL_PCT]) if len(row) > COL_PCT else ""
    return pct in VALID_PERCENTILES


def is_faculty_header(row):
    code = clean(row[COL_CODE]) if row[COL_CODE] else ""
    return bool(FACULTY_RE.match(code)) and clean(row[COL_PCT] if len(row) > COL_PCT else "") not in VALID_PERCENTILES


def collect_rows(pdf):
    """Return list of (row, faculty) for all UQ/M/LQ data rows across all pages."""
    rows = []
    current_faculty = ""
    for page in pdf.pages:
        tables = page.extract_tables()
        if not tables:
            continue
        for row in tables[0]:
            if len(row) < 14:
                continue
            if is_faculty_header(row):
                current_faculty = clean(row[COL_CODE])
                continue
            if not is_data_row(row):
                continue
            rows.append((row, current_faculty))
    return rows


def group_programmes(pdf):
    """
    Group rows into programme groups of exactly 3 (UQ, M, LQ).
    Each programme always has exactly 3 rows; 252 rows / 84 programmes = 3.
    The JUPAS code appears on either the UQ or M row — grouping in triplets handles both.
    """
    all_rows = collect_rows(pdf)
    groups = []
    for i in range(0, len(all_rows), 3):
        triplet = [r for r, _ in all_rows[i:i+3]]
        # Use the faculty from the last row in the triplet (most up-to-date)
        faculty = all_rows[min(i+2, len(all_rows)-1)][1]
        if triplet:
            groups.append((triplet, faculty))
    return groups


def parse_group(rows, faculty):
    """Extract one programme record from its group of rows."""
    # Find JUPAS code
    jupas_code = ""
    for r in rows:
        c = clean(r[COL_CODE])
        if JUPAS_RE.match(c):
            jupas_code = c
            break

    # Programme name: collect all name parts across rows, join
    name_parts = []
    for r in rows:
        n = clean(r[COL_NAME])
        if n and n not in name_parts:
            name_parts.append(n)
    name = " ".join(name_parts).strip()

    # Scores by percentile
    scores = {}
    for r in rows:
        pct = clean(r[COL_PCT])
        score = clean(r[COL_SCORE]) if len(r) > COL_SCORE else ""
        if pct in VALID_PERCENTILES and score:
            scores[pct] = score

    # Selection principle: first non-empty across all rows
    principle = ""
    for r in rows:
        p = clean(r[COL_PRINCIPLE]) if len(r) > COL_PRINCIPLE else ""
        if p and p != "--":
            principle = p
            break

    # Subject weighting: concatenate all non-empty weighting cells
    wt_parts = []
    for r in rows:
        w = clean(r[COL_WEIGHT]) if len(r) > COL_WEIGHT else ""
        if w and w != "--":
            wt_parts.append(w)
    weight = " | ".join(wt_parts) if wt_parts else "--"

    return {
        "jupas_code":            jupas_code,
        "name":                  name,
        "faculty":               faculty,
        "data_year_scores":      DATA_YEAR_SCORES,
        "data_year_weightings":  DATA_YEAR_WEIGHTINGS,
        "score_uq":              scores.get("UQ", ""),
        "score_median":          scores.get("M", ""),
        "score_lq":              scores.get("LQ", ""),
        "selection_principle":   principle,
        "subject_weighting":     weight,
    }


with pdfplumber.open(PDF_PATH) as pdf:
    print(f"Pages: {len(pdf.pages)}")
    groups = group_programmes(pdf)

print(f"Programme groups found: {len(groups)}")

results = []
for rows, faculty in groups:
    rec = parse_group(rows, faculty)
    if rec["jupas_code"]:
        results.append(rec)
    else:
        # Log unmatched groups for debugging
        print(f"  WARN: group with no JUPAS code, rows={len(rows)}, "
              f"name={'|'.join(clean(r[COL_NAME]) for r in rows if clean(r[COL_NAME]))}")

# Deduplicate: cross-faculty programmes appear multiple times in the PDF with identical data
seen = set()
deduped = []
for r in results:
    if r["jupas_code"] not in seen:
        seen.add(r["jupas_code"])
        deduped.append(r)
    # else: silently drop identical duplicate
results = deduped

print(f"Total extracted: {len(results)} programmes")

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

print("\nSample:")
for r in results[:5]:
    print(f"  {r['jupas_code']} {r['name'][:30]} | UQ={r['score_uq']} M={r['score_median']} LQ={r['score_lq']} | wt={r['subject_weighting'][:40]}")
