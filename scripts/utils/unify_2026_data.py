import json
import os
import pandas as pd
import re
from datetime import datetime, timezone
from bs4 import BeautifulSoup

"""
JUPAS Data Unification Script (2026 Cycle)
------------------------------------------
This script merges admission data from 10 different institutions into a single
unified JSON file: JUPAS_2026_Unified_Data.json.

CORE LOGIC:
1. Primary Calculation basis is 2025: Since reference scores (UQ/M/LQ) provided
   by universities are based on the 2025 applicant pool, we must use the 
   2025 weightings and formulas to calculate a student's score for comparison.
2. Requirements are 2026: We use the 2026 minimum levels to determine eligibility.
3. Structured Logic: Complex rules (like conditional pools or "best of" weights)
   are parsed into objects to facilitate machine calculation.
"""

# File paths for institution-specific JSONs (extracted via university scrapers)
FILES = {
    "CityU": "Reference(2026)/CityU/CityU_2026_Data.json",
    "CUHK": "Reference(2026)/CUHK/CUHK_2026_Data.json",
    "EdUHK": "Reference(2026)/EdUHK/EdUHK_2026_Data.json",
    "HKBU": "Reference(2026)/HKBU/HKBU_2026_Data.json",
    "HKMU": "Reference(2026)/HKMU/HKMU_2026_Data.json",
    "HKU": "Reference(2026)/HKU/HKU_2026_Data.json",
    "HKUST": "Reference(2026)/HKUST/HKUST_2026_Data.json",
    "LingU": "Reference(2026)/LingU/LingU_2026_Data.json",
    "PolyU": "Reference(2026)/PolyU/PolyU_2026_Data.json",
    "SSSDP": "Reference(2026)/SSSDP/SSSDP_2026_Data.json"
}

# Supplemental: HKUST structured formula data reverse-engineered from official JS calculator
HKUST_JS_EXTRACT = "Reference(2026)/HKUST/HKUST_2026_JS_Extracted.json"
# CityU 2025 weightings, VLM-transcribed from the 2025 PDF (the scrape's 2025 field
# was garbled; unify was also copying 2026 onto 2025). See scripts/extraction/
# cityu_2025_weights_from_pdf.py. Keyed by JS code.
CITYU_2025_WEIGHTS = "Reference(2026)/CityU/cityu_2025_weights_vlm.json"
# CUHK 2025 weightings, parsed from the reliable scraped 2025 weight strings
# (verified vs Reference(2025)/CUHK/CUHK 2025 Weightings.pdf); unify used to copy
# 2026 onto 2025. See scripts/extraction/cuhk_2025_weights_from_scrape.py.
CUHK_2025_WEIGHTS = "Reference(2026)/CUHK/cuhk_2025_weights.json"

# Supplemental Data Files (PDF extractions or raw API caches)
CUHK_2025_REQ = "Reference(2026)/CUHK/CUHK_PDF_2025_Requirements.json"
CUHK_2026_REQ = "Reference(2026)/CUHK/CUHK_PDF_2026_Requirements.json"
HKU_RAW_API = "Reference(2026)/HKU/hku_raw_api.json"
POLYU_WEIGHTS_2026 = "Reference(2026)/PolyU/PolyU_2026_Weights.json"

OVERVIEW_FILE = "data/raw/2026 JUPAS Program Overview.csv"
OFFER_TABLE_FILE = "data/raw/2026 JUPAS Offer Table.csv"
JUPAS_DETAIL_FILE = "data/raw/jupas_programme_details_2026.json"
OUTPUT_FILE = "data/processed/JUPAS_2026_Unified_Data.json"
# Programmes removed/restructured out of the listing get their last-known unified
# record preserved here (cumulative, keyed by JS code) so the data is never lost.
ARCHIVE_FILE = "Archives/removed_programmes.json"
CUHK_GRADES_FILE = "Reference(2026)/CUHK/cuhk_grades_2025.json"
SUBJECT_MAPPING_FILE = "data/raw/subject_mapping.json"
SUBJECTS_CANONICAL_FILE = "data/raw/subjects.canonical.json"

# Global mapping loaded once from external JSON
with open(SUBJECT_MAPPING_FILE, encoding="utf-8") as f:
    SUBJECT_MAP = json.load(f)

# ── Canonical subject registry (single source of truth, shared with the TS
# frontend). Derive every subject-vocabulary constant from it so the pipeline
# can never drift from what the calculator/UI consider valid subject names. ──
with open(SUBJECTS_CANONICAL_FILE, encoding="utf-8") as f:
    SUBJECTS_REGISTRY = json.load(f)

# LingU per-programme Category C (Other Language) weights, reverse-engineered from
# LingU's official JUPAS calculator (scripts/extraction/lingu_calc_scrape.py). The
# PDF omits these; {jupas_code: weight}. Absent file ⇒ {} (languages default x1.0).
try:
    with open("Reference(2026)/LingU/lingu_catc_weights.json", encoding="utf-8") as _f:
        LINGU_CATC_WEIGHTS = json.load(_f)
except FileNotFoundError:
    LINGU_CATC_WEIGHTS = {}

_ME = SUBJECTS_REGISTRY["math_extended"]
# Every legal canonical subject name (what may appear in an elective pool).
CANONICAL_SUBJECTS = set(
    SUBJECTS_REGISTRY["core"]
    + SUBJECTS_REGISTRY["category_a"]
    + SUBJECTS_REGISTRY["category_c"]
    + SUBJECTS_REGISTRY["category_b"]
    + [_ME["combined"], _ME["module_1"], _ME["module_2"]]
)
SUBJECT_TOKENS = set(SUBJECTS_REGISTRY["tokens"])  # {"Any", "*"}
# alias (any spelling/abbreviation) -> canonical name
SUBJECT_ALIASES = dict(SUBJECTS_REGISTRY["aliases"])
# one name -> several (M1/M2, bare "Combined Science")
SUBJECT_EXPANSIONS = dict(SUBJECTS_REGISTRY["expansions"])

# Fail fast if the registry is internally inconsistent — every alias target and
# every expansion target must itself be a canonical subject.
for _a, _c in SUBJECT_ALIASES.items():
    assert _c in CANONICAL_SUBJECTS, f"registry alias {_a!r} -> {_c!r} is not canonical"
for _src, _tgts in SUBJECT_EXPANSIONS.items():
    for _t in _tgts:
        assert _t in CANONICAL_SUBJECTS, f"registry expansion {_src!r} -> {_t!r} is not canonical"

def normalize_subject(name):
    """
    Standardizes all DSE subject names across 10 institutions using an external canonical map.
    Converts Chinese terms, school-specific abbreviations, and variations.
    """
    if not name: return name
    # Clean string: remove bullets, trailing punctuation, and extra whitespace
    # We strip trailing periods and spaces, but NOT parentheses here to avoid breaking core names
    name = str(name).strip().replace("•", "").strip(" .")
    
    # Authoritative Mapping (case-insensitive lookup using external JSON)
    # We strip trailing parenthesis for the lookup key only
    name_clean = name.upper().strip(")")
    if name_clean in SUBJECT_MAP:
        return SUBJECT_MAP[name_clean]
    
    # Handle common abbreviations and prefix 'A' in CUHK
    if name_clean.startswith("A") and name_clean[1:] in SUBJECT_MAP:
        return SUBJECT_MAP[name_clean[1:]]

    # Special case: Category A wildcard string from API
    if "CATEGORY A" in name_clean:
        return "*"

    # Handle mangled internal parentheses
    if "(" in name:
        name_upper = name.upper()
        # "Module 1 or 2" means EITHER module gets the weight — keep the combined
        # form (must be checked BEFORE "Module 1", which is a substring of it).
        if "MODULE 1 OR 2" in name_upper or "MODULE 1 OR MODULE 2" in name_upper or "M1 OR 2" in name_upper or "M1 OR M2" in name_upper:
            return "Mathematics Extended Part (Module 1 or 2)"
        if "MODULE 1" in name_upper or "M1" in name_upper or "CALCULUS AND STATISTICS" in name_upper:
            return "Mathematics Extended Part (Module 1)"
        if "MODULE 2" in name_upper or "M2" in name_upper or "ALGEBRA AND CALCULUS" in name_upper:
            return "Mathematics Extended Part (Module 2)"
        if "COMPULSORY" in name_upper: return "Mathematics (Compulsory Part)"
        
    return name
def parse_hku_min_reqs(html):
    """Extract ENG/CHI/MATH/CSD/E1/E2 levels and specific constraints from HKU API HTML."""
    if not html: return {}
    soup = BeautifulSoup(html, 'html.parser')
    
    # 1. Basic Table
    table = soup.find('table', class_='section-Minimum-Level-Requirement')
    reqs = {}
    if table:
        rows = table.find_all('tr')
        if len(rows) >= 3:
            cells = rows[2].find_all('td')
            labels = ["eng", "chi", "math", "csd", "elect1", "elect2"]
            for i, label in enumerate(labels):
                if i < len(cells):
                    val = cells[i].get_text(strip=True).replace("Level ", "")
                    reqs[label] = val
    
    # 2. Specific Electives Table
    spec_table = soup.find('table', class_='section-Specific-Elective-Subject-Requirement')
    if spec_table:
        td = spec_table.find('td')
        if td:
            reqs["specific_elective_desc"] = td.get_text(strip=True)
            
    return reqs

def parse_hku_extra_info(html):
    """Extract formula, other factors, and repeater policy from HKU HTML."""
    if not html: return {}
    soup = BeautifulSoup(html, 'html.parser')
    results = {}
    for row in soup.find_all('tr'):
        th = row.find('th')
        td = row.find('td')
        if th and td:
            header = th.get_text(strip=True)
            val = clean_raw_string(td.get_text(separator=' ', strip=True))
            if "Scoring Formula" in header:
                results["formula_desc"] = val
            elif "Other Factors" in header:
                results["other_factors"] = val
            elif "Repeaters" in header:
                results["repeater_policy"] = val
    return results

def parse_hku_weights(weight_text):
    """Parse HKU weight piped strings: 'X 1.5: Subj1 / Subj2 | X 2: Subj3'."""
    if not weight_text or weight_text == "–": return {}
    weights = {}
    parts = weight_text.split('|')
    for part in parts:
        m = re.match(r'X\s*([\d.]+):\s*(.+)', part.strip())
        if m:
            weight = float(m.group(1))
            subjects = m.group(2).split('/')
            for s in subjects:
                weights[normalize_subject(s.strip())] = weight
    return weights

def parse_hku_formula_weights(formula_text):
    """Extract explicit HKU formula multipliers such as '1.5 x Chin' or '2 x M1 / M2'."""
    if not formula_text:
        return {}

    weights = {}
    text = str(formula_text)
    alias_map = {
        "chin": ["Chinese Language"],
        "chinese": ["Chinese Language"],
        "eng": ["English Language"],
        "english": ["English Language"],
        "math": ["Mathematics (Compulsory Part)"],
        "maths": ["Mathematics (Compulsory Part)"],
    }

    for match in re.finditer(r'([\d.]+)\s*x\s*(Chin(?:ese)?|Eng(?:lish)?|Maths?)\b', text, re.IGNORECASE):
        weight = float(match.group(1))
        for subject in alias_map[match.group(2).lower()]:
            weights[subject] = weight

    for match in re.finditer(r'(M1\s*/\s*M2)\s*x\s*([\d.]+)', text, re.IGNORECASE):
        weight = float(match.group(2))
        weights["Mathematics Extended Part (Module 1)"] = weight
        weights["Mathematics Extended Part (Module 2)"] = weight

    for match in re.finditer(r'([\d.]+)\s*x\s*(M1\s*/\s*M2)', text, re.IGNORECASE):
        weight = float(match.group(1))
        weights["Mathematics Extended Part (Module 1)"] = weight
        weights["Mathematics Extended Part (Module 2)"] = weight

    return weights

def parse_cuhk_weights(weight_text):
    """
    Parse CUHK weight strings.
    Extracts both flat weights (AENGL:2) and conditional pools (Best(1,[AECON,AINCT]):1.5).
    """
    if not weight_text or weight_text in ["--", ""]: return {}, []
    
    flat_weights = {}
    best_of_weights = []
    
    # regex for Best(N, [Pool]):Multiplier
    for m in re.finditer(r'Best\((\d+)\s*,\s*\[(.*?)\]\)\s*:\s*([\d\.]+)', weight_text):
        count = int(m.group(1))
        subjs = re.findall(r'A([A-Z0-9]+)', m.group(2))
        norm_subjs = [normalize_subject(s) for s in subjs]
        best_of_weights.append({
            "count": count,
            "subjects": norm_subjs,
            "weight": float(m.group(3))
        })
        
    # strip the parsed Best() parts to handle remaining flat weights
    remainder = re.sub(r'Best\(\d+\s*,\s*\[.*?\]\)\s*:\s*[\d\.]+', '', weight_text)
    
    # regex for Code:Multiplier
    for m in re.finditer(r'A([A-Z0-9]+)\s*:\s*([\d\.]+)', remainder):
        subj = normalize_subject(m.group(1))
        flat_weights[subj] = float(m.group(2))

    return flat_weights, best_of_weights

# Subjects we can map unambiguously from CUHK's PDF-requirements prose. Kept to
# the cores on purpose: any other phrasing is skipped rather than guessed.
_CUHK_PDF_SUBJECTS = {
    "chinese": "Chinese Language",
    "english": "English Language",
    "mathematics": "Mathematics (Compulsory Part)",
}

def parse_cuhk_pdf_weights(weight_text):
    """Fallback parser for CUHK's 2026 PDF-requirements prose weight, e.g.
    '• Chinese (x 1.5) | • English (x 1.5)'. Returns {subject: multiplier} for
    the simple '• <Subject> (x N)' parts only. Deliberately skips best-of phrases
    ('the best one/two subjects of …'), inclusion constraints ('must be included')
    and formula text ('Best 5 subjects'): those are NOT subject multipliers and
    must not be misread as weights. Used only when the coded API weight is empty."""
    if not weight_text or weight_text.strip() in ("--", ""):
        return {}
    weights = {}
    for part in weight_text.split("|"):
        p = part.strip().lstrip("•").strip()
        low = p.lower()
        if any(tok in low for tok in ("best", "must", "include", " of ", "subjects", "remark")):
            continue
        m = re.match(r"^(.+?)\s*\(\s*x\s*([\d.]+)\s*\)\s*$", p)
        if not m:
            continue
        subj = _CUHK_PDF_SUBJECTS.get(m.group(1).strip().lower())
        if subj:
            weights[subj] = float(m.group(2))
    return weights

def parse_cityu_weights(sw_json):
    """Parse CityU's `subject_weights` JSON array honouring positional slots.

    Most CityU programmes weight every subject the same regardless of slot
    (`position: ["all"]`) and collapse to a plain {subject: weight} map. A few
    (JS1050/1051/1052/1053) distinguish the *best/required* elective from the
    rest via `elect_position1` / `elect_position2`: e.g. the best of
    Biology/Chemistry/Physics counts ×2.5 (1st elective), a further elective only
    ×1.5 (2nd elective). The old flattening let the later (lower) `elect_position2`
    entry overwrite the higher `elect_position1` one, silently under-weighting the
    best science elective.

    Returns (flat_weights, best_of_pools):
      - `flat_weights`: base multiplier for each subject. For a subject that has
        both a position1 and a position2/all weight, the lower (non-position1)
        weight is the base — the higher one is granted to only one subject via a pool.
      - `best_of_pools`: one `{count: 1, subjects: [...], weight: w}` per distinct
        position1 weight, so exactly one qualifying elective is up-weighted to it.
    """
    try:
        arr = json.loads(sw_json) if isinstance(sw_json, str) else sw_json
    except Exception:
        return {}, []
    if not isinstance(arr, list):
        return {}, []

    flat = {}
    pos1 = {}  # subject -> weight when occupying the privileged 1st-elective slot
    for item in arr:
        try:
            subj = normalize_subject(item['subject'])
            w = float(item['weight'])
        except (KeyError, TypeError, ValueError):
            continue
        positions = item.get('position') or ['all']
        if 'elect_position1' in positions:
            pos1[subj] = max(pos1.get(subj, 0.0), w)
        else:  # 'all' or 'elect_position2' → base/general weight
            flat[subj] = max(flat.get(subj, 0.0), w)

    best_of = []
    if pos1:
        by_weight = {}
        for subj, w in pos1.items():
            by_weight.setdefault(w, []).append(subj)
            flat.setdefault(subj, 1.0)  # ensure a base weight exists for the rest of the pool
        for w, subjs in sorted(by_weight.items(), reverse=True):
            best_of.append({"count": 1, "subjects": sorted(subjs), "weight": w})
    return flat, best_of

def parse_hkust_weights(other_subjects_text):
    """
    Attempt to extract sub-weightings from HKUST's formula text.
    Example: 'Physics (x2), ICT (x1.5), Biology / Chemistry (x1)'
    """
    if not other_subjects_text: return [], {}
    
    best_of = []
    flat = {}
    
    # Extract blocks like 'Weighting: Physics (x2), ICT (x1.5)'
    # We look for (xN.N) patterns
    matches = re.finditer(r'([A-Z0-9\s/]+)\s*\(x\s*([\d.]+)\)', other_subjects_text)
    for m in matches:
        subjs_raw = m.group(1).strip()
        weight = float(m.group(2))
        
        # Split subjects by / or , and strip special notation chars (*, #, ~, ^)
        subjs = [normalize_subject(s.strip().strip("*#~^ \u25c6")) for s in re.split(r'/|,', subjs_raw) if s.strip()]
        
        # If it's a single subject, add to flat weights if multiplier > 1
        if len(subjs) == 1 and weight > 1.0:
            flat[subjs[0]] = weight
        elif len(subjs) > 1:
            best_of.append({
                "count": 1, # Usually "Best from..."
                "subjects": subjs,
                "weight": weight
            })
            
    return best_of, flat

def parse_polyu_weights_string(w_str):
    """Parse PolyU compact string format: 'Subj (W=X, CatY); ...'"""
    if not w_str or w_str in ["", "--", "-"]: return {}
    weights = {}
    parts = w_str.split(';')
    for p in parts:
        # Matches "Subject Name (W=7, CatA)" or similar
        m = re.search(r'^(.*?)\s*\(W=([\d.]+)', p.strip())
        if m:
            subj = normalize_subject(m.group(1).strip())
            weight = float(m.group(2))
            weights[subj] = weight
    return weights

def get_conversion_table(institution, is_medicine=False):
    """
    Returns the grade-to-point conversion table for the institution.
    Standard (Group A): 5**=8.5, 5*=7, 5=5.5, 4=4, 3=3, 2=2, 1=1
    Standard (Group B): 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1
    """
    # Group B institutions or special cases
    if institution in ["LingnanU", "EdUHK", "HKBU", "HKMU", "SSSDP"] or is_medicine:
        table = {
            "5**": 7.0, "5*": 6.0, "5": 5.0, "4": 4.0, "3": 3.0, "2": 2.0, "1": 1.0,
            "attained": 0.0, "A": 0.0
        }
        # Add Category C for these schools if known (standard is A=7, B=6, C=5, D=4, E=3)
        cat_c = {"A": 7.0, "B": 6.0, "C": 5.0, "D": 4.0, "E": 3.0}
        if is_medicine:
            # CUHK MBChB (JS4501/4502) publish their OWN Other-Language scale, which
            # tops out at 6 (≈ 5*), not 7 — see the programme's score-conversion table:
            # C2/N1/Grade6/A++ = 6, then 5, 4, 3.
            cat_c = {"A": 6.0, "B": 5.0, "C": 4.0, "D": 3.0, "E": 3.0}
    else:
        # Group A: HKU, CUHK, HKUST, PolyU, CityUHK
        table = {
            "5**": 8.5, "5*": 7.0, "5": 5.5, "4": 4.0, "3": 3.0, "2": 2.0, "1": 1.0,
            "attained": 0.0, "A": 0.0
        }
        cat_c = {"A": 5.0, "B": 4.0, "C": 3.0, "D": 2.0, "E": 1.0}
        
    return {"category_a": table, "category_c": cat_c}

def _parse_additive_count(f, institution):
    """Base subject count for institutions whose '+'-separated formula text is
    additive (HKU "Eng + Best 5" = 6, "Best of Bio/Chem + Best 5" = 6; CityU
    "Best 4 subjects" = 4) — the count the original logic missed because it set
    best_n to the bare "Best N" without adding the named cores. Mirrors the web
    calculator's parseFormulaCount. Returns int, or None when not applicable."""
    if not f or institution not in ("HKU", "CityUHK"):
        return None
    # Drop the ordinal bonus ("+ 0.2 x 7th Best Subject"). `Best\b[^+]*Subject`
    # tolerates OCR noise between the words (e.g. "0.5 x 6th Best a Subject")
    # while staying within the term, so a real trailing "Best Remaining Subject"
    # (no "x Nth" prefix) is preserved and still counts.
    s = re.sub(r'\+?\s*\d*\.?\d+\s*x\s*\d+(?:st|nd|rd|th)\s+Best\b[^+]*Subject', ' ', f, flags=re.IGNORECASE)
    if institution == "CityUHK":
        m = re.search(r'(\d+)\s*core\s*\+\s*(\d+)\s*elective', s, re.IGNORECASE)
        if m:
            return int(m.group(1)) + int(m.group(2))
        m = re.search(r'Best\s+(\d+)\s+subjects?', s, re.IGNORECASE)
        return int(m.group(1)) if m else None
    # HKU: each "+"-term is a "Best N" pool (→ N) or a single subject/pool (→ 1).
    total, matched = 0, False
    for raw in s.split('+'):
        t = raw.strip()
        if not t:
            continue
        mb = re.search(r'Best\s+(\d+)\b', t, re.IGNORECASE)
        if mb:
            total += int(mb.group(1)); matched = True; continue
        # Single-subject term: "Best of …" pool, any "Best … Subject" (incl.
        # "Best Subject"/"Best Remaining Subject"/"Best Sci Subject"), or a named
        # subject. No trailing \b so full words "English"/"Mathematics"/"Chinese"
        # match too, not just "Eng"/"Math"/"Chin".
        if (re.search(r'Best of ', t, re.IGNORECASE) or re.search(r'\bBest\b.*\bSubject\b', t, re.IGNORECASE)
                or re.search(r'\b(Eng|Math|Chin|M1|M2)', t, re.IGNORECASE)):
            total += 1; matched = True; continue
    return total if (matched and 1 <= total <= 8) else None


def extract_logic_from_formula(formula_text, institution=None):
    """
    Parses complex formula strings (like CUHK or HKU variants)
    to extract compulsory subjects, intended 'Best N' count, and dynamic pools.
    Returns: { "compulsory": list, "best_n": int, "bonus": list, "best_of": list }
    """
    if not formula_text: return {"compulsory": [], "best_n": 5, "bonus": [], "best_of": []}
    f = str(formula_text).strip()
    
    compulsory = []
    best_n = 5
    bonus = []
    best_of = []
    
    # 1. Detect CUHK style: AENGL+ACHIN+Best(3)
    # Extract subjects starting with 'A' (e.g. AENGL, ACHIN)
    parts = re.split(r'\+|\s', f)
    for p in parts:
        if p.startswith('A') and "(" not in p: # Avoid catching Best(N) here
            clean_p = re.sub(r'[^A-Z0-9]', '', p[1:])
            if clean_p and clean_p.upper() not in ["BEST"]:
                compulsory.append(normalize_subject(clean_p))
            
    # Extract Best(N)
    m_best = re.search(r'Best\((\d+)\)', f, re.IGNORECASE)
    if m_best:
        best_n = int(m_best.group(1)) + len(compulsory)
        
    # 1.5 Detect CUHK Compulsory Pools in Formula: Best(1, [ABIOL, ACHEM])
    # Note: These are different from weighting pools because they appear in the formula part
    compulsory_pools = []
    # If the Best(N, [Pool]) pattern appears without a trailing multiplier (:X.X), 
    # OR if it's in the formula_text (which usually doesn't have multipliers), it's likely a requirement.
    for m in re.finditer(r'Best\((\d+)\s*,\s*\[(.*?)\]\)', f):
        # Check if it has a multiplier immediately after
        if f[m.end():m.end()+1] != ':':
            count = int(m.group(1))
            subjs = re.findall(r'A([A-Z0-9]+)', m.group(2))
            norm_subjs = [normalize_subject(s) for s in subjs]
            compulsory_pools.append({
                "count": count,
                "subjects": norm_subjs,
                "description": f"Best {count} from {', '.join(norm_subjs)} must be included"
            })
            # Also add to best_n if not already accounted for
            best_n += count

    # 2. Detect CUHK Dynamic Weighting Pools: Best(1, [AECON, AINCT]):1.5
    for m in re.finditer(r'Best\((\d+)\s*,\s*\[(.*?)\]\)\s*:\s*([\d\.]+)', f):
        count = int(m.group(1))
        subjs = re.findall(r'A([A-Z0-9]+)', m.group(2))
        norm_subjs = [normalize_subject(s) for s in subjs]
        best_of.append({
            "count": count,
            "subjects": norm_subjs,
            "weight": float(m.group(3))
        })
    
    # 3. Detect HKU style: Best 5 Subjects + 0.5 x 6th / 0.2 x 6th / 0.2 x 7th
    if "Best 5" in f or "Best(5)" in f: best_n = 5
    if "Best 6" in f or "Best(6)" in f: best_n = 6
    if "Best 7" in f or "Best(7)" in f: best_n = 7
    
    # regex for N.N x 6th/7th
    for m_bonus in re.finditer(r'([\d.]+)\s*x\s*(\d)(?:th|rd)?\s*Best', f, re.IGNORECASE):
        multiplier = float(m_bonus.group(1))
        target_idx = int(m_bonus.group(2))
        bonus.append({
            "type": f"bonus_{target_idx}th", 
            "multiplier": multiplier,
            "description": f"{multiplier} x {target_idx}th Best subject included as bonus"
        })

    # 3.5 Detect HKU Compulsory Cores in Formula.
    # NOTE: skip this text-regex heuristic for HKUST. HKUST's 2025 formula text is
    # frequently truncated (merged-cell PDF), so the regex both MISSES real cores
    # (Eng/Math absent from the fragment) and FALSELY grabs "M1"/"M2" when they
    # appear only as a "Best from …/M1/M2" pool member. HKUST compulsory cores are
    # instead derived authoritatively from the JS-extract `formula_steps`
    # (type=='required') in the HKUST block.
    if institution != "HKUST":
        # Compulsory-core detection reads a CLEANED copy of the formula text.
        # Three phrasings mention a subject WITHOUT requiring it, and each has
        # produced a false compulsory constraint (user-reported, JS1211):
        #   - CityU's caveat parenthetical "(If a student takes both Mathematics
        #     and M1/M2, only one subject will be included)" is a counting rule
        #     (handled by maths_m1m2_as_one), not a formula term;
        #   - "Best N from A / B / M1 / M2" pool memberships (HKU JS6688) are a
        #     selection — no single member is compulsory;
        #   - "Math / M1 / M2" slash groups (HKU JS6858) are ONE slot filled by
        #     the best of the three, so neither Math nor M1/M2 is individually
        #     compulsory (the best_of pool carries the x2 weighting).
        # Additive "2 x Math + 2 x M1 / M2" formulas (JS6224/6729/6884) survive
        # the cleaning: there "M1 / M2" is its own term and IS compulsory.
        f_core = re.sub(r'\(\s*If[^)]*\)', '', f, flags=re.IGNORECASE)
        f_core = re.sub(r'Best\s+\d+\s+(?:Subjects?\s+)?from[^+]+', '', f_core, flags=re.IGNORECASE)
        f_core = re.sub(r'\bMaths?\s*/\s*M1\s*/\s*M2\b', '', f_core, flags=re.IGNORECASE)
        if re.search(r'\bEng(?:lish)?\b', f_core, re.IGNORECASE):
            compulsory.append("English Language")
        if re.search(r'\bMaths?\b', f_core, re.IGNORECASE):
            compulsory.append("Mathematics (Compulsory Part)")
        if re.search(r'\bM1\b|\bM2\b', f_core, re.IGNORECASE):
            compulsory.append("Mathematics Extended Part (Module 1 or 2)")
        if re.search(r'\bChin(?:ese)?\b', f_core, re.IGNORECASE):
            compulsory.append("Chinese Language")

    # 4. Detect PolyU style: English & Chinese + Best 3
    if "Chinese & English Languages + Any Best 3" in f:
        compulsory.extend(["Chinese Language", "English Language"])
        best_n = 5

    # 5. Standard 4C+2X / 3C+2X
    if "4C+2X" in f.upper() or "4 CORE" in f.upper():
        compulsory.extend(["Chinese Language", "English Language", "Mathematics (Compulsory Part)", "Citizenship and Social Development"])
        best_n = 6
    elif "3C+2X" in f.upper():
        compulsory.extend(["Chinese Language", "English Language", "Mathematics (Compulsory Part)"])
        best_n = 5

    # Deduplicate compulsory (sorted for deterministic, diff-stable output —
    # plain list(set(...)) reorders between runs under hash randomization).
    compulsory = sorted(set(compulsory))

    # Override best_n for institutions whose additive '+'-text the steps above
    # under/over-count (HKU additive cores, CityU "Best 4"). The formula text is
    # per-year, so this also keeps 2025 vs 2026 counts distinct (e.g. HKU JS6602:
    # Best 4 in 2025 → 6, Best 3 in 2026 → 5).
    additive = _parse_additive_count(f, institution)
    if additive is not None:
        best_n = additive

    return {"compulsory": compulsory, "best_n": best_n, "bonus": bonus, "best_of": best_of, "compulsory_pools": compulsory_pools}

# ── Year-over-year change detection ──────────────────────────────────────────
# The 2025 and 2026 scoring fields are extracted from DIFFERENT raw strings per
# institution, so a naive diff is dominated by noise (mostly Category-C language
# subjects renamed between feeds, e.g. "French #" vs "French: Advanced Diploma …").
# We diff only the NORMALIZED structured fields and only over subjects we can
# match one-to-one across years.

# Canonical DSE subjects we trust to compare across years. Category C (languages)
# and tokens are EXCLUDED — their names differ wildly between the 2025/2026 feeds.
TRUSTED_DIFF_SUBJECTS = set(
    SUBJECTS_REGISTRY["core"]
    + SUBJECTS_REGISTRY["category_a"]
    + [_ME["combined"], _ME["module_1"], _ME["module_2"]]
)

# Institutions whose per-year FORMULA TEXT is the authoritative source of
# compulsory cores, so a 2025-vs-2026 text diff reflects a real rule change.
# HKUST (formula_steps) and CityU (calc_mode) derive cores from structured
# fields, not text — a text diff there would be a false positive.
_COMPULSORY_TEXT_INSTITUTIONS = {"CUHK", "HKU", "EdUHK", "LingnanU", "PolyU"}

def _has_2025_history(obj):
    """True when the programme has any 2025 admission benchmark — i.e. it existed
    in 2025 and is year-comparable. New-for-2026 / auto-included programmes have
    all-null scores and are not 'changes'."""
    s = obj.get("scores_2025") or {}
    return any(s.get(k) is not None for k in ("median", "lq", "uq", "mean", "expected_score"))

def compute_year_changes(obj):
    """Noise-filtered structured diff of 2025 vs 2026 scoring. Returns
    {weighting_changed, formula_changed, items:[…]} or None when the programme
    isn't year-comparable or nothing meaningful changed."""
    if not _has_2025_history(obj):
        return None

    w25 = obj.get("subject_weights_2025") or {}
    w26 = obj.get("subject_weights_2026") or {}
    items = []

    # 1) Weighting: effective weight (absent ⇒ ×1) of a trusted DSE subject differs.
    #    Catches both value changes (×5→×7) and added/removed weighting (×1→×1.5).
    for subj in sorted(TRUSTED_DIFF_SUBJECTS):
        v25 = float(w25.get(subj, 1.0))
        v26 = float(w26.get(subj, 1.0))
        if v25 != v26:
            items.append({"type": "weighting", "subject": subj, "from": v25, "to": v26})

    # 1b) Best-of pool structural change (canonical subject-set, count, weight).
    def _pool_key(pools):
        return sorted(
            (tuple(sorted(p.get("subjects", []))), p.get("count"), p.get("weight"))
            for p in (pools or [])
        )
    if _pool_key(obj.get("best_of_weights_2025")) != _pool_key(obj.get("best_of_weights_2026")):
        items.append({"type": "pool"})

    weighting_changed = any(it["type"] in ("weighting", "pool") for it in items)

    # 2) Formula count change (Best N → Best M).
    fid25, fid26 = obj.get("formula_2025_id"), obj.get("formula_2026_id")
    real_ids = {"best4", "best5", "best6", "best7"}
    if fid25 in real_ids and fid26 in real_ids and fid25 != fid26:
        items.append({"type": "formula_count", "from_id": fid25, "to_id": fid26})

    # 3) Compulsory-inclusion change — text-authoritative institutions only.
    if obj.get("institution") in _COMPULSORY_TEXT_INSTITUTIONS:
        f25 = str(obj.get("formula_2025") or "").strip()
        f26 = str(obj.get("formula_2026") or "").strip()
        if f25 not in ("", "-", "–") and f26 not in ("", "-", "–"):
            c25 = set(extract_logic_from_formula(obj.get("formula_2025"), obj.get("institution"))["compulsory"])
            c26 = set(extract_logic_from_formula(obj.get("formula_2026"), obj.get("institution"))["compulsory"])
            for subj in sorted(c26 - c25):
                items.append({"type": "compulsory_added", "subject": subj})
            for subj in sorted(c25 - c26):
                items.append({"type": "compulsory_removed", "subject": subj})

    formula_changed = any(
        it["type"] in ("formula_count", "compulsory_added", "compulsory_removed") for it in items
    )

    if not items:
        return None
    return {"weighting_changed": weighting_changed, "formula_changed": formula_changed, "items": items}

def map_formula_id(formula_text):
    """Standardize formula descriptions into machine-readable IDs."""
    if not formula_text: return "unknown"
    logic = extract_logic_from_formula(formula_text)
    if logic["best_n"] == 5: return "best5"
    if logic["best_n"] == 6: return "best6"
    return "custom"

def clean_raw_string(text):
    """Universal utility to strip bullet points, HTML tags, and fix whitespace in remarks."""
    if not text: return text
    text = str(text)
    text = text.replace("<br />", ", ")
    text = text.replace("<br>", ", ")
    text = text.replace("\n", ", ")
    text = text.replace("•", "")
    
    # Strip stray "a " prefixes (often seen in HKU formula scrapes)
    text = re.sub(r'^a\s+', '', text)
    text = text.replace(" Best", " Best") # keep space normalization
    text = re.sub(r'\s+a\s+Subject', ' Subject', text)
    
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r',\s*,', ',', text)
    text = text.replace(" ,", ",")
    return text.strip(", ")

def clean_formula_display(text, institution=None):
    """Tidy the human-readable formula shown in the UI (cosmetic only — does NOT
    affect scoring/counts). Translates CUHK code notation to words so 2025 and
    2026 read the same, and strips footnote markers (#, ^, *, ◆, ~, ▲), the
    'with Weighting N' pointer, the 'Weighting: …' annotation tail, and stray
    OCR tokens."""
    if not text:
        return text
    f = str(text).replace("\n", " ").replace("\r", " ")

    # CUHK code notation → readable words (e.g. "Best(5)" → "Best 5 subjects",
    # "Best(1,[ABIOL,ACHEM])" → "Best 1 of Biology / Chemistry", "AENGL" → name).
    if institution == "CUHK":
        def _pool(m):
            names = [normalize_subject(s) for s in re.findall(r'A?([A-Z][A-Z0-9]+)', m.group(2))]
            return f"Best {m.group(1)} of " + " / ".join(n for n in names if n)
        f = re.sub(r'Best\((\d+)\s*,\s*\[(.*?)\]\)', _pool, f)
        f = re.sub(r'Best\((\d+)\)', lambda m: f"Best {m.group(1)} subjects", f)
        f = re.sub(r'\bA([A-Z]{3,})\b', lambda m: normalize_subject(m.group(1)) or m.group(0), f)
        f = f.replace("+", " + ")

    # Drop the "Weighting: …" annotation tail (HKUST) and the "with Weighting N"
    # footnote pointer (HKU) — the actual weights live in subject_weights_*.
    f = re.sub(r'\s*with\s+Weighting\s*\d*', '', f, flags=re.IGNORECASE)
    f = re.sub(r'[\s,*^◆~▲]*\bWeighting\b\s*:?.*$', '', f, flags=re.IGNORECASE)
    # Drop footnote markers / OCR noise. Asterisks are always footnote markers
    # in these formulas (multiplication is written "x"), so strip them all
    # (incl. word-attached ones like "ICT*").
    f = re.sub(r'[#◆▲~^*]+', '', f)
    f = re.sub(r'\bBest\s+a\s+Subject', 'Best Subject', f, flags=re.IGNORECASE)
    f = re.sub(r'^a\s+', '', f)
    # Normalise whitespace + trailing punctuation.
    f = re.sub(r'\s+', ' ', f)
    f = re.sub(r'[\s,*]+$', '', f)
    return f.strip()

def estimate_hkbu_score_from_grades(grades, weights, conversion_table):
    """
    Estimate HKBU median/LQ totals from published subject-grade breakdowns.
    HKBU publishes weighted mean, but median/LQ are provided as subject grades,
    so we apply the programme's 2025 weights and sum the best five subjects.
    """
    if not grades:
        return None

    core_names = {
        "Chinese Language",
        "English Language",
        "Mathematics (Compulsory Part)",
        "Mathematics Extended Part (Module 1)",
        "Mathematics Extended Part (Module 2)",
        "Citizenship and Social Development",
    }
    weighted_elective_multipliers = sorted(
        [weight for subject, weight in weights.items() if subject not in core_names],
        reverse=True
    )
    subject_scores = []

    for subject, grade in grades.items():
        base_points = conversion_table.get(str(grade).strip(), 0)
        weight = 1.0

        if subject == "CHIN":
            weight = weights.get("Chinese Language", 1.0)
        elif subject == "ENGL":
            weight = weights.get("English Language", 1.0)
        elif subject == "MATH":
            weight = weights.get("Mathematics (Compulsory Part)", 1.0)
        elif subject == "M1/M2":
            weight = max(
                weights.get("Mathematics Extended Part (Module 1)", 1.0),
                weights.get("Mathematics Extended Part (Module 2)", 1.0),
            )
        elif "Elective" in subject and weighted_elective_multipliers:
            weight = weighted_elective_multipliers.pop(0)

        if base_points:
            subject_scores.append(base_points * weight)

    if not subject_scores:
        return None

    subject_scores.sort(reverse=True)
    return round(sum(subject_scores[:5]), 2)

# Split elective text on top-level "or" / "/" / "," but NOT inside
# parentheses, so "Mathematics (Module 1 or 2)" stays whole instead of
# leaking a fake "2)" subject (the lookahead is the same trick used for the
# comma split below).
ELECTIVE_SPLIT = re.compile(r'(?: or | / |,)(?![^(]*\))')


def expand_m1m2(subjs):
    """Expand an "M1 or 2" elective token into the two real subjects so the
    eligibility check can match a student who took just one of them."""
    out = []
    for s in subjs:
        if s == "M1/M2" or "Module 1 or 2" in s:
            out += ["Mathematics Extended Part (Module 1)", "Mathematics Extended Part (Module 2)"]
        else:
            out.append(s)
    seen, res = set(), []
    for s in out:
        if s not in seen:
            seen.add(s); res.append(s)
    return res


COMBINED_SCIENCE_VARIANTS = list(SUBJECT_EXPANSIONS.get("Combined Science", []))

# Multi-word DSE subject names whose internal "," / " and " would otherwise be
# treated as list separators when an elective list is split, shredding the name
# (e.g. "Design and Applied Technology" -> "Design" + "Applied Technology").
# Each is protected before splitting and restored to its CANONICAL form so the
# calculator's exact-match eligibility check can find it. DERIVED from the
# canonical registry (not hand-maintained): every canonical name and every alias
# spelling that contains such a separator is protected automatically, so a newly
# added subject can never be silently shredded.
def _needs_protect(name):
    return (", " in name) or (" and " in name) or ("(" in name)

PROTECTED_ELECTIVES = (
    [(s, s) for s in CANONICAL_SUBJECTS if _needs_protect(s)]
    + [(a, c) for a, c in SUBJECT_ALIASES.items() if _needs_protect(a)]
)
# Longest first so strand-qualified names (e.g. "...Studies (Accounting)") win
# over their bare prefixes ("...Studies").
_PROTECT = [(re.compile(re.escape(name), re.I), canon)
            for name, canon in sorted(PROTECTED_ELECTIVES, key=lambda x: len(x[0]), reverse=True)]


def expand_combined_science(subjs):
    """Expand bare 'Combined Science' (HKU writes it without a strand) into the
    three real Combined Science subjects so a student who took any one matches."""
    out = []
    for s in subjs:
        if str(s).strip().lower() == "combined science":
            out += COMBINED_SCIENCE_VARIANTS
        else:
            out.append(s)
    return out


# Some weighting feeds label a COMPOUND or GENERIC subject that is not a single
# canonical subject — e.g. LingU's "Chinese History / Chinese Literature" (either
# counts) and the bare "Technology and Living" (either strand). Left as-is they
# are non-canonical keys and the weight is SILENTLY dropped by canonicalisation.
# Split each onto its member subjects at the SAME weight (a student takes at most
# one, so a flat weight on each is exact).
COMPOUND_WEIGHT_EXPANSIONS = {
    "chinese history / chinese literature": ["Chinese History", "Chinese Literature"],
    "technology and living": [
        "Technology and Living (Food Science and Technology)",
        "Technology and Living (Fashion, Clothing and Textiles)",
    ],
}


def expand_compound_weight_keys(weights):
    """Expand compound/generic subject keys in a {subject: weight} dict onto their
    member canonical subjects (see COMPOUND_WEIGHT_EXPANSIONS)."""
    if not weights or not isinstance(weights, dict):
        return weights
    out = {}
    for k, v in weights.items():
        members = COMPOUND_WEIGHT_EXPANSIONS.get(str(k).strip().lower())
        if members:
            for m in members:
                out[m] = v
        else:
            out[k] = v
    return out


# Case-insensitive lookup of every registry alias + canonical self-map.
_ALIAS_LC = {k.lower(): v for k, v in SUBJECT_ALIASES.items()}
_ALIAS_LC.update({c.lower(): c for c in CANONICAL_SUBJECTS})


def canon_elective_subject(s):
    """Canonicalise a single, already-isolated elective subject name (used when a
    source supplies a clean list, e.g. CityU's API). Maps registry aliases
    (ICT/DAT, Combined Science / BAFS strand variants, …) to canonical, otherwise
    defers to normalize_subject."""
    if not s:
        return s
    key = str(s).strip().lower()
    if key in _ALIAS_LC:
        return _ALIAS_LC[key]
    return normalize_subject(s)


def parse_elective_subjects(text, split_re):
    """Parse an elective-list string into canonical subject names.

    Robust to subject names that themselves contain ',' or ' and ': those are
    protected (replaced by separator-free placeholders) BEFORE the list is split,
    then restored to canonical form. M1/M2 and bare 'Combined Science' are
    expanded BEFORE normalising (normalise would otherwise collapse them)."""
    if not text:
        return []
    holder = {}
    for i, (pat, canon) in enumerate(_PROTECT):
        if pat.search(text):
            ph = f"@@E{i}@@"
            text = pat.sub(ph, text)
            holder[ph] = canon
    # Strip stray list punctuation (e.g. a trailing "." on the last item) so a
    # placeholder isn't left unrestored, then restore any embedded placeholder.
    parts = [p.strip(" .") for p in split_re.split(text) if p.strip(" .")]
    restored = [holder[p] if p in holder
                else re.sub(r'@@E\d+@@', lambda m: holder.get(m.group(0), ''), p)
                for p in parts]
    canon_vals = set(holder.values())
    # Expand M1/M2 on the raw tokens before normalising (preserves both modules).
    expanded = expand_m1m2(restored)
    normed = [s if s in canon_vals else canon_elective_subject(s) for s in expanded]
    normed = expand_combined_science(normed)
    seen, res = set(), []
    for s in normed:
        if s and s not in seen:
            seen.add(s)
            res.append(s)
    return res


def build_cuhk_elective(note, text, req_str):
    """
    Transforms string-based requirements (e.g. 'One of the following: Bio, Chem')
    into a structured object for calculation.
    """
    m = re.search(r'>=\s*(\d[A-Za-z*]*)', req_str)
    grade = m.group(1) if m else "3"

    if not note or note == "--":
        if text == "*":
            return {"count": 1, "subjects": ["Any"], "grade": grade, "note": ""}
        subjs = parse_elective_subjects(text, ELECTIVE_SPLIT)
        return {"count": 1, "subjects": subjs, "grade": grade, "note": ""}

    note_clean = note.replace(" subjects:", ":")
    # Parse the pool, protecting multi-word subject names so commas/'and' inside
    # a name (e.g. "Business, Accounting and Financial Studies") aren't mistaken
    # for list separators.
    subjs = parse_elective_subjects(text, re.compile(r',(?![^\(]*\))'))

    # Infer required count from text keywords
    count = 1
    if "Two" in note_clean: count = 2
    elif "Three" in note_clean: count = 3

    note_clean = note_clean.replace(":", "").strip()

    # Check for wildcards in subjects (e.g. Category A subjects only)
    is_cat_a_wildcard = any("Category A" in str(s) or s == "*" for s in subjs)
    if is_cat_a_wildcard:
        subjs = ["*"]
        note_clean = "Category A Subjects Only"

    return {
        "count": count,
        "subjects": subjs,
        "grade": grade,
        "note": note_clean
    }

def build_hku_elective_pool(desc, fallback_grade):
    """
    Parses HKU specific requirement strings like:
    'Level 3 or above in one of the following subjects: Biology, or Chemistry'
    """
    if not desc: return None
    
    # Extract grade
    m_grade = re.search(r'Level (\d)', desc)
    grade = m_grade.group(1) if m_grade else fallback_grade
    
    # Extract count (one vs two)
    count = 1
    if "two of the following" in desc.lower():
        count = 2
        
    # Extract subjects
    subjects = ["Any"]
    if ":" in desc:
        subj_part = desc.split(":")[1]
        # Protect multi-word subject names BEFORE splitting so an internal
        # "," / " and " (e.g. "Design and Applied Technology", "Business,
        # Accounting and Financial Studies") is not mistaken for a list
        # separator; M1/M2 and bare "Combined Science" are expanded too.
        subjects = parse_elective_subjects(subj_part, re.compile(r'(?:,| or | and )(?![^(]*\))'))
    elif "Mathematics Extended Part (Module 1 or 2)" in desc:
        subjects = ["Mathematics Extended Part (Module 1)", "Mathematics Extended Part (Module 2)"]
    elif "Chemistry" in desc and "one of" not in desc.lower():
        subjects = ["Chemistry"]
        
    return {
        "count": count,
        "subjects": subjects,
        "grade": str(grade),
        "note": desc
    }

def build_hkbu_elective(grade, constraint, default_cat_a=False):
    # HKBU's first elective MUST be a Category A subject (excluding M1/M2); the
    # second may be any Cat A (incl M1/M2) and — for most programmes — Cat B/C.
    # `default_cat_a` emits the "CategoryA" token (the calculator resolves it to
    # Cat A membership, which already excludes M1/M2 and Cat C) when there's no
    # more specific scraped constraint.
    if not grade: return None
    subjs = ["CategoryA"] if default_cat_a else ["Any"]
    if constraint:
        # Extract subjects like "Biology or Chemistry"
        # "One elective subject must be Biology or Chemistry"
        m = re.search(r'must be (.*)', constraint)
        if m:
            pool = m.group(1)
            subjs = [normalize_subject(s.strip()) for s in re.split(r' or | / ', pool)]

    return {
        "count": 1,
        "subjects": subjs,
        "grade": str(grade).strip("#"),
        "note": constraint or ("Category A subject (excluding M1/M2)" if default_cat_a else "")
    }

def build_generic_elective(grade, constraint=None):
    if not grade: return None
    # A constraint naming a specific subject list ("in Biology / Chemistry /
    # Physics", "One of: X / Y") is an ENFORCEABLE restriction — parse it into a
    # canonical pool so eligibility actually requires one of those subjects at
    # `grade`, not just any elective. Non-subject constraints ("Any 3 other
    # subjects", a bare level) have no "/" → stay a display-only note on an "Any"
    # pool. (EdUHK e.g. JS8011 "Level 3 in Biology/Chemistry/Physics".)
    pool = None
    if constraint and "/" in str(constraint):
        body = re.sub(r"^\s*(in|one of)\b\s*:?\s*", "", str(constraint).strip(), flags=re.I)
        pool = parse_specified_elective("One of: " + body)
    return {
        "count": 1,
        "subjects": pool or ["Any"],
        "grade": str(grade).strip("#"),
        "note": "" if pool else (constraint or ""),
    }

def parse_specified_elective(spec):
    """HKUST `anotherSpecifiedSubject` → an elect1 subject pool, or None for 'Any'.
    Format: "One of: Biology / Chemistry / Physics / ICT" (sometimes with M1/M2),
    or "No specific subject requirements". Many HKUST programmes restrict their
    FIRST elective to a science pool — without this the slot was left "Any" and a
    non-science elective wrongly satisfied it (e.g. JS5260, and ~15 siblings)."""
    if not spec:
        return None
    s = str(spec).strip()
    if not s or s.lower().startswith("no specific"):
        return None
    m = re.match(r'one of\s*:?\s*(.+)', s, re.I)
    body = m.group(1) if m else s
    out = []
    for tok in re.split(r'\s*/\s*', body):
        tok = tok.strip()
        if not tok:
            continue
        u = tok.upper().replace(".", "")
        if u in ("M1", "MATH M1", "MATHS M1"):
            out.append("Mathematics Extended Part (Module 1)")
        elif u in ("M2", "MATH M2", "MATHS M2"):
            out.append("Mathematics Extended Part (Module 2)")
        elif u == "ICT":
            out.append("Information and Communication Technology")
        elif tok.strip().lower().rstrip("s") == "combined science":
            # Bare "Combined Science" isn't a canonical subject (only the three
            # strand pairs are) → expand so any strand a student took matches.
            out.extend(["Combined Science: Biology + Chemistry",
                        "Combined Science: Biology + Physics",
                        "Combined Science: Physics + Chemistry"])
        else:
            out.append(normalize_subject(tok))
    # De-dupe preserving order; drop empties.
    seen, pool = set(), []
    for x in out:
        if x and x not in seen:
            seen.add(x); pool.append(x)
    return pool or None

# ── Curated per-programme overrides — SINGLE SOURCE OF TRUTH ───────────────────
# Hand-verified rules the per-school scrape can't express. The runtime reads the
# emitted fields GENERICALLY (no JS-code lists hardcoded in the calculator).
#
# *** ANNUAL MAINTENANCE (next year's refresh) — READ THIS ***
# Value corrections (weights/electives) patch THIS cycle's scraped data, so they
# can go stale. Each carries `expect_*` = the (wrong) value it's correcting FROM.
# At every regenerate, apply_curated_overrides() RE-CHECKS those expectations and
# prints "⚠ REVIEW" for any that no longer hold — i.e. the scraper changed, the
# programme moved, or the scrape now produces the right value (override redundant).
# So you don't trust this table blindly: you run unify, read the curated summary,
# and re-verify only the flagged ones. Stable RULE entries (category_c_policy,
# extra_eligibility, CategoryA elect1) don't rot, but still re-confirm the code
# exists. `verified` records when/against-what each was checked.
CURATED_PROGRAMME_RULES = {
    # (JS2340's former set_weights_2025={} rule is retired: the HKBU block now
    # keeps an explicit empty 2025 dict as authoritative, and the §5 HKBU
    # 2026-basis step intentionally scores weight-introduced programmes on the
    # 2026 weights with a re-simulated benchmark — see hkbu_2026_simulated.)
    # — 2025 SCORING-weight evenness patch —
    "JS2940": {  # HKBU Innovation in Health & Social Well-Being — the 2025 PDF cell
        # lists MATH + MAT1 (x1.5) but not MAT2; the Sep-2025 2026 cell adds MAT2
        # (x1.5). M1/M2 are mutually exclusive per student and the benchmark
        # estimator uses max(M1,M2) (already 1.5), so scoring 2025 without MAT2
        # would arbitrarily penalise M2-takers vs M1-takers (the report-7/8 class
        # of complaint) while changing no benchmark. Patch MAT2=1.5 into 2025 —
        # after this w2025 == w2026, so the §5 hkbu step correctly skips it.
        "verified": "2026-07-12 · Sep-2025 GER/PER PDF vs HKBU 2025 Weighting.pdf",
        "set_weights_2025": {
            "English Language": 2.0,
            "Mathematics (Compulsory Part)": 1.5,
            "Mathematics Extended Part (Module 1)": 1.5,
            "Mathematics Extended Part (Module 2)": 1.5,
            "Health Management and Social Care": 1.5,
        },
        "set_weights_2025_raw": "ENG (x 2), MATH (x 1.5), MAT1 (x 1.5), MAT2 (x 1.5), HMSC^ (x 1.5)",
        "expect_weights_2025": {
            "English Language": 2.0,
            "Mathematics (Compulsory Part)": 1.5,
            "Mathematics Extended Part (Module 1)": 1.5,
            "Health Management and Social Care": 1.5,
        },
    },
    # (JS2940 was previously patched HMSC→1.1 from a tester report, but the official
    # HKBU 2025 Weighting.pdf — confirmed by word-coordinate row matching on BOTH
    # pages — clearly assigns HMSC ×1.5 to JS2940 and HMSC ×1.1 to JS2660 (Social
    # Work). The tester mixed up the two "Bachelor of Social…" programmes. So JS2940
    # keeps its scraped ×1.5; no override.)
    # (JS5260's elect1 restriction is now handled SYSTEMATICALLY for all HKUST
    # programmes via parse_specified_elective() — no per-code patch needed.)
    # — Category C (Other Languages) policy (stable rule; was hardcoded in categoryC.ts) —
    # HKBU programmes that do NOT consider Cat C at all (eligibility + scoring):
    "JS2620": {"verified": "2026 · HKBU", "category_c_policy": "none"},
    "JS2110": {"verified": "2026 · HKBU", "category_c_policy": "none"},
    "JS2120": {"verified": "2026 · HKBU", "category_c_policy": "none"},
    "JS2410": {"verified": "2026 · HKBU", "category_c_policy": "none"},
    "JS2420": {"verified": "2026 · HKBU", "category_c_policy": "none"},
    # CUHK electives Category-A-only (Cat C can't satisfy an elective; otherwise still scored):
    "JS4550": {"verified": "2026 · CUHK footnote", "category_c_policy": "elective_cat_a_only"},
    "JS4601": {"verified": "2026 · CUHK footnote", "category_c_policy": "elective_cat_a_only"},
    "JS4648": {"verified": "2026 · CUHK footnote", "category_c_policy": "elective_cat_a_only"},
    "JS4719": {"verified": "2026 · CUHK footnote", "category_c_policy": "elective_cat_a_only"},
    # CityU: 2026 Entrance-Requirements PDF remark — "Unspecified electives may
    # include Category A subjects, M1/M2 (except JS1801) and Category C other
    # language subjects (except for JS1200, JS1201, JS1217, JS1300, JS1801,
    # JS1805, JS1806 and JS1807)". So the 'any' elective slot on these must NOT
    # accept Cat C. (For JS1200/1217/1801 both electives are already specific, so
    # this is defensive; it actually tightens JS1201/1300/1805/1806/1807, which
    # have an 'any' slot.) Verified page-by-page against the official PDF.
    "JS1200": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1201": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1217": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1300": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1801": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1805": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1806": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    "JS1807": {"verified": "2026 · CityU Entrance Req PDF remark", "category_c_policy": "elective_cat_a_only"},
    # — Extra admission gate (stable rule) —
    "JS4502": {  # CUHK MBChB-GPS — total >= 40 in 6 with 5** in any 4
        "verified": "2026 · CUHK MBChB-GPS Note 3",
        "extra_eligibility": {"min_total": 40, "min_top_grade_count": 4, "top_grade": "5**"},
    },
}

def apply_curated_overrides(programmes):
    """Apply CURATED_PROGRAMME_RULES, re-checking each value correction's stated
    expectation so stale patches surface loudly instead of silently rotting at the
    next annual refresh. Prints a per-run summary; returns the list of review notes."""
    by_code = {p.get("jupas_code"): p for p in programmes}
    applied, review = 0, []
    for code, rule in CURATED_PROGRAMME_RULES.items():
        p = by_code.get(code)
        if p is None:
            review.append(f"{code}: NOT in unified set — programme removed/renamed? (rule did nothing)")
            continue
        # Staleness checks BEFORE patching (value corrections only).
        if "expect_weights_2025" in rule:
            cur = p.get("subject_weights_2025") or {}
            exp = rule["expect_weights_2025"]
            if "patch_weights_2025" in rule:  # compare just the patched keys
                bad = {k: cur.get(k) for k, v in exp.items() if cur.get(k) != v}
                if bad:
                    review.append(f"{code}: scraped 2025 weight changed (expected {exp}, found {bad}) — re-verify before trusting the override")
            else:  # set_weights: whole-dict expectation
                if cur != exp:
                    already = cur == rule.get("set_weights_2025")
                    review.append(f"{code}: 2025 weights {'already correct (scrape fixed → override redundant)' if already else f'changed (expected {exp}, found {dict(cur)})'} — re-verify")
        if "expect_elect1" in rule:
            cur_e1 = ((p.get("min_requirements_2026") or {}).get("elect1") or {}).get("subjects")
            if cur_e1 != rule["expect_elect1"]:
                review.append(f"{code}: scraped elect1 changed (expected {rule['expect_elect1']}, found {cur_e1}) — re-verify")
        # Apply patches.
        if "set_weights_2025" in rule:
            p["subject_weights_2025"] = dict(rule["set_weights_2025"])
            if "set_weights_2025_raw" in rule:
                p["subject_weights_2025_raw"] = rule["set_weights_2025_raw"]
            elif not rule["set_weights_2025"]:
                p["subject_weights_2025_raw"] = "-"
        if "patch_weights_2025" in rule:
            w = dict(p.get("subject_weights_2025") or {})
            for k, v in rule["patch_weights_2025"].items():
                if k in w:
                    w[k] = v
            p["subject_weights_2025"] = w
        if "elect1_subjects" in rule:
            e1 = (p.get("min_requirements_2026") or {}).get("elect1")
            if isinstance(e1, dict):
                e1["subjects"] = list(rule["elect1_subjects"])
                if rule.get("elect1_note"):
                    e1["note"] = rule["elect1_note"]
        if "category_c_policy" in rule:
            p["category_c_policy"] = rule["category_c_policy"]
        if "extra_eligibility" in rule:
            p["extra_eligibility"] = dict(rule["extra_eligibility"])
        applied += 1
    print(f"Curated overrides applied: {applied}/{len(CURATED_PROGRAMME_RULES)}; {len(review)} need review")
    for note in review:
        print(f"  ⚠ REVIEW curated rule — {note}")
    return review


# ── Category B (Applied Learning) acceptance, per-institution ──────────────────
# Each institution's policy is researched from OFFICIAL sources and applied in
# apply_apl_policy() — see docs/manuals/APL_POLICY.md for the per-institution rule
# + authoritative source URL. ApL is scored through the Cat-A table at the
# equivalent DSE level (Dist II→L4, Dist I→L3; bare "Attained"→L2 only where
# apl_min_level == "attained"). Per-programme detail (PolyU weights, CUHK/HKBU
# acceptance, EdUHK ×1.5) is loaded from Reference(2026)/<school>/*.json.

# Surface forms (canonical ApL names + their registry aliases) for case-insensitive
# canonicalisation of raw course names from the institutional PDFs.
_CAT_B_SET = set(SUBJECTS_REGISTRY["category_b"])
_APL_SURFACE = {n: n for n in _CAT_B_SET}
_APL_SURFACE.update({a: c for a, c in SUBJECT_ALIASES.items() if c in _CAT_B_SET})


_APL_SURFACE_LC = {k.lower(): v for k, v in _APL_SURFACE.items()}


def _apl_lookup(s):
    s = s.strip()
    if s in _APL_SURFACE:
        return _APL_SURFACE[s]
    if s.lower() in _APL_SURFACE_LC:
        return _APL_SURFACE_LC[s.lower()]
    c = _ALIAS_LC.get(s.lower())
    return c if c in _CAT_B_SET else None


def canon_apl(name):
    """Canonical ApL subject for a raw course name, or None if not a known ApL.
    Tolerates institutional formatting: a "(former name: …)" annotation, and "/"
    separating alternative spellings of the same course (e.g. "Film and Video
    Studies / Film and Video")."""
    if not name:
        return None
    s = str(name).strip()
    hit = _apl_lookup(s)
    if hit:
        return hit
    stripped = re.sub(r"\s*\(former name[:\s\"].*?\)\s*$", "", s, flags=re.I).strip()
    if stripped != s:
        hit = _apl_lookup(stripped)
        if hit:
            return hit
        s = stripped
    if "/" in s:
        for part in s.split("/"):
            hit = _apl_lookup(part)
            if hit:
                return hit
    return None


def _dedupe_canon_apl(names):
    """Canonicalise a list of raw ApL names → de-duplicated canonical list
    (older-cohort / non-vocabulary names drop out)."""
    out = []
    for nm in names or []:
        c = canon_apl(nm)
        if c and c not in out:
            out.append(c)
    return out


# CityU recognises ApL (as one elective) ONLY for these 9 programmes — per CityU's
# official "Admission Score Formula and Admissions Scores for 2026 JUPAS" (Jan 2026).
CITYU_APL_PROGS = {"JS1040", "JS1041", "JS1042", "JS1043", "JS1044",
                   "JS1300", "JS1805", "JS1806", "JS1807"}

# HKUST counts a Category B subject ONLY as the 6th-subject bonus (≤5%), and only
# for these 11 programmes (per HKUST's score formulae).
HKUST_APL_BONUS_PROGS = {"JS5101", "JS5102", "JS5103", "JS5118", "JS5181", "JS5411",
                         "JS5412", "JS5711", "JS5812", "JS5811", "JS5813"}


def _load_apl_ref(path, label):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"  note: {path} absent — {label}")
        return {}


def apply_apl_policy(programmes):
    """Emit apl_policy / apl_max / apl_min_level per programme — researched per
    institution from OFFICIAL sources (see docs/manuals/APL_POLICY.md)."""
    cuhk_apl = _load_apl_ref("Reference(2026)/CUHK/cuhk_apl.json", "CUHK ApL from notes only")
    eduhk_apl_w = _load_apl_ref("Reference(2026)/EdUHK/eduhk_apl_weights.json", "EdUHK ×1.5 not applied")
    # PolyU per-programme ApL acceptance + weight (5/7/10), from each programme's
    # Subject-Weighting PDF. A programme absent here has NO Category B section in its
    # SW PDF → it does not recognise ApL.
    polyu_apl = _load_apl_ref("Reference(2026)/PolyU/polyu_apl_weights.json", "PolyU ApL kept generic")
    # HKBU per-programme Category-B acceptance (any / none / specified), from its GER PDF.
    hkbu_apl = _load_apl_ref("Reference(2026)/HKBU/hkbu_apl.json", "HKBU ApL kept generic")
    # LingnanU per-programme recognised-ApL lists, reverse-engineered from LingU's
    # JUPAS calculator (recognition is per-programme × per-subject; "_meta" holds the
    # derived conversion — Attained ≡ L3 — and the ×1.0 weight / max-1 rule).
    lingu_apl = _load_apl_ref("Reference(2026)/LingU/lingu_apl.json", "LingnanU ApL kept none")

    counts = {"any": 0, "none": 0, "restricted": 0}
    for p in programmes:
        inst = p.get("institution")
        code = p.get("jupas_code")
        policy = max_n = min_lvl = None

        if inst == "HKU":
            policy = "none"  # ApL is "additional supporting information" only

        elif inst == "HKUST":
            # ApL is accepted ONLY as the 6th-subject BONUS (≤5%, Dist I=3 / Dist II=4,
            # Attained not counted), and only for these 11 programmes — never a Best-5 or
            # eligibility elective. The hkust_weighted_best constraint applies the bonus.
            if code in HKUST_APL_BONUS_PROGS:
                policy, max_n, min_lvl = "any", 1, "dist1"
                p["apl_bonus_only"] = True
            else:
                policy = "none"

        elif inst == "LingnanU":
            # Per-programme recognised ApL from LingU's calculator; Attained ≡ L3.
            # A programme recognising ~all of the 55 probeable ApL → "any".
            subs = _dedupe_canon_apl(lingu_apl.get(code) or [])
            if not subs:
                policy, max_n, min_lvl = "none", 1, "dist1"
            else:
                policy, max_n, min_lvl = ("any" if len(subs) >= 54 else subs), 1, "l3"

        elif inst == "CityUHK":
            policy, max_n, min_lvl = ("any", 1, "dist1") if code in CITYU_APL_PROGS else ("none", 1, "dist1")

        elif inst == "CUHK":
            entry = cuhk_apl.get(code)
            if entry is None:
                policy = "none"  # not on CUHK's recognising-programme list
            else:
                raw = entry.get("apl") if isinstance(entry, dict) else entry
                if raw == "ALL":
                    policy = "any"
                else:
                    subs = _dedupe_canon_apl(raw)
                    policy = subs if subs else "none"
                # CUHK recognises ApL only as an EXTRA bonus subject whose value it does
                # not publish → NOT scored, NOT an eligibility elective; apl_policy is
                # kept only to tell the candidate which ApL the programme recognises.
                if policy != "none":
                    p["apl_advisory_only"] = True

        elif inst == "PolyU":
            entry = polyu_apl.get(code)
            wmap = {}
            if entry:
                for nm, wt in (entry.get("apl") or {}).items():
                    c = canon_apl(nm)
                    if c:
                        wmap[c] = max(wmap.get(c, 0), wt)
            if not wmap:
                policy = "none"  # no Category B section in the SW PDF → ApL not recognised
            else:
                policy, max_n, min_lvl = sorted(wmap), 1, "dist1"
                w25 = p.get("subject_weights_2025")
                if isinstance(w25, dict):
                    for s, wt in wmap.items():  # ApL weighted on PolyU's own 5/7/10 scale
                        w25[s] = wt

        elif inst == "HKBU":
            entry = hkbu_apl.get(code)
            raw = entry.get("apl") if isinstance(entry, dict) else entry
            if raw == "none":
                policy = "none"
            elif isinstance(raw, list):
                subs = _dedupe_canon_apl(raw)
                # specified-by-description (e.g. "PE-related") → can't canonicalise; allow any
                policy, max_n, min_lvl = (subs or "any"), 1, "dist1"
            else:  # "any" or no table yet → HKBU's default (2nd elective, Dist I+)
                policy, max_n, min_lvl = "any", 1, "dist1"

        elif inst == "EdUHK":
            policy, max_n, min_lvl = "any", 1, "dist1"
            if "Higher Diploma" in (p.get("name_en") or ""):
                max_n = 2  # HD counts up to 2 ApL; Bachelor's 1

        elif inst == "HKMU":
            policy, max_n, min_lvl = "any", 2, "attained"  # up to 2; bare Attained = L2

        elif inst == "SSSDP":
            m = re.match(r"Offered by ([^:]+):", p.get("name_en") or "")
            off = m.group(1).strip() if m else ""
            if off == "HKMU":
                policy, max_n, min_lvl = "any", 2, "attained"
            elif off == "HKSYU":
                policy, max_n, min_lvl = "any", 1, "dist1"   # Shue Yan rejects bare "Attained"
            else:                                            # SFU/THEi/HSUHK/TWC/UOWCHK/HKCHC
                policy, max_n, min_lvl = "any", 1, "attained"

        else:
            continue  # institution not modelled for ApL

        if policy == "none":
            p["apl_policy"] = "none"
            counts["none"] += 1
            continue
        p["apl_policy"] = policy
        if max_n and max_n != 1:
            p["apl_max"] = max_n
        if min_lvl and min_lvl != "dist1":
            p["apl_min_level"] = min_lvl
        counts["restricted" if isinstance(policy, list) else "any"] += 1

    print(f"ApL (Cat B) policy: any={counts['any']} restricted={counts['restricted']} none={counts['none']}")

    # EdUHK ×1.5 ApL weighting: replace the scraped "Specified ApL subject(s)"
    # placeholder weight key (which silently never matches) with the actual
    # canonical ApL subjects at ×1.5, in both the 2025 and 2026 weight maps.
    _ew_n = 0
    by_code = {p.get("jupas_code"): p for p in programmes}
    for code, entry in eduhk_apl_w.items():
        p = by_code.get(code)
        if not p:
            continue
        subs = []
        for nm in entry.get("apl_weighted_1_5", []):
            c = canon_apl(nm)
            if c and c not in subs:
                subs.append(c)
        if not subs:
            continue
        for yr in ("2025", "2026"):
            w = p.get(f"subject_weights_{yr}")
            if not isinstance(w, dict):
                continue
            for k in [k for k in w if "Specified ApL" in k]:
                del w[k]
            for s in subs:
                w[s] = 1.5
        _ew_n += 1
    if _ew_n:
        print(f"EdUHK ApL ×1.5 weighting applied to {_ew_n} programme(s)")


def expand_m1m2_weights(programmes):
    """A "Mathematics Extended Part (Module 1 or 2)" weight means EITHER module
    earns it (HKU/EdUHK science programmes weight the combined form). Expand it to
    BOTH Module 1 and Module 2 so the calculator scores whichever module the
    student actually took — a more specific Module 1/Module 2 key already present
    takes precedence (setdefault). The combined key is then dropped."""
    M12 = "Mathematics Extended Part (Module 1 or 2)"
    M1 = "Mathematics Extended Part (Module 1)"
    M2 = "Mathematics Extended Part (Module 2)"
    n = 0
    for p in programmes:
        for yr in ("2025", "2026"):
            w = p.get(f"subject_weights_{yr}")
            if not isinstance(w, dict) or M12 not in w:
                continue
            combined = w.pop(M12)
            w.setdefault(M1, combined)
            w.setdefault(M2, combined)
            n += 1
    if n:
        print(f"Expanded combined M1/M2 weighting on {n} programme-year(s)")


def apply_baselines(obj):
    """
    Ensures every programme meets the Universal Minimum University Requirements.
    HKU, CUHK, HKUST, PolyU, CityUHK, HKBU: 332A33
    LingnanU, EdUHK, HKMU, SSSDP: 332A22
    """
    inst = obj["institution"]
    # Group A: 332A33
    if inst in ["HKU", "CUHK", "HKUST", "PolyU", "CityUHK", "HKBU"]:
        b = {"chi": "3", "eng": "3", "math": "2", "csd": "A", "e_grade": "3"}
    # Group B: 332A22
    else:
        b = {"chi": "3", "eng": "3", "math": "2", "csd": "A", "e_grade": "2"}

    reqs = obj["min_requirements_2026"]
    
    # Cores
    reqs["chi"] = str(reqs.get("chi") or b["chi"]).strip("# ")
    reqs["eng"] = str(reqs.get("eng") or b["eng"]).strip("# ")
    reqs["math"] = str(reqs.get("math") or b["math"]).strip("# ")
    
    csd_val = str(reqs.get("csd") or b["csd"]).lower()
    if "attained" in csd_val or "a" in csd_val or "2" in csd_val:
        reqs["csd"] = "A"
    else:
        reqs["csd"] = b["csd"]
    
    # Electives
    if not reqs.get("elect1") or not isinstance(reqs["elect1"], dict):
        current_val = reqs.get("elect1")
        reqs["elect1"] = {"count": 1, "subjects": ["Any"], "grade": str(current_val or b["e_grade"]).strip("# "), "note": "University Baseline" if not current_val else ""}
    
    if not reqs.get("elect2") or not isinstance(reqs["elect2"], dict):
        current_val = reqs.get("elect2")
        reqs["elect2"] = {"count": 1, "subjects": ["Any"], "grade": str(current_val or b["e_grade"]).strip("# "), "note": "University Baseline" if not current_val else ""}

    return obj


def parse_shared_quota(raw_text):
    """Joint-admission ('combined figure') quota detector.

    JUPAS writes shared intakes inline, e.g.
      'First Year Intake 327 (Combined figure for programmes JS6303, JS6315 & JS6987)'
      'First Year Intake Intake quota 30-50 (combined figure of 300 for programmes JS4501 and JS4502)'
    Returns {"total": int|None, "codes": [JS...]} when ≥2 programmes share the
    intake, else None — so the app can show 'N places shared across M programmes'
    instead of a per-programme number that overstates each one's real intake.
    """
    if not raw_text or "ombined" not in raw_text:
        return None
    codes = sorted(set(re.findall(r"JS[A-Z0-9]{4}", raw_text)))
    if len(codes) < 2:
        return None
    m = re.search(r"[Cc]ombined\s+(?:figures?|intake)?\s*of\s*(\d+)", raw_text)
    if m:
        total = int(m.group(1))
    else:
        m2 = re.search(r"First Year Intake\s*(?:\([^)]*\))?\s*:?\s*(\d+)", raw_text)
        total = int(m2.group(1)) if m2 else None
    return {"total": total, "codes": codes}


def apply_jupas_detail(obj, jd):
    """Overlay the JUPAS public listing onto a unified entry — fills gaps the
    per-school feed lacks, and detects joint-admission shared quotas. Shared by
    the per-school pass and the auto-include pass so both behave identically."""
    if not jd:
        return obj
    # Names: overlay only if per-school is blank.
    if not obj.get("name_en"):
        obj["name_en"] = jd.get("name_en") or obj.get("name_en")
    if not obj.get("name_zh"):
        obj["name_zh"] = jd.get("name_zh") or obj.get("name_zh")

    # Quota: fall back to the JUPAS number only when the per-school feed has none
    # (the JUPAS-detail value historically carried a spurious leading "1" on PolyU
    # quotas; the scraper now de-pollutes the "(1)" footnote, but per-school stays
    # authoritative).
    if obj.get("quota") in (None, "", 0) and jd.get("quota"):
        obj["quota"] = jd["quota"]
    # Joint-admission shared quota — record the relationship + use the combined
    # total as the displayed figure.
    shared = parse_shared_quota(jd.get("quota_raw_text"))
    if shared:
        obj["quota_shared"] = shared
        if shared.get("total"):
            obj["quota"] = shared["total"]

    obj["jupas_url"] = jd.get("url")
    # short_description: trim to ~280 chars (full structured overview is shipped
    # lazily via the programme-details sidecar).
    short_desc = (jd.get("short_description") or "").strip()
    if len(short_desc) > 280:
        short_desc = short_desc[:280].rsplit(" ", 1)[0] + "…"
    obj["short_description"] = short_desc
    obj["programme_websites"] = jd.get("programme_websites") or []
    obj["tuition_fee_first_year"] = jd.get("tuition_fee_first_year") or ""
    obj["contacts_text"] = jd.get("contacts_text") or ""
    obj["study_level"] = jd.get("study_level") or ""
    requirements = dict(jd.get("requirements") or {})
    requirements.pop("raw_text", None)
    obj["jupas_requirements"] = requirements
    return obj

def unify_data():
    # 1. Pre-load Global Resources
    df_overview = pd.read_csv(OVERVIEW_FILE)
    overview_map = {str(row['JUPAS Catalogue No.']): {
        "name_zh": row['chinese_name'],
        "name_en": row['Programme Full Title'],
        "institution": row['Institution / Scheme']
    } for _, row in df_overview.iterrows()}

    # Load JUPAS Offer Statistics (Application/Offer trends)
    offer_stats_map = {}
    if os.path.exists(OFFER_TABLE_FILE):
        df_offer = pd.read_csv(OFFER_TABLE_FILE)
        # Convert numeric columns to native python types to avoid JSON serialisation errors
        cols_to_fix = ['Year', 'Band A', 'Band B', 'Band C', 'Band D', 'Band E', 'Total']
        for col in cols_to_fix:
            if col in df_offer.columns:
                df_offer[col] = pd.to_numeric(df_offer[col], errors='coerce').fillna(0).astype(int)

        # Quota: sanitise. The offer-table extraction occasionally merges
        # cells (e.g. CUHK JS4502 came through as 305030045014502 — really
        # "30-50" + "300" + the JS codes concatenated). No JUPAS programme
        # has >3000 first-year places, so anything outside [1, 3000] is an
        # artefact → 0 (treated as "unknown", so the backfill/JUPAS fallback
        # can take over rather than surfacing a garbage number).
        if 'Quota' in df_offer.columns:
            q = pd.to_numeric(df_offer['Quota'], errors='coerce')
            df_offer['Quota'] = q.where((q >= 1) & (q <= 3000), other=0).fillna(0).astype(int)
        
        # Replace remaining NaN (in non-numeric columns like Type) with empty strings to keep JSON valid
        df_offer = df_offer.where(pd.notnull(df_offer), "")
        
        for code, group in df_offer.groupby('JUPAS'):
            offer_stats_map[str(code)] = group.to_dict('records')
    print(f"Loaded offer statistics for {len(offer_stats_map)} programmes.")

    # Load JUPAS-site programme details (used as a baseline fallback layer for
    # every programme — see scripts/extraction/jupas_detail_scrap.py).
    jupas_detail_map = {}
    if os.path.exists(JUPAS_DETAIL_FILE):
        with open(JUPAS_DETAIL_FILE, encoding="utf-8") as f:
            for rec in json.load(f):
                jupas_detail_map[rec["jupas_code"]] = rec
    print(f"Loaded JUPAS detail records for {len(jupas_detail_map)} programmes.")

    # Load PolyU structured weights
    polyu_weights_2026 = {}
    if os.path.exists(POLYU_WEIGHTS_2026):
        with open(POLYU_WEIGHTS_2026, encoding='utf-8') as f:
            polyu_weights_2026 = json.load(f)

    cuhk_2025_reqs = {}
    if os.path.exists(CUHK_2025_REQ):
        with open(CUHK_2025_REQ, encoding='utf-8') as f:
            cuhk_2025_reqs = {item['jupas_code']: item for item in json.load(f)}

    cuhk_2026_reqs = {}
    if os.path.exists(CUHK_2026_REQ):
        with open(CUHK_2026_REQ, encoding='utf-8') as f:
            cuhk_2026_reqs = {item['jupas_code']: item for item in json.load(f)}

    cuhk_2025_grades = {}
    if os.path.exists(CUHK_GRADES_FILE):
        with open(CUHK_GRADES_FILE, encoding='utf-8') as f:
            cuhk_2025_grades = json.load(f)

    # Load HKUST JS-extracted structured formula data
    hkust_js_data = {}
    if os.path.exists(HKUST_JS_EXTRACT):
        with open(HKUST_JS_EXTRACT, 'r', encoding='utf-8') as f:
            for entry in json.load(f):
                hkust_js_data[entry['jupas_code']] = entry
        print(f"Loaded HKUST JS extract: {len(hkust_js_data)} entries")

    # Load CityU 2025 weightings (VLM-transcribed from the 2025 PDF) — authoritative
    # 2025 source; the scrape's 2025 field was garbled and unify copied 2026 onto 2025.
    cityu_2025_weights = {}
    if os.path.exists(CITYU_2025_WEIGHTS):
        with open(CITYU_2025_WEIGHTS, 'r', encoding='utf-8') as f:
            cityu_2025_weights = json.load(f)
        print(f"Loaded CityU 2025 weightings: {len(cityu_2025_weights)} entries")

    cuhk_2025_weights = {}
    if os.path.exists(CUHK_2025_WEIGHTS):
        with open(CUHK_2025_WEIGHTS, 'r', encoding='utf-8') as f:
            cuhk_2025_weights = json.load(f)
        print(f"Loaded CUHK 2025 weightings: {len(cuhk_2025_weights)} entries")

        # Known scrape error — JS5901. Its official formula (HKUST PDF) is identical
        # to the other engineering programmes: English×2 + Math×2 + best of
        # {Bio/Chem/Phys ×2, ICT ×1} + best 2 other {M1/M2 ×1.5, else ×1}, giving a
        # highest-attainable of 75.86. But its scraped `otherSubjects` text dropped
        # the "(x 2)" ("Biology / Chemistry / Physics, ICT (x 1)"), so its
        # formula_steps came through with the sciences at ×1 — a theoretical max of
        # only 67.36, BELOW its own published 75.86. Tell-tale: the extract's own
        # max_attainable_weighting (8.5) already assumes ×2, so the ×1 pool is
        # internally inconsistent. Patch the science pool back to ×2, re-checking so
        # a future corrected scrape surfaces the override as redundant.
        _js5901 = hkust_js_data.get('JS5901')
        if _js5901:
            for _step in _js5901.get('formula_steps', []):
                if _step.get('type') != 'best_from_pool':
                    continue
                if not any('Biology' in s for s in (_step.get('subject_filter') or [])):
                    continue
                _sci_w = [g.get('weight') for g in (_step.get('weights') or [])
                          if any(x in ('Biology', 'Chemistry', 'Physics') for x in g.get('subjects', []))]
                if _sci_w and max(_sci_w) <= 1.0:
                    _step['weights'] = [
                        {'subjects': ['Biology', 'Chemistry', 'Physics'], 'weight': 2.0},
                        {'subjects': ['Information and Communication Technology'], 'weight': 1.0},
                    ]
                    print("  [fix] JS5901 science pool ×1 → ×2 (scrape dropped '(x 2)'; matches official 75.86 HA)")
                else:
                    print("  ⚠ REVIEW: JS5901 science pool no longer ×1 — scrape may be fixed; drop this override")
                break

    # Load HKU Raw API for Min Reqs & Extra Info
    hku_req_map = {}
    hku_extra_map = {}
    if os.path.exists(HKU_RAW_API):
        with open(HKU_RAW_API, encoding='utf-8') as f:
            h_data = json.load(f)
            for faculty, progs in h_data['data']['programme'].items():
                for name, p_info in progs.items():
                    code = "JS" + p_info['programme_code']
                    h_html = p_info.get('accordionHTML')
                    hku_req_map[code] = parse_hku_min_reqs(h_html)
                    hku_extra_map[code] = parse_hku_extra_info(h_html)

    unified_map = {}

    # 2. Iterate through institutions
    for school_key, path in FILES.items():
        if not os.path.exists(path): continue
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        
        for entry in data:
            code = entry.get('jupas_code') or entry.get('code')
            if not code: continue
            
            # Logic Pre-check: Does this entry have detailed formula info?
            # Prefer the most detailed formula regardless of order
            raw_f25 = str(entry.get('formula') or entry.get('score_formula') or entry.get('principle') or "")
            logic_check = extract_logic_from_formula(raw_f25)
            
            if code in unified_map:
                existing = unified_map[code]
                existing_logic = extract_logic_from_formula(existing.get('formula_2025'))
                
                # Decision: Should we replace the existing entry with the new one?
                # Case A: New entry has more compulsory subjects
                if len(logic_check["compulsory"]) > len(existing_logic["compulsory"]):
                    pass # Keep new
                # Case B: New entry has dynamic pools and existing doesn't
                elif logic_check["best_of"] and not existing_logic["best_of"]:
                    pass # Keep new
                # Case C: New formula string is longer and existing has no special logic
                elif len(raw_f25) > len(str(existing.get('formula_2025', ''))) and not existing_logic["compulsory"] and not existing_logic["best_of"]:
                    pass # Keep new
                else:
                    continue # Stick with existing
            
            ov = overview_map.get(code, {})
            
            # Base Unified Object Structure
            obj = {
                "jupas_code": code,
                "name_en": ov.get('name_en') or entry.get('name') or entry.get('title'),
                "name_zh": ov.get('name_zh'),
                "institution": ov.get('institution') or school_key,
                "faculty": entry.get('faculty') or entry.get('school'),
                
                "formula_2025": None,
                "formula_2025_id": None,
                "formula_2026": None,
                "formula_2026_id": None,
                
                "subject_weights_2025": {},
                "subject_weights_2026": {},
                "best_of_weights_2025": [],
                "best_of_weights_2026": [],
                "subject_weights_2025_raw": None,
                "subject_weights_2026_raw": None,
                
                "min_requirements_2026": {},
                "calculation_constraints": [], # Machine-readable calculation flags
                "score_conversion_table": {},
                "max_achievable_score": None,
                
                "scores_2025": {"median": None, "lq": None, "uq": None, "mean": None, "expected_score": None},
                "score_grades_2025": {
                    "median": entry.get('score_median_grades') or entry.get('median_grades'),
                    "lq": entry.get('score_lq_grades') or entry.get('lq_grades')
                },
                "offer_statistics": [],
                
                "quota": entry.get('quota'),
                "remarks": " | ".join(filter(lambda x: x and x not in ["", "--", "-"], [entry.get('remarks'), entry.get('other_req'), entry.get('formula_remarks'), entry.get('requirement_remarks')]))
            }

            # 3. School-Specific Mapping & Constraint Detection
            
            if school_key == "CityU":
                # `score_formula` is the precise statement ("Best 5 Subjects (includes
                # English Language, Mathematics)") — prefer it over `calc_mode_text`
                # ("Best 5 Subjects"), which drops the compulsory-cores clause and
                # otherwise contradicts the structured display (e.g. JS1000). CityU
                # formulas are stable year-over-year, so use it for both years.
                _city_sf = entry.get('score_formula')
                obj["formula_2025"] = _city_sf or entry.get('subject_weights_2025', {}).get('subjects_included') or entry.get('calc_mode_text')
                obj["formula_2026"] = _city_sf or entry.get('calc_mode_text')
                
                sw2026 = entry.get('subject_weights', {})
                if isinstance(sw2026, (str, list)):
                    # positional array form (JSON string or list) → honour the
                    # 1st/2nd-elective slots (best science elective ×2.5 etc.)
                    flat26, best26 = parse_cityu_weights(sw2026)
                    obj["subject_weights_2026"] = flat26
                    obj["best_of_weights_2026"] = best26
                else:
                    obj["subject_weights_2026"] = {normalize_subject(k): float(v) for k, v in sw2026.items()}

                # CityU 2025 weights: use the VLM-transcribed 2025 PDF (authoritative).
                # 7 programmes genuinely differ from 2026 (e.g. JS1001 English ×1 not
                # ×1.5; JS1200 Math/sciences ×2.5; JS1216/JS1219 weighted electives the
                # 2026 data lost). Fall back to the 2026 copy only for programmes absent
                # from the 2025 PDF (e.g. JS1300, new/renamed since).
                _c25 = cityu_2025_weights.get(code)
                if _c25:
                    obj["subject_weights_2025"] = {normalize_subject(k): float(v)
                                                   for k, v in _c25["subject_weights_2025"].items()}
                    obj["best_of_weights_2025"] = [
                        {"count": p["count"], "weight": float(p["weight"]),
                         "subjects": [normalize_subject(s) for s in p["subjects"]]}
                        for p in _c25.get("best_of_weights_2025", [])
                    ]
                else:
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                    obj["best_of_weights_2025"] = [dict(p) for p in obj["best_of_weights_2026"]]
                
                # Regex extraction of compulsory subjects embedded in "Best 5 (includes ...)" strings
                sf = str(entry.get('score_formula', ''))
                m_comp = re.search(r'\(includes\s*(.*)\)', sf, re.IGNORECASE)
                if m_comp:
                    comp_text = m_comp.group(1).strip(" .")
                    
                    # Check for "and one subject from Bio/Chem/Phys" pattern
                    pool_match = re.search(r'and one subject from (.*)', comp_text, re.IGNORECASE)
                    fixed_text = comp_text
                    if pool_match:
                        pool_raw = pool_match.group(1)
                        pool_subjs = [normalize_subject(s.strip()) for s in re.split(r' / |/|,', pool_raw)]
                        obj["calculation_constraints"].append({
                            "type": "compulsory_subject_pool",
                            "count": 1,
                            "subjects": pool_subjs,
                            "description": f"Formula requires one subject from: {', '.join(pool_subjs)}"
                        })
                        fixed_text = comp_text[:pool_match.start()].strip(" ,")

                    # Handle fixed compulsory subjects
                    subjs = []
                    for s in re.split(r',| and ', fixed_text):
                        if not s.strip(): continue
                        norm_s = normalize_subject(s.strip())
                        if norm_s: subjs.append(norm_s)
                    
                    if subjs:
                        obj["calculation_constraints"].append({
                            "type": "compulsory_subjects",
                            "subjects": subjs,
                            "description": f"Formula includes: {', '.join(subjs)}"
                        })

                # CityU "3 Core + 2 Elective" mode (calc_mode 'best3plus2'): the
                # three DSE cores (Chinese, English, Mathematics) are compulsory
                # plus the best 2 electives. Unlike the 'best5 (includes …)' mode,
                # this phrasing carries no "(includes …)" clause, so the cores must
                # be forced from the mode itself — otherwise weak-core applicants
                # are over-scored (their cores wrongly drop out of the Best-N).
                # Matches the project's documented 3C+2X definition (see
                # docs/manuals/JUPAS_2026_INSTRUCTIONS.md and EXCEL_LOGIC.md).
                if entry.get('calc_mode') == 'best3plus2':
                    cores = ["Chinese Language", "English Language", "Mathematics (Compulsory Part)"]
                    existing_comp = next((c for c in obj["calculation_constraints"] if c.get("type") == "compulsory_subjects"), None)
                    if existing_comp:
                        existing_comp["subjects"] = sorted(set(existing_comp["subjects"] + cores))
                    else:
                        obj["calculation_constraints"].append({
                            "type": "compulsory_subjects",
                            "subjects": cores,
                            "description": "3 Core + 2 Elective: Chinese, English and Mathematics are compulsory"
                        })

                # Detect Math + M1/M2 mutual exclusivity
                if entry.get('maths_calc_as_one') == 1 or "only one subject will be included" in sf:
                    obj["calculation_constraints"].append({
                        "type": "maths_m1m2_as_one",
                        "description": "If a student takes both Mathematics and M1/M2, only one subject will be included"
                    })

                # Parse nested JSON requirements from API
                reqs = {"chi": None, "eng": None, "math": None, "csd": "A", "elect1": None, "elect2": None}
                try:
                    basic_reqs = json.loads(entry.get('basic_requirements', '[]'))
                    if isinstance(basic_reqs, list):
                        for br in basic_reqs:
                            subj = normalize_subject(br.get('subject', ''))
                            mg = br.get('min_grade', '')
                            if subj == "Chinese Language": reqs["chi"] = mg
                            elif subj == "English Language": reqs["eng"] = mg
                            elif subj == "Mathematics (Compulsory Part)": reqs["math"] = mg
                            elif subj == "Citizenship and Social Development": reqs["csd"] = mg
                except: pass
                
                try:
                    elect_reqs = json.loads(entry.get('elective_requirements', '[]'))
                    if isinstance(elect_reqs, list):
                        for er in elect_reqs:
                            mg = er.get('min_grade', '')
                            try: count = int(er.get('min_count', '1'))
                            except: count = 1
                            subjs = expand_combined_science([canon_elective_subject(s) for s in er.get('subjects', [])])
                            if not subjs or len(subjs) > 20: subjs = ["Any"]
                            
                            # If count > 1 (e.g. any two electives), we split them into individual entries
                            er_obj = {"count": 1, "subjects": subjs, "grade": mg, "note": er.get('display', '').strip()}
                            for _ in range(count):
                                if not reqs["elect1"]: reqs["elect1"] = er_obj.copy()
                                elif not reqs["elect2"]: reqs["elect2"] = er_obj.copy()
                except: pass
                obj["min_requirements_2026"] = reqs

            elif school_key == "CUHK":
                req25 = cuhk_2025_reqs.get(code, {})
                req26 = cuhk_2026_reqs.get(code, {})
                
                # Formula Logic: Prefer the structured 'formula' string over 'principle'
                f26 = entry.get('formula') if entry.get('formula') and "Best" in str(entry.get('formula')) else entry.get('principle')
                obj["formula_2026"] = f26
                
                # Check for descriptive formula in the main entry itself (sometimes raw API has it)
                raw_f = entry.get('formula')
                f25 = req25.get('principle')
                
                # Logic: If raw_f has A-codes (AENGL etc) and f25 doesn't, use raw_f
                if raw_f and "A" in str(raw_f) and ("+" in str(raw_f) or "Best" in str(raw_f)):
                    if not f25 or "A" not in str(f25):
                        f25 = raw_f

                # Handle fallback if f25 is missing or too vague
                if not f25 or len(str(f25)) < 10 or "(x " in str(f25):
                    f25 = f26
                obj["formula_2025"] = f25
                
                # 2026 weights from the structured API string.
                flat_weights, best_of_weights = parse_cuhk_weights(entry.get('weight'))
                obj["subject_weights_2026"] = flat_weights
                obj["best_of_weights_2026"] = best_of_weights
                # 2025 weights: use the parsed 2025 PDF (authoritative) instead of
                # copying 2026. CUHK's real 2025 formula differs for some programmes
                # (e.g. JS4412 M1/M2 ×1.75, JS4361 best-of language/science pools).
                # Fall back to the 2026 copy only for programmes with no 2025 entry.
                _cu25 = cuhk_2025_weights.get(code)
                if _cu25 is not None:
                    obj["subject_weights_2025"] = {normalize_subject(k): float(v)
                                                   for k, v in _cu25.get("subject_weights_2025", {}).items()}
                    obj["best_of_weights_2025"] = [
                        {"count": p["count"], "weight": float(p["weight"]),
                         "subjects": [normalize_subject(s) for s in p["subjects"]]}
                        for p in _cu25.get("best_of_weights_2025", [])
                    ]
                else:
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                    obj["best_of_weights_2025"] = obj["best_of_weights_2026"].copy()
                
                obj["subject_weights_2025_raw"] = req25.get('weight')
                obj["subject_weights_2026_raw"] = entry.get('weight_remarks')

                # Fallback: the coded API weight is empty for some programmes, but
                # CUHK's 2026 PDF requirements still list a weighting (e.g. JS4100
                # "• Chinese (x 1.5) | • English (x 1.5)"). Populate the 2026
                # weighting from it. Per the Year Labeling Rule this is a 2026-only
                # change, so we DON'T touch the 2025 weights — the 2025-logic score
                # must stay comparable to the 2025 admission benchmarks.
                if not obj["subject_weights_2026"] and not obj["best_of_weights_2026"]:
                    pdf_w = parse_cuhk_pdf_weights(req26.get('weight'))
                    if pdf_w:
                        obj["subject_weights_2026"] = pdf_w
                        obj["subject_weights_2026_raw"] = req26.get('weight')

                # CUHK Manual Overrides for Special Logic (e.g. JS4725)
                if code == "JS4725":
                    # Logic: Best 2 of English, Biology or Chemistry (x 1.5)
                    obj["best_of_weights_2025"].append({
                        "count": 2,
                        "subjects": ["English Language", "Biology", "Chemistry"],
                        "weight": 1.5
                    })
                    obj["best_of_weights_2026"] = obj["best_of_weights_2025"].copy()
                    
                    # Logic: Best of Biology/Chemistry must be included
                    obj["calculation_constraints"].append({
                        "type": "compulsory_subject_pool",
                        "count": 1,
                        "subjects": ["Biology", "Chemistry"],
                        "description": "Best of Biology/Chemistry must be included in the score calculation (i.e. Best of Bio/Chem + Best 4 subjects)"
                    })

                # Detect CUHK "Max Weighted" constraints
                if "maximum of 3 subjects will be weighted heavier" in obj["remarks"]:
                    obj["calculation_constraints"].append({
                        "type": "max_weighted_subjects",
                        "limit": 3,
                        "description": "A maximum of 3 subjects will be weighted heavier in the total score of Best 5 subjects"
                    })
                
                # Detect special M1/M2 half-replacement logic
                if "worst subject is replaced by a new score comprising half" in obj["remarks"]:
                    obj["calculation_constraints"].append({
                        "type": "m1m2_half_replacement",
                        "description": "M1/M2 contributes if higher than worst subject; half original + half M1/M2 score"
                    })
                
                # Detect special Medicine conversion scales
                if "5** = 7 | 5* = 6" in obj["remarks"]:
                    obj["calculation_constraints"].append({
                        "type": "medicine_conversion_scale",
                        "description": "Special conversion scale: 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1"
                    })

                # Build structured requirements from API pools. The
                # `req_electives` token (e.g. "ABIOL,ACHEM >= 3; * >= 3") is
                # AUTHORITATIVE. A "*" subject means ANY elective — the
                # display text/note (subject_N_text) can be noisy (e.g. CUHK
                # medicine's "Mathematics (Module 1 or 2)" footnote, which
                # previously leaked in as a fake elect2 subject and wrongly
                # made strong Bio/Chem/Phys applicants ineligible).
                req_el = entry.get("req_electives", "")
                parts = req_el.split(";")
                e1_req = parts[0].strip() if len(parts) > 0 else ""
                e2_req = parts[1].strip() if len(parts) > 1 else ""

                def cuhk_elective(req_part, note, text):
                    subj_tok = req_part.split(">=")[0].strip()
                    if subj_tok == "*":
                        gm = re.search(r'>=\s*(\d[A-Za-z*]*)', req_part)
                        return {"count": 1, "subjects": ["Any"], "grade": gm.group(1) if gm else "3", "note": ""}
                    return build_cuhk_elective(note, text, req_part)

                e1 = cuhk_elective(e1_req, entry.get("subject_1_note"), entry.get("subject_1_text"))
                e2 = None
                if e2_req and "None" not in e2_req:
                    e2 = cuhk_elective(e2_req, entry.get("subject_2_note"), entry.get("subject_2_text"))

                obj["min_requirements_2026"] = {
                    "chi": entry.get('req_chi') or req26.get('req_chi'),
                    "eng": entry.get('req_eng') or req26.get('req_eng'),
                    "math": entry.get('req_math') or req26.get('req_math'),
                    "csd": entry.get('req_csd') or entry.get('req_cs') or req26.get('req_cs') or "A",
                    "elect1": e1, 
                    "elect2": e2
                }

                rem = entry.get('requirement_remarks') or req26.get('remarks')
                if rem and rem not in ["--", ""]:
                    rem_clean = clean_raw_string(re.sub(r'<[^>]+>', ' ', rem).strip())
                    rem_clean = rem_clean.replace(" preferred: ", " preferred:\n")
                    obj["min_requirements_2026"]["conditional_remarks"] = rem_clean
                
                # Merge individual grade breakdowns from PDF extraction
                if code in cuhk_2025_grades:
                    obj["score_grades_2025"]["median"] = cuhk_2025_grades[code].get("median")
                    obj["score_grades_2025"]["lq"] = cuhk_2025_grades[code].get("lq")
                    if cuhk_2025_grades[code].get("uq"):
                        obj["score_grades_2025"]["uq"] = cuhk_2025_grades[code].get("uq")

            elif school_key == "HKU":
                formula_25 = entry.get('formula_25') or entry.get('formula_2025')
                formula_26 = entry.get('formula_2026')
                obj["formula_2025"] = formula_25
                obj["formula_2026"] = formula_26
                
                # Parse Weights from subject_weight field
                sw_text = entry.get('subject_weight')
                obj["subject_weights_2026"] = parse_hku_weights(sw_text)
                obj["subject_weights_2025"] = parse_hku_weights(sw_text)
                
                # Formula often contains multipliers too, e.g. "2 x Eng"
                f_text = str(formula_26)
                obj["subject_weights_2026"].update(parse_hku_formula_weights(formula_26))
                obj["subject_weights_2025"].update(parse_hku_formula_weights(formula_25))

                # HKU "best of pool" mis-flattening fix. A formula slot like
                # "1.5 x Best Sci Subject" or "Best 2 from Bio/Chem/Phys/M1/M2" gives
                # its weight to only the BEST N of the subject_weight pool — not every
                # listed subject. parse_hku_weights flattened the whole pool, so a
                # student taking several sciences got each boosted (the same
                # over-weighting bug found for HKUST). Detect the "Best [one] … Sci
                # Subject" / "Best N from …" restriction and convert the weighted pool
                # into a best_of (count N), stripping it from the flat weights. Formulas
                # that merely say "Best N Subjects" (no "Sci"/"from" pool) legitimately
                # weight EVERY listed elective, so they're left as flat weights.
                _sw_pool = parse_hku_weights(sw_text)
                _bo_count = 1 if re.search(r'Best\b[^+]*Sci[^+]*Subject', str(formula_25) or '', re.IGNORECASE) else None
                _m_from = re.search(r'Best\s+(\d+)\s+from\b', str(formula_25) or '', re.IGNORECASE)
                if _m_from:
                    _bo_count = int(_m_from.group(1))
                if _bo_count and _sw_pool:
                    _w = max(_sw_pool.values())
                    _pool_subs = sorted(k for k, v in _sw_pool.items() if v == _w)
                    obj["best_of_weights_2026"].append({"count": _bo_count, "subjects": _pool_subs, "weight": _w})
                    for _k in _pool_subs:
                        obj["subject_weights_2026"].pop(_k, None)
                        obj["subject_weights_2025"].pop(_k, None)
                    print(f"  [fix] HKU {code}: best-{_bo_count}-of-{len(_pool_subs)} pool ×{_w:g} "
                          f"(was flattened onto every pool member)")

                # JS6858 (BSc & LLB): its subject_weight scrape is EMPTY, so the
                # general fix above can't reach it. Model its formula "2 x Eng +
                # 2 x Math/M1/M2 + 2 x Best Sci Subject + Best 3" from the formula +
                # other_req (which names the science pool as Bio/Chem/Physics): the
                # best of {Math,M1,M2} and the best of {Bio,Chem,Phys} each take ×2
                # (best-of, not every member). Without this both ×2 boosts are
                # missing — a perfect student scores 68 vs the ~76.5 max, under its
                # own UQ (56). Re-check: only fires while the scrape stays empty.
                if code == "JS6858" and not (sw_text or "").strip():
                    obj["subject_weights_2026"].pop("Mathematics (Compulsory Part)", None)
                    obj["subject_weights_2025"].pop("Mathematics (Compulsory Part)", None)
                    for _pool in ({"count": 1, "weight": 2.0,
                                   "subjects": ["Mathematics (Compulsory Part)",
                                                "Mathematics Extended Part (Module 1)",
                                                "Mathematics Extended Part (Module 2)"]},
                                  {"count": 1, "weight": 2.0,
                                   "subjects": ["Biology", "Chemistry", "Physics"]}):
                        obj["best_of_weights_2026"].append(dict(_pool))
                    print("  [fix] HKU JS6858: added best-of ×2 pools for Math/M1/M2 "
                          "and Bio/Chem/Physics (empty subject_weight scrape)")

                # Detect Best of pools in HKU formula
                m_best = re.search(r'Best of (.*?) with Weighting([\d.]+)', f_text, re.IGNORECASE)
                if m_best:
                    pool_text = m_best.group(1)
                    weight = float(m_best.group(2))
                    subjs = [normalize_subject(s.strip()) for s in re.split(r' or | / ', pool_text)]
                    obj["best_of_weights_2026"].append({
                        "count": 1,
                        "subjects": subjs,
                        "weight": weight
                    })

                obj["best_of_weights_2025"] = obj["best_of_weights_2026"].copy()
                
                obj["subject_weights_2026_raw"] = sw_text
                obj["subject_weights_2025_raw"] = formula_25 if parse_hku_formula_weights(formula_25) else sw_text 

                # Constraints
                obj["calculation_constraints"].append({
                    "type": "hku_8.5_scale",
                    "description": "HKU standard conversion scale: 5**=8.5, 5*=7, 5=5.5, 4=4, 3=3, 2=2, 1=1"
                })
                
                extra = hku_extra_map.get(code, {})
                if extra.get("other_factors"):
                    obj["calculation_constraints"].append({
                        "type": "consideration_other_factors",
                        "description": extra["other_factors"]
                    })
                if extra.get("repeater_policy"):
                    obj["calculation_constraints"].append({
                        "type": "repeater_combined_results_policy",
                        "description": extra["repeater_policy"]
                    })

                hku_reqs_raw = hku_req_map.get(code, {})
                obj["min_requirements_2026"] = {
                    "chi": hku_reqs_raw.get("chi"),
                    "eng": hku_reqs_raw.get("eng"),
                    "math": hku_reqs_raw.get("math"),
                    "csd": "A" if "Attained" in str(hku_reqs_raw.get("csd", "")) else hku_reqs_raw.get("csd"),
                    "elect1": build_generic_elective(hku_reqs_raw.get("elect1")),
                    "elect2": build_generic_elective(hku_reqs_raw.get("elect2"))
                }
                
                # Check for specific elective requirements (e.g. Medicine needs Bio/Chem)
                spec_desc = hku_reqs_raw.get("specific_elective_desc")
                if spec_desc:
                    pool = build_hku_elective_pool(spec_desc, hku_reqs_raw.get("elect1", "3"))
                    if pool:
                        if pool["count"] == 1:
                            obj["min_requirements_2026"]["elect1"] = pool
                        elif pool["count"] == 2:
                            # Split into two identical pools for simplicity in calculation
                            p1 = pool.copy()
                            p1["count"] = 1
                            obj["min_requirements_2026"]["elect1"] = p1
                            obj["min_requirements_2026"]["elect2"] = p1.copy()

            elif school_key == "HKUST":
                # Use structured data from JS-extracted source (reverse-engineered from official
                # HKUST calculator). Falls back to old scraper data if JS extract is missing.
                js = hkust_js_data.get(code, {})

                # Reconstruct the FULL formula from the authoritative JS-extract
                # rather than the old scraper's fields. The scraper's
                # `formula_text_2025` is either a bare fragment ("Best 3 other
                # subjects", missing the English/Math prefix) or a stale two-option
                # string (e.g. JS5812) that no longer matches the real model. The
                # JS-extract gives the required cores (+ weights) via `formula_steps`
                # and the rest via `otherSubjects_text`.
                _hk_short = {"English Language": "English", "Mathematics (Compulsory Part)": "Math",
                             "Mathematics Compulsory Part": "Math", "Chinese Language": "Chinese"}
                _core_parts = []
                for _s in js.get('formula_steps', []):
                    if isinstance(_s, dict) and _s.get('type') == 'required' and _s.get('subject'):
                        _subj = _hk_short.get(_s['subject'], normalize_subject(_s['subject']))
                        _w = _s.get('weight', 1) or 1
                        _core_parts.append(f"{_subj} x {_w:g}" if _w != 1 else _subj)
                # Clean footnote markers + drop the trailing legend ("Weighting: …",
                # "Category C …"); keep the better-of "… OR …" body intact.
                _others = js.get('otherSubjects_text') or entry.get('otherSubjects', '') or ''
                _others = re.sub(r'[▲#^~*]', '', _others)
                _others = re.split(r'\bWeighting\s*:|\bCategory\s+C\b', _others)[0].strip().strip(',+ ').strip()
                _parts = _core_parts + ([_others] if _others else [])
                _hk_formula = " + ".join(_parts) if _parts else (entry.get('formula_text_2025') or '')
                # HKUST formulas are stable across cycles.
                obj["formula_2025"] = _hk_formula
                obj["formula_2026"] = _hk_formula

                # Subject weights: use structured JS data, normalizing keys to canonical names.
                js_weights = js.get('subject_weights_2026', {})
                if js_weights:
                    obj["subject_weights_2026"] = {normalize_subject(k): v for k, v in js_weights.items()}
                    # HKUST formula is stable across cycles — use same weights for 2025
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                else:
                    # Fallback: parse from string fields (old approach)
                    eng_m = float(str(entry.get('engMultiplier', 'x1')).replace('x', ''))
                    sec_m = float(str(entry.get('secondMultiplier', 'x1')).replace('x', ''))
                    sec_subj = entry.get('secondMultiplierSubject')
                    obj["subject_weights_2026"]["English Language"] = eng_m
                    if sec_subj and sec_m != 1.0:
                        obj["subject_weights_2026"][normalize_subject(sec_subj)] = sec_m
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()

                # For "better-of" programmes (JS5312/JS5331/JS5332/JS5822):
                # Option A = plain best-3; Option B = best-1 from Chem/Phys/Econ/M1/M2 x1.5 + best-2.
                # The pool exists in both 2025 and 2026 formulas (formula_text_2025 confirms this).
                # Note: "HA=62.48" in HKUST's PDF is the actual highest observed score in admissions,
                # not the theoretical all-5** maximum (which is ~66.94 with the pool).
                formula_steps = js.get('formula_steps', [])
                is_better_of = js.get('is_better_of', False)
                pool_weight = 1.0  # default if no pool found
                if is_better_of:
                    for step in formula_steps:
                        if step.get('type') == 'better_of':
                            options = step.get('options', [])
                            if len(options) >= 2:
                                option_b = options[1]
                                for case in option_b:
                                    if case.get('type') == 'best_from_pool' and case.get('weights'):
                                        pool_entry = {
                                            "count": 1,
                                            # Normalize subject names to canonical form
                                            "subjects": [normalize_subject(s) for s in case['subject_filter']],
                                            "weight": case['weights'][0]['weight']
                                        }
                                        pool_weight = pool_entry["weight"]
                                        # Pool applies to both 2025 and 2026 formulas
                                        obj["best_of_weights_2026"].append(pool_entry)
                                        obj["best_of_weights_2025"].append(pool_entry.copy())
                            break

                # Standard engineering formula: a RESTRICTED best_from_pool step
                # ("Best from Bio/Chem/Phys/ICT") boosts only ONE subject — the rest
                # count as ordinary "other subjects" (x1). The JS-extract flattened
                # every pool member into subject_weights (e.g. Bio/Chem/Phys ALL x2),
                # which wrongly weights every science a student takes. Convert each
                # weight-group (>1) of a restricted pool into a best_of pool (count 1)
                # and strip those subjects from the flat weights so only the single
                # best one is boosted. (better-of programmes handle their own pool.)
                if not is_better_of:
                    for step in formula_steps:
                        if not (isinstance(step, dict) and step.get('type') == 'best_from_pool'):
                            continue
                        if not step.get('subject_filter'):
                            continue  # empty filter = "any remaining" → the flat weight is correct
                        for wg in step.get('weights', []) or []:
                            w = wg.get('weight', 1)
                            subs = [normalize_subject(s) for s in (wg.get('subjects') or [])]
                            if w and w > 1 and subs:
                                pool_entry = {"count": 1, "subjects": subs, "weight": w}
                                obj["best_of_weights_2025"].append(pool_entry)
                                obj["best_of_weights_2026"].append(pool_entry.copy())
                                for s in subs:
                                    obj["subject_weights_2025"].pop(s, None)
                                    obj["subject_weights_2026"].pop(s, None)

                # Store formula_steps as a reference field for future use
                obj["hkust_formula_steps"] = formula_steps

                # Compulsory cores: derive from the JS-extract `formula_steps`
                # (type=='required') — the authoritative source. The HKUST formula
                # TEXT is unreliable for this (truncated merged-cell PDF), so the
                # generic text-regex in extract_logic_from_formula is disabled for
                # HKUST. Every HKUST programme explicitly requires its cores
                # (English + Math, or English + Chinese for some), then Best-N of
                # the rest, so these must be forced into the score selection.
                req_cores = []
                for step in formula_steps:
                    if isinstance(step, dict) and step.get('type') == 'required' and step.get('subject'):
                        nc = normalize_subject(step['subject'])
                        if nc and nc not in req_cores:
                            req_cores.append(nc)
                if req_cores:
                    obj["calculation_constraints"].append({
                        "type": "compulsory_subjects",
                        "subjects": req_cores,
                        "description": f"Formula requires: {', '.join(req_cores)}"
                    })

                # Constraints
                bonus_6th = js.get('bonus_6th', {})
                bonus_pct = bonus_6th.get('bonus_percentage', 5)
                bonus_cats = bonus_6th.get('eligible_categories',
                    (entry.get('extra_subject_bonus_category', '') or '').split(','))
                if isinstance(bonus_cats, str):
                    bonus_cats = [c.strip() for c in bonus_cats.split(',') if c.strip()]

                # max_attainable_weighting = sum of the multipliers in the OPTIMAL
                # best-N selection (drives the 6th-subject bonus rate). The JS-extract
                # carries the authoritative value; prefer it. The old local sum was
                # wrong once pooled sciences were (correctly) stripped from the flat
                # weights — it summed every flat weight, ignoring that a restricted
                # pool contributes only ONE slot.
                subject_num = entry.get('subjectNum', 5)
                max_attainable = js.get('max_attainable_weighting')
                if max_attainable is None:
                    explicit_weights = obj["subject_weights_2025"]
                    explicit_sum = sum(explicit_weights.values())
                    pool_slots = 1 if is_better_of else 0
                    remaining_slots = subject_num - len(explicit_weights) - pool_slots
                    max_attainable = explicit_sum + pool_slots * pool_weight + remaining_slots * 1.0

                obj["calculation_constraints"].append({
                    "type": "hkust_weighted_best",
                    "subject_count": subject_num,
                    "max_attainable_weighting": round(max_attainable, 4),
                    "bonus_percentage": bonus_pct,
                    "bonus_eligible_categories": bonus_cats,
                    "description": (
                        f"Weighted Best {subject_num} subjects "
                        f"with {bonus_pct}% of max_attainable_weighting bonus for 6th subject."
                    )
                })

                # Requirements: use structured JS data for reliability
                js_reqs = js.get('min_requirements_2026_raw', {})
                if js_reqs:
                    csd_raw = js_reqs.get('csd', 'attained')
                    obj["min_requirements_2026"] = {
                        "chi": js_reqs.get('chinese'),
                        "eng": js_reqs.get('english'),
                        "math": js_reqs.get('maths_core'),
                        "csd": "A" if str(csd_raw).lower() == "attained" else csd_raw,
                        "elect1": {"count": 1, "subjects": ["Any"],
                                   "grade": js_reqs.get('elective_subject_1', '3'), "note": ""},
                        "elect2": {"count": 1, "subjects": ["Any"],
                                   "grade": js_reqs.get('elective_subject_2', '3'), "note": ""}
                    }
                else:
                    # Fallback to old scraper fields
                    obj["min_requirements_2026"] = {
                        "chi": entry.get('req_chin'),
                        "eng": entry.get('req_eng'),
                        "math": entry.get('req_math'),
                        "csd": "A" if str(entry.get('req_csd', '')).lower() == "attained" else entry.get('req_csd'),
                        "elect1": {"count": 1, "subjects": ["Any"], "grade": entry.get('req_e1', "3"), "note": ""},
                        "elect2": {"count": 1, "subjects": ["Any"], "grade": entry.get('req_e2', "3"), "note": ""}
                    }

                # Apply HKUST's specified FIRST elective ("One of: Bio/Chem/Phys/…")
                # — authoritative from `anotherSpecifiedSubject`. Without this the
                # slot stays "Any" and a non-science elective wrongly satisfies it.
                _hk_spec = js.get('anotherSpecifiedSubject') or entry.get('anotherSpecifiedSubject')
                _hk_pool = parse_specified_elective(_hk_spec)
                if _hk_pool and obj["min_requirements_2026"].get("elect1"):
                    obj["min_requirements_2026"]["elect1"]["subjects"] = _hk_pool
                    obj["min_requirements_2026"]["elect1"]["note"] = str(_hk_spec).strip()

            elif school_key == "PolyU":
                formula_text = entry.get('calculation_mechanism')
                obj["formula_2025"] = formula_text
                obj["formula_2026"] = formula_text
                
                # Weights 2026 (Prefer structured JSON if available)
                if code in polyu_weights_2026:
                    for w in polyu_weights_2026[code]:
                        s_name = normalize_subject(w.get('Subject Name'))
                        s_val = float(w.get('Subject Weighting', 1.0))
                        obj["subject_weights_2026"][s_name] = s_val
                else:
                    obj["subject_weights_2026"] = parse_polyu_weights_string(entry.get('weights_2026'))
                obj["subject_weights_2026_raw"] = entry.get('weights_2026')

                # Weights 2025
                obj["subject_weights_2025"] = parse_polyu_weights_string(entry.get('weights_2025'))
                if not obj["subject_weights_2025"]:
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                obj["subject_weights_2025_raw"] = entry.get('weights_2025')

                # Constraints
                formula_clean = str(formula_text).replace('\xa0', ' ')
                if "additional bonus score for the 6th subject" in formula_clean:
                    obj["calculation_constraints"].append({
                        "type": "additional_bonus_6th",
                        "description": "Additional bonus score for the 6th subject with Level 3 or above"
                    })
                
                if "Chinese & English Languages + Any Best 3 Subjects" in formula_clean:
                    obj["calculation_constraints"].append({
                        "type": "compulsory_subjects",
                        "subjects": ["Chinese Language", "English Language"],
                        "description": "Formula includes: Chinese Language, English Language"
                    })

                # Structured Requirements 2026
                # PolyU reqs are usually standard 332A33 or 332A22, but let's map them
                obj["min_requirements_2026"] = {
                    "chi": entry.get('req_chin'),
                    "eng": entry.get('req_eng'),
                    "math": entry.get('req_math'),
                    "csd": "A" if entry.get('req_csd') == "Attained" else entry.get('req_csd'),
                    "elect1": {"count": 1, "subjects": ["Any"], "grade": entry.get('req_e1', "3"), "note": ""},
                    "elect2": {"count": 1, "subjects": ["Any"], "grade": entry.get('req_e2', "3"), "note": ""}
                }
                
                # Preferred subjects
                pref = entry.get('preferred_subjects')
                if pref and pref not in ["", "-"]:
                    obj["min_requirements_2026"]["conditional_remarks"] = "Preferred subjects: " + pref

            elif school_key == "HKBU":
                obj["formula_2025"] = entry.get('formula')
                obj["formula_2026"] = entry.get('formula')
                
                # Weights 2026
                sw2026 = entry.get('subject_weights', {})
                obj["subject_weights_2026"] = {normalize_subject(k): float(v) for k, v in sw2026.items()}
                obj["subject_weights_2026_raw"] = entry.get('weights_raw')
                
                # Weights 2025. An explicit EMPTY dict is authoritative "no
                # weighting" (2025 PDF row "-") and must NOT fall back to the
                # 2026 copy — that fallback hid weighting INTRODUCED for 2026
                # (JS2340/JS2960) from year-change detection and silently fed
                # the benchmark estimator 2026 weights. Fall back only when the
                # scrape carries no 2025 field at all.
                sw2025 = entry.get('subject_weights_2025')
                if isinstance(sw2025, dict):
                    obj["subject_weights_2025"] = {normalize_subject(k): float(v) for k, v in sw2025.items()}
                else:
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                obj["subject_weights_2025_raw"] = entry.get('weights_2025_raw')

                # Structured Requirements 2026
                obj["min_requirements_2026"] = {
                    "chi": entry.get('min_chi'),
                    "eng": entry.get('min_eng'),
                    "math": entry.get('min_math'),
                    "csd": entry.get('min_csd'),
                    "elect1": build_hkbu_elective(entry.get('min_elect1'), entry.get('elect1_constraint'), default_cat_a=True),
                    "elect2": build_hkbu_elective(entry.get('min_elect2'), None)
                }

            elif school_key == "LingU":
                obj["formula_2025"] = entry.get('formula')
                obj["formula_2026"] = entry.get('formula')
                
                # LingU weights compound/generic subjects ("Chinese History /
                # Chinese Literature", generic "Technology and Living") — expand
                # onto member subjects before canonicalising so the weight isn't
                # silently dropped (see expand_compound_weight_keys).
                sw2026 = expand_compound_weight_keys(entry.get('subject_weights', {}))
                obj["subject_weights_2026"] = {normalize_subject(k): float(v) for k, v in sw2026.items()}
                obj["subject_weights_2026_raw"] = entry.get('subject_weights_raw')

                sw2025 = entry.get('subject_weights_2025')
                if sw2025 and isinstance(sw2025, dict):
                    sw2025 = expand_compound_weight_keys(sw2025)
                    obj["subject_weights_2025"] = {normalize_subject(k): float(v) for k, v in sw2025.items()}
                else:
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                obj["subject_weights_2025_raw"] = entry.get('subject_weights_2025_raw') or entry.get('subject_weights_raw')

                # LingU Category C (Other Language) weights — the PDF omits them, so
                # they're reverse-engineered PER PROGRAMME from LingU's official JUPAS
                # calculator by scripts/extraction/lingu_calc_scrape.py →
                # lingu_catc_weights.json. They are NOT uniform: most programmes weight
                # languages at x1.0 (no entry needed), but one that weights its whole
                # elective pool higher (JS7123 x1.25) weights languages the same. Only
                # add an entry when the measured weight > 1.0. setdefault so an explicit
                # weight still wins. (Earlier we wrongly assumed a blanket x1.25.)
                _catc_w = LINGU_CATC_WEIGHTS.get(code)
                if _catc_w and _catc_w > 1.0:
                    for _catc in SUBJECTS_REGISTRY.get("category_c", []):
                        obj["subject_weights_2026"].setdefault(_catc, _catc_w)
                        obj["subject_weights_2025"].setdefault(_catc, _catc_w)

                # LingU Constraints
                obj["calculation_constraints"].append({
                    "type": "lingu_7_scale",
                    "description": "Lingnan standard conversion scale: 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1"
                })
                
                obj["calculation_constraints"].append({
                    "type": "score_breakdown_warning",
                    "description": "The median and lower quartile scores for individual subjects (Chinese, English, Math, Elective 1 and Elective 2) SHOULD NOT be summed up and taken as achieved by a single candidate. Each median and lower quartile score is calculated separately by subject."
                })

                # Flexible Admission Detection
                flex_map = {
                    "JS7123": "Chinese Language", "JS7133": "Chinese Language / Mathematics",
                    "JS7211": "Chinese Language", "JS7212": "Chinese Language", "JS7213": "Chinese Language",
                    "JS7214": "Chinese Language", "JS7215": "Chinese Language", "JS7216": "Chinese Language",
                    "JS7301": "Chinese Language", "JS7302": "Chinese Language", "JS7303": "Chinese Language",
                    "JS7307": "Chinese Language", "JS7503": "Chinese Language", "JS7606": "Chinese Language / Mathematics",
                    "JS7709": "Mathematics", "JS7905": "Chinese Language / Mathematics"
                }
                if code in flex_map:
                    obj["calculation_constraints"].append({
                        "type": "lingu_flexible_admission",
                        "subjects": flex_map[code],
                        "description": f"May be considered even with result in {flex_map[code]} one level below standard, provided they are competitive enough and in Band A."
                    })

                obj["min_requirements_2026"] = {
                    "chi": entry.get('min_chi'),
                    "eng": entry.get('min_eng'),
                    "math": entry.get('min_math'),
                    "csd": entry.get('min_csd'),
                    "elect1": build_generic_elective(entry.get('min_elect1'), entry.get('elect1_constraint')),
                    "elect2": build_generic_elective(entry.get('min_elect2'))
                }

            elif school_key == "EdUHK":
                obj["formula_2025"] = entry.get('formula')
                obj["formula_2026"] = entry.get('formula')
                
                sw2026 = entry.get('subject_weights', {})
                obj["subject_weights_2026"] = {normalize_subject(k): float(v) for k, v in sw2026.items()}
                obj["subject_weights_2026_raw"] = entry.get('subject_weights_raw')
                
                sw2025 = entry.get('subject_weights_2025')
                if sw2025 and isinstance(sw2025, dict):
                    obj["subject_weights_2025"] = {normalize_subject(k): float(v) for k, v in sw2025.items()}
                else:
                    obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                obj["subject_weights_2025_raw"] = entry.get('subject_weights_2025_raw') or entry.get('subject_weights_raw')

                obj["min_requirements_2026"] = {
                    "chi": entry.get('min_chi'),
                    "eng": entry.get('min_eng'),
                    "math": entry.get('min_math'),
                    "csd": entry.get('min_csd'),
                    "elect1": build_generic_elective(entry.get('min_elect1'), entry.get('elect1_constraint')),
                    "elect2": build_generic_elective(entry.get('min_elect2'))
                }
                
                # Guard against the EdUHK merged-cell bleed: a subject-specific
                # exemption note ("...HKDSE Visual Arts/Music will be exempted from
                # the practical test/audition") can land on an unrelated row — e.g.
                # JS8003 (a Chinese Language programme) inheriting the Visual Arts
                # practical-test note. Keep it only when the programme teaches that
                # subject; otherwise it's a row-bleed → drop.
                rp = entry.get('remarks_pdf') or ""
                _name_l = (obj.get("name_en") or "").lower()
                for _subj in ("Visual Arts", "Music"):
                    if re.search(re.escape(_subj) + r".*exempted", rp, re.I | re.S) and _subj.lower() not in _name_l:
                        rp = ""
                        break

                # Combine PDF remarks and admission notes for EdUHK
                remarks_list = [rp, entry.get('admission_notes')]
                # Filter out None/empty
                valid_remarks = [clean_raw_string(r) for r in remarks_list if r and r not in ["", "--", "-"]]
                if valid_remarks:
                    if obj["remarks"]:
                        obj["remarks"] += " | " + " | ".join(valid_remarks)
                    else:
                        obj["remarks"] = " | ".join(valid_remarks)
            
            elif school_key in ["HKMU", "SSSDP"]:
                obj["formula_2025"] = entry.get('formula')
                obj["formula_2026"] = entry.get('formula')
                
                sw2026 = entry.get('subject_weights', {})
                obj["subject_weights_2026"] = {normalize_subject(k): float(v) for k, v in sw2026.items()}
                obj["subject_weights_2026_raw"] = entry.get('subject_weights_raw')
                
                obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                obj["subject_weights_2025_raw"] = entry.get('subject_weights_raw')

                # Flexible Admission Constraint (HKMU / SSSDP HKMU programmes)
                is_hkmu = (school_key == "HKMU") or ("Metropolitan University" in str(entry.get('institution', '')))
                if is_hkmu and code not in ["JS9580", "JSSU40", "JSSU50", "JSSU55"]:
                    obj["calculation_constraints"].append({
                        "type": "hkmu_flexible_admission",
                        "description": "Applicants fail to achieve Level 3 in CHI/ENG may be considered if they have Level 2 in that subject + Level 5* in one other Cat A subject + Band A choice + Pass Interview."
                    })

                obj["min_requirements_2026"] = {
                    "chi": entry.get('min_chi'),
                    "eng": entry.get('min_eng'),
                    "math": entry.get('min_math'),
                    "csd": entry.get('min_csd'),
                    "elect1": build_generic_elective(entry.get('min_elect1')),
                    "elect2": build_generic_elective(entry.get('min_elect2'))
                }

            # 4. Standardize numeric scores
            if school_key == "CityU":
                obj["scores_2025"]["median"] = entry.get('median_score')
                obj["scores_2025"]["lq"] = entry.get('lower_score')
            elif school_key == "CUHK":
                obj["scores_2025"]["expected_score"] = entry.get('expected_score')
                obj["scores_2025"]["median"] = entry.get('score_median_2025')
                obj["scores_2025"]["lq"] = entry.get('score_lq_2025')
                obj["scores_2025"]["uq"] = entry.get('score_uq_2025')
            elif school_key == "HKU":
                obj["scores_2025"]["median"] = entry.get('score_median')
                obj["scores_2025"]["lq"] = entry.get('score_lq')
                obj["scores_2025"]["uq"] = entry.get('score_uq')
            elif school_key == "HKUST":
                obj["scores_2025"]["median"] = entry.get('score_median')
                obj["scores_2025"]["lq"] = entry.get('score_lq')
                obj["max_achievable_score"] = entry.get('score_ha')
                obj["scores_2025"]["expected_score"] = entry.get('expected_score')
            elif school_key == "PolyU":
                obj["scores_2025"]["mean"] = entry.get('score_avg')
                obj["scores_2025"]["median"] = entry.get('score_median')
                obj["scores_2025"]["lq"] = entry.get('score_lq')
            else:
                obj["scores_2025"]["median"] = entry.get('score_median')
                obj["scores_2025"]["lq"] = entry.get('score_lq')
                obj["scores_2025"]["mean"] = entry.get('score_mean')

            for k in obj["scores_2025"]:
                val = obj["scores_2025"][k]
                if val in ["", "-", None, "N/A"]: obj["scores_2025"][k] = None
                else:
                    try: obj["scores_2025"][k] = float(str(val).replace(",", ""))
                    except: obj["scores_2025"][k] = None
            
            # Standardize max_achievable_score
            val = obj["max_achievable_score"]
            if val in ["", "-", None, "N/A"]: obj["max_achievable_score"] = None
            else:
                try: obj["max_achievable_score"] = float(str(val).replace(",", ""))
                except: obj["max_achievable_score"] = None
            
            # Final ID generation and global logic extraction. Pass institution
            # so additive HKU/CityU formulas get the right per-year count.
            logic_25 = extract_logic_from_formula(obj["formula_2025"], obj.get("institution"))
            logic_26 = extract_logic_from_formula(obj["formula_2026"], obj.get("institution"))

            def _formula_id(n):
                return f"best{n}" if n in (4, 5, 6, 7) else "custom"
            obj["formula_2025_id"] = _formula_id(logic_25["best_n"])
            obj["formula_2026_id"] = _formula_id(logic_26["best_n"])
            
            # Merge extracted compulsory subjects into constraints.
            # Prefer the 2025 formula (per the Year Labeling Rule the score uses
            # 2025 logic), but fall back to the 2026 formula's compulsory cores
            # when the 2025 formula is absent — i.e. a programme new for 2026 with
            # no 2025 history (e.g. HKU JS6200, formula_2025 '–'). Otherwise its
            # cores would never be forced into the Best-N selection.
            merged_compulsory = logic_25["compulsory"] or logic_26["compulsory"]
            if merged_compulsory:
                existing_comp = next((c for c in obj["calculation_constraints"] if c["type"] == "compulsory_subjects"), None)
                if existing_comp:
                    existing_comp["subjects"] = sorted(set(existing_comp["subjects"] + merged_compulsory))
                else:
                    obj["calculation_constraints"].append({
                        "type": "compulsory_subjects",
                        "subjects": merged_compulsory,
                        "description": f"Formula requires: {', '.join(merged_compulsory)}"
                    })
            
            # Merge extracted dynamic pools (CUHK style)
            for pool in logic_25["best_of"]:
                obj["best_of_weights_2025"].append(pool)
                # Sync to 2026 if not already overwritten
                if not obj["best_of_weights_2026"]:
                    obj["best_of_weights_2026"] = obj["best_of_weights_2025"].copy()
            
            # Merge extracted compulsory pools (CUHK style)
            for pool in logic_25.get("compulsory_pools", []):
                obj["calculation_constraints"].append({
                    "type": "compulsory_subject_pool",
                    "count": pool["count"],
                    "subjects": pool["subjects"],
                    "description": pool["description"]
                })
            
            # Merge extracted bonuses
            for b in logic_25["bonus"]:
                if b["type"] not in [x["type"] for x in obj["calculation_constraints"]]:
                    obj["calculation_constraints"].append(b)

            if obj["remarks"] and obj["remarks"] not in ["", "--", "-"]:
                if "conditional_remarks" not in obj["min_requirements_2026"]:
                    obj["min_requirements_2026"]["conditional_remarks"] = obj["remarks"]
            
            # Final global string sweep for cleanliness
            obj["formula_2025"] = clean_formula_display(clean_raw_string(obj["formula_2025"]), obj.get("institution"))
            obj["formula_2026"] = clean_formula_display(clean_raw_string(obj["formula_2026"]), obj.get("institution"))
            
            # If raw strings are missing, build them from the dicts for auditability
            if not obj["subject_weights_2026_raw"] and obj["subject_weights_2026"]:
                obj["subject_weights_2026_raw"] = ", ".join([f"{k} (x{v})" for k, v in obj["subject_weights_2026"].items()])
            
            if not obj["subject_weights_2025_raw"] and obj["subject_weights_2025"]:
                obj["subject_weights_2025_raw"] = ", ".join([f"{k} (x{v})" for k, v in obj["subject_weights_2025"].items()])

            obj["subject_weights_2025_raw"] = clean_raw_string(obj["subject_weights_2025_raw"])
            obj["subject_weights_2026_raw"] = clean_raw_string(obj["subject_weights_2026_raw"])
            obj["remarks"] = clean_raw_string(obj["remarks"])
            
            if "conditional_remarks" in obj["min_requirements_2026"]:
                obj["min_requirements_2026"]["conditional_remarks"] = clean_raw_string(obj["min_requirements_2026"]["conditional_remarks"])

            # Assign conversion table
            is_med = (code in ["JS4501", "JS4502"])
            obj["score_conversion_table"] = get_conversion_table(obj["institution"], is_medicine=is_med)

            if school_key == "HKBU":
                conversion_table = obj["score_conversion_table"]["category_a"]
                median_estimate = estimate_hkbu_score_from_grades(
                    obj["score_grades_2025"].get("median"),
                    obj["subject_weights_2025"],
                    conversion_table
                )
                lq_estimate = estimate_hkbu_score_from_grades(
                    obj["score_grades_2025"].get("lq"),
                    obj["subject_weights_2025"],
                    conversion_table
                )
                if median_estimate is not None:
                    obj["scores_2025"]["median"] = median_estimate
                    obj["scores_2025"]["score_type"] = "estimated"
                if lq_estimate is not None:
                    obj["scores_2025"]["lq"] = lq_estimate
                    obj["scores_2025"]["score_type"] = "estimated"
                # Manual LQ correction for JS2660: the estimator hands the
                # Health Management & Social Care (HSMC) x1.1 weight to the
                # highest-graded elective (the Lv5 slot), but for this programme
                # HSMC is the Lv4 elective in the published LQ grade profile, so
                # the weighted best-5 total is 25.4, not 25.5. The breakdowns
                # don't name subjects, so this can't be inferred automatically —
                # verified by hand. (The median is unaffected: both its electives
                # are grade 4, so where the x1.1 lands makes no difference.)
                if code == "JS2660" and obj["scores_2025"].get("lq") is not None:
                    obj["scores_2025"]["lq"] = 25.4

            obj = apply_baselines(obj)
            obj["offer_statistics"] = offer_stats_map.get(code, [])
            # Backfill quota from offer_statistics if not set at top level
            if obj.get("quota") in (None, "", 0):
                for row in obj["offer_statistics"]:
                    q = row.get("Quota")
                    if isinstance(q, (int, float)) and q > 0:
                        obj["quota"] = int(q)
                        break

            # Normalise a verbose per-school quota string to its leading
            # integer (e.g. PolyU's "115 (JUPAS and Non-JUPAS)" -> 115). The
            # institutional source is authoritative for quota, so we keep
            # this and do NOT overwrite it with the JUPAS-detail number,
            # which has had artefacts (a spurious leading "1" on PolyU
            # quotas, e.g. 115 -> 1115).
            if isinstance(obj.get("quota"), str):
                m = re.match(r"\s*(\d[\d,]*)", obj["quota"])
                obj["quota"] = int(m.group(1).replace(",", "")) if m else None

            # JUPAS-site baseline fallback layer (fills gaps the per-school feed
            # lacks; also records joint-admission shared quotas). The raw_text
            # requirements dump is stripped inside the helper.
            apply_jupas_detail(obj, jupas_detail_map.get(code))
            unified_map[code] = obj

    # 4a2. Auto-include any JUPAS-listed programme not covered by a per-school
    # feed, so a programme on the public JUPAS listing is NEVER silently dropped
    # (new programmes routinely appear there before — or without — institutional
    # data; the 2026 SSSDP additions JSSC02/JSSU55/JSSU66 were exactly this).
    # They get universal-baseline requirements + a Best-5 estimate; admission
    # scores stay null, so the app shows them as a "new programme" with no
    # benchmark until institutional data arrives.
    auto_added = []
    for code, jd in jupas_detail_map.items():
        if code in unified_map:
            continue
        ov = overview_map.get(code, {})
        institution = ov.get("institution") or jd.get("institution") or (jd.get("institution_key") or "").upper()
        obj = {
            "jupas_code": code,
            "name_en": ov.get("name_en") or jd.get("name_en"),
            "name_zh": ov.get("name_zh") or jd.get("name_zh"),
            "institution": institution,
            "faculty": None,
            "formula_2025": "Best 5", "formula_2025_id": "best5",
            "formula_2026": "Best 5", "formula_2026_id": "best5",
            "subject_weights_2025": {}, "subject_weights_2026": {},
            "best_of_weights_2025": [], "best_of_weights_2026": [],
            "subject_weights_2025_raw": None, "subject_weights_2026_raw": None,
            "min_requirements_2026": {},
            "calculation_constraints": [],
            "score_conversion_table": get_conversion_table(institution),
            "max_achievable_score": None,
            "scores_2025": {"median": None, "lq": None, "uq": None, "mean": None, "expected_score": None},
            "score_grades_2025": {"median": None, "lq": None},
            "offer_statistics": offer_stats_map.get(code, []),
            "quota": jd.get("quota"),
            "remarks": "",
            "auto_included": True,
        }
        apply_jupas_detail(obj, jd)
        apply_baselines(obj)
        if obj.get("quota") in (None, "", 0):
            for row in obj["offer_statistics"]:
                q = row.get("Quota")
                if isinstance(q, (int, float)) and q > 0:
                    obj["quota"] = int(q)
                    break
        unified_map[code] = obj
        auto_added.append(code)
    if auto_added:
        print(f"Auto-included {len(auto_added)} JUPAS-listed programme(s) absent from per-school feeds: {', '.join(sorted(auto_added))}")

    # 4b. Canonicalize subject_weights keys. The calculator weights a subject by
    # exact key match against the student's canonical subject, so an un-normalized
    # key (e.g. "Business, Accounting and Financial Studies (Accounting)",
    # "Goethe-Certificate") would silently never apply. Collapsing aliases to
    # canonical is lossless here (the strand keys always carry equal weights).
    # ApL / unmodeled keys have no alias and are left untouched.
    for _obj in unified_map.values():
        for _yr in ("2025", "2026"):
            _w = _obj.get(f"subject_weights_{_yr}")
            if not isinstance(_w, dict):
                continue
            _new = {}
            for _k, _v in _w.items():
                _ck = canon_elective_subject(_k)
                if _ck in CANONICAL_SUBJECTS or _ck in SUBJECT_TOKENS:
                    _new.setdefault(_ck, _v)
                    continue
                _low = _ck.strip().lower()
                # Bare "Combined Science" weight → apply to each specific combo so it
                # matches whichever combo the student actually took.
                if _low == "combined science":
                    for _combo in SUBJECT_EXPANSIONS.get("Combined Science", []):
                        _new.setdefault(_combo, _v)
                    continue
                # Catch-all multiplier ("Other Subjects") can't be a subject key — drop.
                if _low in ("other subjects", "other elective subjects"):
                    continue
                # Formula fragment that names a best-of choice ("the best one subject of
                # A or B", "A or B", "A / B") → route to a best_of_weights pool, but
                # ONLY when every part canonicalises (else leave the key untouched).
                _frag = re.sub(r'(?i)^the best (?:one|two|three|\d+) subjects? of\s+', '', _ck).strip()
                # Split on " or " / spaced " / " only — an UNspaced "/" is inside a
                # subject name (e.g. "BAFS (Accounting/ Business Management)").
                _parts = [canon_elective_subject(p.strip()) for p in re.split(r'\s+or\s+|\s+/\s+', _frag) if p.strip()]
                if _parts and all(p in CANONICAL_SUBJECTS for p in _parts):
                    _bo = _obj.setdefault(f"best_of_weights_{_yr}", [])
                    if not any(sorted(p.get("subjects", [])) == sorted(_parts) and p.get("weight") == float(_v) for p in _bo):
                        _bo.append({"count": 1, "subjects": _parts, "weight": float(_v)})
                    continue
                # ApL / genuinely unmodeled subject — leave as-is (backlog).
                _new.setdefault(_ck, _v)
            _obj[f"subject_weights_{_yr}"] = _new

    # 4b-i½. VLM-verified CUHK weight/score corrections. CUHK's coded API `weight`
    # feed is sometimes STALE relative to the official booklet (e.g. JS4903 still
    # returns English x2 for 2026 though the booklet removed it; JS4428's elective
    # pool dropped x1.5 -> x1.25), and a few programmes changed their scoring formula
    # for 2026 while CUHK published 2025 admission scores RECALCULATED with the new
    # formula (e.g. JS4725). The authoritative source is the "Useful Information for
    # JUPAS Applicants" booklet, transcribed via the VLM workflow — NOT the PDF text
    # parser or the API. See docs/manuals/VLM_WEIGHT_EXTRACTION.md. These per-programme
    # overrides are applied BEFORE year_changes so the "Weighting changed" pills reflect
    # the corrected 2026 weights.
    _corr_path = "Reference(2026)/CUHK/cuhk_weight_corrections.json"
    if os.path.exists(_corr_path):
        with open(_corr_path, encoding="utf-8") as _cf:
            _corrections = json.load(_cf)
        _corr_applied = 0
        for _code, _fix in _corrections.items():
            if _code.startswith("_"):
                continue
            _obj = unified_map.get(_code)
            if not _obj:
                print(f"  WARNING: correction for {_code} but no such programme in unified data")
                continue
            for _k, _v in _fix.items():
                if _k.startswith("_"):
                    continue
                if _k == "scores_2025" and isinstance(_v, dict):
                    _obj.setdefault("scores_2025", {}).update(_v)
                else:
                    _obj[_k] = _v
            _corr_applied += 1
        print(f"CUHK VLM corrections applied: {_corr_applied} programme(s)")

    # 4a3. SSSDP admission scores the af_2025_SSSDP.pdf publishes in per-institution
    # table formats the bulk extractor missed (Chu Hai College's Upper/Lower Quarter
    # grade table; HKMU's Median/Lower list). These programmes are auto-included
    # above (absent from the per-school feed) so their scores land null — inject
    # the published values here. JSSU66/JSSV14 are genuinely NEW 2026 programmes
    # (no 2025 score; JSSV14 is "Not Applicable" in the PDF), correctly left null.
    # Source: Reference(2026)/SSSDP/sssdp_score_corrections.json.
    _sssdp_sc_path = "Reference(2026)/SSSDP/sssdp_score_corrections.json"
    if os.path.exists(_sssdp_sc_path):
        with open(_sssdp_sc_path, encoding="utf-8") as _ssf:
            _sssdp_sc = json.load(_ssf)
        _sssdp_n = 0
        for _code, _sc in _sssdp_sc.items():
            if _code.startswith("_"):
                continue
            _obj = unified_map.get(_code)
            if not _obj:
                print(f"  WARNING: SSSDP score correction for {_code} but no such programme")
                continue
            _obj.setdefault("scores_2025", {}).update({_k: float(_v) for _k, _v in _sc.items()})
            _sssdp_n += 1
        print(f"SSSDP score corrections applied: {_sssdp_n} programme(s)")

    # 4a4. SSSDP programme-specific entrance requirements. Our per-school SSSDP
    # feed carries no requirement data, so SSSDP requirements come from the
    # universal baseline — which misses the few programmes with a specific
    # elective-subject pool (and one core-level difference). These are transcribed
    # from the JUPAS per-programme pages already scraped into
    # jupas_requirements.programme_electives; a full 57-programme comparison found
    # only these to differ. Source: Reference(2026)/SSSDP/sssdp_requirement_corrections.json.
    _sssdp_req_path = "Reference(2026)/SSSDP/sssdp_requirement_corrections.json"
    if os.path.exists(_sssdp_req_path):
        with open(_sssdp_req_path, encoding="utf-8") as _srf:
            _sssdp_req = json.load(_srf)
        _sssdp_req_n = 0
        for _code, _fix in _sssdp_req.items():
            if _code.startswith("_"):
                continue
            _obj = unified_map.get(_code)
            if not _obj:
                print(f"  WARNING: SSSDP requirement correction for {_code} but no such programme")
                continue
            _mr = _obj.setdefault("min_requirements_2026", {})
            for _k, _v in _fix.items():
                if _k in ("chi", "eng", "math", "csd"):
                    _mr[_k] = _v
                elif _k == "elect1":
                    _mr["elect1"] = {
                        "count": _v.get("count", 1),
                        "subjects": [normalize_subject(_s) for _s in _v["subjects"]],
                        "grade": str(_v["grade"]),
                        "note": "",
                    }
                elif _k == "formula" and _v == "3C1X":
                    # 3-core + best-1-elective (Best 4), CSD not scored. SSSDP's
                    # universal baseline defaults every programme to Best-5; only
                    # JSSC02 is Best-4. parseFormulaCount ignores SSSDP, so the
                    # count is driven by formula_id=best4; compulsory Chi/Eng/Math
                    # force the three cores (CSD "Attained"=0 never enters best-4).
                    for _yr in ("2025", "2026"):
                        _obj[f"formula_{_yr}"] = "Chinese + English + Mathematics + Best 1 Elective"
                        _obj[f"formula_{_yr}_id"] = "best4"
                    _core = {"type": "compulsory_subjects",
                             "subjects": ["Chinese Language", "English Language", "Mathematics (Compulsory Part)"],
                             "description": "3 core subjects + best 1 elective (Best 4); CSD not scored"}
                    _cc = _obj.setdefault("calculation_constraints", [])
                    if _core not in _cc:
                        _cc.append(_core)
            _sssdp_req_n += 1
        print(f"SSSDP requirement corrections applied: {_sssdp_req_n} programme(s)")

    # 4b-i-hku. HKU footnote WEIGHTING-n pools. The HKU formula-text scrape
    # references "with WEIGHTING n" but does NOT carry the pool composition (it
    # lives in a separate PDF footnote box), so parse_hku_formula_weights leaves
    # best_of empty / weights incomplete for JS6224 (W7), JS6999 (W8), JS6602
    # (W10). These pools were VLM-read from the 2025 subject-weightings booklet
    # and are supplied via hku_weight_corrections.json. Runs before year-changes.
    def _apply_weight_corrections(_path, _label):
        """Apply a per-programme weight-corrections JSON (VLM-verified) onto the
        unified map. Supports, per programme entry: subject_weights_2025/2026
        (replace; keys canonicalized), best_of_weights_2025/2026 (replace; an
        optional `slot` tag marks pools that compete for ONE positional slot —
        see the calculator's pool-claiming logic), subject_weights_2025_raw/
        2026_raw (replace), and add_calculation_constraints (append if absent)."""
        if not os.path.exists(_path):
            return
        with open(_path, encoding="utf-8") as _cfh:
            _corr = json.load(_cfh)
        _n = 0
        for _code, _fix in _corr.items():
            if _code.startswith("_"):
                continue
            _obj = unified_map.get(_code)
            if not _obj:
                print(f"  WARNING: {_label} correction for {_code} but no such programme")
                continue
            for _yr in ("2025", "2026"):
                if f"subject_weights_{_yr}" in _fix:
                    _obj[f"subject_weights_{_yr}"] = {normalize_subject(k): float(v)
                                                      for k, v in _fix[f"subject_weights_{_yr}"].items()}
                if f"best_of_weights_{_yr}" in _fix:
                    _obj[f"best_of_weights_{_yr}"] = [
                        {"count": p["count"], "weight": float(p["weight"]),
                         "subjects": [normalize_subject(s) for s in p["subjects"]],
                         **({"slot": p["slot"]} if "slot" in p else {})}
                        for p in _fix[f"best_of_weights_{_yr}"]
                    ]
                if f"subject_weights_{_yr}_raw" in _fix:
                    _obj[f"subject_weights_{_yr}_raw"] = _fix[f"subject_weights_{_yr}_raw"]
            for _con in _fix.get("add_calculation_constraints", []):
                _cc = dict(_con)
                if "subjects" in _cc:
                    _cc["subjects"] = [normalize_subject(s) for s in _cc["subjects"]]
                if _cc not in _obj["calculation_constraints"]:
                    _obj["calculation_constraints"].append(_cc)
            _n += 1
        print(f"{_label} weight corrections applied: {_n} programme(s)")

    _apply_weight_corrections("Reference(2026)/HKU/hku_weight_corrections.json", "HKU")

    # 4b-i-cityu. CityU positional elective weightings. The School of Energy &
    # Environment programmes (JS1050/1051/1052/1053) weight electives BY
    # POSITION — "x2.5 Biology/Chemistry/Physics in 1st Elective", "x1.5 (list)
    # in 2nd Elective", and JS1053 adds "x2.5 Economics/BAFS in 2nd Elective" —
    # but both the 2026 scrape and the 2025 VLM transcription flattened the
    # positional qualifiers into per-subject weights, wrongly weighting a 3rd+
    # elective (user-reported, JS1050). The corrections encode the official
    # cells as ordered, slot-tagged best_of pools; the scheme and values are
    # identical in the 2025 and 2026 PDFs, so both years get the same model
    # (which also keeps year_changes quiet for these programmes).
    _apply_weight_corrections("Reference(2026)/CityU/cityu_positional_weights.json", "CityU positional")

    # 4b-i-hkbu. HKBU updated 2026 weightings. HKBU re-issued its GER/PER PDF
    # (Sep-2025 edition; the May edition is archived as
    # 2026-GER-PERs.superseded-2026-07.pdf) with changed weighting cells for
    # JS2660 / JS2940 / JS2960. HKBU confirmed by phone that the PDF overrides
    # its own online Score Calculator. Applied BEFORE year_changes so the
    # "Weighting changed" pills reflect the corrected 2026 weights.
    _apply_weight_corrections("Reference(2026)/HKBU/hkbu_weight_corrections.json", "HKBU")

    # 4b-i-restructure. Restructured-programme disclosure. A programme that
    # replaces a discontinued one carries its predecessor's admission score as a
    # proxy (it has no history of its own yet). Flag it so the DetailPanel says
    # the benchmark shown is borrowed from the predecessor. PolyU JS3243
    # (Language Science and Technology, "subject to approval") restructures the
    # retired JS3241 and reuses its 2025 lq/mean.
    _restructured = {"JS3243": "JS3241"}
    for _code, _from in _restructured.items():
        _obj = unified_map.get(_code)
        if _obj and (_obj.get("scores_2025") or {}).get("mean") is not None:
            _obj["score_basis"] = "restructured"
            _obj["restructured_from"] = _from
            print(f"Restructured-programme flag: {_code} <- {_from}")

    # 4b-i-or. OR-alternative entrance requirements. A few JUPAS programmes list
    # their requirements as more than one acceptable pattern (an "OR"), encoded
    # on the listing as a conditional elective row (e.g. JS1202: "ANY 1 SUBJECT
    # for students who have attained Level 3 or above in MATHEMATICS COMPULSORY
    # PART"). The scrapers flatten this to a single pattern, so a student who
    # qualifies only via the alternative was wrongly rejected by checkEligibility.
    # Attach the alternative pattern(s); the app passes eligibility if the base OR
    # any alternative is satisfied. A full live sweep of all 422 JUPAS pages found
    # JS1202 to be the only such case. Source: data/raw/or_requirements_2026.json.
    _or_path = "data/raw/or_requirements_2026.json"
    if os.path.exists(_or_path):
        with open(_or_path, encoding="utf-8") as _f:
            _or_specs = json.load(_f)
        _or_n = 0
        for _code, _spec in _or_specs.items():
            if _code.startswith("_"):
                continue
            _obj = unified_map.get(_code)
            if _obj and _spec.get("alternatives"):
                _obj.setdefault("min_requirements_2026", {})["alternatives"] = _spec["alternatives"]
                _or_n += 1
        print(f"OR-alternative requirements applied: {_or_n} programme(s)")

    # 4b-i-retake. HKDSE retake / repeater penalty (CUHK + HKU). TWO different
    # models, kept per-programme so the web app + Excel both surface them:
    #   HKU  → 10% off the RETAKE SUBJECT only (per-subject), for EVERY programme;
    #          `consideration` says how previous/combined sittings are counted.
    #   CUHK → a band (5%-or-less / 6%-to-10%) off the WHOLE admission score, only
    #          for the listed programmes (rest: best-of-3-sittings, no penalty).
    # The CUHK bands are VLM-verified from the official table image (the PDF text
    # layer mis-tags the Wingdings ticks). Source: data/raw/retake_2026.json.
    _retake_path = "data/raw/retake_2026.json"
    if os.path.exists(_retake_path):
        with open(_retake_path, encoding="utf-8") as _f:
            _rt = json.load(_f)
        _cuhk_rt, _hku_rt = _rt.get("cuhk", {}), _rt.get("hku", {})
        _cuhk_progs, _hku_progs = _cuhk_rt.get("programmes", {}), _hku_rt.get("programmes", {})
        _rt_n = 0
        for _code, _obj in unified_map.items():
            if _code in _cuhk_progs:
                _obj["retake"] = {
                    "penalty": _cuhk_progs[_code],
                    "scope": "admission_score",     # % off the whole final score (全Cert)
                    "policy_en": _cuhk_rt.get("policy_en"),
                    "source": _cuhk_rt.get("source"),
                }
                _rt_n += 1
            elif _obj.get("institution") == "HKU":
                _r = {
                    "penalty": _hku_rt.get("penalty", "10%"),
                    "scope": "retake_subject",       # 10% off the repeated subject only
                    "policy_en": _hku_rt.get("policy_en"),
                    "source": _hku_rt.get("source"),
                }
                _cons = _hku_progs.get(_code)
                if _cons:
                    _r["consideration"] = _cons
                _obj["retake"] = _r
                _rt_n += 1
        print(f"Retake / repeater penalty applied: {_rt_n} programme(s)")

    # 4b-i-hkust. HKUST School of Engineering moved to PER-DEPARTMENT weightings
    # for 2026 (2025 was UNIFORM across all Engineering: English x2 + Math x2 +
    # best science [Bio/Chem/Physics] x2 + ICT x1 + best-2-other with M1/2 x1.5).
    # The HKUST block above copies the 2026 weights onto the 2025 slots ("formula
    # stable across cycles"), which is now false and hides the change from the
    # year_changes diff below. Restore the true 2025 uniform weighting — it equals
    # JS5270's 2026 (the one department that did NOT change) — so the 7 departments
    # that moved get flagged. Scoring is unaffected: HKUST scores via
    # hkust_formula_steps (always the 2026 formula), never subject_weights.
    _HKUST_ENG_2025_SW = {
        "English Language": 2.0, "Mathematics (Compulsory Part)": 2.0,
        "Information and Communication Technology": 1.0,
        "Mathematics Extended Part (Module 2)": 1.5,
        "Mathematics Extended Part (Module 1)": 1.5,
    }
    _HKUST_ENG_2025_BO = [{"count": 1, "subjects": ["Biology", "Chemistry", "Physics"], "weight": 2.0}]
    _hkust_eng = 0
    for _obj in unified_map.values():
        if _obj.get("institution") == "HKUST" and _obj.get("faculty") == "School of Engineering":
            _obj["subject_weights_2025"] = json.loads(json.dumps(_HKUST_ENG_2025_SW))
            _obj["best_of_weights_2025"] = json.loads(json.dumps(_HKUST_ENG_2025_BO))
            _obj["subject_weights_2025_official"] = json.loads(json.dumps(_HKUST_ENG_2025_SW))
            _obj["best_of_weights_2025_official"] = json.loads(json.dumps(_HKUST_ENG_2025_BO))
            _hkust_eng += 1
    print(f"HKUST Engineering 2025 uniform weighting restored: {_hkust_eng} programme(s)")

    # 4b-ii. Year-over-year change detection. Runs AFTER weight canonicalization so
    # the diff is over canonical subject keys. Attaches a compact `year_changes`
    # summary only when a real (noise-filtered) weighting/formula change exists;
    # surfaced as header pills + a "what changed" panel in the DetailPanel.
    _yc_count = 0
    for _obj in unified_map.values():
        yc = compute_year_changes(_obj)
        if yc:
            _obj["year_changes"] = yc
            _yc_count += 1
    print(f"Year-over-year changes flagged: {_yc_count} programme(s)")

    # 4b-iii. CityU score-basis alignment: SCORE CityU on the 2026 weights.
    # CityU's published admission scores are RECALCULATED under the CURRENT
    # cycle's formula — the 2026 "Admission Score Formula and Admissions Scores"
    # PDF header reads "calculated based on the 2026 programme-specific main
    # admission score formula and the HKDSE results of the JUPAS applicants with
    # Main Round offers in 2025 entry" (the 2025 PDF says the same, one year
    # shifted). Contrast proof: JS1216 is 35/33.5 in the 2025 PDF (weighted 2025
    # formula) but 20/18 in the 2026 PDF (2026 dropped its weightings) — same
    # programme, adjacent cohorts. Our scores_2025 benchmarks come from the 2026
    # PDF, so the student score must use the 2026 weights or the comparison is
    # invalid (user-reported: JS1071/72/74 scored English x2 against a published
    # x1.5 basis; JS1216 scored weighted against an unweighted 20/18). The true
    # 2025 weightings (cityu_2025_weights_vlm.json) still feed the year_changes
    # diff ABOVE — they are overwritten here, after the diff, for scoring only.
    # Programmes whose weights actually differ get a score_basis flag so the
    # DetailPanel discloses the basis (mirrors CUHK's cuhk_2026_recalculated).
    _cityu_realigned = 0
    for _obj in unified_map.values():
        if _obj.get("institution") != "CityUHK":
            continue
        _same = (_obj.get("subject_weights_2025") == _obj.get("subject_weights_2026")
                 and _obj.get("best_of_weights_2025") == _obj.get("best_of_weights_2026"))
        if not _same:
            _obj["score_basis"] = "cityu_2026_recalculated"
            # Keep the TRUE 2025 weighting as displayable FACTS. The scoring
            # fields below become the 2026 basis, but the DetailPanel must not
            # present those as "2025" — it shows these official values instead
            # (user-reported: the 2025 box contradicted the change pill).
            _obj["subject_weights_2025_official"] = json.loads(json.dumps(_obj.get("subject_weights_2025") or {}))
            _obj["best_of_weights_2025_official"] = json.loads(json.dumps(_obj.get("best_of_weights_2025") or []))
            _obj["subject_weights_2025_official_raw"] = _obj.get("subject_weights_2025_raw")
            _cityu_realigned += 1
        _obj["subject_weights_2025"] = json.loads(json.dumps(_obj.get("subject_weights_2026") or {}))
        _obj["best_of_weights_2025"] = json.loads(json.dumps(_obj.get("best_of_weights_2026") or []))
        _obj["subject_weights_2025_raw"] = _obj.get("subject_weights_2026_raw")
        # Formula text/id follow the same basis. Identical across years for all
        # 58 CityU programmes today — mirrored so a future cycle where CityU
        # changes the text keeps scoring and slot counts on the published basis.
        _obj["formula_2025"] = _obj.get("formula_2026")
        _obj["formula_2025_id"] = _obj.get("formula_2026_id")
    print(f"CityU 2026-basis alignment: 2025 scoring fields mirrored from 2026; {_cityu_realigned} programme(s) flagged cityu_2026_recalculated")

    # 4b-i-eduhk. EdUHK 2026-basis realignment. For the handful of EdUHK
    # programmes whose subject weighting changed for 2026, EdUHK's af_2025 PDF
    # publishes the 2025 admission scores RECALCULATED with the 2026 weightings
    # ("Reference scores with 2026 entry weightings" in the Remarks column) —
    # exactly the CUHK JS4725 / CityU pattern. Mirror those programmes' 2025
    # scoring fields onto the 2026 weights and swap in the recalculated LQ/median
    # benchmark, so a 2026-formula-scored student compares on the same basis. The
    # true 2025 weights already fed the year_changes diff ABOVE; overwritten here
    # for scoring only, with the official 2025 values preserved for display.
    # Source: Reference(2026)/EdUHK/eduhk_weight_corrections.json.
    _eduhk_recalc_path = "Reference(2026)/EdUHK/eduhk_weight_corrections.json"
    _eduhk_apl_disp = {}
    if os.path.exists("Reference(2026)/EdUHK/eduhk_apl_weights.json"):
        with open("Reference(2026)/EdUHK/eduhk_apl_weights.json", encoding="utf-8") as _adf:
            _eduhk_apl_disp = json.load(_adf)
    _eduhk_realigned = 0
    if os.path.exists(_eduhk_recalc_path):
        with open(_eduhk_recalc_path, encoding="utf-8") as _ef:
            _eduhk_recalc = json.load(_ef)
        for _code, _sc in _eduhk_recalc.items():
            if _code.startswith("_"):
                continue
            _obj = unified_map.get(_code)
            if not _obj:
                print(f"  WARNING: EdUHK recalc for {_code} but no such programme")
                continue
            _obj["score_basis"] = "eduhk_2026_recalculated"
            _obj["subject_weights_2025_official"] = json.loads(json.dumps(_obj.get("subject_weights_2025") or {}))
            # Expand the display-only "Specified ApL subject(s)" placeholder in the
            # 2025-official snapshot into the real ApL subjects (the scoring maps
            # already expand it; the pre-mirror 2025 snapshot kept the raw
            # placeholder, which rendered literally in the "official 2025" note).
            _off = _obj["subject_weights_2025_official"]
            _ph_keys = [_k for _k in _off if "Specified ApL" in _k]
            if _ph_keys:
                _apl_subs = [canon_apl(_nm) for _nm in (_eduhk_apl_disp.get(_code) or {}).get("apl_weighted_1_5", [])]
                _apl_subs = [_s for _s in _apl_subs if _s]
                for _pk in _ph_keys:
                    _wv = _off.pop(_pk)
                    for _s in _apl_subs:
                        _off[_s] = _wv
            _obj["best_of_weights_2025_official"] = json.loads(json.dumps(_obj.get("best_of_weights_2025") or []))
            _obj["subject_weights_2025_official_raw"] = _obj.get("subject_weights_2025_raw")
            _obj["subject_weights_2025"] = json.loads(json.dumps(_obj.get("subject_weights_2026") or {}))
            _obj["best_of_weights_2025"] = json.loads(json.dumps(_obj.get("best_of_weights_2026") or []))
            _obj["subject_weights_2025_raw"] = _obj.get("subject_weights_2026_raw")
            _obj["formula_2025"] = _obj.get("formula_2026")
            _obj["formula_2025_id"] = _obj.get("formula_2026_id")
            _obj.setdefault("scores_2025", {}).update({"lq": _sc["lq"], "median": _sc["median"]})
            _eduhk_realigned += 1
    print(f"EdUHK 2026-basis alignment: {_eduhk_realigned} programme(s) flagged eduhk_2026_recalculated")

    # 4c. Merge non-academic admission requirements (interview arrangements)
    # scraped per-institution into each programme as an `interview` object.
    # Source: Reference(2026)/<School>/<school>_interview.json (see the runbook
    # docs/manuals/INTERVIEW_SCRAPING.md). Factual only — `timing` (pre/post/both)
    # + a human-readable `when` (+ HKUST's scored flag); salience is policy
    # applied in the frontend (staging/src/lib/selection.ts).
    interview_files = {
        "HKU": "Reference(2026)/HKU/hku_interview.json",
        "CUHK": "Reference(2026)/CUHK/cuhk_interview.json",
        "PolyU": "Reference(2026)/PolyU/polyu_interview.json",
        "EdUHK": "Reference(2026)/EdUHK/eduhk_interview.json",
        "HKBU": "Reference(2026)/HKBU/hkbu_interview.json",
        "LingU": "Reference(2026)/LingU/lingu_interview.json",
        "HKMU": "Reference(2026)/HKMU/hkmu_interview.json",
        "HKUST": "Reference(2026)/HKUST/hkust_interview.json",
        "CityU": "Reference(2026)/CityU/cityu_interview.json",
    }

    def _interview_when(rec):
        # Build a readable timing description from whichever fields the source used.
        parts = []
        before = (rec.get("before") or "").strip()
        after = (rec.get("after") or "").strip()
        if before and before.upper() not in ("-", "–", "N/A", "NA", "NIL"):
            parts.append(f"Before results: {before}")
        if after and after.upper() not in ("-", "–", "N/A", "NA", "NIL", "✓"):
            parts.append(f"After results: {after}")
        if not parts and rec.get("date"):
            parts.append(rec["date"].strip())
        return " · ".join(parts)

    # Mirror staging/src/lib/selection.ts salienceFromText so the same wording
    # ("required"/"must" → required; "optional"/"may be"/"if shortlisted" →
    # optional; otherwise weighty) yields the same salience server- and client-side.
    def _salience_of(sentence):
        if re.search(r"may be (?:required|invited|asked)|if (?:necessary|shortlisted|applicable)|optional|priority consideration|where applicable", sentence, re.I):
            return "optional"
        if re.search(r"\b(?:required|must|compulsory|mandatory|shall)\b", sentence, re.I):
            return "required"
        return "weighty"

    # Allow plurals — JUPAS remarks say "submit their portfolios" (JS2330),
    # "practical tests" (JS2810); a strict \bportfolio\b misses the plural.
    _EXTRA_PATTERNS = [
        (r"\bportfolios?\b", "portfolio"),
        (r"\bauditions?\b", "audition"),
        (r"practical tests?", "practical-test"),
        (r"aptitude tests?", "aptitude-test"),
    ]

    def _extra_requirements(rec):
        # Non-interview requirement TYPES stated in a scraped entry's free text
        # (e.g. PolyU's interview-page remarks: "Applicants must submit a portfolio
        # in June"; JUPAS "Remarks on other requirements"). Authoritative — beats
        # the name-based heuristic. Salience is read per-sentence so "Portfolio
        # submission is optional but is preferred" (JS2930) isn't mislabelled
        # required; strongest salience wins if a type spans sentences.
        blob = " ".join(str(rec.get(k) or "") for k in ("remarks", "date", "format"))
        rank = {"optional": 0, "weighty": 1, "required": 2}
        found = {}
        for sentence in re.split(r"[.;!?]\s+|\n+", blob):
            for pat, typ in _EXTRA_PATTERNS:
                if re.search(pat, sentence, re.I):
                    sal = _salience_of(sentence)
                    if typ not in found or rank[sal] > rank[found[typ]]:
                        found[typ] = sal
        return [{"type": t, "salience": s} for t, s in found.items()]

    interview_count = 0
    interview_covered = []  # institutions with an official per-programme source
    for _school, _path in interview_files.items():
        if not os.path.exists(_path):
            continue
        interview_covered.append(_school)
        with open(_path, encoding="utf-8") as f:
            _idata = json.load(f)
        for _code, _rec in (_idata.get("programmes") or {}).items():
            _obj = unified_map.get(_code)
            if not _obj:
                continue  # interview source lists a code not in the unified set
            # 1) the interview itself
            _iv = {"type": _rec.get("type", "interview"), "timing": _rec.get("timing")}
            _when = _interview_when(_rec)
            if _when:
                _iv["when"] = _when
            if _rec.get("before"):
                _iv["before"] = _rec["before"].strip()
            if _rec.get("after"):
                _iv["after"] = _rec["after"].strip()
            if _rec.get("date"):
                _iv["date"] = _rec["date"].strip()
            if _rec.get("format"):
                _iv["format"] = _rec["format"].strip()
            if _rec.get("salience"):
                _iv["salience"] = _rec["salience"]
            if _rec.get("scored"):
                _iv["scored"] = True
            # 2) any other requirement types named in the entry's free text
            _items = [_iv] + _extra_requirements(_rec)
            _obj["non_academic"] = _items
            interview_count += 1
    print(f"Merged interview arrangements: {interview_count} programmes across {len(interview_covered)} institutions ({', '.join(interview_covered)})")

    # 4d. Merge CityU per-programme requirements (portfolio/audition/test) scraped
    # from each programme page (cityu_requirements_scrap.py) — appended to the
    # programme's non_academic alongside its interview record.
    _cityu_req = "Reference(2026)/CityU/cityu_requirements.json"
    if os.path.exists(_cityu_req):
        with open(_cityu_req, encoding="utf-8") as f:
            _cdata = json.load(f)
        _cnt = 0
        for _code, _rec in (_cdata.get("programmes") or {}).items():
            _obj = unified_map.get(_code)
            if not _obj:
                continue
            _na = _obj.setdefault("non_academic", [])
            _have = {i.get("type") for i in _na}
            for _r in _rec.get("requirements", []):
                if _r.get("type") not in _have:
                    _na.append({k: v for k, v in _r.items() if k != "source"})
                    _cnt += 1
        print(f"Merged CityU per-programme requirements: {_cnt} item(s)")

    # 4e. Parse the JUPAS programme page's "Remarks on other requirements" section
    # into official non-academic requirements. This is JUPAS's own authoritative,
    # central statement of each programme's portfolio/audition/practical needs.
    # raw_text was popped from the per-programme copy in §4 above, but the source
    # record in jupas_detail_map still holds it. Interview is already covered by the
    # per-school scrape (§4c); here we only add the non-interview types via the
    # shared parser. Because JUPAS states these authoritatively, the frontend can
    # treat such institutions as OFFICIAL_FULL (absence ⇒ none) and drop name-based
    # heuristic guesses the official page contradicts (e.g. a "Physical Education"
    # programme whose page states no fitness test).
    _REMARK_RE = re.compile(r"Remarks on other requirements\s*:?(.*)", re.I | re.S)
    _REMARK_STOP = re.compile(r"\bCore Subjects\b|\bElective Subject", re.I)
    _remark_cnt = 0
    for _code, _obj in unified_map.items():
        _rt = ((jupas_detail_map.get(_code) or {}).get("requirements") or {}).get("raw_text") or ""
        _m = _REMARK_RE.search(_rt)
        if not _m:
            continue
        _seg = _REMARK_STOP.split(_m.group(1))[0].strip()
        if not _seg:
            continue
        _na = _obj.setdefault("non_academic", [])
        _have = {i.get("type") for i in _na}
        for _item in _extra_requirements({"remarks": _seg}):
            if _item["type"] not in _have:
                _na.append(_item)
                _have.add(_item["type"])
                _remark_cnt += 1
    print(f"Merged JUPAS 'other requirements' remarks: {_remark_cnt} item(s)")

    # 5. Export Unified Master File — minified to shrink wire size.
    final_unified = list(unified_map.values())

    apply_curated_overrides(final_unified)

    apply_apl_policy(final_unified)

    expand_m1m2_weights(final_unified)

    # 5-hkbu. HKBU score-basis alignment + benchmark re-simulation — ONLY for
    # programmes whose weighting was INTRODUCED for 2026 from none (empty 2025
    # weights, non-empty 2026: JS2340, JS2960 per the Sep-2025 GER/PER update).
    # There the whole score composition changes for every applicant and the
    # published mean is plainly unweighted, so we score on subject_weights_2026
    # and RE-ESTIMATE the median/LQ benchmarks from HKBU's published
    # (weight-independent) grade profiles under the same weights — the
    # cuhk_2026_simulated pattern. The published MEAN cannot be re-based (a
    # scalar computed under the old formula), so it moves to
    # mean_official_2025_basis: an unweighted mean next to weighted student
    # scores would read systematically low.
    #
    # Programmes whose existing weighting merely CHANGED for 2026 (JS2660 HMSC
    # x1.1->x1.3, JS2950 +CHI x1.25) deliberately KEEP the 2025 basis (the
    # Year-Labeling default): the benchmark delta (~+0.8/+1.0) is within the
    # profile estimator's own noise, student-vs-cohort shifts largely cancel,
    # and the published mean stays coherent — the year-change pill and the
    # "2026 applicant reference" panel disclose the new weighting. (JS2940's
    # 2026-only MAT2 x1.5 is handled as a curated 2025 evenness patch instead —
    # benchmark identical either way; see CURATED_PROGRAMME_RULES.)
    # Runs LAST among weight-touching steps — after curated overrides and
    # expand_m1m2_weights — and after year_changes, so the pills survive.
    _hkbu_simulated = 0
    for _obj in final_unified:
        if _obj.get("institution") != "HKBU":
            continue
        if _obj.get("subject_weights_2025") or not _obj.get("subject_weights_2026"):
            continue
        # Keep the TRUE 2025 state (no weighting) as displayable facts — same
        # convention as the CityU 4b-iii stash.
        _obj["subject_weights_2025_official"] = json.loads(json.dumps(_obj.get("subject_weights_2025") or {}))
        _obj["best_of_weights_2025_official"] = json.loads(json.dumps(_obj.get("best_of_weights_2025") or []))
        _obj["subject_weights_2025_official_raw"] = _obj.get("subject_weights_2025_raw")
        _obj["subject_weights_2025"] = json.loads(json.dumps(_obj.get("subject_weights_2026") or {}))
        _obj["best_of_weights_2025"] = json.loads(json.dumps(_obj.get("best_of_weights_2026") or []))
        _obj["subject_weights_2025_raw"] = _obj.get("subject_weights_2026_raw")
        _obj["score_basis"] = "hkbu_2026_simulated"
        _grades = _obj.get("score_grades_2025") or {}
        _conv = ((_obj.get("score_conversion_table") or {}).get("category_a")) or {}
        _sc = _obj.setdefault("scores_2025", {})
        _med = estimate_hkbu_score_from_grades(_grades.get("median"), _obj["subject_weights_2025"], _conv)
        _lq = estimate_hkbu_score_from_grades(_grades.get("lq"), _obj["subject_weights_2025"], _conv)
        if _med is not None:
            _sc["median"] = _med
        if _lq is not None:
            _sc["lq"] = _lq
        if _med is not None or _lq is not None:
            _sc["score_type"] = "estimated"
        if _sc.get("mean") is not None:
            _sc["mean_official_2025_basis"] = _sc.pop("mean")
        _hkbu_simulated += 1
    print(f"HKBU 2026-basis simulation (introduced-from-none only): {_hkbu_simulated} programme(s) (score_basis=hkbu_2026_simulated)")

    # 5a. Archive any programme present in the PREVIOUS build but gone now
    # (removed/restructured by JUPAS) so its data is never lost — a cumulative
    # archive (keyed by JS code, latest-known record) we can reference later.
    new_codes = {p.get("jupas_code") for p in final_unified}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, encoding="utf-8") as f:
                prev = json.load(f)
            removed = [p for p in prev if p.get("jupas_code") not in new_codes]
            if removed:
                archive = {}
                if os.path.exists(ARCHIVE_FILE):
                    with open(ARCHIVE_FILE, encoding="utf-8") as f:
                        archive = json.load(f)
                stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                for p in removed:
                    archive[p["jupas_code"]] = {"removed_detected": stamp, "record": p}
                os.makedirs(os.path.dirname(ARCHIVE_FILE), exist_ok=True)
                with open(ARCHIVE_FILE, "w", encoding="utf-8") as f:
                    json.dump(archive, f, ensure_ascii=False, indent=2)
                print(f"Archived {len(removed)} removed programme(s) → {ARCHIVE_FILE}: "
                      f"{', '.join(p['jupas_code'] for p in removed)}")
        except Exception as e:  # noqa: BLE001
            print(f"Archive step skipped ({e})")

    # Decode any HTML entities that leaked in from scraping (e.g. JUPAS notes
    # carry &quot; / &amp; / &#39; …). Global recursive pass over every string so
    # nothing HTML-encoded ever reaches the UI/Excel/SEO. Runs last, right before
    # serialisation, so it catches all fields regardless of their source scraper.
    import html as _html
    def _unescape_all(obj):
        if isinstance(obj, str):
            out = _html.unescape(obj)
            return _html.unescape(out) if "&" in out else out  # double-encoded
        if isinstance(obj, list):
            return [_unescape_all(v) for v in obj]
        if isinstance(obj, dict):
            return {k: _unescape_all(v) for k, v in obj.items()}
        return obj
    final_unified = _unescape_all(final_unified)

    payload = json.dumps(final_unified, ensure_ascii=False, separators=(",", ":"))
    import re as _re_ent
    _leftover = len(_re_ent.findall(r"&(?:[a-zA-Z][a-zA-Z0-9]{1,10}|#[0-9]{1,6}|#x[0-9a-fA-F]{1,5});", payload))
    print(f"HTML-entity unescape pass: {_leftover} entity-like token(s) remain (URL '&' etc. are fine)")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(payload)
    # Sidecar version file — short content hash. The frontend fetches this
    # tiny file first and skips the full JSON re-download when the hash
    # matches the cached copy.
    import hashlib
    version_hash = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
    version_path = OUTPUT_FILE.replace(".json", ".version")
    with open(version_path, 'w', encoding='utf-8') as f:
        f.write(version_hash)
    print(f"Unified data for {len(final_unified)} programmes saved to {OUTPUT_FILE}")
    print(f"Version hash {version_hash} written to {version_path}")

if __name__ == "__main__":
    unify_data()
