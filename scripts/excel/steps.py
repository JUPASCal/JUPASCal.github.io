"""
Composable scoring steps for the 計分版 engine.

The engine row is built by a small pipeline of reusable STEP emitters:

    convert (pick scale row) -> weight (K:T) -> select (BH:BQ, AF:AO, AP:AY)
                                                             -> aggregate (J)

Most programmes reuse the DEFAULT steps. Weird calculation methods override a
single step (see resolve_recipe). Steps write cells over the fixed engine-row
column layout in layout.ENGINE_SLOTS. See BUILD_PLAN.md "Engine architecture".
"""
from __future__ import annotations
import json
from layout import ENGINE_SLOTS, INST_SCALE_ROW, REGISTRY_JSON

# Category-A subjects = the inputtable elective vocabulary. A weighted subject
# outside this set (Cat-C language, Cat-B/SSSDP vocational) can't be entered in
# an elective slot, so it's correctly excluded from the conditional — and NOT a
# coverage warning. Only a Cat-A subject missing an EN→ZH is a real gap.
CATEGORY_A = set(json.load(open(REGISTRY_JSON, encoding="utf-8")).get("category_a") or [])

# The no-bonus linear scale row (無加分制) — used by SSSDP and as the override for
# the `medicine_conversion_scale` exception (5**=7 linear).
LINEAR_SCALE_ROW = 13

# EN canonical subject name -> 選單 Chinese name (the elective slots hold ZH names
# from 主頁). subjects.canonical.json is English-only, so this is the bridge.
# Coverage is checked at build time; any missing elective is logged.
EN_TO_ZH = {
    "Physics": "物理", "Chemistry": "化學", "Biology": "生物",
    "Economics": "經濟", "Geography": "地理", "Music": "音樂",
    "Physical Education": "體育", "History": "歷史", "Chinese History": "中國歷史",
    "Visual Arts": "視覺藝術", "Integrated Science": "綜合科學",
    "Combined Science: Physics + Chemistry": "組合科學(物理、化學)",
    "Combined Science: Biology + Chemistry": "組合科學(生物、化學)",
    "Combined Science: Biology + Physics": "組合科學(物理、生物)",
    "Chinese Literature": "中國文學", "Literature in English": "英語文學",
    "Tourism and Hospitality Studies": "旅遊與款待",
    "Ethics and Religious Studies": "倫理與宗教",
    # The two DSE Technology and Living strands are DISTINCT subjects (separate
    # papers, canonical vocabulary lists both) and CAN carry different programme
    # weights (e.g. PolyU JS3050: Fashion ×10, Food Science ×7) — so they MUST get
    # distinct ZH slot names, else the engine can't tell which strand was taken and
    # mis-weights it. ZH strings match the app (src/lib/strings.ts). No plain
    # "Technology and Living": it is not a canonical Cat-A subject.
    "Technology and Living (Food Science and Technology)": "科技與生活（食品科學與科技）",
    "Technology and Living (Fashion, Clothing and Textiles)": "科技與生活（時裝、成衣及紡織）",
    "Information and Communication Technology": "資訊及通訊科技",
    "Design and Applied Technology": "設計與應用科技",
    "Health Management and Social Care": "健康管理與社會關懷",
    "Business, Accounting and Financial Studies": "企業、會計與財務概論",
}

# Non-CSD slots, in engine column order. CSD is computed but never scored, so it
# gets no weighted/boost/mask cell (EXCEL_LOGIC §4.6).
SCORING_SLOTS = ["chi", "eng", "math", "m1m2", "x1", "x2", "x3", "x4", "lang"]
ELECTIVE_SLOTS = ["x1", "x2", "x3", "x4"]

METHOD_N = {"best5": 5, "best4": 4, "best6": 6}

# core subject canonical name -> slot (for required-subject flags)
CORE_SUBJECT_SLOT = {
    "Chinese Language": "chi", "English Language": "eng",
    "Mathematics (Compulsory Part)": "math", "Mathematics Compulsory Part": "math",
    "Mathematics Extended Part (Module 1)": "m1m2",
    "Mathematics Extended Part (Module 2)": "m1m2",
    "Mathematics Extended Part (Module 1 or 2)": "m1m2",
}


# --- convert step ------------------------------------------------------------
def scale_row(prog):
    """Which grade-scale row this programme converts on (references 計分版 rows
    3-13, kept shell). Default = institution scale; medicine uses linear."""
    constraints = {c.get("type") for c in (prog.raw.get("calculation_constraints") or [])
                   if isinstance(c, dict)}
    if "medicine_conversion_scale" in constraints:
        return LINEAR_SCALE_ROW
    return prog.scale_row


# --- weight step -------------------------------------------------------------
def _elective_weight_formula(slot_col, elective_weights, warn):
    """A per-slot conditional weight: IF(OR(slotZH=…), w, 1), grouped by weight.
    slot_col e.g. 'P'; the slot's subject name is at f'{slot_col}1'."""
    if not elective_weights:
        return 1
    by_w = {}
    for subj, w in elective_weights.items():
        zh = EN_TO_ZH.get(subj)
        if zh is None:
            if subj in CATEGORY_A:  # real inputtable gap — must not silently drop
                warn(f"no EN→ZH for Cat-A elective {subj!r}")
            continue  # Cat-B/C & vocational: not inputtable electives — skip

        by_w.setdefault(float(w), []).append(zh)
    if not by_w:
        return 1
    ref = f"{slot_col}1"
    # nest heaviest weight outermost
    expr = "1"
    for w in sorted(by_w):
        cond = "OR(" + ",".join(f'{ref}="{zh}"' for zh in by_w[w]) + ")"
        expr = f"IF({cond},{w:g},{expr})"
    return "=" + expr


def emit_weights(ws, r, prog, warn):
    """weight step (default): cores from core_weights; electives subject-
    conditional; lang default 1."""
    cw = prog.core_weights
    ws[f"K{r}"] = cw.get("chi", 1)
    ws[f"L{r}"] = cw.get("eng", 1)
    ws[f"M{r}"] = cw.get("math", 1)
    # M1/2 weight is module-specific for a few programmes (M1 weight ≠ M2 weight);
    # 主頁!$D$12 (M1/M2 selector) picks which. A no-op where M1 == M2 (most programmes).
    sw = prog.raw.get("subject_weights_2025") or {}
    m1w = sw.get("Mathematics Extended Part (Module 1)", 1)
    m2w = sw.get("Mathematics Extended Part (Module 2)", 1)
    ws[f"O{r}"] = m1w if m1w == m2w else f'=IF(主頁!$D$12="M2",{m2w:g},{m1w:g})'
    for slot in ELECTIVE_SLOTS:
        col = ENGINE_SLOTS[slot][0]
        ws[f"{col}{r}"] = _elective_weight_formula(col, prog.elective_weights, warn)
    ws[f"T{r}"] = 1  # language slot weight (Cat-C); default 1


def _pool_to_slots(subjects):
    """(pool has M1/M2?, [ZH names of Cat-A pool subjects]) — used by compulsory pool."""
    has_m = any("Module" in s for s in subjects)
    zh = [EN_TO_ZH[s] for s in subjects if s in EN_TO_ZH]
    return has_m, zh


# best-of helper regions (8 slots each: chi,eng,math,m1m2,x1,x2,x3,x4). Two regions
# support up to two helper-needing rules per programme; M1/2-only rules need none.
BEST_OF_REGIONS = [
    ["BR", "BS", "BT", "BU", "BV", "BW", "BX", "BY"],
    ["CQ", "CR", "CS", "CT", "CU", "CV", "CW", "CX"],
]
_POOL_CORE_SLOT = {
    "Chinese Language": "chi", "English Language": "eng",
    "Mathematics (Compulsory Part)": "math", "Mathematics Compulsory Part": "math",
}
_CORE_COL = {"chi": "K", "eng": "L", "math": "M"}


def _pool_members(subjects):
    """(core slot names in pool, pool has M1/M2?, [elective ZH names])."""
    cores = [_POOL_CORE_SLOT[s] for s in subjects if s in _POOL_CORE_SLOT]
    has_m = any("Module" in s for s in subjects)
    zh = [EN_TO_ZH[s] for s in subjects if s in EN_TO_ZH]
    return cores, has_m, zh


def emit_best_of(ws, r, prog, sr, warn):
    """weight-step OVERRIDE (best_of_weights): the best `count` subjects of a pool
    get `weight`; the rest keep their default weight. The pool can span cores
    (Chi/Eng/Math), M1/2 and electives. Helper cells hold each candidate slot's
    unweighted converted grade (0 if not in the pool); a slot wins if its helper
    is in the pool's top-`count`. M1/2-only pools are trivial (one module taken)."""
    region = 0
    for rule in (prog.raw.get("best_of_weights_2025") or []):
        cnt, w = rule.get("count", 1), rule.get("weight", 1)
        cores, has_m, zh = _pool_members(rule.get("subjects", []))
        if not cores and not zh:                    # M1/2-only pool
            ws[f"O{r}"] = max(prog.core_weights.get("m1m2", 1), w)
            continue
        if region >= len(BEST_OF_REGIONS):
            warn(f"{prog.code}: >2 best_of helper rules unhandled")
            continue
        H = BEST_OF_REGIONS[region]; region += 1
        rng = f"${H[0]}{r}:${H[7]}{r}"
        for i, slot in enumerate(("chi", "eng", "math")):
            ws[f"{H[i]}{r}"] = f"={_CORE_COL[slot]}${sr}" if slot in cores else 0
        ws[f"{H[3]}{r}"] = f"=O${sr}" if has_m else 0
        for k, col in enumerate(("P", "Q", "R", "S")):
            cond = "OR(" + ",".join(f'{col}1="{z}"' for z in zh) + ")" if zh else "FALSE"
            ws[f"{H[4 + k]}{r}"] = f"=IF({cond},{col}${sr},0)"

        def win(hc):
            return f"AND({hc}{r}>0.5,{hc}{r}>=LARGE({rng},{cnt}))"

        # weight = MAX(default, best_of-if-winner) — best_of only lifts, never lowers
        # a subject already weighted higher by subject_weights (mirrors calculator.ts).
        cw = prog.core_weights
        for i, slot in enumerate(("chi", "eng", "math")):
            if slot in cores:
                ws[f"{_CORE_COL[slot]}{r}"] = f"=MAX({cw.get(slot, 1):g},IF({win(H[i])},{w:g},0))"
        if has_m:
            ws[f"O{r}"] = f"=MAX({cw.get('m1m2', 1):g},IF({win(H[3])},{w:g},0))"
        for k, col in enumerate(("P", "Q", "R", "S")):
            if zh:
                default = _elective_weight_formula(col, prog.elective_weights, lambda m: None)
                dexpr = (default[1:] if isinstance(default, str) and default.startswith("=")
                         else f"{default:g}")
                ws[f"{col}{r}"] = f"=MAX({dexpr},IF({win(H[4 + k])},{w:g},0))"


def _maths_as_one_keep(prog):
    """For maths_m1m2_as_one: which of Math/M1·2 to keep — 'm12', 'math', or None
    (keep the higher at runtime). A compulsory subject forces its side."""
    cons = prog.raw.get("calculation_constraints") or []
    if not any(c.get("type") == "maths_m1m2_as_one" for c in cons if isinstance(c, dict)):
        return False, None
    comp = next((c for c in cons if isinstance(c, dict) and c.get("type") == "compulsory_subjects"), None)
    csubs = (comp or {}).get("subjects", []) or []
    if any("Module" in s for s in csubs):
        return True, "m12"
    if any("Compulsory" in s for s in csubs):
        return True, "math"
    return True, None


# --- weighted-score cells (given weights + scale row) ------------------------
def emit_weighted(ws, r, sr, prog):
    """V:AE = scaleRow × weight, with M1/2 gated by G ('v') and lang by H ('E').

    maths_m1m2_as_one: only ONE of Math / M1·2 may count — zero the other's
    weighted score so the Best-N picks a replacement (mirrors calculator.ts)."""
    as_one, keep = _maths_as_one_keep(prog)
    mathraw = f"M${sr}*M{r}"
    m12g = f'IF(G{r}="v",O${sr}*O{r},0)'   # gated M1/2 weighted (0 if M1/2 off/absent)
    for slot in SCORING_SLOTS:
        wcol, vcol, *_ = ENGINE_SLOTS[slot]
        if slot == "math":
            if not as_one or keep == "math":
                ws[f"{vcol}{r}"] = f"={mathraw}"
            elif keep == "m12":                    # drop Math only if M1/2 counts
                ws[f"{vcol}{r}"] = f"=IF({m12g}>0.5,0,{mathraw})"
            else:                                   # keep the higher of the two
                ws[f"{vcol}{r}"] = f"=IF({m12g}>{mathraw},0,{mathraw})"
        elif slot == "m1m2":
            if not as_one or keep == "m12":
                ws[f"{vcol}{r}"] = f"={m12g}"
            elif keep == "math":                    # drop M1/2 only if Math counts
                ws[f"{vcol}{r}"] = f"=IF({mathraw}>0.5,0,{m12g})"
            else:
                ws[f"{vcol}{r}"] = f"=IF({mathraw}>={m12g},0,{m12g})"
        elif slot == "lang":
            ws[f"{vcol}{r}"] = f'=IF(H{r}="E",{wcol}${sr}*{wcol}{r},0)'
        else:
            ws[f"{vcol}{r}"] = f"={wcol}${sr}*{wcol}{r}"


# max_weighted rank-key helpers (reuse CB:CJ — max_weighted progs aren't HKUST)
MAX_WEIGHT_HELPER = ["CB", "CC", "CD", "CE", "CF", "CG", "CH", "CI", "CJ"]


def emit_max_weighted(ws, r, prog, sr, limit):
    """max_weighted_subjects: only the `limit` highest-weighted PRESENT subjects
    keep their weight; the rest count at ×1. Rank key = weight×1000 − slot order
    (higher weight first, ties broken by earlier slot = input order, mirroring
    calculator.ts). Rewrites V:AE with the capped weights. Runs AFTER emit_weighted
    (and best_of) so it sees the final weights in K:T."""
    rng = f"$CB{r}:$CJ{r}"
    for i, slot in enumerate(SCORING_SLOTS):
        wc = ENGINE_SLOTS[slot][0]
        ws[f"{MAX_WEIGHT_HELPER[i]}{r}"] = (
            f"=IF(AND({wc}{r}>1,{wc}${sr}>0.5),{wc}{r}*1000-{i},-1)")
    for i, slot in enumerate(SCORING_SLOTS):
        wc, vc, *_ = ENGINE_SLOTS[slot]
        hk = f"{MAX_WEIGHT_HELPER[i]}{r}"
        capped = f"IF(AND({hk}>-1,{hk}>=LARGE({rng},{limit})),{wc}{r},1)"
        val = f"{wc}${sr}*({capped})"
        if slot == "m1m2":
            ws[f"{vc}{r}"] = f'=IF(G{r}="v",{val},0)'
        elif slot == "lang":
            ws[f"{vc}{r}"] = f'=IF(H{r}="E",{val},0)'
        else:
            ws[f"{vc}{r}"] = f"={val}"


# --- select step (required flags + boost + Best-N mask) ----------------------
# compulsory-pool helper columns (best-of-pool forcing): m1m2, x1, x2, x3, x4
COMP_POOL_HELPER = ["CL", "CM", "CN", "CO", "CP"]


def emit_required(ws, r, prog, sr):
    """BH:BQ required-subject flags. Handles:
    - compulsory_subjects CORE (Chi/Eng/Math/M1·2) → static flag.
    - compulsory_subjects ELECTIVES (e.g. must include Chemistry) → conditional
      flag on whichever elective slot holds that subject.
    - compulsory_subject_pool (best `count` from a pool must be included) → a
      helper (CL:CP) forces the best-`count` pool members' slots.
    A forced subject is only actually selected if PRESENT (emit_mask checks >0.5)."""
    cons = prog.raw.get("calculation_constraints") or []
    core_req = set()
    elective_zh = set()                       # specific compulsory electives
    for c in cons:
        if isinstance(c, dict) and c.get("type") == "compulsory_subjects":
            for subj in (c.get("subjects") or []):
                slot = CORE_SUBJECT_SLOT.get(subj)
                if slot:
                    core_req.add(slot)
                elif EN_TO_ZH.get(subj):
                    elective_zh.add(EN_TO_ZH[subj])
    # per-elective-slot OR-conditions that force the slot
    force = {c: [f'{c}1="{z}"' for z in sorted(elective_zh)] for c in ("P", "Q", "R", "S")}
    # compulsory_subject_pool → best `count` of the pool (one helper region)
    pool_used = False
    for c in cons:
        if not (isinstance(c, dict) and c.get("type") == "compulsory_subject_pool"):
            continue
        has_m, zh = _pool_to_slots(c.get("subjects") or [])
        if pool_used or (not zh and not has_m):
            continue
        pool_used = True
        cnt = c.get("count", 1)
        rng = f"$CL{r}:$CP{r}"
        ws[f"CL{r}"] = f"=O${sr}" if has_m else 0
        for k, col in enumerate(("P", "Q", "R", "S")):
            cond = "OR(" + ",".join(f'{col}1="{z}"' for z in zh) + ")" if zh else "FALSE"
            ws[f"{COMP_POOL_HELPER[k + 1]}{r}"] = f"=IF({cond},{col}${sr},0)"
        if has_m:
            core_req.add("m1m2")   # if M1/2 is in the pool it's the only maths ext — force it
        for k, col in enumerate(("P", "Q", "R", "S")):
            force[col].append(f"AND({COMP_POOL_HELPER[k + 1]}{r}>0,"
                              f"{COMP_POOL_HELPER[k + 1]}{r}>=LARGE({rng},{cnt}))")
    # emit flags
    for slot in SCORING_SLOTS:
        if slot in core_req:
            ws[f"{ENGINE_SLOTS[slot][4]}{r}"] = True
    for slot, col in (("x1", "P"), ("x2", "Q"), ("x3", "R"), ("x4", "S")):
        if force[col]:
            ws[f"{ENGINE_SLOTS[slot][4]}{r}"] = "=IF(OR(" + ",".join(force[col]) + "),TRUE,FALSE)"


def emit_boost(ws, r, m1m2_excluded=False):
    """AF:AO = +99 when the slot is required AND present (score > 0.5), forcing it
    into the Best-N ranking without polluting the sum. An ABSENT required subject
    is NOT force-selected. If m1m2_excluded (half-replacement), M1/2's boost is set
    very low so it never enters the Best-N ranking (its weighted Z is still kept
    for the half-replacement step)."""
    for i, slot in enumerate(SCORING_SLOTS):
        _, vcol, bcol, _, flagcol = ENGINE_SLOTS[slot]
        if m1m2_excluded and slot == "m1m2":
            ws[f"{bcol}{r}"] = -999
            continue
        # Tie-break for the Best-N ranking: earlier slot ⇒ higher, so ties in the
        # weighted score resolve in input order (chi,eng,math,m1/2,x1..) — matching
        # calculator.ts's stable sort. 1e-6 is far below any real score granularity
        # and far above the scale's ~1e-10 decimals (which collide after weighting).
        tie = (len(SCORING_SLOTS) - i) * 1e-6
        ws[f"{bcol}{r}"] = (f"=IF(AND({flagcol}{r}=TRUE,{vcol}{r}>0.5),"
                            f"{vcol}{r}+99,{vcol}{r})+{tie:.8f}")


def emit_mask(ws, r, n, m1m2_excluded=False):
    """AP:AY Best-N selection: TRUE if required AND present (score > 0.5), or if the
    boosted score is in the top-N of the boosted vector (> the (N+1)th largest).
    An absent required subject is NOT force-selected. If m1m2_excluded (half-
    replacement programmes), M1/2 never enters Best-N — it can only feed the
    half-replacement step in emit_aggregate."""
    boost_range = f"$AF{r}:$AO{r}"
    for slot in SCORING_SLOTS:
        _, vcol, bcol, mcol, flagcol = ENGINE_SLOTS[slot]
        if m1m2_excluded and slot == "m1m2":
            ws[f"{mcol}{r}"] = False
        else:
            ws[f"{mcol}{r}"] = (f"=IF(AND({flagcol}{r}=TRUE,{vcol}{r}>0.5),TRUE,"
                                f"IF({bcol}{r}>LARGE({boost_range},{n + 1}),TRUE))")


# --- target-count + bonus (ported from src/lib/calculator.ts) -----------------
def get_target_count(prog):
    """Base subject count N (getTargetCount, id-based branch). bonus_7th counts 6,
    bonus_6th/additional counts 5 (the bonus is the extra subject)."""
    fid = prog.method_id
    cons = {c.get("type") for c in (prog.raw.get("calculation_constraints") or [])
            if isinstance(c, dict)}
    has_b6 = "bonus_6th" in cons or "additional_bonus_6th" in cons
    has_b7 = "bonus_7th" in cons
    if fid == "best4":
        return 4
    if fid == "best6" or has_b7:
        return 6
    if fid == "best5" or has_b6:
        return 5
    return 5


def get_bonus(prog):
    """(mode, rate) for the next-best bonus (calculator.ts). HKUST uses the BASE
    points of the best-base unselected subject; the others use the WEIGHTED best
    unselected. Returns (None, None) if no bonus."""
    cons = {c.get("type"): c for c in (prog.raw.get("calculation_constraints") or [])
            if isinstance(c, dict)}
    if "hkust_weighted_best" in cons:
        c = cons["hkust_weighted_best"]
        return "base", float(c.get("max_attainable_weighting", 5)) * float(c.get("bonus_percentage", 5)) / 100
    if "bonus_7th" in cons:
        return "weighted", float(cons["bonus_7th"].get("multiplier", 0.2))
    if "bonus_6th" in cons:
        return "weighted", float(cons["bonus_6th"].get("multiplier", 0))
    if "additional_bonus_6th" in cons:
        return "weighted_l3", 0.1  # PolyU 6th-subject bonus — gated on raw level ≥ 3
    return None, None


# base-of-unselected helper columns (one per scoring slot), for the HKUST bonus
BASE_HELPER_COLS = ["CB", "CC", "CD", "CE", "CF", "CG", "CH", "CI", "CJ"]


# --- aggregate step ----------------------------------------------------------
def emit_aggregate(ws, r, n, sr, mode=None, rate=None, half_replace=False):
    """J = masked weighted Best-N sum, plus a next-best bonus:
    - "weighted" (HKU/CUHK/PolyU 6th/7th): `rate × LARGE($AF:$AO, N+1)`. The
      (N+1)th boosted = best unselected (unselected ⇒ no +99 ⇒ boosted = weighted).
      Avoids MAXIFS (unreliable boolean criteria; needs Excel 2019+).
    - "base" (HKUST): `rate × MAX(base of unselected slots)`. Per slot a helper
      cell holds the UNWEIGHTED converted grade when the slot is unselected."""
    terms = f"SUMIF(AP{r}:AY{r},TRUE,V{r}:AE{r})"
    if mode == "weighted":
        terms += f"+{rate:g}*LARGE($AF{r}:$AO{r},{n + 1})"
    elif mode == "weighted_l3":   # PolyU additional_bonus_6th — 0.1 × the best
        # UNSELECTED subject whose RAW DSE level ≥ 3 (base converted score > 2.5;
        # level 2→2, level 3→3 in every scale, so the boundary is clean). Mirrors
        # calculator.ts's polyu_style grade≥3 filter. MAX over unselected level-≥3
        # slots = the highest-WEIGHTED qualifying candidate; 0 (no bonus) if none.
        # Unlike plain "weighted"'s LARGE(N+1), this skips a level-<3 6th subject.
        parts = []
        for slot in SCORING_SLOTS:
            wcol, vcol, _, mcol, _ = ENGINE_SLOTS[slot]
            parts.append(f"IF(AND({mcol}{r}=FALSE,{wcol}${sr}>2.5,{vcol}{r}>0.5),{vcol}{r},0)")
        terms += f"+{rate:g}*MAX({','.join(parts)})"
    elif mode == "base":   # HKUST — base points of the best-base unselected
        for i, slot in enumerate(SCORING_SLOTS):
            wcol, _, _, mcol, _ = ENGINE_SLOTS[slot]
            ws[f"{BASE_HELPER_COLS[i]}{r}"] = f"=IF({mcol}{r}=FALSE,{wcol}${sr},0)"
        rng = f"{BASE_HELPER_COLS[0]}{r}:{BASE_HELPER_COLS[-1]}{r}"
        terms += f"+{rate:g}*MAX({rng})"
    if half_replace:
        # M1/2 (Z, not in Best-N) replaces the worst selected elective by half if
        # that improves it: net += (M1/2 - worst)/2 when M1/2 > worst.
        worst = (f"MIN(IF(AU{r}=TRUE,AA{r},999),IF(AV{r}=TRUE,AB{r},999),"
                 f"IF(AW{r}=TRUE,AC{r},999),IF(AX{r}=TRUE,AD{r},999))")
        terms += f"+IF(Z{r}>{worst},(Z{r}-{worst})/2,0)"
    ws[f"J{r}"] = f"={terms}"


# --- recipe resolution -------------------------------------------------------
DEFAULT_METHODS = set(METHOD_N)
EXCEPTION_CONSTRAINTS = {  # constraints that need a non-default step (stage 3+)
    "best_of_weights", "max_weighted_subjects", "compulsory_subject_pool",
    "hkust_weighted_best", "bonus_6th", "bonus_7th", "additional_bonus_6th",
    "m1m2_half_replacement",
}


def recipe_exceptions(prog):
    """Return the set of exception features this programme needs beyond the
    default pipeline (so build_engine can log what still falls back to default)."""
    ex = set()
    if prog.method_id not in DEFAULT_METHODS:
        ex.add(f"method:{prog.method_id}")
    if prog.raw.get("best_of_weights_2025"):
        ex.add("best_of_weights")
    for c in (prog.raw.get("calculation_constraints") or []):
        t = c.get("type") if isinstance(c, dict) else None
        if t in EXCEPTION_CONSTRAINTS:
            ex.add(t)
    return ex
