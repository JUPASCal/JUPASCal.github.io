"""
HKBU PDF Extractor — 2026-GER-PERs.pdf
Extracts programme entrance requirements and subject weightings.
Admission scores are NOT in this PDF (only on the website).

Usage:
    ~/miniconda3/envs/jupascal/bin/python hkbu_pdf_extract.py
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH = "Reference(2026)/HKBU/2026-GER-PERs.pdf"

CHECK = "\uf0fc"   # ✓
CROSS = "\uf04f"  # ×

# Maps each (page_idx, table_idx_within_page) → school name
# Table index counts only the 13-col programme tables (skipping 1-col header blobs)
SCHOOL_MAP = {
    (1, 0): "Faculty of Arts and Social Sciences",
    (2, 0): "School of Business",
    (2, 1): "School of Chinese Medicine",
    (3, 0): "School of Communication",
    (3, 1): "School of Creative Arts",
    (4, 0): "Faculty of Science",
    (4, 1): "Transdisciplinary Programmes",
}


def parse_bool(cell):
    """Convert ✓/× cell to True/False/None."""
    if cell is None:
        return None
    cell = cell.strip()
    if CHECK in cell:
        return True
    if CROSS in cell:
        return False
    return None


def parse_weights(cell):
    """
    Parse 'ENG (x 1.5)\nMATH (x 1.25)' → {"ENG": 1.5, "MATH": 1.25}
    Returns empty dict if no special weights (cell is '-' or empty).
    """
    if not cell or cell.strip() in ("-", ""):
        return {}
    # Match patterns like: WORD (x NUMBER) or WORD^ (x NUMBER)
    matches = re.findall(r"([A-Z][A-Z0-9]*)\^?\s*\(x\s*([\d.]+)\)", cell)
    return {subj: float(mult) for subj, mult in matches}


def parse_min_level(cell):
    """
    Parse min level cells. Returns string like '3', '2', 'A', '3#'.
    Strips embedded constraint text (e.g. '3\n(One elective subject...)')
    """
    if cell is None:
        return None
    # Take first token before newline
    first_line = cell.split("\n")[0].strip()
    return first_line if first_line else None


def parse_elective_constraint(cell):
    """
    Extract constraint text from elective cell if present.
    e.g. '3\n(One elective subject must be Biology or Chemistry)' → constraint text
    """
    if cell is None:
        return None
    lines = cell.strip().split("\n")
    constraint_lines = [l.strip() for l in lines[1:] if l.strip()]
    # Strip leading/trailing parens
    text = " ".join(constraint_lines).strip("()")
    return text if text else None


def parse_cat_b(cell):
    """Parse Category B cell — may contain '✓ (specified subjects)' note."""
    if cell is None:
        return None, None
    allowed = parse_bool(cell)
    specified = "(specified" in cell
    return allowed, specified


def extract_programme_rows(table, school):
    """Extract data rows from a 13-col programme table (skip 2 header rows)."""
    rows = []
    for row in table[2:]:  # skip 2 header rows
        code = row[0]
        if not code or not re.match(r"JS\d{4}", code.strip()):
            continue  # skip if no valid JUPAS code

        code = code.strip()
        name = (row[1] or "").replace("\n", " ").strip()
        # Clean up symbol artifacts in name
        name = re.sub(r"[\uf072\uf028\uf029]+", "", name).strip()

        approach = (row[2] or "").replace("\n", " ").replace("- based", "-based").replace("-  based", "-based").strip()

        chi_min = parse_min_level(row[3])
        eng_min = parse_min_level(row[4])
        csd_min = parse_min_level(row[5])
        math_min = parse_min_level(row[6])

        # Elective 1 may have constraint text embedded
        elect1_cell = row[7] or ""
        elect1_min = parse_min_level(elect1_cell)
        elect1_constraint = parse_elective_constraint(elect1_cell)

        elect2_min = parse_min_level(row[8])

        m1m2_ok = parse_bool(row[9])
        cat_b_ok, cat_b_specified = parse_cat_b(row[10])
        cat_c_ok = parse_bool(row[11])

        weights_raw = (row[12] or "").replace("\n", "\n")
        weights = parse_weights(weights_raw)

        rows.append({
            "code": code,
            "name": name,
            "school": school,
            "admissions_approach": approach,
            "formula": "Best 5",
            "min_chi": chi_min,
            "min_eng": eng_min,
            "min_csd": csd_min,
            "min_math": math_min,
            "min_elect1": elect1_min,
            "elect1_constraint": elect1_constraint,
            "min_elect2": elect2_min,
            "m1m2_accepted": m1m2_ok,
            "cat_b_accepted": cat_b_ok,
            "cat_b_specified_only": cat_b_specified,
            "cat_c_accepted": cat_c_ok,
            "subject_weights": weights,
            "weights_raw": weights_raw.strip(),
            # Scores — not available in PDF
            "score_uq": None,
            "score_lq": None,
            "score_median": None,
            "data_year_weightings": 2026,
            "data_year_scores": None,
        })
    return rows


def main():
    all_rows = []
    seen_codes = set()

    with pdfplumber.open(PDF_PATH) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            prog_table_count = 0
            for table in tables:
                if not table or not table[0]:
                    continue
                # Only process 13-col programme tables
                if len(table[0]) != 13:
                    continue

                school = SCHOOL_MAP.get((page_idx, prog_table_count), f"Page{page_idx+1}-Table{prog_table_count+1}")
                rows = extract_programme_rows(table, school)
                for row in rows:
                    if row["code"] not in seen_codes:
                        all_rows.append(row)
                        seen_codes.add(row["code"])
                    else:
                        print(f"  [skip duplicate] {row['code']} ({school})")
                prog_table_count += 1

    print(f"\nExtracted {len(all_rows)} programmes:")
    for r in all_rows:
        weights_str = ", ".join(f"{k} x{v}" for k, v in r["subject_weights"].items()) or "(none)"
        print(f"  {r['code']}  [{r['school']}]  weights: {weights_str}")

    # Save JSON
    out_json = "Reference(2026)/HKBU/HKBU_2026_Data.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(all_rows, f, ensure_ascii=False, indent=2)
    print(f"\nSaved {out_json}")

    # Save Excel
    df = pd.DataFrame(all_rows)
    # Flatten subject_weights dict to string for Excel
    df["subject_weights"] = df["subject_weights"].apply(
        lambda d: ", ".join(f"{k} x{v}" for k, v in d.items()) if d else ""
    )
    out_xlsx = "Reference(2026)/HKBU/HKBU_2026_Data.xlsx"
    df.to_excel(out_xlsx, index=False)
    print(f"Saved {out_xlsx}")


if __name__ == "__main__":
    main()
