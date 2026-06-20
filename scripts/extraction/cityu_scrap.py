"""
CityU JUPAS Data Scraper

IMPORTANT — Year Labeling:
- Admission scores (hist-data): 2025 reference scores (last year's actuals)
- Subject weightings & calculation methods (weight-info): 2026 data (current year)
- These CANNOT be directly paired for calculation.
  Use 2026 weightings only when 2026 scores become available (i.e. for 2027 calculator).
  For the 2026 calculator, apply 2025 weightings to compare against 2025 scores.
"""

import json
import re
import pandas as pd
from playwright.sync_api import sync_playwright

BASE = "https://www.cityu.edu.hk/admo/_static_json/_api_json"

COLLEGE_IDS = [500, 1, 427, 2, 3, 4, 5, 6, 8, 9, 103]

OUTPUT_JSON  = "Reference(2026)/CityU/CityU_2026_Data.json"
OUTPUT_EXCEL = "Reference(2026)/CityU/CityU_2026_Data.xlsx"


def fetch_json(page, url):
    page.goto(url)
    try:
        return json.loads(page.inner_text("body"))
    except Exception:
        return None


def parse_jupas_code(raw):
    match = re.search(r'(JS\w+)', raw)
    return match.group(1) if match else raw


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # --- Step 1: Subject lookup tables (fetch once) ---
    print("Fetching subject lookup tables...")
    electives   = fetch_json(page, f"{BASE}/get-dse-subjects-elective.json") or []
    other_langs = fetch_json(page, f"{BASE}/get-dse-subjects-other_lang.json") or []

    subj_lookup = {}
    for s in electives + other_langs:
        subj_lookup[str(s["tid"])] = s["name"]
    print(f"  Subjects loaded: {len(subj_lookup)}")

    # Core subject IDs (hardcoded in DSE)
    core_lookup = {
        "141": "English Language",
        "142": "Chinese Language",
        "143": "Mathematics (Compulsory Part)",
        "144": "Liberal Studies / Citizenship and Social Development",
    }
    subj_lookup.update(core_lookup)

    def resolve_subj(tid):
        return subj_lookup.get(str(tid), f"tid:{tid}")

    # --- Step 2: Collect all published programmes ---
    print("Fetching programmes by college...")
    all_programmes = {}

    for college_id in COLLEGE_IDS:
        data = fetch_json(page, f"{BASE}/get-programme-by-collage/{college_id}.json") or []
        published = [prog for prog in data if prog.get("moderation_state") == "Published"]
        for prog in published:
            nid = prog["nid"]
            if nid not in all_programmes:
                all_programmes[nid] = {
                    "nid":           nid,
                    "title":         prog["title"],
                    "jupas_code":    parse_jupas_code(prog.get("field_admission_code", "")),
                    "calc_mode":     prog.get("field_dse_subj_calc_mode", ""),
                    "calc_mode_text":prog.get("field_dse_subj_calc_mode_text", ""),
                    "college_id":    college_id,
                }
        print(f"  College {college_id}: {len(published)} published")

    print(f"Total unique programmes: {len(all_programmes)}")

    # --- Step 3: Fetch detailed data per programme ---
    results = []
    total = len(all_programmes)

    for i, (nid, prog) in enumerate(all_programmes.items()):
        print(f"Scraping {prog['jupas_code']} ({nid}) [{i+1}/{total}]", end="\r")

        hist    = fetch_json(page, f"{BASE}/get-dse-calc-info/hist-data/{nid}.json")    or []
        weights = fetch_json(page, f"{BASE}/get-dse-calc-info/weight-info/{nid}.json")  or []
        weights2= fetch_json(page, f"{BASE}/get-dse-calc-info/weight-info-2/{nid}.json") or []
        breqs   = fetch_json(page, f"{BASE}/get-dse-calc-info/basic-req-info/{nid}.json") or []
        mreqs   = fetch_json(page, f"{BASE}/get-dse-calc-info/min-req-info/{nid}.json")  or []
        other   = fetch_json(page, f"{BASE}/get-dse-calc-info/other-info/{nid}.json")    or []

        # --- Historical scores (2025) ---
        lower_score = med_score = score_formula = score_year = ""
        if hist:
            h = hist[0]
            lower_score   = h.get("field_lower_score", "")
            med_score     = h.get("field_med_score", "")
            score_formula = h.get("field_score_formula", "")
            score_year    = h.get("field_year", "")

        # --- Subject weightings (2026) ---
        # Multiple rows: each row = one subject with its weight and position
        subject_weights = []
        maths_calc_as_one = "0"
        for w in weights:
            subjs = w.get("field_dse_subjects") or []
            wt    = w.get("field_score_weight", "")
            pos   = w.get("field_elc_position") or []
            maths_calc_as_one = w.get("field_maths_calc_as_one", "0")
            if isinstance(subjs, list):
                for tid in subjs:
                    subject_weights.append({
                        "subject":  resolve_subj(str(tid)),
                        "weight":   wt,
                        "position": pos,
                    })

        # weight-info-2 (additional weighting rows, same structure)
        for w in weights2:
            subjs = w.get("field_dse_subjects") or []
            wt    = w.get("field_score_weight", "")
            pos   = w.get("field_elc_position") or []
            if isinstance(subjs, list) and subjs:
                for tid in subjs:
                    subject_weights.append({
                        "subject":  resolve_subj(str(tid)),
                        "weight":   wt,
                        "position": pos,
                        "source":   "weight-info-2",
                    })

        # --- Compulsory subjects for calculation (from other-info) ---
        calc_firstly = []
        calc_firstly_1of = []
        if other:
            calc_firstly     = [resolve_subj(t) for t in (other[0].get("field_dse_subj_calc_firstly") or [])]
            calc_firstly_1of = [resolve_subj(t) for t in (other[0].get("field_dse_subj_calc_firstly_1of") or [])]

        # --- Basic requirements (2026) - one row per required subject ---
        basic_reqs = []
        for row in breqs:
            subjs = row.get("field_dse_subjects") or []
            grade = row.get("field_min_dse_lvl", "")
            for tid in subjs:
                basic_reqs.append({
                    "subject":   resolve_subj(str(tid)),
                    "min_grade": grade,
                })

        # --- Minimum elective requirements (2026) ---
        elective_reqs = []
        for row in mreqs:
            subjs       = row.get("field_dse_subjects") or []
            min_count   = row.get("field_min_count", "")
            min_grade   = row.get("field_min_dse_lvl", "")
            min_grade2  = row.get("field_min_dse_lvl_2", "")
            position    = row.get("field_elc_position") or []
            display     = row.get("field_display_text", "")
            elective_reqs.append({
                "subjects":   [resolve_subj(str(t)) for t in subjs],
                "min_count":  min_count,
                "min_grade":  min_grade,
                "min_grade2": min_grade2,
                "position":   position,
                "display":    display,
            })

        results.append({
            # Identifiers
            "jupas_code":        prog["jupas_code"],
            "nid":               nid,
            "title":             prog["title"],

            # Score calculation method (2026 data)
            "data_year_weightings": "2026",
            "calc_mode":         prog["calc_mode"],
            "calc_mode_text":    prog["calc_mode_text"],
            "maths_calc_as_one": maths_calc_as_one,
            "calc_firstly":      ", ".join(calc_firstly),
            "calc_firstly_1of":  ", ".join(calc_firstly_1of),
            "subject_weights":   json.dumps(subject_weights, ensure_ascii=False),

            # Entry requirements (2026 data)
            "basic_requirements":   json.dumps(basic_reqs, ensure_ascii=False),
            "elective_requirements":json.dumps(elective_reqs, ensure_ascii=False),

            # Historical admission scores (2025 data)
            "data_year_scores":  "2025",
            "score_year_label":  score_year,
            "lower_score":       lower_score,
            "median_score":      med_score,
            "score_formula":     score_formula,
        })

    browser.close()

print(f"\nDone. {len(results)} programmes collected.")

# --- Step 4: Save ---
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")
