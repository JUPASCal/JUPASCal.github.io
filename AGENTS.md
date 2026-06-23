# JUPAS Cal — Master Project Context

This document is the single source of truth for all AI agents (Gemini, Claude, etc.) interacting with the JUPAS Cal project. It defines the project identity, architectural standards, and operational mandates.

---

## 1. Project Overview
**JUPAS Cal** is an unofficial annual score calculator for Hong Kong DSE (Diploma of Secondary Education) applicants.
- **Function**: Users input DSE grades → tool calculates estimated scores for **422 programmes** across 10 institutions → compares results against historical admission data.
  - **The programme count is NOT hardcoded** - it is `__PROGRAMME_COUNT__`, a Vite `define` in `vite.config.ts` read from `data/processed/JUPAS_2026_Unified_Data.json` at build time. Do not type a literal programme count in UI copy.
  - **New programmes are auto-included** by `scripts/utils/unify_2026_data.py` when they appear in the JUPAS listing but are missing from per-school feeds. They use baseline requirements, estimated scoring logic, null historical scores, and appear as no-2025-data programmes.
- **Goal**: Help students gauge their admission chances based on complex, institution-specific weightings.
- **Scope**: Educational and informational purposes only.

---

## 2. Directory Structure
- `index.html`, `src/`, `public/`, `vite.config.ts`, `package.json`: the current React + TypeScript (Vite) web app at the repo root. `npm run build` writes `dist/`.
- `src/App.tsx`: top-level app orchestrator for profiles, grades, picked programmes, filters/sort state, data loading, share/hash state, desktop/mobile layout selection, and mobile navigation history.
- `src/components/`: React UI components. Key files include `AdvisorConsole.tsx`, `DetailPanel.tsx`, `FiltersBar.tsx`, `ResultsView.tsx`, `GradeInput.tsx`, `PreferencePlanner.tsx`, `AnalysisView.tsx`, and `ShareView.tsx`.
- `src/lib/`: calculation, filtering/sorting, selection/non-academic requirement, analysis, i18n, profile, hash, and data-loading logic.
- `src/styles.css` plus component CSS files: current Vanilla CSS styling. Keep CSS in the existing files/patterns unless a component already owns a CSS module-style file.
- `scripts/*.mjs`: JS audit harnesses (`npm run audit*`).
- `.github/workflows/deploy.yml`: GitHub Pages deployment. Pushes to `main` build and deploy production.
- `js/`, `css/`: legacy vanilla prototype, not the active deployed app.
- `data/processed/JUPAS_2026_Unified_Data.json`: Master unified dataset.
- `data/raw/`: Source files (Excel, PDF, JSON), `subject_mapping.json`, and `term_glossary.json`.
- `scripts/extraction/`: University-specific scrapers and PDF parsers.
- `scripts/utils/`: Core data processing, unification, and validation logic.
- `docs/manuals/`: Detailed technical documentation and phase-specific learnings.
- `Reference(2026)/`: Source PDFs and institutional raw data.
- `Archives/`: Historical project files and legacy Excel versions.

---

## 3. Specialized Agent Roles

### 1. Data Scientist
- **Objective**: Ensure the accuracy and structural integrity of the JUPAS admission dataset.
- **Key Files**: `scripts/utils/unify_2026_data.py`, `data/processed/JUPAS_2026_Unified_Data.json`.
- **Mandate**: Maintain the structured logic for complex weightings and requirements.

### 2. Full-Stack Developer
- **Objective**: Transition legacy Excel logic into a modern, responsive web application.
- **Key Files**: `index.html`, `src/`, `public/`, `vite.config.ts` (the React/TS app at the repo root; `js/`+`css/` are legacy). Auto-deploys to GitHub Pages on push to `main` via `.github/workflows/deploy.yml`.
- **Mandate**: Prioritize Vanilla CSS and React (TypeScript) for the web app.

### 3. Archive Maintainer
- **Objective**: Manage historical context and per-year university reference materials.
- **Key Files**: `Archives/`, `Reference(2026)/`.
- **Mandate**: Strictly follow the Year Labeling Rule to prevent historical data drift.

---

## 4. Current Web App Architecture

### App Shell & Breakpoint
- `src/lib/useMediaQuery.ts` defines the single layout breakpoint: desktop is `min-width: 921px`; mobile is `max-width: 920px`.
- `App.tsx` chooses between `layout-desktop` and `layout-mobile`. Shared state lives in `App.tsx`; desktop and mobile are different presentations of the same grades, results, picks, filters, and share state.

### Desktop / iPad Landscape
- Desktop renders `AdvisorConsole` inside `<main className="app-shell layout-desktop">`.
- `AdvisorConsole` has a left rail and main workspace:
  - Left rail: `ProfileNameRow`, `GradeInput`, and `PreferencePlanner`.
  - `PreferencePlanner`: selected programme order, quick Browse entry, reorder/swap/remove, and clear-all action.
  - Main workspace tabs: `Analysis` (default), `Browse`, and transient `Detail`.
- Desktop `Browse` uses the reusable `programmePicker` node from `App.tsx`: `FiltersBar` + `ResultsView`.
- Desktop `Detail` is not a standalone route. It is a transient drill-in view in `AdvisorConsole` showing `DetailPanel` for the active programme, with a back-to-analysis tab state.

### Mobile
- Mobile renders `<main className="app-shell layout-mobile">` with a stepper flow:
  - Step 1: `GradeInput`
  - Step 2: `programmePicker` (`FiltersBar` + `ResultsView`)
  - Step 3: comparison/plan view, `DetailPanel` drill-in, and in-flow `AnalysisBody`
- Heavy panels render only when their step is active, to avoid reconciling the full programme list while editing grades.
- Mobile footer owns Back/Next/Reset/Analysis/Share actions. Browser or hardware Back is coordinated through `App.tsx` history sentinels.

### DetailPanel
- `DetailPanel` is the reusable programme-detail surface, used by desktop drill-in and mobile detail drill-in.
- It shows programme metadata, benchmarks, eligibility checks, formulas/weights, offer statistics, competition, and non-academic requirements.
- Non-academic requirement rows come from `src/lib/selection.ts`; interview rows may include quoted source text from `programme.non_academic[].when`.

### Browse, Results, and Interview Labels
- `FiltersBar` owns search, institution filter, eligibility filter, interview timing filter, score range, sorting, compact mode, selected-only mode, and delta mode.
- `ResultsView` renders the desktop table or mobile cards and window-renders results in chunks.
- Interview labels are based on official timing only:
  - `pre-results` → pre-results interview / 放榜前面試
  - `post-results` → post-results interview / 放榜後面試
  - `both` → pre/post-results interview / 放榜前後面試
  - vague source text such as "When necessary" is treated as tentative: show it in `DetailPanel`, but do not label it in Browse or call it out in analysis.
- Do not reintroduce discipline-based "serious interview" logic. We are not the authority deciding whether a programme takes interviews seriously.

### Analysis and Share Views
- `src/lib/analysis.ts` computes advisory findings and verdicts. Non-academic requirements are informational reminders, not score penalties.
- `AnalysisView` is the standalone/share-friendly analysis page; `AnalysisBody` is reused inside `AdvisorConsole` and mobile Step 3.
- `ShareView` handles social/advisor sharing and received-share read-only previews. In read-only mode, edit actions are hidden or disabled; users may save a received share as their own profile.

---

## 5. Core Operational Rules

### Technical Environment
- **Python Path**: Always use `~/miniconda3/envs/jupascal/bin/python`.
- **Dependencies**: pandas, pdfplumber, bs4, playwright.

### Data Integrity
- **Manual Edits**: NEVER modify `JUPAS_2026_Unified_Data.json` manually.
- **Unification**: Always update `scripts/utils/unify_2026_data.py` and rerun the script to update the master JSON.

### Year Labeling Rule (Critical)
- **Score Calculation**: Use **2025 logic** (formulas/weightings) to match the latest available admission scores.
- **Eligibility Checks**: Use **2026 requirements** for current applicants.
- **Rationale**: Students compare their 2026 potential scores against 2025 admission benchmarks.

---

### Versioning & Deployment
- Read `VERSIONING.md` before changing release metadata.
- Do not bump `package.json` `"version"` for routine pushes.
- Pushes to `main` deploy through GitHub Actions. Runtime-fetched files must be copied in `.github/workflows/deploy.yml` or they will 404 in production.

---

## 6. Institutions & Admission Baselines
- **332A33 (General UGC)**: HKU, CUHK, HKUST, PolyU, CityUHK, HKBU.
- **332A22 (Others)**: LingnanU, EdUHK, HKMU, SSSDP.
- **Total**: 8 UGC-funded universities + HKMU (self-funded) + SSSDP (multi-institution).

---

## 7. Key Documentation (Manuals)
- `docs/manuals/WEBAPP_PLAN.md`: Architecture & UI/UX strategy.
- `docs/manuals/CALCULATION_LOGIC.md`: Grade scales and score pipelines.
- `docs/manuals/SCORE_LOGIC.md`: Institutional score type definitions.
- `docs/manuals/DATA_UNIFICATION_LEARNINGS.md`: Institutional quirks & maintenance.
- `docs/manuals/JUPAS_2026_INSTRUCTIONS.md`: Update workflow & scraper reference.
- `docs/manuals/INTERVIEW_SCRAPING.md`: Interview/non-academic requirement scraping and timing rules.

---

## 8. Annual Update Workflow
1. Run school-specific scrapers in `scripts/extraction/`.
2. Run the unification script:
   ```bash
   ~/miniconda3/envs/jupascal/bin/python scripts/utils/unify_2026_data.py
   ```
3. Validate output against `data/raw/` source files.
