"""
PolyU JUPAS Data Scraper

Source: drupalSettings.jupas_calculator from PolyU JUPAS calculator page
        (rendered via Playwright from https://www.polyu.edu.hk/study/ug/admissions/jupas)
Raw JSON saved to: Reference(2026)/PolyU/polyu_drupal_settings.json

Data structure:
  year: 2026  → weightings/formula are for 2026 entry
  data.ADMISSIONS: 46 programme rows
    - Scheme / Programme, JUPAS Code, Faculty / School
    - Admission Score Calculation Mechanism (formula name)
    - Intake Score: HTML/markdown with 2025 Average Score & Lower Quartile
    - Preferred Subjects, Relevant Subjects, Remarks, Quota
  data.JS3xxx: per-programme subject weight table
    [{Subject Name, Subject Weighting, Subject Category}]  ← 2026 weightings
  scores: grade→value conversion tables
    core/elective: 5**=8.5, 5*=7, 5=5.5, 4=4, 3=3, 2=2, 1=1
    ApL: Attained with Distinction=4, Attained=3
    Other Language: A=5, B=4, C=3, D=2, E=1
  requirements: [{key, name, level, category}] — universal min levels
  minimum_level: {core_subject_1: '3', ..., elective_subject: '3'}

Score formula:
  Total = sum of best-N subjects where each subject score = grade_value × subject_weight
  N depends on calculation_mechanism:
    "Any Best 5 Subjects"                          → best 5
    "4 Core + Best 2 Elective Subjects"            → 4 cores + best 2 electives
    "Chinese & English Languages + Any Best 3"     → Chin + Eng + best 3
    "Any Best 6 Subjects"                          → best 6
    "+ bonus" variants add a fractional bonus for the 6th subject

Note on JS3241 → JS3243:
  JS3241 had a 2025 weighting PDF but is absent from the 2026 data.
  JS3243 is the likely restructured replacement (confirmed present in 2026 data).
"""

import re
import json
import warnings
from pathlib import Path

import pandas as pd
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

warnings.filterwarnings("ignore")

OUTPUT_DIR       = Path("Reference(2026)/PolyU")
RAW_JSON         = OUTPUT_DIR / "polyu_drupal_settings.json"
OUTPUT_JSON      = OUTPUT_DIR / "PolyU_2026_Data.json"
OUTPUT_EXCEL     = OUTPUT_DIR / "PolyU_2026_Data.xlsx"
WEIGHTS_JSON     = OUTPUT_DIR / "PolyU_2026_Weights.json"
CALC_URL         = "https://www.polyu.edu.hk/study/ug/admissions/jupas"


# ── Fetch via Playwright ──────────────────────────────────────────────────────

def fetch_drupal_settings():
    if RAW_JSON.exists():
        print(f"Using cached {RAW_JSON}")
        with open(RAW_JSON, encoding="utf-8") as f:
            return json.load(f)

    print("Fetching drupalSettings via Playwright...")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(CALC_URL, wait_until="networkidle", timeout=30000)
        raw = page.evaluate(
            "() => typeof drupalSettings !== 'undefined' && drupalSettings.jupas_calculator "
            "? JSON.stringify(drupalSettings.jupas_calculator) : null"
        )
        browser.close()

    if not raw:
        raise RuntimeError("drupalSettings.jupas_calculator not found on page")

    settings = json.loads(raw)
    with open(RAW_JSON, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    print(f"Saved raw settings: {RAW_JSON}")
    return settings


# ── Parsing helpers ───────────────────────────────────────────────────────────

def strip_html(text):
    if not text:
        return ""
    return " ".join(BeautifulSoup(str(text), "html.parser").get_text().split())


def parse_intake_score(intake_html):
    """Extract Average Score and Lower Quartile from Intake Score HTML/markdown."""
    if not intake_html:
        return "", ""
    text = strip_html(intake_html)
    avg_m = re.search(r"Average Score:\s*([\d.]+)", text)
    lq_m  = re.search(r"Lower Quartile:\s*([\d.]+)", text)
    avg = avg_m.group(1) if avg_m else ""
    lq  = lq_m.group(1)  if lq_m  else ""
    return avg, lq


def parse_requirements(req_list):
    """Convert [{key, name, level}] into flat dict."""
    mapping = {
        "core_subject_1": "req_chin",
        "core_subject_2": "req_eng",
        "core_subject_3": "req_math",
        "core_subject_4": "req_csd",
        "elective_1":     "req_e1",
        "elective_2":     "req_e2",
    }
    return {mapping[r["key"]]: r["level"] for r in req_list if r["key"] in mapping}


def format_weights(weight_list):
    """Compact representation of a weight table: 'Subject (W=n); ...'"""
    parts = []
    for w in weight_list:
        cat = w.get("Subject Category", "")
        name = w.get("Subject Name", "")
        wt   = w.get("Subject Weighting", "")
        # Abbreviate category
        cat_abbr = "A" if "Category A" in cat else ("B" if "Category B" in cat else "C")
        parts.append(f"{name} (W={wt}, Cat{cat_abbr})")
    return "; ".join(parts)


# ── Main ──────────────────────────────────────────────────────────────────────

settings = fetch_drupal_settings()

year = settings.get("year", "2026")
d    = settings["data"]

# Universal min requirements
req_dict = parse_requirements(settings.get("requirements", []))

admissions = d["ADMISSIONS"]
print(f"ADMISSIONS rows: {len(admissions)}")
print(f"Year: {year} (formula/weightings year)")

# Per-programme weight tables (2026)
weight_tables = {k: v for k, v in d.items() if k != "ADMISSIONS"}
print(f"Weight tables: {len(weight_tables)} programmes")

# Build output records
results = []
for row in admissions:
    code = row.get("JUPAS Code", "")
    if not re.match(r"^JS3\d+$", code):
        continue

    avg_2025, lq_2025 = parse_intake_score(row.get("Intake Score"))

    weights = weight_tables.get(code, [])
    weights_compact = format_weights(weights)

    results.append({
        "jupas_code":           code,
        "name":                 row.get("Scheme / Programme", ""),
        "faculty":              row.get("Faculty / School", ""),
        "data_year_formula":    str(year),
        "calculation_mechanism": row.get("Admission Score Calculation Mechanism", ""),
        "quota":                strip_html(row.get("Quota", "")),
        "preferred_subjects":   strip_html(row.get("Preferred Subjects", "")),
        "relevant_subjects":    strip_html(row.get("Relevant Subjects", "")),
        "remarks":              strip_html(row.get("Remarks", "")),
        # Min requirements (universal for PolyU)
        **req_dict,
        # 2026 subject weights (compact string)
        "weights_2026":         weights_compact,
        # 2025 actual admission scores
        "data_year_scores":     "2025",
        "score_avg":            avg_2025,
        "score_lq":             lq_2025,
    })

# Separate weights JSON for full detail (each programme → list of weight objects)
weights_output = {code: weight_tables[code] for code in weight_tables}

# Save
results.sort(key=lambda r: r["jupas_code"])
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

with open(WEIGHTS_JSON, "w", encoding="utf-8") as f:
    json.dump(weights_output, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"\nSaved:")
print(f"  {OUTPUT_JSON}  ({len(results)} programmes)")
print(f"  {WEIGHTS_JSON} (full per-subject weight tables)")
print(f"  {OUTPUT_EXCEL}")

print("\nSample (first 6):")
for r in results[:6]:
    print(f"  {r['jupas_code']} {r['name'][:38]:38s} | {r['calculation_mechanism'][:22]:22s} | Avg={r['score_avg']} LQ={r['score_lq']}")

# Programmes with no weight table
no_weights = [r["jupas_code"] for r in results if not r["weights_2026"]]
if no_weights:
    print(f"\nNo weight table (Best 5 formula, no individual weighting): {no_weights}")

# Grade conversion reference
print("\nGrade → Score conversion (core/elective):")
for item in settings["scores"]["core_subject"]:
    print(f"  {item['level']:6s} → {item['value']}")
