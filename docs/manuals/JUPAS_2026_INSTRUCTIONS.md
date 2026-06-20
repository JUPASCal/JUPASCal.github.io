# JUPAS Cal 2026 — Project Instructions

## Overview
An unofficial JUPAS score calculator for HK university applicants. Users input their DSE subject grades; the tool calculates estimated scores per programme based on each university's published weighting formula, then compares against historical admission scores.

---

## Participating Institutions

### 8 Main Schools (UGC-funded)
| Abbr | Institution |
|------|-------------|
| HKU | University of Hong Kong |
| CUHK | Chinese University of Hong Kong |
| HKUST | Hong Kong University of Science and Technology |
| PolyU | Hong Kong Polytechnic University |
| CityU | City University of Hong Kong |
| HKBU | Hong Kong Baptist University |
| LingU | Lingnan University |
| EdUHK | Education University of Hong Kong |

### Other
| Abbr | Institution | Notes |
|------|-------------|-------|
| HKMU | Hong Kong Metropolitan University | Self-funded programmes |
| SSSDP | Study Subsidy Scheme for Designated Professions/Sectors | Aggregated list of various institutions; some HKMU programmes appear here instead of under HKMU |

---

## Data Needed Per School

For each school and each programme, the following must be collected:

| Data | Source Type | Notes |
|------|-------------|-------|
| JUPAS code | JUPAS website (scraped) | e.g. JS1000 |
| Programme name (EN + ZH) | JUPAS website (scraped) | |
| Quota | JUPAS website (scraped) | |
| Application statistics | JUPAS website (scraped) | |
| Offer statistics / admission scores | Per-university (PDF or webpage) | Varies by school |
| Subject weightings | Per-university (PDF or webpage) | Varies by school |
| Score calculation method | Per-university (PDF or webpage) | e.g. Best 5, 3 Cores + 2 electives |
| Minimum entry requirements | Per-university (PDF or webpage) | |
| Interview / non-academic requirement | Per-university interview-arrangement page or PDF | Interview / portfolio / audition / physical or written test, + before/after-HKDSE-results timing. Runbook: `INTERVIEW_SCRAPING.md` |

---

## Data Sources (Per School)

Each school publishes data differently. Common formats: PDF, HTML table, or downloadable Excel.

- **HKU** — Publishes scoring formula + expected scores PDF; also has web page
- **CUHK** — PDF with admission scores and weightings per programme
- **HKUST** — PDF with admission scores
- **PolyU** — Subject weighting PDFs per programme (bulk download possible via script)
- **CityU** — Combined PDF: score formula + admission scores
- **HKBU** — Subject weight table PDF; detailed score page online
- **LingU** — Weighting PDF + admission scores PDF
- **EdUHK** — Combined weighting & entrance requirements PDF + admission scores PDF
- **HKMU** — Admission scores PDF
- **SSSDP** — Varies per institution in the list

---

## Score Calculation Methods

Different schools / programmes use different formulas. Common patterns:

- **Best 5** — Top 5 subject scores (with or without Chinese/English/Maths required)
- **3 Cores + 2 Electives** — Compulsory Chinese, English, Maths + best 2 electives
- **3 Cores + 2 Electives (Science required)** — As above but one elective must be a science subject
- **Weighted score** — Each subject multiplied by a programme-specific weighting factor
- **Bonus points** — Some schools add bonus for certain subjects or grades

---

## Automation Status (2026 cycle — complete)

All per-school scrapers are implemented and have been run. See `CLAUDE.md` for the script reference table.

- JUPAS overview: `scripts/extraction/2026_scrap.py` → `data/raw/2026 JUPAS Program Overview.xlsx`
- Per-school JSON outputs: `Reference(2026)/{School}/{School}_2026_Data.json`
- Unified master: `data/processed/JUPAS_2026_Unified_Data.json` (432 programmes)

---

## Web Application

The Excel-based calculator has been replaced with a static web app:
- `index.html` + `js/calculator.js` + `js/ui.js` + `css/style.css`
- Pure vanilla JS, hosted on GitHub Pages, no backend
- See `docs/manuals/WEBAPP_PLAN.md` for architecture details

---

## Workflow for 2026 Update

1. [x] Archive 2024 & 2025 files
2. [x] Create `scripts/extraction/2026_scrap.py` and run → `data/raw/2026 JUPAS Program Overview.xlsx` + `data/raw/2026 JUPAS Offer Table.xlsx` (422 programmes)
3. [x] Collect per-school weighting & admission score data (all 10 institutions complete)
4. [x] Build automation scripts per school
5. [x] Compile and unify: `~/miniconda3/envs/jupascal/bin/python scripts/utils/unify_2026_data.py`
6. [x] **Gate 1 — validate:** `~/miniconda3/envs/jupascal/bin/python scripts/utils/validate_unified.py` (must report `ERROR: 0`; eyeball the REVIEW items)
7. [x] **Gate 2 — eligibility audit:** `npm run audit` (from the repo root; must end `PASS — 0 hard-gate failure(s)`)
8. [x] Build web app (replaced OneDrive Excel embed)
9. [ ] Commit and open Pull Request on GitHub

### Subject vocabulary (single source of truth)
All DSE subject names live in **`data/raw/subjects.canonical.json`** — consumed by
both the Python pipeline (`unify_2026_data.py`, `validate_unified.py`) and the TS
frontend (`src/lib/subjects.ts`, `calculator.ts`). The eligibility matcher
compares subjects by **exact equality**, so a stored subject that isn't a canonical
name silently never matches (a qualified applicant is wrongly rejected). To add a
new subject or a new institutional spelling, **edit only this file** (add the alias →
canonical mapping), rerun unify, and let Gates 1 & 2 confirm everything is in sync.
Never re-introduce hand-maintained subject lists elsewhere. See the project memory
note *Elective subject parsing* for the bug class this prevents.
