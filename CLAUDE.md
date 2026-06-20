# JUPAS Cal — Master Project Context

This document is the single source of truth for all AI agents (Gemini, Claude, etc.) interacting with the JUPAS Cal project. It defines the project identity, architectural standards, and operational mandates.

---

## 1. Project Overview
**JUPAS Cal** is an unofficial annual score calculator for Hong Kong DSE (Diploma of Secondary Education) applicants. 
- **Function**: Users input DSE grades → tool calculates estimated scores for **422 programmes** across 10 institutions → compares results against historical admission data.
  - **The programme count is NOT hardcoded** — it's `__PROGRAMME_COUNT__`, a Vite `define` (see `vite.config.ts`) read from `JUPAS_2026_Unified_Data.json`'s length at build time and used in `AboutPage.tsx` + `MobileWelcome.tsx`. It updates automatically when the dataset changes; never type a literal count in UI copy. (Currently 422 — was 419 before the 3 new-2026 SSSDP programmes were auto-included.)
  - **New programmes are auto-included**: `unify_2026_data.py` adds any JUPAS-listed code missing from the per-school feeds (universal-baseline requirements + Best-5 estimate, null scores → "new programme"), so a programme on the JUPAS listing is never silently dropped. Removed programmes are archived to `Archives/removed_programmes.json`. Joint-admission shared quotas ("Combined figure for programmes JS…") are parsed into `quota_shared` {total, codes}.
- **Goal**: Help students gauge their admission chances based on complex, institution-specific weightings.
- **Scope**: Educational and informational purposes only.

---

## 2. Directory Structure
- `index.html`, `src/`, `public/`, `vite.config.ts`, `package.json`: the React + TypeScript (Vite) web app, **at the repo root** (formerly in `staging/`, which no longer exists). `npm run build` → `dist/` (gitignored). The JS audit harnesses live in `scripts/*.mjs` (`npm run audit*`).
- `.github/workflows/deploy.yml`: GitHub Actions builds the app + bundles the runtime data and **auto-deploys to GitHub Pages on every push to `main`** (no manual build/copy step). See §4 Deployment.
- `js/`, `css/`: **legacy** vanilla prototype — no longer referenced by `index.html` or deployed; superseded by the React app.
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
- **Key Files**: `index.html`, `src/`, `public/`, `vite.config.ts` (the React/TS app at the repo root).
- **Mandate**: Prioritize Vanilla CSS and React (TypeScript) for the web app.

### 3. Archive Maintainer
- **Objective**: Manage historical context and per-year university reference materials.
- **Key Files**: `Archives/`, `Reference(2026)/`.
- **Mandate**: Strictly follow the Year Labeling Rule to prevent historical data drift.

---

## 4. Core Operational Rules

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

### Versioning — see [`VERSIONING.md`](VERSIONING.md) (authoritative)
- **Do NOT bump the version on a routine push.** Every deploy is auto-identified by a build stamp (`__BUILD_SHA__` + `__BUILD_DATE__`, injected at build time and shown in the About footer). A normal change = just push to `main`.
- **Bump `package.json` `"version"` (semver) ONLY when cutting a release**: pre-1.0 stay `0.1.0-beta.N`; set `1.0.0` at stable launch; then PATCH=fixes, MINOR=features (and the annual data refresh — also bump `"admissionCycle"`), MAJOR=overhauls. Tag releases (`vX.Y.Z`) + publish GitHub Release notes.
- **`"admissionCycle"`** (`package.json`, e.g. `"2026"`) is the JUPAS entry year the data targets — a separate axis, bumped only on a data refresh, surfaced as `__ADMISSION_CYCLE__`. This applies to ALL agents — read `VERSIONING.md` before any release push.

### Deployment (auto-deploy on push to `main`)
- **`.github/workflows/deploy.yml`** builds the app, copies the runtime data files (`data/processed/JUPAS_2026_Unified_Data.json` + `.version`, `data/raw/subjects.canonical.json`) and `CNAME` into `dist/`, and publishes `dist/` to GitHub Pages. **A push to `main` is a production deploy** — there is no separate build/copy step and no committed bundle.
- One-time GitHub setting (already configured): repo **Settings → Pages → Source = "GitHub Actions"**.
- The app fetches its data at runtime via paths **relative** to `index.html` (`data/processed/…`), so any new runtime-fetched file MUST be added to the workflow's copy step or it will 404 in production.

---

## 5. Institutions & Admission Baselines
- **332A33 (General UGC)**: HKU, CUHK, HKUST, PolyU, CityUHK, HKBU.
- **332A22 (Others)**: LingnanU, EdUHK, HKMU, SSSDP.
- **Total**: 8 UGC-funded universities + HKMU (self-funded) + SSSDP (multi-institution).

---

## 6. Key Documentation (Manuals)
- `docs/manuals/WEBAPP_PLAN.md`: Architecture & UI/UX strategy.
- `docs/manuals/CALCULATION_LOGIC.md`: Grade scales and score pipelines.
- `docs/manuals/SCORE_LOGIC.md`: Institutional score type definitions.
- `docs/manuals/DATA_UNIFICATION_LEARNINGS.md`: Institutional quirks & maintenance.
- `docs/manuals/JUPAS_2026_INSTRUCTIONS.md`: Update workflow & scraper reference.

---

## 7. Annual Update Workflow
1. Run school-specific scrapers in `scripts/extraction/`.
2. Run the unification script:
   ```bash
   ~/miniconda3/envs/jupascal/bin/python scripts/utils/unify_2026_data.py
   ```
3. Validate output against `data/raw/` source files.
