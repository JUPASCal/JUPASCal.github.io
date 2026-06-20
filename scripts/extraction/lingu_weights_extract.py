"""
LingU Weightings Extractor — Admission_Requirements_JUPAS_2026.pdf
Extracts 2026 subject weightings per programme (pages 6-10),
then merges into LingU_2026_Data.json (which has 2025 scores from score extractor).

PDF structure (pages 6-10, no tables — clean text):
  JS7xxx <Programme Name>       ← code + name header (name may wrap to next line)
  <Subject Name> <weight>       ← weight row
  <Subject Name> <weight>
  ...
  JS7xxx <Next Programme>
  ...

Known typo in PDF: "JS7215" appears twice (p8). Second occurrence is JS7216.

Usage:
    ~/miniconda3/envs/jupascal/bin/python lingu_weights_extract.py
"""

import json
import re
import pdfplumber
import pandas as pd

WEIGHTS_PDF = "Reference(2026)/LingU/Admission_Requirements_JUPAS_2026.pdf"
DATA_JSON   = "Reference(2026)/LingU/LingU_2026_Data.json"

CODE_RE   = re.compile(r"^(JS7\d{3})\s+(.+)$")
WEIGHT_RE = re.compile(r"^(.+?)\s+([\d.]+)$")

# Pages with weighting data (1-indexed: 6-10, 0-indexed: 5-9)
WEIGHT_PAGES = range(5, 10)

# Known PDF typo: second JS7215 entry is actually JS7216
TYPO_FIX = {"JS7215": "JS7216"}  # applied only on second occurrence

# PDF text extraction artifacts: subject names that got merged into one line.
# Each entry maps the merged string → list of (subject, weight) tuples to replace it.
# Weight is None = inherit the parsed weight for both subjects.
SUBJECT_SPLITS = {
    "Health Management and Social Care Physics": [
        ("Health Management and Social Care", None),
        ("Physics", None),
    ],
}

# Subject name typos in the PDF → correct name
SUBJECT_TYPOS = {
    "Physic": "Physics",
}


def extract_weightings(pdf_path):
    """Parse all text from weighting pages into {code: {subject: weight}} dict."""
    all_lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for i in WEIGHT_PAGES:
            text = pdf.pages[i].extract_text() or ""
            all_lines.extend(text.split("\n"))

    weightings = {}   # {code: {"name": str, "weights": {subject: float}}}
    seen_codes = {}   # track occurrences for typo fixing
    current_code = None
    current_name_parts = []
    name_complete = False  # True once we see first weight line

    for line in all_lines:
        line = line.strip()
        if not line:
            continue

        # Skip section header lines
        if any(line.startswith(x) for x in [
            "5 Subject", "In addition", "greater weight", "weightings are",
            "JUPAS Code", "COPYRIGHT"
        ]):
            continue

        m_code = CODE_RE.match(line)
        if m_code:
            # Save previous programme
            if current_code:
                name = " ".join(current_name_parts).strip()
                weightings[current_code]["name"] = name

            raw_code = m_code.group(1)
            seen_codes[raw_code] = seen_codes.get(raw_code, 0) + 1

            # Apply typo fix on second occurrence
            code = raw_code
            if seen_codes[raw_code] > 1 and raw_code in TYPO_FIX:
                code = TYPO_FIX[raw_code]
                print(f"  [typo fix] {raw_code} (occurrence {seen_codes[raw_code]}) → {code}")

            current_code = code
            current_name_parts = [m_code.group(2).strip()]
            name_complete = False
            weightings[code] = {"name": "", "weights": {}}
            continue

        if current_code is None:
            continue

        m_weight = WEIGHT_RE.match(line)
        if m_weight:
            name_complete = True
            subject = m_weight.group(1).strip()
            weight  = float(m_weight.group(2))

            # Fix run-on subject names (PDF extraction artifact)
            if subject in SUBJECT_SPLITS:
                print(f"  [subject split] {repr(subject)} → split into 2 subjects")
                for split_subj, split_weight in SUBJECT_SPLITS[subject]:
                    w = split_weight if split_weight is not None else weight
                    corrected = SUBJECT_TYPOS.get(split_subj, split_subj)
                    weightings[current_code]["weights"][corrected] = w
            else:
                # Fix standalone typos
                subject = SUBJECT_TYPOS.get(subject, subject)
                weightings[current_code]["weights"][subject] = weight
        elif not name_complete:
            # Programme name continuation line
            current_name_parts.append(line)

    # Save last programme
    if current_code:
        weightings[current_code]["name"] = " ".join(current_name_parts).strip()

    return weightings


def merge_and_save(weightings):
    with open(DATA_JSON, encoding="utf-8") as f:
        programmes = json.load(f)

    matched, unmatched_scores, unmatched_weights = 0, [], []

    for prog in programmes:
        code = prog["code"]
        if code in weightings:
            prog["subject_weights"]          = weightings[code]["weights"]
            prog["data_year_weightings"]      = 2026
            prog["weightings_source"]         = "Admission_Requirements_JUPAS_2026.pdf (LingU, Section 5)"
            matched += 1
        else:
            prog["subject_weights"]     = {}
            unmatched_scores.append(code)

    weight_codes = set(weightings)
    score_codes  = {p["code"] for p in programmes}
    unmatched_weights = [c for c in weight_codes if c not in score_codes]

    print(f"\nMerge summary:")
    print(f"  Matched:                {matched}")
    print(f"  In scores, no weights:  {unmatched_scores}")
    print(f"  In weights, no scores:  {unmatched_weights}")

    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(programmes, f, ensure_ascii=False, indent=2)
    print(f"\nUpdated {DATA_JSON}")

    # Rebuild Excel
    df = pd.DataFrame(programmes)
    df["subject_weights"] = df["subject_weights"].apply(
        lambda d: ", ".join(f"{k}:{v}" for k, v in d.items()) if isinstance(d, dict) else ""
    )
    for col in ("score_median_grades", "score_lq_grades"):
        if col in df:
            df[col] = df[col].apply(
                lambda d: ", ".join(f"{k}:{v}" for k, v in d.items()) if isinstance(d, dict) else ""
            )
    out_xlsx = "Reference(2026)/LingU/LingU_2026_Data.xlsx"
    df.to_excel(out_xlsx, index=False)
    print(f"Updated {out_xlsx}")


def main():
    print("Extracting weightings...")
    weightings = extract_weightings(WEIGHTS_PDF)

    print(f"\nExtracted {len(weightings)} programmes:")
    for code, data in weightings.items():
        w_str = ", ".join(f"{s}:{v}" for s, v in data["weights"].items())
        print(f"  {code}  {w_str}")

    merge_and_save(weightings)


if __name__ == "__main__":
    main()
