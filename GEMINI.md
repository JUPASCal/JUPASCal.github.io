# JUPAS Cal — Master Project Context

This document is the single source of truth for all AI agents (Gemini, Claude, etc.) interacting with the JUPAS Cal project. It defines the project identity, architectural standards, and operational mandates.

---

## 1. Project Overview
**JUPAS Cal** is an unofficial annual score calculator for Hong Kong DSE (Diploma of Secondary Education) applicants. 
- **Function**: Users input DSE grades → tool calculates estimated scores for ~432 programmes across 10 institutions → compares results against historical admission data.
- **Goal**: Help students gauge their admission chances based on complex, institution-specific weightings.
- **Scope**: Educational and informational purposes only.

---

## 2. Directory Structure
- `js/`, `css/`, `index.html`: Modern web application (React/TypeScript/Vanilla CSS).
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
