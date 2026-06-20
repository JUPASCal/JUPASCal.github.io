# JUPAS Data Unification Learnings (2025/2026)

This document records the key learnings, challenges, and solutions discovered during the extraction and unification of JUPAS admission data across different institutions for the 2026 cycle.

## 1. General Unification Strategy
The goal was to unify disparate JSON outputs from 10 different universities into a single `JUPAS_2026_Unified_Data.json` file.
*   **The "Year Labeling Rule":** For the 2026 calculator, we strictly use **2025 calculation logic (formulas and weightings)** as the primary basis for score estimation, because the reference scores provided by the universities are from the 2025 applicant pool. The 2026 requirements are used solely to determine *if* a student is eligible.
*   **Unified Schema:** Standardized on keys like `formula_2025`, `formula_2026`, `subject_weights_2025`, `subject_weights_2026`, `min_requirements_2026`, and `scores_2025`.
*   **Auditability:** Preserved `subject_weights_raw` fields for both years to allow manual verification against source documents.

## 2. Calculation Constraints Model
We introduced a `calculation_constraints` array to store machine-readable flags for rules that cannot be captured in a simple weighting dictionary:
*   **`max_weighted_subjects` (CUHK):** Detects rules like "A maximum of 3 subjects will be weighted heavier."
*   **`compulsory_subjects` (CityU/PolyU):** Identifies subjects that *must* be included in the "Best N" total (e.g., English or Mathematics).
*   **`maths_m1m2_as_one` (CityU):** Enforces that only one of Core Math or M1/M2 can be counted.
*   **`medicine_conversion_scale` (CUHK):** Flags the unique `5**=7` conversion scale used by Medicine programmes.
*   **`hku_8.5_scale` (HKU):** Flags the standard HKU `5**=8.5` conversion scale.
*   **`lingu_7_scale` (LingU):** Flags the standard LingU `5**=7` conversion scale.
*   **`additional_bonus_6th` (PolyU):** Captures the specific bonus logic for a 6th DSE subject.
*   **`score_breakdown_warning` (LingU):** Informs that median/LQ subject grades should not be summed up as they are calculated separately.

## 3. Institutional Quirks & Solutions

### CUHK (Chinese University of Hong Kong)
*   **Grade Breakdowns:** PDF structure in `af_2025_CUHK.pdf` was inconsistent. We wrote a script to scan adjacent rows to map UQ/M/LQ grade breakdowns correctly when the JUPAS code was missing from specific rows.
*   **Best-Of Pools:** Parsed complex strings like `Best(1,[AECON,AINCT]):1.5` into a structured `best_of_weights` array to prevent double-counting.
*   **Elective Pools:** Transformed requirements like "One of the following: Bio, Chem..." into structured JSON objects specifying the subject pool and grade threshold using API `req_electives` data.

### CityU (City University of Hong Kong)
*   **CSD Omission:** Learned that the CityU API completely omits the Citizenship and Social Development (CSD) requirement. We hardcoded a universal fallback of `"csd": "A"`.
*   **Formula Extraction:** Utilized regex to pull compulsory subjects directly from the `score_formula` text field (e.g., "includes English Language").
*   **Structured Electives:** Parsed nested API JSON strings to handle `min_count` logic for multiple electives.

### HKU (University of Hong Kong)
*   **HTML Scraping:** Extracted minimum levels, "Other Factors" (e.g., bonus for 5**/5*/5), and "Repeater Policies" by parsing the `accordionHTML` section of the raw HKU API response using BeautifulSoup.

### HKUST (Hong Kong University of Science and Technology)
*   **JS Calculator Reverse Engineering:** HKUST's official calculator is a client-side JS file that hardcodes all 33 programme formulas as minified strategy classes. We reverse-engineer this via `scripts/extraction/hkust_js_extract.py`, which outputs `Reference(2026)/HKUST/HKUST_2026_JS_Extracted.json` with:
    *   `formula_steps` — structured ordered list of picks (required subjects, best-from-pool slots, 6th subject bonus).
    *   `subject_weights_2026` — flat dict of subject → multiplier, no HTML parsing required.
    *   `bonus_6th` — `{bonus_percentage: 5, eligible_categories: [...]}`.
    *   `is_better_of` — true for JS5312/JS5331/JS5332/JS5822, which evaluate two selection strategies and take the higher score.
*   **Correct 6th Subject Bonus Formula:** Reverse-engineered from the JS `pickLast`/`scoreBonusItem` methods. The correct formula is `bonus = max_attainable_weighting × (bonus_percentage/100) × subject_converted_score`. The previous hardcoded per-grade `bonus_scale` (e.g., `"5**": 0.05`) was incorrect — it mistakenly used `haScore × grade_percentage` instead.
*   **max_attainable_weighting Computation:** Must be computed from the formula structure. Note that the PDF `score_ha` (e.g., 63.75 for JS5312) represents the **Highest Attainable** score (the theoretical maximum with all 5**). Our calculated `max_attainable_weighting` should be used to verify that our theoretical max aligns with the university's published HA score. For better-of programmes (ENG×2 + MATH×2 + pool×1.5 + 2×1), this weighting base is 7.5.
*   **Better-of Programmes:** JS5312/JS5331/JS5332/JS5822 offer two scoring options (plain best-3 vs. best-1-from-pool × 1.5 + best-2-plain) and admit the higher score. The pool exists in both 2025 and 2026 formulas (confirmed from `formula_text_2025`). Stored in `best_of_weights_2025` and `best_of_weights_2026`. When a qualifying subject is present, x1.5 applies naturally; if not, the pool has no effect and the plain score is used.
*   **HKUST Subject Name Variants:** The JS extract and raw scraper use non-canonical subject names that do not match the UI's student grade keys. Always run all subject names through `normalize_subject()` before storing. Key variants added to `subject_mapping.json`:
    *   `Mathematics Compulsory Part` → `Mathematics (Compulsory Part)`
    *   `Mathematics Extended Part (Calculus and Statistics) - Module 1` → `Mathematics Extended Part (Module 1)`
    *   `Mathematics Extended Part (Algebra and Calculus) - Module 2` → `Mathematics Extended Part (Module 2)`
    *   A fallback normalizer in `calculator.js` (`normalizeSubjectKey`) guards against any variants that slip through the pipeline.
*   **M1 / M2 Interchangeability:** This is a universal JUPAS rule. All programmes treat M1 and M2 as a single elective choice (interchangeable). Pool logic with `count: 1` ensures only the better of M1/M2 gets the pool multiplier. Our UI handles this by providing a single "M1/2" input field to prevent double-counting in the "Best N" selection.
*   **HA Score vs. Observed Scores:** In HKUST's admission PDF, "HA" stands for **Highest Attainable** score, which is the theoretical maximum achievable (all 5**). This is distinct from "Median" or "LQ" scores which are based on actual admitted students' performance. Our `max_achievable_score` calculation should align with this HA value.
*   **JS URL Stability:** The JS calculator URL contains a hash parameter and may change each cycle. Re-run `hkust_js_extract.py` and update the URL if the file returns 404.

### PolyU (Hong Kong Polytechnic University)
*   **Compact String Parsing:** Developed a parser for PolyU's compact 2025 weighting strings: `Subject (W=X, CatY); ...`.

### EdUHK (Education University of Hong Kong)
*   **Remark Extraction:** Updated PDF extractor to capture the multi-line "Remarks" column often spanning split or merged cells.

### LingU (Lingnan University)
*   **Flexible Admission:** Mapped the specific 2026 flexible arrangement for students who underperform in Chinese or Math by one level.

### HKMU / SSSDP
*   **Flexible Admission:** Structured the baseline flexible admission policy which allows Level 2 in CHI/ENG if certain other conditions (Level 5*, Band A choice) are met.

## 4. Universal Baseline Enforcement
We implemented an `apply_baselines` layer to guarantee every programme meets the mandatory university-wide minimums:
*   **332A33 Baseline:** HKU, CUHK, HKUST, PolyU, CityUHK, HKBU.
*   **332A22 Baseline:** LingnanU, EdUHK, HKMU, SSSDP.
*   If a programme's specific extraction is missing a requirement, the script automatically populates it with `"Any"` subject and the university's baseline grade.

## 5. Key Takeaways for Future Maintenance
1.  **API > PDF:** Structured API strings are always more reliable than PDF tables.
2.  **Subject Normalization:** Use a centralized `normalize_subject` map to handle institutional variations (e.g., `CHI LANG` vs `Chinese Language`).
    *   *Mangled Parentheses:* Some API sources truncate names (e.g., `Math (Compulsory Part`). A robust normalizer must proactively fix these before matching.
    *   *HKUST Variants:* The JS extract omits parentheses (`Mathematics Compulsory Part`) and uses full module names (`Mathematics Extended Part (Calculus and Statistics) - Module 1`). These must be in `subject_mapping.json` and `normalize_subject()` must be called on all keys before storing in the JSON.
    *   *Normalize everywhere:* Any place that writes subject names into the JSON — including `best_of_weights` pool subject lists and `subject_weights` dict keys — must call `normalize_subject()`. Skipping it in even one place causes silent calculator mismatches (the weight lookup finds `undefined` and falls back to ×1).
    *   *Calculator-side fallback:* `calculator.js` contains a `normalizeSubjectKey()` function as a last-line defence, but the primary fix must always be at the data source.
3.  **Data Cleaning:** Universally strip bullet points (`•`) and HTML tags (`<br />`) from text fields to keep the dataset clean.
4.  **Raw String Fallback:** If a raw weight string is missing from the source, generate one from the structured dictionary to ensure the data is always auditable.
5.  **Complex Constraints:**
    *   **Nested Parents:** When splitting strings containing parentheses (like CityU formulas), use regex that respects balanced parentheses to avoid breaking subject names.
    *   **Multiplier Caps:** Some universities (like CUHK Science) limit the number of subjects that can receive bonus weightings. The calculator must sort all subjects by multiplier and cap anything exceeding the limit (e.g., `max_weighted_subjects`).
    *   **Compulsory Pools:** Some programmes (e.g., CUHK JS4725) require the *best* subject from a specific pool (like Biology or Chemistry) to be included in the total, even if it is not among the overall top scores.
    *   **Dynamic Weighting Pools:** Logic like "Best 2 of English, Biology or Chemistry (x 1.5)" requires the engine to dynamically assign multipliers to the highest-scoring members of a pool before finalizing the "Best N" selection.
    *   **Category A Wildcards:** Requirements like "Category A subjects only" must be mapped to a wildcard pool (`*`) to allow subjects like M1/M2 to correctly satisfy eligibility.
6.  **Deduplication:** Always use a `seen_codes` set during the unification process to ensure that each JUPAS code appears only once in the final dataset, even if multiple source JSONs accidentally overlap.
