"""
CUHK JUPAS Data Scraper
Source: https://admission.cuhk.edu.hk/wp-content/uploads/data.json

IMPORTANT — Year Labeling:
- formula, weight, requirement fields: 2026 entry data (current year)
- static_data_1 ("expected score"): CUHK's reference/expected score for 2026 entry.
  This is NOT the same as 2025 actual admission scores.
  Actual 2025 admission scores are in Admission-Grades-2025.pdf.

For the 2026 calculator:
  Use 2025 actual scores (from PDF) + 2025 weightings (from Admission-Grades-2025.pdf).
  The 2026 formula/weights here are for reference / 2027 calculator.
"""

import argparse
import json
import sys
import requests
import pandas as pd

URL         = "https://admission.cuhk.edu.hk/wp-content/uploads/data.json"
OUTPUT_JSON = "Reference(2026)/CUHK/CUHK_2026_Data.json"
OUTPUT_EXCEL= "Reference(2026)/CUHK/CUHK_2026_Data.xlsx"


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--insecure",
    action="store_true",
    help=(
        "Disable TLS certificate verification. Use only as a fallback when the "
        "CUHK admission feed's cert chain can't be verified in the current "
        "environment (e.g. its Sectigo intermediate roots through an old AAA "
        "Certificate Services anchor that's not in this machine's trust store). "
        "The endpoint is a public CUHK feed, so unverified fetch is low-risk."
    ),
)
ARGS = parser.parse_args()


def fetch_data():
    verify = not ARGS.insecure
    if not verify:
        print(
            "WARNING: TLS verification disabled via --insecure. "
            "Re-enable as soon as the trust store is fixed.",
            file=sys.stderr,
        )
        # Suppress the InsecureRequestWarning noise but keep our explicit warning.
        from urllib3.exceptions import InsecureRequestWarning
        requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
    resp = requests.get(URL, timeout=30, verify=verify)
    resp.raise_for_status()
    return resp.json()


def parse_requirement(req):
    if not req:
        return "", "", "", ""
    chi    = req.get("CHI", "")
    eng    = req.get("ENG", "")
    math   = req.get("MATH", "")
    elects = req.get("ELECT", [])
    elect_str = "; ".join(
        f"{e.get('subject','*')} >= {e.get('score','')}"
        for e in elects
    )
    return chi, eng, math, elect_str


raw = fetch_data()
print(f"Fetched {len(raw)} programmes from CUHK API")

results = []
for prog in raw:
    chi, eng, math, elect_str = parse_requirement(prog.get("requirement"))

    results.append({
        # Identifiers
        "jupas_code":               prog.get("code", ""),
        "name":                     prog.get("name", ""),
        "faculty":                  prog.get("faculty", ""),

        # Score calculation (2026 entry data)
        "data_year_formula":        "2026",
        "principle":                prog.get("principle", ""),
        "formula":                  prog.get("formula", ""),
        "weight":                   prog.get("weight", ""),
        "weight_remarks":           prog.get("weight_remarks", ""),
        "formula_remarks":          prog.get("formula_remarks", ""),

        # Entry requirements (2026 entry data)
        "req_chi":                  chi,
        "req_eng":                  eng,
        "req_math":                 math,
        "req_electives":            elect_str,
        "subject_1":                prog.get("subject_1", ""),
        "subject_1_text":           prog.get("subject_1_text", ""),
        "subject_1_note":           prog.get("subject_1_note", ""),
        "subject_2":                prog.get("subject_2", ""),
        "subject_2_text":           prog.get("subject_2_text", ""),
        "subject_2_note":           prog.get("subject_2_note", ""),
        "requirement_remarks":      prog.get("requirement_remarks", ""),
        "remarks":                  prog.get("remarks", ""),

        # Expected/reference score for 2026 entry
        # NOTE: CUHK's projected reference score — NOT 2025 actual admission score.
        # Actual 2025 scores: see Admission-Grades-2025.pdf
        "data_year_expected_score": "2026",
        "expected_score":           prog.get("static_data_1", ""),
        "score_remark":             prog.get("score_remark", ""),
    })

print(f"Processed {len(results)} programmes")

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

print("\nSample:")
for r in results[:4]:
    print(f"  {r['jupas_code']} {r['name'][:30]} | formula={r['formula']} | expected={r['expected_score']}")

print("\nUnique formulas:")
for f in sorted(set(r['formula'] for r in results)):
    print(f"  {f}")
