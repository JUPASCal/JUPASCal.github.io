# JUPAS Cal 2026 - Production Web App Plan

## 1. Tech Stack & Architecture
* **Framework:** React + TypeScript (via Vite).
    * *Why not just Vanilla JS?* While Vanilla JS works, React provides a robust component model, state management (crucial for multiple profiles and advanced filtering), and a rich ecosystem.
    * *GitHub Pages Compatibility:* A Vite-built React app compiles down to pure HTML, CSS, and JS. It is 100% client-side and hosts perfectly on GitHub Pages with zero backend required.
* **Styling:** Vanilla CSS (Custom). We will use CSS Variables for theming (Dark Mode) and CSS Grid/Flexbox for responsive layouts.
* **Data Layer:** The existing `calculator.js` will be ported/wrapped into a TypeScript utility module. The unified JSON will be fetched asynchronously on initial load and cached.

## 2. Layout & User Experience (Two Use Cases)
We will employ a responsive design strategy that drastically changes the layout based on the viewport, catering to the two distinct personas.

### A. Mobile-First (The Student "Quick Check")
* **Goal:** Speed and simplicity.
* **Flow:**
    1. **Bottom Navigation / Tabs:** Switch between "My Grades", "Search", and "Saved".
    2. **Grades View:** Clean, touch-friendly dropdowns or steppers to input grades.
    3. **Search View:** A prominent search bar. Tapping a programme slides over to a simple "Result Card".
    4. **Result Card:** Shows Eligibility (Big Green Check/Red Cross), Total Score, and a concise summary of the Historical Comparison. Deep analysis is hidden behind an "Advanced Details" accordion.

### B. Desktop Layout (The Teacher/Analyst "Command Center")
* **Goal:** High information density and comparative analysis.
* **Flow (Dashboard / Split-Pane):**
    * **Left Sidebar (Sticky):** Grade input matrix and Profile switcher (Save/Load scenarios like "Best Case", "Worst Case").
    * **Top Bar:** Advanced Filtering (by Institution, Faculty, Score Range, Subject Requirements).
    * **Main Area (Split):**
        * *Left Column:* Search results displayed as a dense, sortable data table.
        * *Right Column:* The "Analysis View". Selecting a programme opens a detailed panel showing the full Calculation Audit Trail, UQ/Median/LQ benchmarking grids, and historical trend charts (Ratio, Offer %).

## 3. Core Features (MVP)
* **Dark Mode:** Native implementation using CSS variables (`prefers-color-scheme` + manual toggle).
* **Multiple Profiles:** LocalStorage-based saving of grade profiles (e.g., "Profile A", "Profile B").
* **Advanced Filtering:** Filter the 400+ programmes by Institution, Faculty, and "Eligible Only" toggles.
* **Shareable Links:** Serialize the selected grades and targeted programme into a short URL hash (e.g., `#grades=...&prog=JS1000`).
* **HTML Report:** A printable, printer-friendly CSS layout that formats the "Analysis View" into a clean one-pager.

## 4. Implementation Phases
1. **Phase 1: Setup & Porting.** Scaffold Vite/React, port `calculator.js` to TypeScript, setup CSS architecture.
2. **Phase 2: Core State & Mobile UI.** Build the grade input, simple search, and basic result card.
3. **Phase 3: Desktop UI & Analysis.** Build the split-pane layout, data tables, and deep audit trail components.
4. **Phase 4: Polish.** Dark mode, share links, print styles, and animations.

## 5. Web App
The React + TypeScript Vite app lives at the **repo root** (`index.html`, `src/`, `public/`). It reads the unified dataset from `data/processed/JUPAS_2026_Unified_Data.json` at runtime. (It was formerly under `staging/`; that directory was retired when the app moved to the root.)

Build output (`dist/`) is gitignored. **GitHub Actions** (`.github/workflows/deploy.yml`) builds and publishes to GitHub Pages on every push to `main`; end users receive static HTML, CSS, JavaScript, and the JSON dataset.

```bash
npm install   # run once, from the repo root
npm run dev
npm run build
```

The prototype calculates all programmes client-side after grade entry, then exposes institution buttons, programme keyword search, eligibility filtering, benchmark-band filtering, score-data filtering, desktop table comparison, mobile result cards, and a selected-programme analysis panel.
