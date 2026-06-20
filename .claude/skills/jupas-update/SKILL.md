---
name: jupas-update
description: Annual JUPAS data update workflow for the JUPASCal project. Use this skill when updating data for a new cycle — running scrapers, re-extracting PDFs, unifying data, or doing any part of the annual update. Triggers on "run the scrapers", "update the data", "annual update", "run unify", "new cycle data", "start the 20XX update", or any mention of collecting or refreshing JUPAS institutional data.
---

# JUPAS Annual Data Update Workflow

Guides the annual data collection, extraction, and unification process.
Full institutional quirks reference: `docs/manuals/DATA_UNIFICATION_LEARNINGS.md`
Data source details per school: `docs/manuals/JUPAS_2026_INSTRUCTIONS.md`

## Environment

- **Python env:** `~/miniconda3/envs/jupascal/bin/python` — always use full path, never bare `python`
- **Working directory:** project root
- **Packages available:** pandas, pdfplumber, bs4, playwright

---

## Step 1: JUPAS Overview Scrape

```bash
~/miniconda3/envs/jupascal/bin/python scripts/extraction/2026_scrap.py
```

Outputs:
- `data/raw/2026 JUPAS Program Overview.xlsx`
- `data/raw/2026 JUPAS Offer Table.xlsx` (~422 programmes)

---

## Step 2: Per-School Scrapers

Run each scraper from the project root. Order matters for schools that cross-reference PDFs.

| School | Script | Output |
|--------|--------|--------|
| HKU | `scripts/extraction/hku_scrap.py` | `Reference(2026)/HKU/HKU_2026_Data.json` |
| CUHK | `scripts/extraction/cuhk_scrap.py` | `Reference(2026)/CUHK/CUHK_2026_Data.json` |
| HKUST | `scripts/extraction/hkust_scrap.py` | `Reference(2026)/HKUST/HKUST_2026_Data.json` |
| PolyU | `scripts/extraction/polyu_scrap.py` | `Reference(2026)/PolyU/PolyU_2026_Data.json` |
| CityU | `scripts/extraction/cityu_scrap.py` | `Reference(2026)/CityU/CityU_2026_Data.json` |
| HKBU | `scripts/extraction/hkbu_pdf_extract.py` | `Reference(2026)/HKBU/HKBU_2026_Data.json` |
| LingU | `scripts/extraction/lingu_score_extract.py` | `Reference(2026)/LingU/LingU_2026_Data.json` |
| EdUHK | `scripts/extraction/eduhk_pdf_extract.py` | `Reference(2026)/EdUHK/EdUHK_2026_Data.json` |
| HKMU | `scripts/extraction/hkmu_pdf_extract.py` | `Reference(2026)/HKMU/HKMU_2026_Data.json` |
| SSSDP | `scripts/extraction/sssdp_pdf_extract.py` | `Reference(2026)/SSSDP/SSSDP_2026_Data.json` |

Run each with:
```bash
~/miniconda3/envs/jupascal/bin/python scripts/extraction/<script>.py
```

---

## Step 2b: Interview / Non-Academic Requirement Scrapers

Collects per-programme interview / portfolio / audition / physical-test info **with
before/after-HKDSE timing** for the analysis "duties" reminders. Full runbook +
per-school quirks + the CityU/Incapsula lesson: **`docs/manuals/INTERVIEW_SCRAPING.md`**.

```bash
for s in hku cuhk polyu eduhk hkbu lingu hkmu cityu; do
  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/${s}_interview_scrap.py
done
# HKUST: hand-curated Reference(<year>)/HKUST/hkust_interview.json — re-verify its 5 codes
```

Output: `Reference(<year>)/<School>/<school>_interview.json` (9/9 institutions; SSSDP TODO).

- **CityU is behind Imperva Incapsula** — a cold run returns an ~880-byte stub. Do NOT escalate to a headed browser / Selenium / proxies; the block is **IP-reputation + time** based. Warm the IP (browse the site a few times / wait) and **retry with backoff** — the same headless Chromium scraper then works. Last resort: delegate to `codex exec`.
- Validate with `npm run audit:selection` (run from the repo root).

---

## Step 3: Unify

```bash
~/miniconda3/envs/jupascal/bin/python scripts/utils/unify_2026_data.py
```

Output: `data/processed/JUPAS_2026_Unified_Data.json`
Expected: ~432 entries across all 10 institutions.

---

## Step 4: Validate

After unifying, run the `jupas-validate` skill or do a quick sanity check:
- Total entries ~432
- No duplicate JUPAS codes
- `subject_weights_2025`, `scores_2025`, `min_requirements_2026` present on all entries

---

## Key Notes for Next Cycle

When incrementing the year (e.g., from 2026 to 2027):
- Update the `_2026` suffix in all script output paths and variable names
- Move current `subject_weights_2026` → `subject_weights_2025` (they become the calculation weights)
- Move current `subject_weights_2025` → archive / drop
- The new cycle's admission scores won't be available until published by universities
- `data_year_scores` and `data_year_weightings` fields in JSON must be updated accordingly
- **Interview scrapers (Step 2b):** bump the hardcoded `Reference(2026)` path in each `*_interview_scrap.py`; refresh the CUHK interview-PDF URL (changes yearly) and the HKDSE result-release date constant (drives CityU/PolyU/LingU/HKMU timing); re-verify HKUST's curated 5. See the checklist in `docs/manuals/INTERVIEW_SCRAPING.md`.

For HKMU and SSSDP: both fields (`data_year_scores` and `data_year_weightings`) are typically the same year since these institutions don't publish separate cycle data.

---

## Data Source Format Reference

| School | Format | Notes |
|--------|--------|-------|
| HKU | HTML/API + PDF | `accordionHTML` in API response for bonus/repeater policies |
| CUHK | PDF | Inconsistent row structure — scanner handles adjacent-row mapping |
| HKUST | JS calculator data | `engMultiplier`/`secondMultiplier` fields; 17 programmes lack `formula_text_2025` (merged cells) |
| PolyU | Playwright + drupalSettings | Compact weight string format: `Subject (W=X, CatY); ...` |
| CityU | Combined PDF + API | CSD requirement hardcoded as `"csd": "A"` (API omits it) |
| HKBU | PDF | Only publishes weighted mean; median/LQ estimated from grade breakdowns |
| LingU | Weight PDF + score PDF | `score_breakdown_warning` constraint must be set — do NOT sum subject breakdowns |
| EdUHK | Combined PDF | Multi-line Remarks column spans merged cells |
| HKMU | PDF | Flexible admission: Level 2 CHI/ENG allowed under certain conditions |
| SSSDP | Varies | Multi-institutional; some HKMU programmes appear here instead |
