"""
HKUST JUPAS Data Scraper & PDF Extractor

Sources:
  JS:  Reference(2026)/HKUST/hkust_calculator.js
       → hardcoded programme data: 2026 formula, min requirements,
         2025 Median (MS) & Lower Quartile (LQ), 2026 expected_score
  PDF: Reference(2026)/HKUST/ADMISSIONS-SCORES-2025.pdf
       → 2025 Highest Attainable (HA), Median, LQ scores (verified)
         5-col format: [HA, '', MS, '', LQ]
         7-col format: ['', HA, '', MS, '', LQ, '']  (some Business)
  PDF: Reference(2026)/HKUST/ADMISSIONS-REQUIREMENTS-2026.pdf
       → 2026 min requirements (10-col page 1 / 14-col page 2)

JS programme object fields:
  jcode               JUPAS code (JS5xxx)
  name                Programme name
  faculty             School/Faculty
  engMultiplier       English weight (x1, x1.5, x2)
  secondMultiplier    Second-subject weight
  secondMultiplierSubject  Which subject gets second multiplier (Math/Chin)
  anotherSpecifiedSubject  Required elective subject group description
  otherSubjects       Free-text description of remaining subject slots
  subjectNum          Number of subjects in formula
  max_attainable_weighting  Max possible weighted total
  expected_score      2026 reference/expected score
  noticesAfterCal.MS  2025 Median score
  noticesAfterCal.LQ  2025 Lower Quartile score
  noticesAfterCal.NO_MSLQ  Non-empty = no reference scores available
  requirements        [{subject, level}] min requirements list
  extra_subject_bonus_category  Bonus subject categories
  flexible_intake_score  -1 if not applicable
"""

import re
import json
import warnings
import pdfplumber
import pandas as pd
from bs4 import BeautifulSoup

warnings.filterwarnings("ignore")

JS_PATH        = "Reference(2026)/HKUST/hkust_calculator.js"
SCORES_PDF     = "Reference(2026)/HKUST/ADMISSIONS-SCORES-2025.pdf"
REQS_PDF       = "Reference(2026)/HKUST/ADMISSIONS-REQUIREMENTS-2026.pdf"
OUTPUT_JSON    = "Reference(2026)/HKUST/HKUST_2026_Data.json"
OUTPUT_EXCEL   = "Reference(2026)/HKUST/HKUST_2026_Data.xlsx"


# ── JS parsing ────────────────────────────────────────────────────────────────

def extract_programmes_from_js(path):
    with open(path, encoding="utf-8") as f:
        content = f.read()

    # Find the main programmes:[{...}] array (second occurrence)
    positions = [m.start() for m in re.finditer(r'programmes:\[', content)]
    if len(positions) < 2:
        raise ValueError("Could not find programmes:[{...}] array in JS")
    start = positions[1] + len("programmes:")  # position of '['

    # Match the outer [...] brackets
    depth = 0
    idx = start
    while idx < len(content):
        if content[idx] == "[":
            depth += 1
        elif content[idx] == "]":
            depth -= 1
            if depth == 0:
                idx += 1
                break
        idx += 1
    prog_str = content[start:idx]

    # Convert JS object literal to valid JSON
    prog_str = prog_str.replace(":!0,", ":true,").replace(":!0}", ":true}")
    prog_str = prog_str.replace(":!1,", ":false,").replace(":!1}",":false}")
    prog_str = re.sub(r'(?<=[{,\[])([a-zA-Z_][a-zA-Z0-9_]*):', r'"\1":', prog_str)

    return json.loads(prog_str)


def parse_requirement_level(req_list):
    """Convert [{subject, level}] to a flat dict keyed by subject shorthand."""
    mapping = {
        "English Language": "req_eng",
        "Chinese Language": "req_chin",
        "Mathematics Compulsory Part": "req_math",
        "Citizenship & Social Development": "req_csd",
        "Elective Subject 1": "req_e1",
        "Elective Subject 2": "req_e2",
    }
    result = {}
    for item in req_list:
        key = mapping.get(item["subject"])
        if key:
            result[key] = item["level"]
    return result


def clean_html(text):
    """Strip HTML tags and normalise whitespace."""
    return " ".join(BeautifulSoup(str(text), "html.parser").get_text().split())


def parse_js(path):
    raw_progs = extract_programmes_from_js(path)
    results = {}
    for p in raw_progs:
        jcode = p.get("jcode", "")
        if not re.match(r"^JS\d+$", jcode):
            continue

        notices = p.get("noticesAfterCal", {})
        has_scores = not notices.get("NO_MSLQ") and notices.get("MS")
        ms = notices.get("MS", "") if has_scores else ""
        lq = notices.get("LQ", "") if has_scores else ""

        req_dict = parse_requirement_level(p.get("requirements", []))

        results[jcode] = {
            "jupas_code":           jcode,
            "name":                 p.get("name", "").replace(jcode + " ", "", 1).strip(),
            "faculty":              p.get("faculty", ""),
            "data_year_formula":    "2026",
            "subjectNum":           p.get("subjectNum", ""),
            "max_attainable_weighting": p.get("max_attainable_weighting", ""),
            "engMultiplier":        p.get("engMultiplier", ""),
            "secondMultiplier":     p.get("secondMultiplier", ""),
            "secondMultiplierSubject": p.get("secondMultiplierSubject", ""),
            "anotherSpecifiedSubject": p.get("anotherSpecifiedSubject", ""),
            "otherSubjects":        clean_html(p.get("otherSubjects", "")),
            "remark":               clean_html(p.get("remark", "")),
            "extra_subject_bonus_category": ",".join(p.get("extra_subject_bonus_category", [])),
            "flexible_intake_score": p.get("flexible_intake_score", -1),
            "data_year_expected_score": "2026",
            "expected_score":       p.get("expected_score", ""),
            "data_year_scores":     "2025",
            "score_median":         ms,
            "score_lq":             lq,
            "score_ha":             "",   # filled from PDF
            **req_dict,
        }
    return results


# ── Scores PDF (HA extraction) ────────────────────────────────────────────────

def parse_scores_pdf(path):
    """
    Returns {(ms_float, lq_float): ha_str} from the 2025 scores PDF.
    5-col rows: [HA, '', MS, '', LQ]
    7-col rows: ['', HA, '', MS, '', LQ, '']
    Uses float tuples as keys to avoid string-format mismatches.
    """
    lookup = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for t in page.extract_tables() or []:
                if not t:
                    continue
                ncols = max(len(r) for r in t)
                for row in t:
                    vals = [str(v).strip() if v else "" for v in row]
                    try:
                        if ncols == 5:
                            ha, ms, lq = float(vals[0]), float(vals[2]), float(vals[4])
                        elif ncols == 7:
                            ha, ms, lq = float(vals[1]), float(vals[3]), float(vals[5])
                        else:
                            continue
                        lookup[(ms, lq)] = str(ha)
                    except (ValueError, IndexError):
                        pass
    return lookup


# ── Main ──────────────────────────────────────────────────────────────────────

print("Parsing JS file...")
js_data = parse_js(JS_PATH)
print(f"JS programmes: {len(js_data)}")

print("Parsing scores PDF...")
ha_lookup = parse_scores_pdf(SCORES_PDF)
print(f"HA score rows: {len(ha_lookup)}")

# Attach HA scores
matched = 0
for jcode, rec in js_data.items():
    ms = rec["score_median"]
    lq = rec["score_lq"]
    if ms and lq:
        try:
            ha = ha_lookup.get((float(ms), float(lq)), "")
        except ValueError:
            ha = ""
        if ha:
            rec["score_ha"] = ha
            matched += 1
print(f"HA matched: {matched}/{len([r for r in js_data.values() if r['score_median']])}")

# Sort by JUPAS code
results = sorted(js_data.values(), key=lambda r: r["jupas_code"])

# Save outputs
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

print("\nSample (first 5):")
for r in results[:5]:
    print(f"  {r['jupas_code']} {r['name'][:32]:32s} | Eng={r['engMultiplier']} n={r['subjectNum']} "
          f"| HA={r['score_ha']} MS={r['score_median']} LQ={r['score_lq']}")

# Summary stats
no_scores = [r for r in results if not r["score_median"]]
if no_scores:
    print(f"\nProgrammes with no 2025 scores ({len(no_scores)}):")
    for r in no_scores:
        print(f"  {r['jupas_code']} {r['name'][:50]}")
