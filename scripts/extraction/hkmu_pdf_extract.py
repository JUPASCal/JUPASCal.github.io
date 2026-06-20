"""
HKMU Score Extractor — af_2025_HKMU.pdf (from JUPAS af_2025_JUPAS.pdf p42-44)
Extracts 2025 admission scores (Median + Lower Quartile) and 2026 subject weightings
for HKMU programmes.

NOTE: The HKMU scores PDF includes BOTH 2025 scores and the subject weightings for those
scores. HKMU does not separately publish "2026 weightings" in this document — the weights
shown ARE the weights used for the 2025 scores. Mark data_year_weightings=2025.

PDF structure (9 columns per data row):
  Col 0: JUPAS code (JS9xxx^) or school section header
  Col 1: Programme name (or blank if name starts in col 2)
  Col 2: Programme name (or continuation)
  Col 3: Programme name continuation (rare)
  Col 4: Median score (2025)
  Col 5: Lower Quartile score (2025)
  Col 6: Subject weights (or "-" for none)
  Col 7: Subject weights (continuation / overflow)
  Col 8: Subject weights (continuation / overflow)

Formula: Best 5 (any best 5 subjects in Cat A, B, or C — CSD not explicitly excluded)
Grade conversion (Cat A): 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2 (Level 1 not listed; assumed =1)
Subject weight abbreviations: "Chi Lang"=Chinese Language, "Eng Lang"=English Language,
  "Chi Literature"=Chinese Literature, "Child Care & Edu/Dev"=ApL subjects

Usage:
    ~/miniconda3/envs/jupascal/bin/python hkmu_pdf_extract.py
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH = "Reference(2026)/HKMU/af_2025_HKMU.pdf"
OUT_JSON = "Reference(2026)/HKMU/HKMU_2026_Data.json"
OUT_XLSX = "Reference(2026)/HKMU/HKMU_2026_Data.xlsx"

CODE_RE   = re.compile(r"^JS\d{4}")
NUM_RE    = re.compile(r"^\d+(\.\d+)?$")
ENDS_WGT  = re.compile(r'\(x\s*[\d.]+\)\*?$')
WEIGHT_RE = re.compile(r"^(.+?)\s*\(x\s*([\d.]+)\)\*?$")


def parse_score(val):
    if not val:
        return None
    val = str(val).strip()
    return float(val) if NUM_RE.match(val) else None


def parse_weights(raw):
    """
    Parse weight text like 'Chi Lang (x2)\nEng Lang (x1.5)'.
    Returns (weights_dict, raw_text). Uses grouping + findall approach.
    """
    if not raw or raw.strip() in ("-", ""):
        return {}, raw.strip() if raw else ""

    lines = [l.strip() for l in raw.split("\n") if l.strip()]
    entries = []
    current = []
    for line in lines:
        current.append(line)
        if ENDS_WGT.search(line):
            entries.append(" ".join(current))
            current = []
    if current:
        entries.append(" ".join(current))

    weights = {}
    for entry in entries:
        for subj_raw, wgt in re.findall(r'(.+?)\s*\(x\s*([\d.]+)\)\*?', entry):
            weight = float(wgt)
            for subj in subj_raw.split(","):
                subj = subj.strip()
                if subj:
                    weights[subj] = weight

    return weights, raw.strip()


def collect_cell_text(row, cols):
    """Collect and join non-empty text from specified columns."""
    parts = []
    for i in cols:
        val = str(row[i] or "").replace("\n", " ").strip()
        if val:
            parts.append(val)
    return " ".join(parts)


def finalize_prog(prog, programmes):
    prog["name"] = " ".join(prog.pop("name_parts")).strip()
    wgt_raw = "\n".join(filter(None, prog.pop("weight_parts")))
    prog["subject_weights"], prog["subject_weights_raw"] = parse_weights(wgt_raw)
    programmes.append(prog)


def extract_programmes():
    programmes = []
    current_school = ""  # carried across pages
    current = None       # in-progress programme dict

    with pdfplumber.open(PDF_PATH) as pdf:
        # Page 1 has only grade conversion tables — skip; data is on pages 2 and 3
        for page_idx in [1, 2]:
            page = pdf.pages[page_idx]
            main_table = next(
                (t for t in page.extract_tables() if t and len(t[0]) == 9), None
            )
            if not main_table:
                continue

            for row in main_table[4:]:  # skip 4 header rows
                c0 = str(row[0] or "").strip()

                # Collect weight text from cols 6,7,8 (skip "-" and empty)
                wgt_cells = [str(row[i] or "").strip() for i in [6, 7, 8]]
                wgt_from_row = "\n".join(p for p in wgt_cells if p and p != "-")

                if CODE_RE.match(c0):
                    # New programme — finalize previous if any
                    if current:
                        finalize_prog(current, programmes)

                    code = c0.rstrip("^").strip()
                    name_start = collect_cell_text(row, [1, 2, 3])
                    current = {
                        "code":         code,
                        "school":       current_school,
                        "formula":      "Best 5",
                        "score_median": parse_score(row[4]),
                        "score_lq":     parse_score(row[5]),
                        "name_parts":   [name_start] if name_start else [],
                        "weight_parts": [wgt_from_row] if wgt_from_row else [],
                        "data_year_scores":      2025,
                        "data_year_weightings":  2025,
                        "scores_source":    "af_2025_JUPAS.pdf p42-44 (JUPAS combined, HKMU section)",
                        "weightings_source": "af_2025_JUPAS.pdf p42-44 (HKMU section, weights used for 2025 scores)",
                    }

                elif c0 and all(
                    row[i] is None or str(row[i]).strip() == "" for i in [4, 5]
                ):
                    # School section header — no scores in this row
                    if current:
                        finalize_prog(current, programmes)
                        current = None
                    current_school = c0

                else:
                    # Continuation row — append name/weight to current programme
                    if current is None:
                        continue
                    name_cont = collect_cell_text(row, [1, 2, 3])
                    if name_cont:
                        current["name_parts"].append(name_cont)
                    if wgt_from_row:
                        current["weight_parts"].append(wgt_from_row)

    # Finalize last programme
    if current:
        finalize_prog(current, programmes)

    return programmes


def main():
    programmes = extract_programmes()

    print(f"\nExtracted {len(programmes)} programmes:")
    for p in programmes:
        w_str = ", ".join(f"{k} x{v}" for k, v in p["subject_weights"].items()) or "(none)"
        print(f"  {p['code']}  [{p['school']}]  med={p['score_median']}  lq={p['score_lq']}  weights: {w_str}")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(programmes, f, ensure_ascii=False, indent=2)
    print(f"\nSaved {OUT_JSON}")

    df = pd.DataFrame(programmes)
    df["subject_weights"] = df["subject_weights"].apply(
        lambda d: ", ".join(f"{k} x{v}" for k, v in d.items()) if isinstance(d, dict) else ""
    )
    df.to_excel(OUT_XLSX, index=False)
    print(f"Saved {OUT_XLSX}")


if __name__ == "__main__":
    main()
