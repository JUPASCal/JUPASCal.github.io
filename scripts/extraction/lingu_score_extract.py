"""
LingU Score Extractor — af_2025_LingU.pdf (from JUPAS af_2025_JUPAS.pdf p16-18)
Extracts 2025 admission scores (Median and Lower Quartile weighted scores + grade breakdowns).

Layout notes:
- Two-column visual layout: left = JS code + name, right = score data
- Page 1: Median score row appears just ABOVE the JS code row
- Page 2+: JS code and Median score appear on the SAME y-row
- Both layouts handled by state machine (buffer Median if seen before code)
- Score conversion (LingU-specific): 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1

Usage:
    ~/miniconda3/envs/jupascal/bin/python lingu_score_extract.py
"""

import json
import re
import pdfplumber
import pandas as pd
from collections import defaultdict

SCORE_PDF = "Reference(2026)/LingU/af_2025_LingU.pdf"
OUT_JSON  = "Reference(2026)/LingU/LingU_2026_Data.json"
OUT_XLSX  = "Reference(2026)/LingU/LingU_2026_Data.xlsx"

CODE_RE = re.compile(r"^JS7\d{3}$")
NUM_RE  = re.compile(r"^\d+(\.\d+)?$")

# x-bands: (field_name, x_min, x_max)
SCORE_BANDS = [
    ("score",     258, 298),
    ("CHIN",      320, 350),
    ("ENGL",      370, 405),
    ("MATH",      420, 455),
    ("Elective1", 470, 510),
    ("Elective2", 525, 560),
]
GRADE_FIELDS = ["CHIN", "ENGL", "MATH", "Elective1", "Elective2"]


def words_to_yrows(words, tol=4):
    rows = defaultdict(list)
    for w in words:
        rows[round(w["top"] / tol) * tol].append(w)
    return {y: sorted(ws, key=lambda w: w["x0"]) for y, ws in rows.items()}


def extract_score_data(row_words):
    """Extract weighted score + grade breakdown from a row using x-bands."""
    result = {}
    for name, xlo, xhi in SCORE_BANDS:
        for w in row_words:
            if xlo <= w["x0"] <= xhi and NUM_RE.match(w["text"]):
                result[name] = w["text"]
                break
    return result if "score" in result else None


def classify_yrow(row_words):
    """
    Returns dict with:
      code  : JS code string or None
      score : score data dict or None  (from right column x>200)
      left  : raw left-column text
    """
    left_words  = [w for w in row_words if w["x0"] < 200]
    right_words = [w for w in row_words if w["x0"] >= 200]

    code = None
    for w in left_words:
        if CODE_RE.match(w["text"]):
            code = w["text"]
            break

    score = extract_score_data(right_words)
    left_text = " ".join(w["text"] for w in left_words)

    return {"code": code, "score": score, "left": left_text}


def extract_names(words, code_ys):
    """
    Build {code: name} by collecting left-column words (x<200, not the code itself)
    in the y-range owned by each code.
    """
    left_words = sorted([w for w in words if w["x0"] < 200], key=lambda w: w["top"])
    code_ys_sorted = sorted(code_ys.items(), key=lambda kv: kv[1])  # [(code, y), ...]
    name_map = {}

    for idx, (code, cy) in enumerate(code_ys_sorted):
        next_cy = code_ys_sorted[idx + 1][1] if idx + 1 < len(code_ys_sorted) else 9999
        parts = []
        for w in left_words:
            if cy - 5 <= w["top"] <= next_cy - 5:
                if not CODE_RE.match(w["text"]):
                    parts.append(w["text"])
        name_map[code] = " ".join(parts).strip()
    return name_map


def extract_faculty(left_text):
    t = left_text.upper()
    if "FACULTY OF" in t or "SCHOOL OF" in t:
        return left_text.strip()
    return None


def process_page(page, carry_faculty=""):
    words = page.extract_words()
    rows = words_to_yrows(words)

    # Collect events in y-order; skip running header line only (y < 50)
    events = []
    for y in sorted(rows):
        if y < 50:
            continue
        info = classify_yrow(rows[y])
        fac  = extract_faculty(info["left"])
        events.append((y, info, fac))

    # Build name lookup
    code_ys = {info["code"]: y for y, info, _ in events if info["code"]}
    name_map = extract_names(words, code_ys)

    # State machine
    programmes = []
    current_faculty = carry_faculty
    pending_median = None   # score buffered before its JS code appeared
    current = None          # {code, name, faculty, median, lq}

    def finalize(prog, lq_data):
        prog["score_lq"]        = float(lq_data["score"]) if lq_data and "score" in lq_data else None
        prog["score_lq_grades"] = {k: lq_data[k] for k in GRADE_FIELDS if lq_data and k in lq_data}
        programmes.append(prog)

    for y, info, fac in events:
        if fac:
            current_faculty = fac
            continue

        code  = info["code"]
        score = info["score"]

        if code and score:
            # JS code and Median on the same row (page 2+ layout)
            current = {
                "code":          code,
                "name":          name_map.get(code, ""),
                "faculty":       current_faculty,
                "score_median":  float(score["score"]),
                "score_median_grades": {k: score[k] for k in GRADE_FIELDS if k in score},
            }
            pending_median = None

        elif code:
            # JS code only — Median may be pending (page 1 layout) or will follow
            if pending_median:
                current = {
                    "code":          code,
                    "name":          name_map.get(code, ""),
                    "faculty":       current_faculty,
                    "score_median":  float(pending_median["score"]),
                    "score_median_grades": {k: pending_median[k] for k in GRADE_FIELDS if k in pending_median},
                }
                pending_median = None
            else:
                # Median will appear after (shouldn't happen for this PDF but handle gracefully)
                current = {
                    "code":    code,
                    "name":    name_map.get(code, ""),
                    "faculty": current_faculty,
                    "score_median": None,
                    "score_median_grades": {},
                }

        elif score:
            if current is None:
                # Score before any code → buffer as pending Median
                pending_median = score
            elif current.get("score_median") is None:
                # Code seen, no median yet → this is the Median
                current["score_median"] = float(score["score"])
                current["score_median_grades"] = {k: score[k] for k in GRADE_FIELDS if k in score}
            else:
                # Median already set → this is the LQ; finalize programme
                finalize(current, score)
                current = None

    return programmes, current_faculty


def main():
    all_programmes = []

    with pdfplumber.open(SCORE_PDF) as pdf:
        carry = ""
        for i, page in enumerate(pdf.pages):
            progs, carry = process_page(page, carry_faculty=carry)
            print(f"Page {i+1}: {len(progs)} programmes")
            for p in progs:
                print(f"  {p['code']}  [{p['faculty']}]  median={p['score_median']}  lq={p['score_lq']}")
            all_programmes.extend(progs)

    # Add fixed fields
    for p in all_programmes:
        p["formula"]             = "Best 5"
        p["data_year_scores"]    = 2025
        p["scores_source"]       = "af_2025_JUPAS.pdf p16-18 (JUPAS combined, LingU section)"
        p["data_year_weightings"] = None  # filled when weightings PDF is processed
        p["weightings_source"]   = None

    # Score conversion note (LingU-specific, different from other schools)
    print(f"\nNote: LingU grade→score: 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1")
    print(f"Total: {len(all_programmes)} programmes")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(all_programmes, f, ensure_ascii=False, indent=2)
    print(f"Saved {OUT_JSON}")

    df = pd.DataFrame(all_programmes)
    for col in ("score_median_grades", "score_lq_grades"):
        df[col] = df[col].apply(
            lambda d: ", ".join(f"{k}:{v}" for k, v in d.items()) if isinstance(d, dict) else ""
        )
    df.to_excel(OUT_XLSX, index=False)
    print(f"Saved {OUT_XLSX}")


if __name__ == "__main__":
    main()
