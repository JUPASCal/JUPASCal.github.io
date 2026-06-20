"""
LingU 2025 Weightings Extractor — LingU 2025 Weighting.pdf (from 2025 archive)
Extracts 2025 subject weightings per programme (pages 4-10),
then merges into LingU_2026_Data.json as subject_weights_2025 field.

Same structure as 2026 PDF (clean text, no tables).
Key difference: copyright footer reads "C OPYRIGHT" (with space) — skipped via substring match.
Known typo in PDF: JS7215 appears twice (p8). Second occurrence is JS7216.
Known typo: "Information and Communication Technolody" → corrected in SUBJECT_TYPOS.

Usage:
    ~/miniconda3/envs/jupascal/bin/python lingu_2025_weights_extract.py
"""

import json
import re
import pdfplumber
import pandas as pd

PDF_PATH  = "Archives/2025 JUPAS 計分器/參考資料(2025)/LingU/LingU 2025 Weighting.pdf"
DATA_JSON = "Reference(2026)/LingU/LingU_2026_Data.json"

CODE_RE   = re.compile(r"^(JS7\d{3})\s+(.+)$")
WEIGHT_RE = re.compile(r"^(.+?)\s+([\d.]+)$")
WEIGHT_PAGES = range(3, 10)  # pages 4-10 (0-indexed)

TYPO_FIX = {"JS7215": "JS7216"}  # second occurrence only

SUBJECT_SPLITS = {
    "Health Management and Social Care Physics": [
        ("Health Management and Social Care", None),
        ("Physics", None),
    ],
}

SUBJECT_TYPOS = {
    "Physic": "Physics",
    "Information and Communication Technolody": "Information and Communication Technology",
}

SKIP_STARTERS = [
    "5 Subject", "3 Subject", "In addition", "greater weight", "weightings are",
    "JUPAS Code", "Subject Weighting for", "HKDSE Subjects", "Subject Weights",
]
SKIP_CONTAINS = ["OPYRIGHT"]  # catches "C OPYRIGHT© ..." footer


def extract_weightings(pdf_path):
    """Parse all text from weighting pages into {code: {subject: weight}} dict."""
    all_lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for i in WEIGHT_PAGES:
            text = pdf.pages[i].extract_text() or ""
            all_lines.extend(text.split("\n"))

    weightings = {}
    seen_codes = {}
    current_code = None
    current_name_parts = []
    name_complete = False

    for line in all_lines:
        line = line.strip()
        if not line:
            continue
        if any(line.startswith(x) for x in SKIP_STARTERS):
            continue
        if any(x in line for x in SKIP_CONTAINS):
            continue

        m_code = CODE_RE.match(line)
        if m_code:
            if current_code:
                weightings[current_code]["name"] = " ".join(current_name_parts).strip()

            raw_code = m_code.group(1)
            seen_codes[raw_code] = seen_codes.get(raw_code, 0) + 1
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
            weight = float(m_weight.group(2))

            if subject in SUBJECT_SPLITS:
                print(f"  [subject split] {repr(subject)} → split into 2 subjects")
                for split_subj, split_weight in SUBJECT_SPLITS[subject]:
                    w = split_weight if split_weight is not None else weight
                    corrected = SUBJECT_TYPOS.get(split_subj, split_subj)
                    weightings[current_code]["weights"][corrected] = w
            else:
                subject = SUBJECT_TYPOS.get(subject, subject)
                weightings[current_code]["weights"][subject] = weight
        elif not name_complete:
            current_name_parts.append(line)

    if current_code:
        weightings[current_code]["name"] = " ".join(current_name_parts).strip()

    return weightings


def merge_and_save(weightings):
    with open(DATA_JSON, encoding="utf-8") as f:
        programmes = json.load(f)

    matched, unmatched_scores = 0, []

    for prog in programmes:
        code = prog["code"]
        if code in weightings:
            prog["subject_weights_2025"] = weightings[code]["weights"]
            prog["weightings_2025_source"] = (
                "LingU 2025 Weighting.pdf "
                "(Archives/2025 JUPAS 計分器/參考資料(2025)/LingU/)"
            )
            matched += 1
        else:
            prog["subject_weights_2025"] = {}
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
    for col in ("subject_weights", "subject_weights_2025"):
        if col in df:
            df[col] = df[col].apply(
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
    print("Extracting 2025 weightings...")
    weightings = extract_weightings(PDF_PATH)

    print(f"\nExtracted {len(weightings)} programmes:")
    for code, data in weightings.items():
        w_str = ", ".join(f"{s}:{v}" for s, v in data["weights"].items())
        print(f"  {code}  {w_str}")

    merge_and_save(weightings)


if __name__ == "__main__":
    main()
