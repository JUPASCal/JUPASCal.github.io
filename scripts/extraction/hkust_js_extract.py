#!/usr/bin/env python3
"""
HKUST JavaScript Calculator Extractor
Reverse-engineers the HKUST official JS calculator to extract structured
weighting formulas for all 33 JUPAS programmes.

Source JS: https://join.hkust.edu.hk/sites/default/files/js/js_cip0CF33...
Run from project root:
    ~/miniconda3/envs/jupascal/bin/python scripts/extraction/hkust_js_extract.py
Output: Reference(2026)/HKUST/HKUST_2026_JS_Extracted.json
"""

import re, json, sys, os
from pathlib import Path
from html.parser import HTMLParser

try:
    import requests
except ImportError:
    requests = None

JS_URL = (
    "https://join.hkust.edu.hk/sites/default/files/js/js_cip0CF33Cau1_9BxIDS24XamfoIJWOKcye9jwKua2c8.js"
    "?scope=footer&delta=2&language=en&theme=usturao&include=eJx1UdFuwyAM_CEEn4Qc4hAagyNs2nRfP9Kt2dQ2L-"
    "fznTkkm-Dr7qiDaaKtAjvRO6USDTYfmJeEveSVEpSA7pNobjhMXLP7rXaHNxEJMxa1IyokEitwfX_5OqQcI52PZRSBiKZig"
    "FXDDo5g_7TI3EPsIXgsp4m8auIip750EtRcE97EPdDCBTYzoCpWj9vKgqOfEvVWXMSCFejMhqbspQ056bH-S1tBAlAwe-t1"
    "zu5JTGDiOvDmnuRPGXGCRmrmpQd5SbFAz0MPU_8sgaL7cTKkYgfisPj90Cjf8U3KEQ"
)

CACHE_PATH = Path("/tmp/hkust_calc.js")
OUTPUT_PATH = Path("Reference(2026)/HKUST/HKUST_2026_JS_Extracted.json")

# ─── Helpers ────────────────────────────────────────────────────────────────

class HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
    def handle_data(self, d):
        self.text.append(d)
    def get_text(self):
        return ''.join(self.text)

def strip_html(s):
    p = HTMLStripper()
    p.feed(s)
    return p.get_text().strip()

def js_to_json(s):
    """Convert JS object literal notation to valid JSON."""
    s = re.sub(r'(?<=[{,\[])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'"\1":', s)
    s = s.replace('!0', 'true').replace('!1', 'false')
    return s

def load_js(use_cache=True):
    if use_cache and CACHE_PATH.exists():
        print(f"Using cached JS: {CACHE_PATH}")
        return CACHE_PATH.read_text(encoding='utf-8')
    if requests is None:
        sys.exit("requests not installed. Run: pip install requests")
    print("Downloading HKUST JS...")
    resp = requests.get(JS_URL, timeout=30)
    resp.raise_for_status()
    content = resp.text
    CACHE_PATH.write_text(content, encoding='utf-8')
    print(f"Saved to {CACHE_PATH} ({len(content):,} chars)")
    return content

# ─── Extraction ─────────────────────────────────────────────────────────────

def extract_programmes_array(content):
    """Extract and parse the programmes:[{...}] array from the JS config."""
    idx = content.find('engMultiplier:')
    start = content.rfind('[{', 0, idx + 200)
    depth = 0
    for pos in range(start, len(content)):
        if content[pos] == '[': depth += 1
        elif content[pos] == ']':
            depth -= 1
            if depth == 0:
                raw = content[start:pos+1]
                break
    return json.loads(js_to_json(raw))

def extract_calc_section(content):
    """Extract the IIFE that contains all scoring strategy classes."""
    start = content.find('!function(){class e{setStrategy')
    end = content.find('(jQuery,Drupal,once)', start)
    return content[start:end]

def extract_code_to_class_map(calc):
    """Build {jupas_code: class_letter} mapping from CalcMech declarations."""
    idx = calc.find('CalcMechJS5101')
    section = calc[idx:idx+2000]
    mapping = {}
    for m in re.finditer(r'CalcMechJS(\d{4}):function\(\)\{return new ([a-zA-Z_])\(\)', section):
        mapping[f'JS{m.group(1)}'] = m.group(2)
    return mapping

def extract_class_body(calc, letter):
    """Extract the class body and parent class for a single-letter class."""
    for parent in ['t', 'r', 'o', 'a', 'd', 'S', 'M']:
        idx = calc.find(f'class {letter} extends {parent}')
        if idx == -1:
            continue
        brace_start = calc.find('{', idx)
        depth = 0
        for pos in range(brace_start, len(calc)):
            if calc[pos] == '{': depth += 1
            elif calc[pos] == '}':
                depth -= 1
                if depth == 0:
                    return calc[brace_start:pos+1], parent
    return None, None

def parse_required_picks(body):
    """Parse the initial .pick() calls for compulsory subjects (English, Math/Chinese)."""
    picks = []
    # Pattern handles: i=(c=this.pick(a,[...],[...],t)).bestRow
    for m in re.finditer(
        r'this\.pick\(a,(\[[^\]]*\]),(\[(?:[^\[\]]*|\[[^\]]*\])*\]),t\)',
        body
    ):
        raw_subj = m.group(1)
        raw_weights = m.group(2)

        try: subjects = json.loads(raw_subj)
        except: subjects = re.findall(r'"([^"]+)"', raw_subj)

        weights = []
        for wm in re.finditer(r'\{subjects:(\[[^\]]+\]),weight:([0-9.]+)\}', raw_weights):
            try: subs = json.loads(wm.group(1))
            except: subs = re.findall(r'"([^"]+)"', wm.group(1))
            weights.append({"subjects": subs, "weight": float(wm.group(2))})

        # Determine effective multiplier for this subject
        subject = subjects[0] if subjects else "Unknown"
        weight = weights[0]["weight"] if weights else 1.0
        picks.append({"subject": subject, "weight": weight})

    return picks

def parse_permutation_loops(body):
    """Parse all permutation loops — returns list of [case_list] (one per loop for better-of).

    "Better of" programmes (JS5312, JS5331, JS5332, JS5822) have ONE getPermutations call
    but TWO separate for-loops iterating over the results, each with its own switch block.
    We detect this by counting switch blocks inside the class body.
    """
    # Detect better-of: the return statement compares two different permutation results.
    # Standard: return {maxResult:h,...}  — one reduce
    # Better-of: return {maxResult:g.total>b.total?g:b,...}  — two separate reduces compared
    is_better_of = bool(re.search(r'maxResult:[a-zA-Z]\.total>[a-zA-Z]\.total\?', body))

    # Find all switch blocks in the body
    def extract_switch_blocks(text):
        blocks = []
        for sm in re.finditer(r'switch\(', text):
            brace = text.find('{', sm.start())
            depth = 0
            for p in range(brace, len(text)):
                if text[p] == '{': depth += 1
                elif text[p] == '}':
                    depth -= 1
                    if depth == 0:
                        blocks.append(text[brace:p+1])
                        break
        return blocks

    all_switch_blocks = extract_switch_blocks(body)
    # Only keep switch blocks that contain 'scoreItem' or 'scoreBonusItem'
    scoring_switches = [b for b in all_switch_blocks if 'scoreItem' in b or 'scoreBonusItem' in b]

    loops = []
    for switch_body in scoring_switches:
        cases = []
        for case_m in re.finditer(r'case (\d+):\{(.*?)break;', switch_body, re.DOTALL):
            case_num = int(case_m.group(1))
            case_body = case_m.group(2)

            if 'scoreBonusItem' in case_body:
                cats = re.search(r'scoreBonusItem\([^,]+,(\[[^\]]+\])', case_body)
                cats_list = []
                if cats:
                    try: cats_list = json.loads(cats.group(1))
                    except: cats_list = re.findall(r'"([^"]+)"', cats.group(1))
                cases.append({"slot": case_num, "type": "bonus_6th", "categories": cats_list})
                continue

            # Extract scoreItem args using brace-depth counting (subject names contain parens)
            si_idx = case_body.find('scoreItem(')
            if si_idx == -1:
                continue
            args_start = si_idx + len('scoreItem(')
            depth_p = 1
            args_end = args_start
            for ci in range(args_start, len(case_body)):
                if case_body[ci] == '(': depth_p += 1
                elif case_body[ci] == ')':
                    depth_p -= 1
                    if depth_p == 0:
                        args_end = ci
                        break
            args = case_body[args_start:args_end]
            arrays = re.findall(r'(\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\])', args)

            subj_filter, weights, categories = [], [], []
            if len(arrays) >= 1:
                try: subj_filter = json.loads(arrays[0])
                except: subj_filter = re.findall(r'"([^"]+)"', arrays[0])
            if len(arrays) >= 2:
                for wm in re.finditer(r'\{subjects:(\[[^\]]+\]),weight:([0-9.]+)\}', arrays[1]):
                    try: subs = json.loads(wm.group(1))
                    except: subs = re.findall(r'"([^"]+)"', wm.group(1))
                    weights.append({"subjects": subs, "weight": float(wm.group(2))})
            if len(arrays) >= 3:
                try: categories = json.loads(arrays[2])
                except: categories = re.findall(r'"([^"]+)"', arrays[2])

            cases.append({
                "slot": case_num,
                "type": "elective",
                "subject_filter": subj_filter,
                "weights": weights,
                "categories": categories
            })

        if cases:
            loops.append(cases)

    return loops, is_better_of

def extract_global_config(content):
    """Extract global calculator config (bonus_percentage, score tables, etc.)."""
    idx = content.find('bonus_percentage:')
    if idx == -1:
        return {}
    # Find enclosing init({...})
    init_idx = content.rfind('init({', 0, idx)
    brace_start = content.find('{', init_idx + 4)
    depth = 0
    for pos in range(brace_start, len(content)):
        if content[pos] == '{': depth += 1
        elif content[pos] == '}':
            depth -= 1
            if depth == 0:
                raw = content[brace_start:pos+1]
                break
    try:
        return json.loads(js_to_json(raw))
    except:
        # Just extract bonus_percentage
        m = re.search(r'bonus_percentage:(\d+)', raw)
        return {"bonus_percentage": int(m.group(1)) if m else 5}

def build_formula_steps(code, required_picks, perm_loops, is_better_of=False):
    """Convert parsed picks + loops into a clean formula_steps list."""
    steps = []
    # Required subjects first
    for rp in required_picks:
        steps.append({
            "type": "required",
            "subject": rp["subject"],
            "weight": rp["weight"]
        })

    if not perm_loops:
        return steps

    if not is_better_of:
        # Standard: single loop over elective permutations
        for case in perm_loops[0]:
            if case["type"] == "bonus_6th":
                steps.append({
                    "type": "bonus_6th",
                    "bonus_percentage": 5,
                    "eligible_categories": case["categories"]
                })
            else:
                steps.append({
                    "type": "best_from_pool",
                    "subject_filter": case["subject_filter"],
                    "weights": case["weights"],
                    "eligible_categories": case["categories"]
                })
    else:
        # Better-of: multiple loops, calculator picks the highest total
        options = []
        for loop in perm_loops:
            option_cases = []
            for case in loop:
                if case["type"] == "bonus_6th":
                    option_cases.append({
                        "type": "bonus_6th",
                        "bonus_percentage": 5,
                        "eligible_categories": case["categories"]
                    })
                else:
                    option_cases.append({
                        "type": "best_from_pool",
                        "subject_filter": case["subject_filter"],
                        "weights": case["weights"],
                        "eligible_categories": case["categories"]
                    })
            options.append(option_cases)

        steps.append({
            "type": "better_of",
            "options": options
        })

    return steps

def build_subject_weights(code, required_picks, perm_loops, prog_data):
    """
    Build a subject_weights dict compatible with our unifier schema.
    For required subjects: weight is the multiplier.
    For elective pools: weights for named subjects; default 1.0 for others.
    """
    weights = {}

    # Required subjects
    for rp in required_picks:
        subj = rp["subject"]
        weights[subj] = rp["weight"]

    # Elective pool weights — use first (and only, for non-better-of) loop
    if perm_loops:
        primary_loop = perm_loops[0]
        for case in primary_loop:
            if case["type"] == "bonus_6th":
                continue
            for wentry in case.get("weights", []):
                for subj in wentry["subjects"]:
                    # Only set if higher than current (avoid downgrading)
                    existing = weights.get(subj, 0)
                    if wentry["weight"] > existing:
                        weights[subj] = wentry["weight"]

    return weights

# ─── Subject name normalisation ──────────────────────────────────────────────

SUBJECT_NORM = {
    "English Language": "english",
    "Chinese Language": "chinese",
    "Mathematics Compulsory Part": "maths_core",
    "Mathematics Extended Part (Algebra and Calculus) - Module 2": "maths_m2",
    "Mathematics Extended Part (Calculus and Statistics) - Module 1": "maths_m1",
    "Biology": "biology",
    "Chemistry": "chemistry",
    "Physics": "physics",
    "Information and Communication Technology": "ict",
    "Economics": "economics",
    "Design and Applied Technology": "dat",
    "Citizenship & Social Development": "csd",
}

# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    content = load_js(use_cache=True)

    # Global config
    global_cfg = extract_global_config(content)
    bonus_pct = global_cfg.get("bonus_percentage", 5)
    print(f"Global bonus_percentage: {bonus_pct}%")

    # Programmes array
    programmes = extract_programmes_array(content)
    print(f"Found {len(programmes)} programmes in data array")

    # Calculator section
    calc = extract_calc_section(content)
    code_to_class = extract_code_to_class_map(calc)
    print(f"Code→class map: {len(code_to_class)} entries")

    # Extract class bodies + parents
    seen_classes = {}
    for letter in set(code_to_class.values()):
        body, parent = extract_class_body(calc, letter)
        seen_classes[letter] = (body, parent)

    # Build formula data per class (handling inheritance)
    def get_effective_body(letter):
        body, parent = seen_classes.get(letter, (None, None))
        if body and 'getMaxResult' in body:
            return body
        if parent and parent in seen_classes:
            return get_effective_body(parent)
        return body

    # Build output
    output = []
    prog_by_code = {p['jcode']: p for p in programmes}

    for code in sorted(code_to_class.keys()):
        letter = code_to_class[code]
        prog = prog_by_code.get(code, {})

        body = get_effective_body(letter)
        if not body:
            print(f"WARNING: No class body for {code} (class {letter})")
            required_picks, perm_loops, is_better_of = [], [], False
        else:
            required_picks = parse_required_picks(body)
            perm_loops, is_better_of = parse_permutation_loops(body)

        formula_steps = build_formula_steps(code, required_picks, perm_loops, is_better_of)
        subject_weights = build_subject_weights(code, required_picks, perm_loops, prog)

        # Bonus 6th: extract eligible categories from the last case of the first (or only) loop
        bonus_cats = []
        if perm_loops:
            for case in perm_loops[0]:
                if case.get("type") == "bonus_6th":
                    bonus_cats = case["categories"]
                    break

        # Parse requirements into structured dict
        requirements = {}
        for req in prog.get("requirements", []):
            subj = req["subject"]
            level = req["level"]
            norm_key = SUBJECT_NORM.get(subj, subj.lower().replace(" ", "_"))
            requirements[norm_key] = level

        # Scores from noticesAfterCal
        notices = prog.get("noticesAfterCal", {})

        entry = {
            "jupas_code": code,
            "name": prog.get("name", "").replace(f"{code} ", ""),
            "faculty": prog.get("faculty", ""),
            "institution": "HKUST",
            "data_year_formula": "2026",
            "data_year_scores": "2025",

            # Scalar multipliers (for display / legacy compat)
            "engMultiplier": prog.get("engMultiplier", "x1"),
            "secondMultiplier": prog.get("secondMultiplier", "x1"),
            "secondMultiplierSubject": prog.get("secondMultiplierSubject", ""),
            "subjectNum": prog.get("subjectNum", 5),
            "max_attainable_weighting": prog.get("max_attainable_weighting", 5),

            # NEW: Structured formula data
            "formula_steps": formula_steps,
            "subject_weights_2026": subject_weights,
            "bonus_6th": {
                "bonus_percentage": bonus_pct,
                "eligible_categories": bonus_cats or prog.get("extra_subject_bonus_category", [])
            },
            "is_better_of": is_better_of,

            # Scores (from noticesAfterCal in JS)
            # Note: score_ha (Highest Attainable) comes from the PDF, not this JS file.
            # expected_score_2026 is HKUST's reference/target score for 2026 applicants.
            "score_median": notices.get("MS", ""),
            "score_lq": notices.get("LQ", ""),
            "expected_score_2026": prog.get("expected_score", ""),

            # Requirements (structured)
            "min_requirements_2026_raw": requirements,
            "flexible_intake_score": prog.get("flexible_intake_score", -1),

            # Display strings (keep for reference)
            "anotherSpecifiedSubject": prog.get("anotherSpecifiedSubject", ""),
            "otherSubjects_text": strip_html(prog.get("otherSubjects", "")),
            "remark": strip_html(prog.get("remark", "")),
            "siteURL": prog.get("siteURL", ""),
        }

        output.append(entry)
        print(f"  {code}: {len(formula_steps)} formula steps, {len(subject_weights)} weighted subjects, better_of={len(perm_loops)>1}")

    # Save
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(output)} entries to {OUTPUT_PATH}")
    print(f"\nSample entry (JS5212):")
    sample = next((e for e in output if e['jupas_code'] == 'JS5212'), None)
    if sample:
        print(json.dumps(sample, indent=2))

if __name__ == '__main__':
    main()
