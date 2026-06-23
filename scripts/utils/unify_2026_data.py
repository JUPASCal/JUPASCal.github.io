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

_ME = SUBJECTS_REGISTRY["math_extended"]
# Every legal canonical subject name (what may appear in an elective pool).
CANONICAL_SUBJECTS = set(
    SUBJECTS_REGISTRY["core"]
    + SUBJECTS_REGISTRY["category_a"]
    + SUBJECTS_REGISTRY["category_c"]
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

    # 3.5 Detect HKU Compulsory Cores in Formula
    if re.search(r'\bEng(?:lish)?\b', f, re.IGNORECASE):
        compulsory.append("English Language")
    if re.search(r'\bMaths?\b', f, re.IGNORECASE):
        compulsory.append("Mathematics (Compulsory Part)")
    if re.search(r'\bM1\b|\bM2\b', f, re.IGNORECASE):
        compulsory.append("Mathematics Extended Part (Module 1 or 2)")
    if re.search(r'\bChin(?:ese)?\b', f, re.IGNORECASE):
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

def build_hkbu_elective(grade, constraint):
    if not grade: return None
    subjs = ["Any"]
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
        "note": constraint or ""
    }

def build_generic_elective(grade, constraint=None):
    if not grade: return None
    return {
        "count": 1,
        "subjects": ["Any"],
        "grade": str(grade).strip("#"),
        "note": constraint or ""
    }

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
                obj["formula_2025"] = entry.get('subject_weights_2025', {}).get('subjects_included') or entry.get('score_formula')
                obj["formula_2026"] = entry.get('calc_mode_text') or entry.get('score_formula')
                
                sw2026 = entry.get('subject_weights', {})
                if isinstance(sw2026, str):
                    try:
                        w_list = json.loads(sw2026)
                        obj["subject_weights_2026"] = {normalize_subject(i['subject']): float(i['weight']) for i in w_list}
                    except: pass
                else:
                    obj["subject_weights_2026"] = {normalize_subject(k): float(v) for k, v in sw2026.items()}
                
                # CityU 2025 weights are effectively identical to 2026
                obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                
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
                
                # Use highly structured 2026 API weight strings for 2025 fallback where possible
                flat_weights, best_of_weights = parse_cuhk_weights(entry.get('weight'))
                obj["subject_weights_2026"] = flat_weights
                obj["best_of_weights_2026"] = best_of_weights
                obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()
                obj["best_of_weights_2025"] = obj["best_of_weights_2026"].copy()
                
                obj["subject_weights_2025_raw"] = req25.get('weight')
                obj["subject_weights_2026_raw"] = entry.get('weight_remarks')
                
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

                formula_text_2025 = entry.get('formula_text_2025')
                formula_text_2026 = js.get('otherSubjects_text') or entry.get('otherSubjects', '')
                obj["formula_2025"] = formula_text_2025 or formula_text_2026
                # `formula_text_2026` is only ever the "other subjects" fragment
                # (missing the English/Math prefix). HKUST formulas are stable
                # across cycles, so show the full 2025 text for 2026 too when
                # available — otherwise the 2026 display is an incomplete fragment.
                obj["formula_2026"] = formula_text_2025 or formula_text_2026

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

                # Store formula_steps as a reference field for future use
                obj["hkust_formula_steps"] = formula_steps

                # Constraints
                bonus_6th = js.get('bonus_6th', {})
                bonus_pct = bonus_6th.get('bonus_percentage', 5)
                bonus_cats = bonus_6th.get('eligible_categories',
                    (entry.get('extra_subject_bonus_category', '') or '').split(','))
                if isinstance(bonus_cats, str):
                    bonus_cats = [c.strip() for c in bonus_cats.split(',') if c.strip()]

                # max_attainable_weighting: sum of all multipliers in the optimal best-N selection.
                # For better-of programmes: explicit weights + 1 pool slot at pool_weight + remaining at 1.0
                subject_num = entry.get('subjectNum', 5)
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
                
                # Weights 2025
                sw2025 = entry.get('subject_weights_2025')
                if sw2025 and isinstance(sw2025, dict):
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
                    "elect1": build_hkbu_elective(entry.get('min_elect1'), entry.get('elect1_constraint')),
                    "elect2": build_hkbu_elective(entry.get('min_elect2'), None)
                }

            elif school_key == "LingU":
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
            
            # Merge extracted compulsory subjects into constraints
            if logic_25["compulsory"]:
                existing_comp = next((c for c in obj["calculation_constraints"] if c["type"] == "compulsory_subjects"), None)
                if existing_comp:
                    existing_comp["subjects"] = sorted(set(existing_comp["subjects"] + logic_25["compulsory"]))
                else:
                    obj["calculation_constraints"].append({
                        "type": "compulsory_subjects",
                        "subjects": logic_25["compulsory"],
                        "description": f"Formula requires: {', '.join(logic_25['compulsory'])}"
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
                # keep first-seen on collision (weights verified equal)
                _new.setdefault(_ck, _v)
            _obj[f"subject_weights_{_yr}"] = _new

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

    payload = json.dumps(final_unified, ensure_ascii=False, separators=(",", ":"))
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
