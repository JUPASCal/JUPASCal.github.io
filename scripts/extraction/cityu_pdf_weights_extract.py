"""
CityU PDF Weights Extractor — 2026_JUPAS_MainAdmissionScoreCalculation.pdf

Extracts per-subject weightings for each programme.
Data year: 2026 (current year weightings — for use in 2027 calculator).

Output: Reference(2026)/CityU/CityU_PDF_2026_Weights.json
        Reference(2026)/CityU/CityU_PDF_2026_Weights.xlsx
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH     = "Reference(2026)/CityU/2026_JUPAS_MainAdmissionScoreCalculation.pdf"
OUTPUT_JSON  = "Reference(2026)/CityU/CityU_PDF_2026_Weights.json"
OUTPUT_EXCEL = "Reference(2026)/CityU/CityU_PDF_2026_Weights.xlsx"

HEADER_ROWS  = 7   # rows to skip at top of each page
JUPAS_RE     = re.compile(r'^(JS\w+)$')
WEIGHT_RE    = re.compile(r'^\d+(\.\d+)?$')  # numeric weights like 1, 1.5, 2, 2.5
SECTION_RE   = re.compile(r'^(COLLEGE OF|SCHOOL OF|INTERDISCIPLINARY)', re.IGNORECASE)

COL_TITLE    = 0   # always col 0


def detect_cols(header_rows):
    """Detect column positions from header row 4 (where 'English' label appears)."""
    row4 = [str(c).strip() if c else "" for c in header_rows[4]]
    eng_col = next((i for i, v in enumerate(row4) if v == "English"), None)
    if eng_col is None:
        return None
    # Layout is always: English, (gap), Chinese, (gap), Mathematics, (gap), Elective Subjects
    return {
        "subjects": eng_col - 2,   # Subjects Included is 2 cols before English
        "english":  eng_col,
        "chinese":  eng_col + 2,
        "maths":    eng_col + 4,
        "electives":eng_col + 6,
    }


def clean(val):
    return str(val).strip() if val else ""


def is_section(row):
    return bool(SECTION_RE.match(clean(row[0])))


def collect_pages(pdf):
    """Yield (row, cols) tuples from all pages, with per-page column positions."""
    for page in pdf.pages:
        tables = page.extract_tables()
        if not tables:
            continue
        table = tables[0]
        cols = detect_cols(table[:HEADER_ROWS])
        if not cols:
            continue
        for row in table[HEADER_ROWS:]:
            yield row, cols


def parse_programmes(pdf):
    results = []
    current_college = ""
    current_code = None
    current_title_parts = []
    current_subjects_parts = []
    eng_w = chi_w = maths_w = ""
    elective_parts = []

    def flush():
        if not current_code:
            return
        results.append({
            "jupas_code":        current_code,
            "title":             " ".join(current_title_parts).strip(),
            "college":           current_college,
            "data_year":         "2026",
            "subjects_included": " ".join(current_subjects_parts).strip(),
            "weight_english":    eng_w,
            "weight_chinese":    chi_w,
            "weight_maths":      maths_w,
            "weight_electives":  " | ".join(elective_parts).strip(),
        })

    for row, cols in collect_pages(pdf):
        vals = [clean(c) for c in row]
        if all(v == "" for v in vals):
            continue

        if is_section(row):
            flush()
            current_college = clean(row[0])
            current_code = None; current_title_parts = []; current_subjects_parts = []
            eng_w = chi_w = maths_w = ""; elective_parts = []
            continue

        if JUPAS_RE.match(clean(row[COL_TITLE])):
            flush()
            current_code = clean(row[COL_TITLE])
            current_title_parts = []; current_subjects_parts = []
            eng_w = chi_w = maths_w = ""; elective_parts = []

        title_text = clean(row[COL_TITLE])
        if title_text and not JUPAS_RE.match(title_text):
            current_title_parts.append(title_text)

        subj_text = clean(row[cols["subjects"]]) if len(row) > cols["subjects"] else ""
        if subj_text:
            current_subjects_parts.append(subj_text)

        e  = clean(row[cols["english"]])   if len(row) > cols["english"]   else ""
        c  = clean(row[cols["chinese"]])   if len(row) > cols["chinese"]   else ""
        m  = clean(row[cols["maths"]])     if len(row) > cols["maths"]     else ""
        el = clean(row[cols["electives"]]) if len(row) > cols["electives"] else ""

        if WEIGHT_RE.match(e) and not eng_w:   eng_w   = e
        if WEIGHT_RE.match(c) and not chi_w:   chi_w   = c
        if WEIGHT_RE.match(m) and not maths_w: maths_w = m
        if el and el not in ("", "Elective Subjects"):
            elective_parts.append(el)

    flush()
    return results


def fill_merged_cells(results):
    """
    Post-processing: handle merged 'Subjects Included' and weight cells in PDFs.

    Pattern: consecutive programmes within the same college share a merged cell.
    pdfplumber assigns the content to only ONE row in the merged group; the other
    rows in the group get empty values.

    Fix: identify contiguous "merge groups" — runs of consecutive same-college
    programmes where exactly one has the data — then fill the rest from it.
    We intentionally do NOT fill across groups (i.e. if two adjacent programmes
    BOTH have data, neither bleeds into the other).

    This is a common pattern across university PDFs and should be applied
    whenever extracting tabular data from merged-cell PDF tables.
    """
    FILL_FIELDS = ["subjects_included", "weight_english", "weight_chinese", "weight_maths"]

    def has_data(r):
        return any(r.get(f) for f in FILL_FIELDS)

    def likely_in_merged_group(r):
        """
        A programme is likely part of a merged cell group (and should receive
        filled values) if it has partial elective subject data in weight_electives.
        Two forms indicate real elective data:
          - '·' bullet points: "· Biology | · Chemistry | ..."
          - Descriptive text: "1: Other elective subjects", "2: Physics | ..."
        A programme with truly no data (e.g. a new programme) will have
        weight_electives that is empty or contains only bare numbers like "2:".
        """
        el = r.get("weight_electives", "")
        if "·" in el:
            return True
        # Check for descriptive text (more than just digits/colons/spaces/pipes)
        stripped = re.sub(r'[\d:.\s|]', '', el)
        return len(stripped) > 2  # at least a few real letters

    n = len(results)
    i = 0
    while i < n:
        # Find contiguous run of same-college programmes
        j = i + 1
        while j < n and results[j]["college"] == results[i]["college"]:
            j += 1
        college_block = results[i:j]

        # Within the block, find merge groups:
        # A merge group = maximal sub-run where at most one entry has data.
        # If two consecutive entries both have data, they belong to different groups.
        k = 0
        while k < len(college_block):
            # Extend group as long as not two consecutive filled entries
            group = [k]
            k += 1
            while k < len(college_block):
                prev_has = has_data(college_block[group[-1]])
                curr_has = has_data(college_block[k])
                if prev_has and curr_has:
                    break  # both filled = new group boundary
                group.append(k)
                k += 1

            # Find the single filled entry in this group (if any)
            filled = [g for g in group if has_data(college_block[g])]
            if len(filled) == 1:
                source = college_block[filled[0]]
                for g in group:
                    target = college_block[g]
                    if not has_data(target) and likely_in_merged_group(target):
                        for f in FILL_FIELDS:
                            if source.get(f):
                                target[f] = source[f]
                        target["fill_note"] = f"inherited from {source['jupas_code']}"

        results[i:j] = college_block
        i = j

    return results


with pdfplumber.open(PDF_PATH) as pdf:
    results = parse_programmes(pdf)

results = fill_merged_cells(results)

print(f"Total extracted: {len(results)} programmes")

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

print("\nSample:")
for r in results[:4]:
    print(f"  {r['jupas_code']} | EN={r['weight_english']} ZH={r['weight_chinese']} MA={r['weight_maths']} | {r['subjects_included'][:50]}")
