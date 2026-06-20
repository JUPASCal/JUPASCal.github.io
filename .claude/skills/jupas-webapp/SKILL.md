---
name: jupas-webapp
description: Web app development guide for the JUPASCal static web application. Use this skill when implementing new features, debugging UI or calculator integration, adding institution filtering, sorting, persistence, or any other frontend work. Triggers on "add a feature to the web app", "implement X in ui.js or calculator.js", "sort programmes", "filter by institution", "localStorage", "URL hash", "persistence", "bilingual support", "chance indicator", "audit trail display", or any frontend development work on the JUPAS calculator.
---

# JUPAS Web App Development Guide

Architecture reference: `docs/manuals/WEBAPP_PLAN.md`
Score logic: `docs/manuals/SCORE_LOGIC.md`
Calculation pipeline: `docs/manuals/CALCULATION_LOGIC.md`

---

## Architecture

```
index.html          — Entry point; loads JSON + scripts
js/calculator.js    — Pure logic "Brain"; stateless functions, no DOM
js/ui.js            — UI Controller; DOM, events, state, rendering
css/style.css       — Layout, institution themes, Excel-style highlights
data/processed/JUPAS_2026_Unified_Data.json  — 432 programmes, single source of truth
```

**Constraints:**
- Pure vanilla JS — no frameworks, no build step
- Static GitHub Pages — no backend, no server
- All calculations run in the user's browser

---

## Year Labeling Rule (Critical — Never Break This)

```javascript
// CORRECT
const eligibility = JUPAS_CALCULATOR.checkEligibility(grades, programme.min_requirements_2026);
const result = JUPAS_CALCULATOR.calculateScore(grades, programme, "2025");

// WRONG — mixing 2026 weights with 2025 scores makes the comparison unfair
const result = JUPAS_CALCULATOR.calculateScore(grades, programme, "2026");
```

| Data | Field | Used for |
|------|-------|----------|
| 2025 weights + formula | `subject_weights_2025`, `formula_2025_id`, `best_of_weights_2025` | Score calculation |
| 2025 admission scores | `scores_2025` (median, lq, uq) | Comparison benchmark |
| 2026 requirements | `min_requirements_2026` | Eligibility check only |
| 2026 weights | `subject_weights_2026`, `formula_2026` | Reference display only — not used in scoring |

Score labels in the UI should say: *"Calculated using 2025 formula — for fair comparison against 2025 admission figures"*

---

## Grade Scales

Each programme has a pre-embedded `score_conversion_table` — the calculator uses it directly. For UI purposes:

| Scale | 5** value | Institutions |
|-------|-----------|--------------|
| 8.5 | 8.5 | HKU, HKUST, CityU, PolyU, CUHK (most) |
| 7 | 7.0 | LingU, EdUHK, HKBU, HKMU, SSSDP, CUHK Medicine (JS4501/JS4502) |

---

## Institution-Specific UI Notes

| Institution | Note |
|-------------|------|
| HKBU | Scores are **estimated** from grade breakdowns. Must show disclaimer: *"Median and LQ scores are estimated based on subject grade breakdowns and may be slightly conservative."* |
| HKUST | No `uq` field — only `median`, `lq`, `max_achievable_score`. Don't render a UQ row. |
| LingU | Subject breakdown grades must NOT be summed. Only use published weighted total (`median`, `lq`). The `score_breakdown_warning` constraint flag signals this. |

---

## Audit Trail Display

Every `calculateScore()` call returns an `audit_trail` object. The UI should display:
- Which subjects were selected (highlight in **green**)
- Raw converted points per subject
- Multiplier applied per subject
- Final weighted score per subject
- Total

This mirrors the original Excel logic and is a key trust/transparency feature.

---

## Eligibility Badges

Real-time feedback on whether the student meets `min_requirements_2026`. Show:
- University-wide baseline check (332A33 or 332A22 depending on institution)
- Programme-specific requirements

**Baselines:**
- **332A33:** HKU, CUHK, HKUST, PolyU, CityU, HKBU
- **332A22:** LingU, EdUHK, HKMU, SSSDP

---

## Pending Features (from WEBAPP_PLAN.md §4)

### Grade & Search Persistence
- Use `localStorage` (not cookies — no server transmission, 5MB vs 4KB, simpler API)
- For shareability, encode grades in **URL hash** (`#`) — hash is never sent to server, appears in no logs
- Pattern: hash as primary (shareable), localStorage as fallback (returning visits)
- **Security:** Always sanitize before rendering. Use `textContent` not `innerHTML` for any user-derived values. Validate grade inputs against the allowed set before applying.

### Sorting & Ranking
- Sort all 432 programmes by `(userScore - scores_2025.median)` or `(userScore - scores_2025.lq)`
- Show programmes closest to student's score range first
- Add "chance indicator" (green/yellow/red) based on score vs median/LQ

### Institution Filtering
- Filter by `institution` field
- Valid values: HKU, CUHK, HKUST, PolyU, CityU, HKBU, LingU, EdUHK, HKMU, SSSDP
- Use checkboxes; default all selected

### Bilingual Support
- Toggle between EN/ZH for programme names and UI labels
- Use `programme_name_en` / `programme_name_zh` fields already in JSON
- Term glossary at `data/raw/term_glossary.json` for UI string translations

---

## Security Checklist

When implementing URL hash or localStorage features:
- Parse hash/storage values with strict allowlists (valid grades: `5**`, `5*`, `5`, `4`, `3`, `2`, `1`, `U`, `A`, `B`, `C`, `D`, `E`, `ATT_D`, `ATT`)
- Never pass user-derived strings directly to `innerHTML`, `eval`, or `document.write`
- Use `textContent` for all user-derived display values
- URL hash is safe from server-side injection; still validate client-side for DOM XSS
