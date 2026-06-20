---
name: jupas-calc-debug
description: Traces the full JUPAS score calculation pipeline step by step for a given programme and student grades. Use this skill when debugging why a score doesn't match expectations, verifying a formula is applied correctly, understanding how a specific programme is scored, or checking calculation logic. Triggers on "why is the score wrong", "trace the calculation", "debug the formula", "how is JS#### scored", "check the weighting", "score doesn't match", "verify the calculation", or any request to step through a JUPAS score calculation.
---

# JUPAS Score Calculation Debugger

Walks through the 4-step pipeline for a given programme + student grade inputs.

Reference implementations:
- **Python (ground truth):** `scripts/utils/calculation_engine.py`
- **JavaScript (production):** `js/calculator.js`
- **Pipeline spec:** `docs/manuals/CALCULATION_LOGIC.md`

---

## The 4-Step Pipeline

### Step A: Grade Conversion

Look up `score_conversion_table` in the programme's JSON entry. Convert each DSE grade to numeric points.

**Grade scales:**

| Scale | 5** | 5* | 5 | 4 | 3 | 2 | 1 | Institutions |
|-------|-----|----|----|---|---|---|---|--------------|
| 8.5 | 8.5 | 7.0 | 5.5 | 4.0 | 3.0 | 2.0 | 1.0 | HKU, HKUST, CityU, PolyU, CUHK (most) |
| 7 | 7.0 | 6.0 | 5.0 | 4.0 | 3.0 | 2.0 | 1.0 | LingU, EdUHK, HKBU, HKMU, SSSDP, CUHK Medicine |

Special cases:
- **CSD:** Attained → 0 pts; excluded from Best-N pool entirely (never counted)
- **ApL:** Attained with Distinction → 4, Attained → 3; only counted if explicitly listed in `subject_weights_2025`
- **Other Language (Cat C):** A=5, B=4, C=3, D=2, E=1 (standard); CUHK Medicine (JS4501/JS4502): A=7, B=6, C=5, D=4, E=3

### Step B: Weighting Application

Apply multipliers from `subject_weights_2025`:
- **Flat weight:** `weighted_score = converted_points × multiplier`
- **Best-of pool** (from `best_of_weights_2025`): identify the top N subjects from a named pool, apply the pool's multiplier to those N subjects only

Example of a best-of pool: `Best(1,[M1,M2]):1.5` → take the best 1 of M1/M2, multiply by 1.5.

### Step C: Constraint Filtering

Read `calculation_constraints` array. Each constraint is a flag that changes how subjects are selected.

| Constraint Flag | Effect |
|----------------|--------|
| `compulsory_subjects` | Named subjects MUST appear in the final total, regardless of their score rank |
| `maths_m1m2_as_one` (CityU) | Core Maths and M1/M2 count as a single slot — can't use both |
| `max_weighted_subjects` (CUHK) | Cap the number of subjects that receive bonus weightings (e.g., max 3 at 1.5×) |
| `medicine_conversion_scale` (CUHK JS4501/JS4502) | Use 7-scale (`5**=7`) instead of 8.5-scale |
| `additional_bonus_6th` (PolyU) | Apply percentage-based bonus for the 6th DSE subject |
| `hkust_weighted_best` | HKUST 6th subject bonus: `max_attainable_weighting × 5% × subject_score`. The `max_attainable_weighting` is the sum of all multipliers in the optimal best-5 — **computed by the unifier from the formula structure**, not sourced from the PDF's HA score. |
| `score_breakdown_warning` (LingU) | Individual subject breakdowns are statistical midpoints — do NOT sum them |

### Step D: Best-N Selection

1. Add all **compulsory subjects** to the selection
2. Sort all remaining eligible subjects by their **weighted score** descending
3. Fill remaining slots up to N (typically 5) with highest-scoring eligible subjects
4. Sum all selected → **total score**

---

## Year Labeling Rule

Always use **2025 fields** for calculation. The 2026 calculator compares against 2025 admission scores — using 2026 weights would make the comparison unfair if a school changed its formula.

| Field | Use for |
|-------|---------|
| `subject_weights_2025` | Multipliers in Step B |
| `formula_2025_id` | Formula type (Best-5, 3Core+2, etc.) |
| `best_of_weights_2025` | Pool logic in Step B |
| `scores_2025` | Comparison benchmark after Step D |
| `min_requirements_2026` | Eligibility check only (separate from scoring) |

---

## Debugging Checklist

When a calculated score doesn't match expectations, check in order:

1. **Wrong grade scale?**
   Check `score_conversion_table`. Is `5**` → 8.5 or 7.0? CUHK Medicine must use 7.0.

2. **Subject not weighted?**
   Check `subject_weights_2025`. Is the subject listed? Unlisted subjects get weight 1.0 by default. **Common HKUST trap:** `Mathematics Compulsory Part` (no parentheses) will not match the student's `Mathematics (Compulsory Part)` key — always ensure all HKUST data passed through `normalize_subject()` in the unifier. A fallback `normalizeSubjectKey()` in `calculator.js` guards against this.

3. **Pool not applying?**
   Check `best_of_weights_2025`. Are subject names in `pool.subjects` canonical? (E.g., `Mathematics Extended Part (Module 1)`, not the HKUST-style `Mathematics Extended Part (Calculus and Statistics) - Module 1`.) The pool subjects must exactly match the student grade keys.

4. **Constraint not applied?**
   Check `calculation_constraints`. Is there a `compulsory_subjects` entry forcing a low-scoring subject in? Is `maths_m1m2_as_one` blocking both Core and M1?

5. **Best-N count wrong?**
   Count the subjects selected in the audit trail. Does it match the programme's N?

6. **HKUST 6th bonus wrong?**
   Verify `max_attainable_weighting` in `hkust_weighted_best`. It should equal the sum of all multipliers in the optimal best-5. For better-of programmes (JS5312/JS5331/JS5332/JS5822) with ENG×2 + MATH×2 + pool×1.5 + 2×1, the value is 7.5. If it shows 7.0 or 9.0 unexpectedly, the unifier may have calculated it from the wrong formula structure.

7. **HKUST missing formula?**
   17 HKUST programmes have no `formula_text_2025` (merged-cell PDF issue). The calculator should fall back to `engMultiplier` / `secondMultiplier`.

6. **HKBU score?**
   HKBU doesn't publish numeric median/LQ. Scores are **estimated** by applying 2025 weights to grade breakdowns. This is an intentional risk-adverse overestimate — slightly higher than the true median.

---

## Comparing Against Admission Scores

After calculating, look up `scores_2025` for context:

| Field | Meaning |
|-------|---------|
| `median` | ~50th percentile of admitted students |
| `lq` (lower quartile) | ~75th percentile — a safer target |
| `uq` (upper quartile) | ~25th percentile — competitive benchmark |
| `max_achievable_score` | HKUST only — highest attainable weighted total (theoretical all-5** maximum) |

Note: HKUST has no `uq` field. They publish median, LQ, and HA. **HA in the PDF is the actual highest score observed among admitted students, NOT the theoretical all-5** maximum** — these are often different values. The theoretical max is stored in `max_achievable_score` and computed from the formula structure.

---

## Quick Python Trace

To trace a calculation for a specific code, run from project root:

```bash
~/miniconda3/envs/jupascal/bin/python scripts/utils/calculation_engine.py
```

Or load interactively:

```python
import json
with open('data/processed/JUPAS_2026_Unified_Data.json') as f:
    data = json.load(f)

prog = next(e for e in data if e['jupas_code'] == 'JS1111')
print(json.dumps(prog['subject_weights_2025'], indent=2))
print(json.dumps(prog['calculation_constraints'], indent=2))
print(json.dumps(prog['scores_2025'], indent=2))
```
