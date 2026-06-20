# JUPAS Cal — Calculation Logic & Engine

This document defines the computational logic for the JUPAS 2026 Calculator. The logic is designed to be purely client-side (JavaScript) while maintaining bit-perfect parity with our Python reference implementation.

## 1. The Calculation Pipeline

For a given programme and a student's grades, the engine follows these four steps:

### Step A: Grade Conversion
Convert DSE letter/number grades into raw points using the programme's specific `score_conversion_table`. Each programme's table is pre-embedded in the JSON, so no manual branching is required in code.

For reference, the two scales in use are:

| Scale | Institutions | 5** | 5* | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|---|---|---|
| **8.5 Scale** | HKU, HKUST, CityUHK, PolyU, CUHK (most programmes) | 8.5 | 7.0 | 5.5 | 4.0 | 3.0 | 2.0 | 1.0 |
| **7 Scale** | LingnanU, EdUHK, HKBU, HKMU, SSSDP, CUHK Medicine (JS4501/JS4502) | 7.0 | 6.0 | 5.0 | 4.0 | 3.0 | 2.0 | 1.0 |

*   **Other Language (Cat C):** A=5, B=4, C=3, D=2, E=1 (standard); CUHK Medicine uses A=7, B=6, C=5, D=4, E=3.
*   **CSD:** Attained → 0 points (excluded from Best-N pool entirely).
*   **ApL:** Attained with Distinction → 4, Attained → 3 (only counted if explicitly listed in `subject_weights_2025`).

### Step B: Weighting Application
Apply multipliers from `subject_weights_2025` and `best_of_weights_2025`.
*   **Flat Weight:** `weighted_score = converted_points * multiplier`
*   **Conditional Pool:** Identify the top N subjects from a pool (e.g., M1 or M2) and apply the pool's multiplier to them.

### Step C: Constraint Filtering
Filter the subjects based on `calculation_constraints`:
*   **Compulsory Subjects:** These MUST be included in the total, regardless of their score.
*   **Mutual Exclusivity:** E.g., `maths_m1m2_as_one` prevents the calculator from using both Core Math and M1/M2 in the same "Best N" total.

### Step D: Selection (Best N)
1.  Add all **Compulsory Subjects** to the selection.
2.  Sort all remaining eligible subjects by their **weighted score** in descending order.
3.  Fill the remaining slots (e.g., up to 5 for "Best 5") with the highest-scoring subjects.

---

## 2. HKUST-Specific Rules

HKUST's scoring logic was reverse-engineered from their official client-side JS calculator. Two rules differ from other institutions:

### 6th Subject Bonus
HKUST adds a bonus for the best 6th subject using a fixed rate per programme:

```
bonus = max_attainable_weighting × (bonus_percentage / 100) × 6th_subject_converted_score
```

- `max_attainable_weighting` — the sum of all multipliers in the optimal best-5 selection (programme-specific). Computed by the unifier as: `sum(explicit_weights) + pool_slots × pool_weight + remaining_slots × 1.0`. E.g., for JS5212 = 9.0; for JS5312 = 7.5 (ENG×2 + MATH×2 + pool×1.5 + 2×1).
- `bonus_percentage` = 5 (global, hardcoded in the HKUST calculator).
- `6th_subject_converted_score` — the raw converted grade points of the best unused subject from eligible categories.

Example (JS5212, 5** = 8.5 pts): `bonus = 9.0 × 0.05 × 8.5 = 3.825`

**UI display:** The bonus is shown as `+N% of total` in the weight column, where N = `(subject_basePoints / 8.5) × 5`. This is a grade-relative display (e.g., 5* → +4.12%, grade 5 → +3.24%) — it is **not** a percentage of the subject's own points, and **not** a percentage of the total score. The actual bonus value (added directly to the total) is shown in the Final column. A footnote is displayed below the breakdown table to clarify this for users.

The eligible categories for the 6th subject are stored in `hkust_weighted_best.bonus_eligible_categories` (varies by programme — e.g., some include Category B/C, others only Core/Cat A/Cat C).

### Better-of Programmes
JS5312 (Finance), JS5331 (Accounting & Finance), JS5332 (Investment Management), JS5822 (Quantitative Finance) offer two scoring options and admit the higher:
- **Option A:** Best 3 subjects (any) × 1
- **Option B:** Best 1 from {Chem, Phys, Econ, M1, M2} × 1.5 + best 2 other subjects × 1

Since option B is always ≥ option A (when a qualifying subject is available), this is handled by storing the pool in `best_of_weights_2025`. The calculator's existing pool logic naturally applies × 1.5 when the student has a qualifying subject; if not, the pool has no effect and option A applies.

**Important:** The `max_attainable_weighting` for these programmes is 7.5 (with the pool), not 7.0 (plain). The unifier computes this from the formula structure. Note that in HKUST documentation, "HA" stands for **Highest Attainable** score (the theoretical maximum with all 5**), which should align with our calculated `max_achievable_score`.

### M1 / M2 Interchangeability
All HKUST programmes (and most others) treat M1 and M2 identically — a student who took both will only have one counted. The pool logic with `count: 1` already ensures only the better of M1/M2 receives the weighted multiplier. However, if both M1 and M2 are taken, both could still enter the best-N selection (one at the pool weight, one at ×1). A `maths_m1m2_as_one` constraint (already present for CityU) prevents this for programmes that flag it. This is a known gap for HKUST programmes — pending UI fix to present M1/M2 as a single combined input.

---

## 3. Reference Implementations

*   **Python (Ground Truth):** `scripts/utils/calculation_engine.py`
*   **JavaScript (Production):** `js/calculator.js`

## 3. Data Audit Trail
Every calculation result must return an `audit_trail` object containing:
1.  The list of subjects selected (green in UI).
2.  The raw conversion points.
3.  The multipliers applied.
4.  The final weighted score per subject.
