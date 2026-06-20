"""
EdUHK PDF Extractor

Sources:
  1. af_2025_EdUHK.pdf (from JUPAS af_2025_JUPAS.pdf p23-26)
     - 2025 admission scores: Lower Quartile + Median
     - 2025 entry weightings (col 2) and 2026 entry weightings (col 8)

  2. EdUHK_Entrance_Requirements_and_Admission_Score_Calculation.pdf
     - Programme-specific entrance requirements (min Chi/Eng/Math/CSD/Electives)
     - 2026 subject weightings (authoritative source, used to override scores PDF)
     - Programme type (Teacher Education / Non-Teacher Education / Higher Diploma)

PDF structure — af_2025_EdUHK.pdf (10 columns per data row):
  Col 0: JUPAS code (JS8xxx)
  Col 1: Programme Title
  Col 2: HKDSE Subjects with Heavier Weighting (for 2025 entry)
  Col 4: Lower Quartile score (2025)
  Col 5: Median score (2025)
  Col 6: Mean score of specific HKDSE Subject (often '-')
  Col 8: HKDSE Subjects with Heavier Weighting (for 2026 entry)
  Col 9: Remarks

Formula: Best 5 (any 5 HKDSE subjects, excluding CSD)
Grade conversion (Cat A): 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1

Usage:
    ~/miniconda3/envs/jupascal/bin/python eduhk_pdf_extract.py
"""

import re
import json
import pdfplumber
import pandas as pd

SCORES_PDF = "Reference(2026)/EdUHK/af_2025_EdUHK.pdf"
REQS_PDF   = "Reference(2026)/EdUHK/EdUHK_Entrance_Requirements_and_Admission_Score_Calculation.pdf"
OUT_JSON   = "Reference(2026)/EdUHK/EdUHK_2026_Data.json"
OUT_XLSX   = "Reference(2026)/EdUHK/EdUHK_2026_Data.xlsx"

CODE_RE    = re.compile(r"^JS\d{4}$")
WEIGHT_RE  = re.compile(r"^(.+?)\s*\(x\s*([\d.]+)\)\*?$")
NUM_RE     = re.compile(r"^\d+(\.\d+)?$")
ENDS_WGT   = re.compile(r'\(x\s*[\d.]+\)\*?$')


def parse_weights(cell):
    """
    Parse weight cell with wrapped lines, e.g.:
      'Chinese Language\\n(x1.5)\\nEnglish Language\\n(x1.5)'
      'Literature in\\nEnglish (x1.5)'
      'Specified ApL\\nsubject(s) (x1.5)'
      'The best one\\nsubject of\\nBAFS...(x1.5)*'  ← complex

    Groups lines until one ends with '(x N.NN)' to form one entry,
    then parses 'Subject1, Subject2 (x1.5)' into {Subject1: 1.5, Subject2: 1.5}.

    Returns (weights_dict, raw_text).
    """
    if not cell:
        return {}, ""
    raw = cell.strip()
    if not raw or raw in ("-", "N/A"):
        return {}, raw
    if "(No subject weighting)" in raw:
        return {}, raw

    lines = [l.strip() for l in raw.split("\n") if l.strip()]
    entries = []
    current = []
    for line in lines:
        current.append(line)
        if ENDS_WGT.search(line):
            entries.append(" ".join(current))
            current = []
    if current:
        entries.append(" ".join(current))  # complex tail

    weights = {}
    for entry in entries:
        # Use findall to handle multiple inline entries like "DAT (x1.5) History (x1.5)"
        for subj_raw, wgt in re.findall(r'(.+?)\s*\(x\s*([\d.]+)\)\*?', entry):
            weight = float(wgt)
            # Split comma-separated subjects: "Math, M1/M2 (x1.5)" → Math, M1/M2
            for subj in subj_raw.split(","):
                subj = subj.strip()
                if subj:
                    weights[subj] = weight

    return weights, raw


def parse_score(val):
    if not val:
        return None
    val = str(val).strip()
    return float(val) if NUM_RE.match(val) else None


def parse_min(val):
    """Return first non-empty token from a min-level cell (strips constraint text)."""
    if not val:
        return None
    first = str(val).split("\n")[0].strip()
    return first if first else None


def parse_elect_constraint(val):
    """Extract '3 in ICT / Biology / Chemistry / Physics' constraint text if present."""
    if not val:
        return None
    lines = str(val).split("\n")
    # Constraint text appears after the numeric level on subsequent lines
    constraint_lines = [l.strip() for l in lines[1:] if l.strip()]
    text = " ".join(constraint_lines)
    return text if text else None


# ---------------------------------------------------------------------------
# Step 1: Extract scores from JUPAS combined PDF
# ---------------------------------------------------------------------------

def extract_scores():
    """Returns {code: {score_lq, score_median, subject_weights_2025, subject_weights_2026, ...}}"""
    scores = {}
    seen = set()

    with pdfplumber.open(SCORES_PDF) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table or not table[0] or len(table[0]) != 10:
                    continue
                for row in table[3:]:
                    code = str(row[0] or "").strip()
                    if not CODE_RE.match(code) or code in seen:
                        continue
                    seen.add(code)

                    w25, raw25 = parse_weights(row[2])
                    w26, raw26 = parse_weights(row[8])

                    mean_subj, mean_val = None, None
                    mean_raw = str(row[6] or "").strip()
                    if mean_raw and mean_raw != "-":
                        parts = mean_raw.split("\n")
                        if len(parts) == 2:
                            mean_subj = parts[0].replace(":", "").strip()
                            try:
                                mean_val = float(parts[1].strip())
                            except ValueError:
                                pass

                    scores[code] = {
                        "name":  str(row[1] or "").replace("\n", " ").strip(),
                        "score_lq":     parse_score(row[4]),
                        "score_median": parse_score(row[5]),
                        "mean_specific_subject": mean_subj,
                        "mean_specific_score":   mean_val,
                        "subject_weights_2025":     w25,
                        "subject_weights_2025_raw": raw25,
                        "subject_weights_scores_pdf": w26,       # 2026 from scores PDF
                        "subject_weights_scores_pdf_raw": raw26,
                    }

    print(f"Scores PDF: {len(scores)} programmes")
    return scores


# ---------------------------------------------------------------------------
# Step 2: Extract requirements from entrance requirements PDF
# ---------------------------------------------------------------------------

PROGRAMME_TYPE_KEYWORDS = [
    # Order matters: "Non-Teacher" before "Teacher" to avoid substring match
    ("Non-Teacher", "Non-Teacher Education (4-year)"),
    ("Higher Diploma", "Higher Diploma (2-year)"),
    ("Teacher Education", "Teacher Education (5-year)"),
]


def detect_section(row_text):
    """
    Detect programme type from section header row text.
    Uses short keywords because pdfplumber sometimes splits header text across cells.
    """
    for keyword, label in PROGRAMME_TYPE_KEYWORDS:
        if keyword.lower() in row_text.lower():
            return label
    return None


def extract_requirements():
    """
    Returns {code: {min_chi, min_eng, min_math, min_csd, min_elect1,
                    elect1_constraint, min_elect2, programme_type,
                    subject_weights, subject_weights_raw, admission_notes}}
    """
    reqs = {}

    with pdfplumber.open(REQS_PDF) as pdf:
        # --- Page 1: Table 3 (11 cols) — Five-year double degree programmes ---
        tables_p1 = pdf.pages[0].extract_tables()
        # Find 11-col programme table
        for table in tables_p1:
            if not table or not table[0] or len(table[0]) != 11:
                continue
            prog_type = "Teacher Education (5-year)"
            for row in table[2:]:
                row_text = " ".join(str(c or "") for c in row)
                sec = detect_section(row_text)
                if sec:
                    prog_type = sec
                    continue

                code_cell = str(row[0] or "").strip()
                if not code_cell:
                    continue

                # May have multiple codes stacked (e.g. "JS8002\nJS8003")
                codes = [c.strip() for c in code_cell.split("\n") if CODE_RE.match(c.strip())]
                if not codes:
                    continue

                # If multiple codes share a row, their weight cell is concatenated and
                # cannot be reliably split per-programme — mark as merged.
                weights_merged = len(codes) > 1
                # Weighting usually spans col 8 and 9 due to split header
                weight_raw = " ".join(
                    filter(None, [str(row[8] or "").strip(), str(row[9] or "").strip()])
                ).strip()
                w26, raw26 = parse_weights(weight_raw)
                remarks_raw = str(row[10] or "").strip()

                for code in codes:
                    # Extract programme-specific notes from name (e.g. biennial note)
                    name_cell = str(row[1] or "").replace("\n", " ").strip()
                    # Biennial/odd-year note: "[...will be offered in 20XX/YY]"
                    notes_match = re.search(r'\[([^\]]+)\]', name_cell)
                    admission_notes = notes_match.group(1) if notes_match else None

                    reqs[code] = {
                        "min_chi":   parse_min(row[2]),
                        "min_eng":   parse_min(row[3]),
                        "min_math":  parse_min(row[4]),
                        "min_csd":   parse_min(row[5]),
                        "min_elect1": parse_min(row[6]),
                        "elect1_constraint": parse_elect_constraint(row[6]),
                        "min_elect2": parse_min(row[7]),
                        "programme_type": prog_type,
                        "subject_weights": w26,
                        "subject_weights_raw": raw26,
                        "remarks_pdf": remarks_raw,
                        "weights_merged": weights_merged,
                        "admission_notes": admission_notes,
                    }

        # --- Page 2: Table 1 (15 cols) — remaining programmes ---
        tables_p2 = pdf.pages[1].extract_tables()
        for table in tables_p2:
            if not table or not table[0] or len(table[0]) != 15:
                continue
            prog_type = "Non-Teacher Education (4-year)"  # default for page 2
            for row in table:
                row_text = " ".join(str(c or "") for c in row)
                sec = detect_section(row_text)
                if sec:
                    prog_type = sec
                    continue

                code = str(row[1] or "").strip()
                if not CODE_RE.match(code):
                    continue

                # Weights span col11-13 (merged cell split across columns by pdfplumber)
                wgt_combined = " ".join(
                    filter(None, [str(row[11] or "").strip(), str(row[12] or "").strip(), str(row[13] or "").strip()])
                ).strip()
                # Normalize concatenated spaces from multi-col merge
                weight_raw = wgt_combined.replace("  ", " ")
                w26, raw26 = parse_weights(weight_raw)
                remarks_raw = str(row[14] or "").strip()

                # For HD programme (JS8507) col layout shifts — use what we can
                name_cell = str(row[3] or "").replace("\n", " ").strip()
                notes_match = re.search(r'\[([^\]]+)\]', name_cell)
                admission_notes = notes_match.group(1) if notes_match else None

                # JS8507 (HD) has different min req layout
                if code == "JS8507":
                    reqs[code] = {
                        "min_chi":   "2",
                        "min_eng":   "2",
                        "min_math":  None,
                        "min_csd":   None,
                        "min_elect1": "2",
                        "elect1_constraint": "Any 3 other subjects",
                        "min_elect2": "2",
                        "programme_type": prog_type,
                        "subject_weights": w26,
                        "subject_weights_raw": raw26,
                        "remarks_pdf": remarks_raw,
                        "admission_notes": admission_notes,
                    }
                else:
                    reqs[code] = {
                        "min_chi":   parse_min(row[4]),
                        "min_eng":   parse_min(row[6]),
                        "min_math":  parse_min(row[7]),
                        "min_csd":   parse_min(row[8]),
                        "min_elect1": parse_min(row[9]),
                        "elect1_constraint": parse_elect_constraint(row[9]),
                        "min_elect2": parse_min(row[10]),
                        "programme_type": prog_type,
                        "subject_weights": w26,
                        "subject_weights_raw": raw26,
                        "remarks_pdf": remarks_raw,
                        "admission_notes": admission_notes,
                    }

    print(f"Requirements PDF: {len(reqs)} programmes")
    return reqs


# ---------------------------------------------------------------------------
# Step 3: Merge and save
# ---------------------------------------------------------------------------

def main():
    scores = extract_scores()
    reqs   = extract_requirements()

    all_codes = sorted(set(scores) | set(reqs))
    all_rows  = []

    for code in all_codes:
        s = scores.get(code, {})
        r = reqs.get(code, {})

        # Authoritative 2026 weights: requirements PDF > scores PDF
        # Exception: if requirements PDF merged multiple programmes into one row,
        # the weight cell is unreliable — fall back to per-row scores PDF weights.
        use_reqs_weights = r.get("subject_weights") and not r.get("weights_merged")
        w26     = (r.get("subject_weights") if use_reqs_weights else None) or s.get("subject_weights_scores_pdf") or {}
        raw26   = (r.get("subject_weights_raw") if use_reqs_weights else None) or s.get("subject_weights_scores_pdf_raw") or ""
        w_src   = ("EdUHK_Entrance_Requirements_and_Admission_Score_Calculation.pdf"
                   if use_reqs_weights else "af_2025_JUPAS.pdf p23-26 (col for 2026 entry)")

        row = {
            "code":    code,
            "name":    s.get("name") or "",
            "formula": "Best 5",
            "programme_type": r.get("programme_type"),
            "min_chi":   r.get("min_chi"),
            "min_eng":   r.get("min_eng"),
            "min_math":  r.get("min_math"),
            "min_csd":   r.get("min_csd"),
            "min_elect1": r.get("min_elect1"),
            "elect1_constraint": r.get("elect1_constraint"),
            "min_elect2": r.get("min_elect2"),
            "subject_weights":     w26,
            "subject_weights_raw": raw26,
            "subject_weights_2025":     s.get("subject_weights_2025", {}),
            "subject_weights_2025_raw": s.get("subject_weights_2025_raw", ""),
            "score_lq":      s.get("score_lq"),
            "score_median":  s.get("score_median"),
            "mean_specific_subject": s.get("mean_specific_subject"),
            "mean_specific_score":   s.get("mean_specific_score"),
            "remarks_pdf": r.get("remarks_pdf"),
            "admission_notes": r.get("admission_notes"),
            "data_year_scores":      2025,
            "data_year_weightings":  2026,
            "scores_source":     "af_2025_JUPAS.pdf p23-26 (JUPAS combined, EdUHK section)",
            "weightings_source": w_src,
        }
        all_rows.append(row)

    print(f"\nTotal programmes: {len(all_rows)}")
    for r in all_rows:
        w_str = ", ".join(f"{k} x{v}" for k, v in r["subject_weights"].items()) or "(none)"
        print(f"  {r['code']}  [{r['programme_type']}]  "
              f"lq={r['score_lq']}  med={r['score_median']}  weights: {w_str}")
        if r.get("admission_notes"):
            print(f"    NOTE: {r['admission_notes']}")

    # Check for mismatches
    no_scores = [r["code"] for r in all_rows if r["score_lq"] is None]
    no_reqs   = [r["code"] for r in all_rows if r.get("min_chi") is None and r["code"] != "JS8507"]
    if no_scores:
        print(f"\n  No scores: {no_scores}")
    if no_reqs:
        print(f"  No requirements: {no_reqs}")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(all_rows, f, ensure_ascii=False, indent=2)
    print(f"\nSaved {OUT_JSON}")

    df = pd.DataFrame(all_rows)
    for col in ("subject_weights", "subject_weights_2025"):
        df[col] = df[col].apply(
            lambda d: ", ".join(f"{k} x{v}" for k, v in d.items()) if isinstance(d, dict) else ""
        )
    df.to_excel(OUT_XLSX, index=False)
    print(f"Saved {OUT_XLSX}")


if __name__ == "__main__":
    main()
