#!/usr/bin/env python3
"""
validate_unified.py — post-regeneration sanity gate for JUPAS_2026_Unified_Data.json

Run this AFTER re-scraping + re-running unify_2026_data.py. It is deliberately
SELF-CONTAINED (it re-derives counts/scores from the JSON itself rather than
importing the production calculators) so it can catch bugs in those calculators,
in the unify script, AND in freshly-scraped source data.

Severity levels:
  ERROR  — a definite problem; the data is wrong. Exit code is non-zero.
  REVIEW — ambiguous / can't be auto-verified; a human must eyeball it.
  (clean programmes are summarised, not listed)

Usage:
  python scripts/utils/validate_unified.py [path/to/unified.json]

Background: the count logic, synthetic-UQ, and HKU sourcing notes live in the
project memory; the checks here mirror the 2026-05 audit that found the JS6107
(HKU "Best of …") under-count and the CityU "Best 4" over-count.
"""
import json
import re
import sys
from collections import defaultdict

DEFAULT_PATH = "data/processed/JUPAS_2026_Unified_Data.json"
SUBJECTS_CANONICAL_FILE = "data/raw/subjects.canonical.json"

# ── Canonical subject registry (single source of truth, shared with unify and
# the TS frontend). The eligibility matcher compares subject names by exact
# equality, so every subject stored in an elective pool / best-of pool MUST be
# one of these names (or a token). Loaded here independently — this validator is
# deliberately self-contained and does NOT import the production pipeline. ──
with open(SUBJECTS_CANONICAL_FILE, encoding="utf-8") as _f:
    _REG = json.load(_f)
_ME = _REG["math_extended"]
CANONICAL_SUBJECTS = set(
    _REG["core"] + _REG["category_a"] + _REG["category_c"]
    + [_ME["combined"], _ME["module_1"], _ME["module_2"]]
)
SUBJECT_TOKENS = set(_REG["tokens"])
# alias spelling (lower-cased) -> canonical; used to tell a normalizable-but-
# un-normalized weight key (a real miss) from a genuinely unmodeled subject (ApL).
ALIAS_LC = {k.lower(): v for k, v in _REG["aliases"].items()}

# Expected Category-A 5** conversion per institution (CUHK Medicine uses 7).
EXPECTED_SCALE = {
    "HKU": 8.5, "HKUST": 8.5, "CityUHK": 8.5, "PolyU": 8.5, "CUHK": 8.5,
    "LingnanU": 7, "EdUHK": 7, "HKBU": 7, "HKMU": 7, "SSSDP": 7,
}
CUHK_MED_7 = {"JS4501", "JS4502"}
GRADE_ORDER = ["5**", "5*", "5", "4", "3", "2", "1"]

# A "perfect" candidate: every Cat-A subject + cores + both M1/M2 at 5**, CSD
# attained, all Cat-C languages. Enough subjects that the best-N count always
# binds, so the computed score is the programme's effective max. Derived from the
# canonical registry so it can never fall out of sync with the real subject set.
PERFECT = {s: "5**" for s in _REG["category_a"]}
for _s in ("Chinese Language", "English Language", "Mathematics (Compulsory Part)"):
    PERFECT[_s] = "5**"
PERFECT["Citizenship and Social Development"] = "A"
PERFECT[_ME["module_1"]] = "5**"
PERFECT[_ME["module_2"]] = "5**"
for _s in _REG["category_c"]:
    PERFECT[_s] = "A"


def has_hist(p):
    s = p.get("scores_2025") or {}
    return bool(s.get("uq") or s.get("median") or s.get("lq") or s.get("mean"))


# ── Self-contained count parser (mirrors unify _parse_additive_count) ──
# Only HKU + CityU are parsed CONFIDENTLY from formula text — those are the
# institutions whose '+'-additive text is the authoritative count source and
# whose stored formula_id was unreliable. CUHK's code notation and HKUST's
# fragments (English/Math come from multipliers, not the text) are NOT reliably
# countable from text, so we leave them to formula_id + the perfect-student
# check — exactly how the production calculator/unify treat them.
def count_from_text(formula, institution):
    """Returns (count|None, confident: bool)."""
    if not formula or institution not in ("HKU", "CityUHK"):
        return None, False
    s = re.sub(r'\+?\s*\d*\.?\d+\s*x\s*\d+(?:st|nd|rd|th)\s+Best\b[^+]*Subject', ' ', formula, flags=re.IGNORECASE)
    if institution == "CityUHK":
        m = re.search(r'(\d+)\s*core\s*\+\s*(\d+)\s*elective', s, re.IGNORECASE)
        if m:
            return int(m.group(1)) + int(m.group(2)), True
        m = re.search(r'Best\s+(\d+)\s+subjects?', s, re.IGNORECASE)
        return (int(m.group(1)), True) if m else (None, False)
    # HKU
    total, matched = 0, False
    for raw in s.split('+'):
        t = raw.strip()
        if not t:
            continue
        mb = re.search(r'Best\s+(\d+)\b', t, re.IGNORECASE)
        if mb:
            total += int(mb.group(1)); matched = True; continue
        if (re.search(r'Best of ', t, re.IGNORECASE) or re.search(r'\bBest\b.*\bSubject\b', t, re.IGNORECASE)
                or re.search(r'\b(Eng|Math|Chin|M1|M2)', t, re.IGNORECASE)):
            total += 1; matched = True; continue
    return (total, True) if (matched and 1 <= total <= 8) else (None, False)


def count_from_id(formula_id, constraints):
    has7 = any(c.get("type") == "bonus_7th" for c in constraints)
    has6 = any(c.get("type") in ("bonus_6th", "additional_bonus_6th") for c in constraints)
    if formula_id == "best4":
        return 4
    if formula_id == "best6" or has7:
        return 6
    if formula_id == "best5" or has6:
        return 5
    return None  # custom/unknown


# ── Self-contained "perfect student" base scorer (no bonus — bonuses only add) ──
def perfect_base_score(p, count):
    conv = (p.get("score_conversion_table") or {}).get("category_a") or {}
    catc = (p.get("score_conversion_table") or {}).get("category_c") or {}
    weights = p.get("subject_weights_2025") or {}
    pools = p.get("best_of_weights_2025") or []
    constraints = p.get("calculation_constraints") or []
    cand = {}
    for subj, grade in PERFECT.items():
        base = conv.get(grade, catc.get(grade, 0))
        w = weights.get(subj, 1.0)
        cand[subj] = {"subj": subj, "base": base, "w": w, "ws": base * w}
    # best-of pools raise the weight of their best member
    for pool in pools:
        members = sorted((cand[s] for s in pool.get("subjects", []) if s in cand), key=lambda x: x["ws"], reverse=True)
        for c in members[: int(pool.get("count", 0))]:
            if pool.get("weight", 1.0) > c["w"]:
                c["w"] = pool["weight"]; c["ws"] = c["base"] * c["w"]
    m12_one = any(c.get("type") == "maths_m1m2_as_one" for c in constraints)
    selected, total = [], 0.0
    for c in sorted(cand.values(), key=lambda x: x["ws"], reverse=True):
        if len(selected) >= count:
            break
        if m12_one and "Mathematics" in c["subj"] and any("Mathematics" in s["subj"] for s in selected):
            continue
        selected.append(c); total += c["ws"]
    return total


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    data = json.load(open(path, encoding="utf-8"))
    findings = []  # (severity, code, inst, check, message)

    def add(sev, p, check, msg):
        findings.append((sev, p.get("jupas_code", "?"), p.get("institution", "?"), check, msg))

    for p in data:
        code, inst = p.get("jupas_code"), p.get("institution")
        s = p.get("scores_2025") or {}
        conv = (p.get("score_conversion_table") or {}).get("category_a") or {}
        constraints = p.get("calculation_constraints") or []
        scored = has_hist(p)

        # ── ERROR: grade scale ──
        exp = 7 if code in CUHK_MED_7 else EXPECTED_SCALE.get(inst)
        if conv.get("5**") is None and scored:
            add("ERROR", p, "scale", "no 5** in score_conversion_table.category_a")
        elif exp and conv.get("5**") is not None and abs(conv["5**"] - exp) > 0.01:
            add("ERROR", p, "scale", f"5**={conv['5**']} but expected {exp} for {inst}")

        # ── ERROR: conversion monotonicity ──
        vals = [conv.get(g) for g in GRADE_ORDER if conv.get(g) is not None]
        if any(vals[i] < vals[i + 1] for i in range(len(vals) - 1)):
            add("ERROR", p, "monotonic", f"conversion not descending: {[conv.get(g) for g in GRADE_ORDER]}")

        # ── ERROR: completeness (2025-scored) ──
        if scored:
            if not p.get("formula_2025"):
                add("ERROR", p, "complete", "missing formula_2025")
            if not p.get("formula_2025_id"):
                add("ERROR", p, "complete", "missing formula_2025_id")
            if not conv:
                add("ERROR", p, "complete", "missing category_a conversion table")

        # ── count consistency (text vs id) ──
        ct, confident = count_from_text(p.get("formula_2025"), inst)
        cid = count_from_id(p.get("formula_2025_id"), constraints)
        if ct is not None and cid is not None and ct != cid:
            sev = "ERROR" if confident else "REVIEW"
            add(sev, p, "count", f"formula text implies {ct} subjects but formula_2025_id gives {cid} — {p.get('formula_2025')!r}")
        elif scored and not confident and cid is None:
            add("REVIEW", p, "count", f"could not auto-derive subject count — verify manually: {p.get('formula_2025')!r}")

        # ── ERROR: perfect student must clear the benchmark ──
        # Score with the formula_id-implied count (what a JSON consumer uses);
        # fall back to the confident text count only when the id is "custom".
        if scored:
            count = cid if cid is not None else (ct if confident else None)
            if count:
                perfect = perfect_base_score(p, count)
                bench = s.get("median") if s.get("median") is not None else s.get("lq")
                blabel = "median" if s.get("median") is not None else "lq"
                if bench is not None and perfect < bench:
                    add("ERROR", p, "perfect", f"all-5** base score {perfect:.2f} is BELOW 2025 {blabel} {bench} (impossible → under-count/weight)")

        # ── REVIEW: benchmark ordering ──
        lq, med, uq = s.get("lq"), s.get("median"), s.get("uq")
        if lq is not None and med is not None and lq > med:
            add("REVIEW", p, "benchmark", f"LQ {lq} > median {med} (inverted — e.g. estimated/portfolio programme; verify)")
        if med is not None and uq is not None and med > uq:
            add("REVIEW", p, "benchmark", f"median {med} > UQ {uq} (inverted; verify)")
        if lq is not None and med is not None and lq == med:
            add("REVIEW", p, "benchmark", f"LQ == median ({med}) — degenerate spread; synthetic-UQ uses a fallback margin")

        # ── ERROR/REVIEW: quota sanity ──
        # A string here means unify failed to reduce a verbose per-school
        # quota ("115 (JUPAS and Non-JUPAS)") to an int; an absurd magnitude
        # is a merge artefact (CUHK JS4502 came through as 305030045014502).
        q = p.get("quota")
        if isinstance(q, str):
            add("ERROR", p, "quota", f"quota is an unparsed string {q!r} (unify should reduce it to an int)")
        elif isinstance(q, (int, float)):
            if q > 5000:
                add("ERROR", p, "quota", f"absurd quota {q} (extraction/merge artefact)")
            elif q < 0 or q > 2000:
                add("REVIEW", p, "quota", f"implausible quota {q} (verify)")

        # ── ERROR: closed-vocabulary check on exact-match subject fields ──
        # The eligibility matcher compares elective-pool subjects by EXACT string
        # equality against the student's canonical subjects, so any pool subject
        # that isn't a canonical name (or a token) silently never matches → a
        # qualified applicant is wrongly rejected. This subsumes the old
        # "garbage" regex and catches the whole bug class (abbreviations like
        # "ICT"/"DAT", shredded names like "Applied Technology", un-normalized
        # "Combined Science (...)", and parser leaks like "2) is NOT considered…").
        # best_of_weights pools are matched the same way and must be canonical too.
        mreq = p.get("min_requirements_2026") or {}
        for slot in ("elect1", "elect2"):
            el = mreq.get(slot)
            if isinstance(el, dict):
                for subj in (el.get("subjects") or []):
                    if not (isinstance(subj, str) and (subj in CANONICAL_SUBJECTS or subj in SUBJECT_TOKENS)):
                        add("ERROR", p, "noncanonical_subject", f"{slot} subject {subj!r} is not a canonical name/token (won't match → eligibility wrong)")
        for yr in ("2025", "2026"):
            for pool in (p.get(f"best_of_weights_{yr}") or []):
                for subj in (pool.get("subjects") or []):
                    if not (isinstance(subj, str) and (subj in CANONICAL_SUBJECTS or subj in SUBJECT_TOKENS)):
                        add("ERROR", p, "noncanonical_subject", f"best_of_weights_{yr} subject {subj!r} is not canonical (won't be weighted)")

        # ── REVIEW: weight key that SHOULD be canonical but isn't ──
        # Most non-canonical weight keys are ApL subjects the calculator doesn't
        # model (harmless). But a key that matches a known registry alias is a
        # real normalization miss — the student's canonical subject won't pick up
        # the weight. Flag only those (skip the unmodeled long tail).
        for yr in ("2025", "2026"):
            for k in (p.get(f"subject_weights_{yr}") or {}):
                if k not in CANONICAL_SUBJECTS and isinstance(k, str) and k.lower() in ALIAS_LC:
                    add("REVIEW", p, "weight_alias", f"subject_weights_{yr} key {k!r} should be normalized to {ALIAS_LC[k.lower()]!r} (weight won't apply)")

        # ── REVIEW: estimated / projected benchmarks ──
        st = s.get("score_type")
        if st and st != "actual":
            add("REVIEW", p, "score_type", f"score_type='{st}' — benchmark is {st}, not actual admissions")
        if s.get("expected_score") is not None and s.get("median") is None:
            add("REVIEW", p, "score_type", "uses projected expected_score (no actual median) — treat band cautiously")

        # ── REVIEW: formula text still has noise ──
        for fld in ("formula_2025", "formula_2026"):
            v = p.get(fld) or ""
            if re.search(r'Best\(|#|\^|◆|▲|~|\bWeighting\b|with WEIGHTING|\*|^a ', v):
                add("REVIEW", p, "formula_noise", f"{fld} still has footnote/code noise: {v!r}")

        # ── REVIEW: HKUST formula missing English/Math prefix ──
        if inst == "HKUST" and scored:
            f25 = p.get("formula_2025") or ""
            if "English" not in f25 and "Eng" not in f25:
                add("REVIEW", p, "hkust_fragment", f"formula_2025 has no English/Math prefix (fragment?): {f25!r}")

        # ── REVIEW: new programme (no 2025 data → counts can't be validated) ──
        if not scored:
            add("REVIEW", p, "new_programme", "no 2025 benchmark — new-for-2026 programme, scoring can't be cross-checked")

        # ── year_changes: structure + noise guard ──
        # The year-over-year diff must only ever cite canonical DSE subjects; a
        # Category-C subject in a WEIGHTING change means cross-year naming noise
        # leaked past the trusted-subject filter (the bug class this guards).
        yc = p.get("year_changes")
        if yc is not None:
            items = yc.get("items") if isinstance(yc, dict) else None
            if not isinstance(yc, dict) or not isinstance(items, list) or not items:
                add("ERROR", p, "year_changes_malformed", f"year_changes present but malformed: {yc!r}")
            else:
                for it in items:
                    if not isinstance(it, dict) or "type" not in it:
                        add("ERROR", p, "year_changes_malformed", f"bad change item: {it!r}")
                        continue
                    subj = it.get("subject")
                    if it["type"] in ("weighting", "compulsory_added", "compulsory_removed"):
                        if subj not in CANONICAL_SUBJECTS:
                            add("ERROR", p, "year_changes_subject", f"{it['type']} cites non-canonical subject {subj!r}")
                        elif it["type"] == "weighting" and subj in set(_REG["category_c"]):
                            add("ERROR", p, "year_changes_noise", f"weighting change on Category-C subject {subj!r} (cross-year naming noise)")
                kinds = [k for k, on in (("weighting", yc.get("weighting_changed")), ("formula", yc.get("formula_changed"))) if on]
                add("REVIEW", p, "year_changes", f"{'+'.join(kinds) or 'none'} change ({len(items)} item(s))")

    # ── report ──
    by_sev = defaultdict(list)
    for f in findings:
        by_sev[f[0]].append(f)
    n_err, n_rev = len(by_sev["ERROR"]), len(by_sev["REVIEW"])

    print(f"Validated {len(data)} programmes from {path}")
    print(f"  ERROR : {n_err}")
    print(f"  REVIEW: {n_rev}\n")

    for sev in ("ERROR", "REVIEW"):
        rows = by_sev[sev]
        if not rows:
            continue
        print(f"{'='*70}\n{sev} ({len(rows)})\n{'='*70}")
        by_check = defaultdict(list)
        for _, code, inst, check, msg in rows:
            by_check[check].append((code, inst, msg))
        for check in sorted(by_check):
            items = by_check[check]
            print(f"\n[{check}] {len(items)}")
            cap = len(items) if sev == "ERROR" else min(len(items), 25)
            for code, inst, msg in items[:cap]:
                print(f"  {code} {inst}: {msg}")
            if cap < len(items):
                print(f"  … and {len(items) - cap} more (run with the check name to see all)")

    print(f"\n{'PASS' if n_err == 0 else 'FAIL'} — {n_err} error(s), {n_rev} item(s) for manual review")
    sys.exit(1 if n_err else 0)


if __name__ == "__main__":
    main()
