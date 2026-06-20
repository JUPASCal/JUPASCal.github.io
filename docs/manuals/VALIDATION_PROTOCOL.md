# JUPAS Cal — Validation Protocol

This document defines the standardized process for validating university-specific calculation logic. Following this protocol ensures bit-perfect parity between official university calculators and our engine.

## 1. Logic Audit Workflow

Whenever a new university is added or a formula is updated, follow these four steps:

### Step A: Formula String Extraction
Audit the raw source data to identify all unique formula variants.
- **Command:** `grep "score_formula" Reference(2026)/School/Data.json | sort | uniq -c`
- **Goal:** Ensure the Unification script (`scripts/utils/unify_2026_data.py`) has regex patterns for every variant found.

### Step B: Constraint Mapping Verification
Verify that strings are correctly mapped to machine-readable constraints in `data/processed/JUPAS_2026_Unified_Data.json`.
- **Key Flags to Check:**
    - `compulsory_subjects`: Fixed subjects like ENG/MATH.
    - `compulsory_subject_pool`: "Best 1 of Bio/Chem/Phys".
    - `maths_m1m2_as_one`: Mutual exclusivity of Core and M1/M2.
    - `bonus_6th` / `bonus_7th`: Multiplier-based bonuses.
    - `m1m2_half_replacement`: Special CUHK Medicine logic.

### Step C: Manual Trace (The "All 5**" Test)
Pick a programme and perform a manual calculation with a student having all 5** (8.5 points).
1. Apply multipliers to all subjects.
2. Select Compulsory subjects first.
3. Select Best-N from remaining.
4. Calculate Bonus (ensure it uses **Weighted** vs **Base** points correctly per school rules).
5. Compare total against the UI output.

### Step D: Audit Trail Review
Check the UI "Your Calculation Detail" table:
- Are multipliers shown correctly (e.g., x1.5)?
- Are bonuses labeled correctly (e.g., "+0.1x" or "+5% of total")?
- Are unused subjects marked correctly?

---

## 2. Institutional Test Cases (Validated 2026)

| School | Test Case | Expected Logic |
| :--- | :--- | :--- |
| **PolyU** | `JS3003` | Best 5 + 6th Bonus (10% of **Weighted** Score of 6th subject). |
| **HKU** | `JS6711` | Best 5 + 6th Bonus (0.5x) + 7th Bonus (0.2x). |
| **CUHK** | `JS4501` | Medicine 7-point scale + M1/M2 replaces 50% of worst subject. |
| **HKUST** | `JS5312` | Better-of pool (1.5x for Sci/Math) + 6th Bonus (5% of HA weighting). |
| **CityU** | `JS1801` | 4 Compulsory subjects (CHI/ENG/MATH/BIO/CHEM) + Best 1. |

## 3. Regression Testing
After any change to `js/calculator.js`, rerun the "All 5**" test for one programme from each of the 5 major schools above to ensure no global logic regressions were introduced.
