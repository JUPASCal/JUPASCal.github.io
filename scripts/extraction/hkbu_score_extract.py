"""
HKBU Score Extractor — af_2025_HKBU.pdf (from JUPAS af_2025_JUPAS.pdf p9-15)
Extracts 2025 admission scores (mean, median/LQ grade breakdowns) per programme.
Then merges with HKBU_2026_Data.json (which has weightings/requirements).

Usage:
    ~/miniconda3/envs/jupascal/bin/python hkbu_score_extract.py
"""

import re
import json
import pdfplumber
import pandas as pd

SCORE_PDF = "Reference(2026)/HKBU/af_2025_HKBU.pdf"
DATA_JSON = "Reference(2026)/HKBU/HKBU_2026_Data.json"

SUBJECT_COLS = ["CHIN", "ENGL", "MATH", "CSD", "Elective 1", "Elective 2", "Elective 3", "Elective 4"]
CODE_RE = re.compile(r"(JS\d{4})\s+(.+)")


def parse_table(table):
    """
    Parse one programme table (8-9 rows, 10 cols).
    Returns dict or None if not a valid programme table.
    """
    # Find the row containing JS code
    code, name = None, None
    for row in table:
        if row[0] and CODE_RE.match(str(row[0])):
            m = CODE_RE.match(row[0].strip())
            code = m.group(1)
            name = m.group(2).strip()
            break
        # Name may wrap to next row — check if row[0] contains more of name
    if not code:
        return None

    # Collect multi-line name (rows after code row until 'Score Formula')
    capturing_name = False
    for row in table:
        cell = str(row[0] or "").strip()
        if CODE_RE.match(cell):
            capturing_name = True
            continue
        if capturing_name:
            if cell.startswith("Score Formula") or cell == "" or cell is None:
                break
            name += " " + cell

    name = name.strip()

    # Find Median and Lower Quartile rows (last 2 data rows)
    median_row = None
    lq_row = None
    mean_score = None

    for row in table:
        label = str(row[1] or "").strip()
        if label == "Median":
            median_row = row
            mean_val = str(row[0] or "").strip()
            if mean_val and mean_val != "None":
                try:
                    mean_score = float(mean_val)
                except ValueError:
                    pass
        elif label == "Lower Quartile":
            lq_row = row

    if median_row is None:
        return None

    def extract_grades(row):
        """Extract [CHIN, ENGL, MATH, CSD, E1, E2, E3, E4] from row cols 2-9."""
        grades = {}
        for i, subj in enumerate(SUBJECT_COLS):
            val = row[i + 2] if (i + 2) < len(row) else None
            if val and str(val).strip() not in ("", "None"):
                grades[subj] = str(val).strip()
        return grades

    median_grades = extract_grades(median_row)
    lq_grades = extract_grades(lq_row) if lq_row else {}

    return {
        "code": code,
        "score_mean": mean_score,
        "score_median_grades": median_grades,
        "score_lq_grades": lq_grades,
        "data_year_scores": 2025,
    }


def extract_scores():
    scores = {}
    with pdfplumber.open(SCORE_PDF) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                result = parse_table(table)
                if result:
                    scores[result["code"]] = result
                    print(f"  {result['code']}  mean={result['score_mean']}  "
                          f"median={result['score_median_grades']}")
    return scores


def merge_and_save(scores):
    with open(DATA_JSON, encoding="utf-8") as f:
        programmes = json.load(f)

    matched, unmatched = 0, []
    for prog in programmes:
        code = prog["code"]
        if code in scores:
            s = scores[code]
            prog["score_mean"] = s["score_mean"]
            prog["score_median_grades"] = s["score_median_grades"]
            prog["score_lq_grades"] = s["score_lq_grades"]
            prog["data_year_scores"] = s["data_year_scores"]
            matched += 1
        else:
            unmatched.append(code)

    print(f"\nMerged: {matched} matched, {len(unmatched)} unmatched")
    if unmatched:
        print(f"  Unmatched (no score data): {unmatched}")

    # Check for score entries with no matching weighting entry
    prog_codes = {p["code"] for p in programmes}
    extra = [c for c in scores if c not in prog_codes]
    if extra:
        print(f"  Score-only (not in GER-PERs): {extra}")

    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(programmes, f, ensure_ascii=False, indent=2)
    print(f"Updated {DATA_JSON}")

    # Rebuild Excel
    df = pd.DataFrame(programmes)
    df["subject_weights"] = df["subject_weights"].apply(
        lambda d: ", ".join(f"{k} x{v}" for k, v in d.items()) if isinstance(d, dict) and d else ""
    )
    df["score_median_grades"] = df["score_median_grades"].apply(
        lambda d: ", ".join(f"{k}:{v}" for k, v in d.items()) if isinstance(d, dict) else ""
    )
    df["score_lq_grades"] = df["score_lq_grades"].apply(
        lambda d: ", ".join(f"{k}:{v}" for k, v in d.items()) if isinstance(d, dict) else ""
    )
    out_xlsx = "Reference(2026)/HKBU/HKBU_2026_Data.xlsx"
    df.to_excel(out_xlsx, index=False)
    print(f"Updated {out_xlsx}")


def main():
    print("Extracting scores...")
    scores = extract_scores()
    print(f"\nTotal programmes with scores: {len(scores)}")
    merge_and_save(scores)


if __name__ == "__main__":
    main()
