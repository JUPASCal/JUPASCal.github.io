---
name: jupas-validate
description: Validates the JUPAS unified JSON dataset for schema compliance, field completeness, year labeling consistency, and institutional quirks. Use this skill when checking data quality after running scrapers or editing the JSON, debugging missing fields, or verifying data before deploying the web app. Triggers on "validate the JSON", "check the data", "missing fields", "data quality", "something looks wrong with the data", "check the unified JSON", or any reference to auditing JUPAS_2026_Unified_Data.json.
---

# JUPAS Data Validator

Validates `data/processed/JUPAS_2026_Unified_Data.json` against the project's data model.
Full institutional quirks: `docs/manuals/DATA_UNIFICATION_LEARNINGS.md`
Grade scale reference: `docs/manuals/CALCULATION_LOGIC.md`

---

## Quick Validation Script

Run from project root to catch the most common issues:

```bash
~/miniconda3/envs/jupascal/bin/python -c "
import json
from collections import Counter

with open('data/processed/JUPAS_2026_Unified_Data.json') as f:
    data = json.load(f)

print(f'Total entries: {len(data)}  (expect ~432)')

# Duplicate codes
codes = [e['jupas_code'] for e in data]
dupes = [c for c, n in Counter(codes).items() if n > 1]
print(f'Duplicate codes: {dupes or \"none\"}')

# Missing critical fields
for field in ['subject_weights_2025', 'min_requirements_2026', 'scores_2025', 'score_conversion_table']:
    missing = [e['jupas_code'] for e in data if not e.get(field)]
    if missing:
        print(f'Missing {field}: {missing}')

# Count by institution
from collections import Counter
by_inst = Counter(e['institution'] for e in data)
for inst, count in sorted(by_inst.items()):
    print(f'  {inst}: {count}')
"
```

---

## Checklist: Required Fields (Every Entry)

| Field | Type | Notes |
|-------|------|-------|
| `jupas_code` | string | Format `JS\d{4}` |
| `institution` | string | One of 10 valid institutions |
| `programme_name_en` | string | English name |
| `programme_name_zh` | string | Chinese name |
| `formula_2025_id` | string | Calculation formula identifier |
| `subject_weights_2025` | dict | Subject → multiplier |
| `calculation_constraints` | array | May be empty `[]` but must exist |
| `min_requirements_2026` | dict | Subject → minimum grade |
| `scores_2025` | dict | At least `median` |
| `score_conversion_table` | dict | Grade → points |

---

## Scores by Institution

| Institution | Expected score fields |
|-------------|----------------------|
| HKU | `uq`, `median`, `lq` |
| CUHK | `uq`, `median`, `lq` |
| HKUST | `median`, `lq`, `max_achievable_score` (no `uq`) |
| PolyU | `median`, `lq`, `average` |
| CityU | `median`, `lq` |
| HKBU | `weighted_mean` + grade breakdown fields |
| LingU | `median`, `lq` |
| EdUHK | `median`, `lq` |
| HKMU | `median`, `lq` |

---

## Year Labeling Rule

The invariant: **2025 fields drive scoring, 2026 fields drive eligibility only.**

- `subject_weights_2025` — must be non-empty for all entries
- `min_requirements_2026` — must exist for all entries
- `subject_weights_2026` — may be absent for HKMU/SSSDP (acceptable)
- `data_year_scores=2025`, `data_year_weightings=2026` for all main schools
- For HKMU/SSSDP: both fields = 2025

---

## Grade Conversion Table Check

Each `score_conversion_table` should reflect the institution's scale:

| Scale | 5** value | Institutions |
|-------|-----------|--------------|
| 8.5 | 8.5 | HKU, HKUST, CityU, PolyU, CUHK (most programmes) |
| 7 | 7.0 | LingU, EdUHK, HKBU, HKMU, SSSDP, CUHK Medicine (JS4501/JS4502) |

---

## Baseline Requirements Check

Every programme must satisfy the university-wide minimum. Check `min_requirements_2026` contains at least:

| Baseline | Institutions | Minimum |
|----------|-------------|---------|
| 332A33 | HKU, CUHK, HKUST, PolyU, CityU, HKBU | CHI≥3, ENG≥3, MATHS≥2, CSD≥A |
| 332A22 | LingU, EdUHK, HKMU, SSSDP | CHI≥3, ENG≥3, MATHS≥2, CSD≥A (but LingU/EdUHK accept Level 2) |

The unifier's `apply_baselines` layer should enforce these automatically. If any programme is missing core requirements, it likely means the per-school scraper had an extraction error.

---

## Known Acceptable Exceptions

These are not bugs — don't flag them as errors:

| Code/School | Exception | Reason |
|-------------|-----------|--------|
| HKUST 17 programmes | Missing `formula_text_2025` | Merged-cell PDF limitation; calculator uses `engMultiplier`/`secondMultiplier` |
| PolyU JS3160 | Missing 2025 weights | Likely a new programme |
| HKBU all | No raw `median`/`lq` numeric scores | Only weighted mean + grade breakdowns published |
| CUHK JS4501/JS4502 | `score_conversion_table` uses 7 scale | Medicine uses `5**=7` — intentional |

---

## Constraint Flags to Verify

Check `calculation_constraints` for these flags where expected:

| Flag | Expected on |
|------|------------|
| `medicine_conversion_scale` | CUHK JS4501, JS4502 |
| `score_breakdown_warning` | All LingU entries |
| `maths_m1m2_as_one` | CityU entries |
| `additional_bonus_6th` | PolyU entries |
| HKUST 6th subject bonus | All HKUST entries |
| `max_weighted_subjects` | CUHK Science entries |
