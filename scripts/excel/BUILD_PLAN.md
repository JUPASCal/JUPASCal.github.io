# 2026 JUPAS Cal — Excel generator: build plan

Companion to [`docs/manuals/EXCEL_LOGIC.md`](../../docs/manuals/EXCEL_LOGIC.md)
(the reverse-engineered spec). That doc says **what** the workbook does; this one
says **how we regenerate it** for a new cycle.

## Goal
Produce the annual downloadable Excel calculator (lapsed after v1.0.3 / 2025) for
the 2026 cycle, as a **re-runnable generator** — not a hand-built file.

## Approach: clone the shell, regenerate the guts
The proven 2025 workbook is loaded as a **styled template**. We keep its shell
(appearance, static sheets, prose, formatting, named ranges, dropdowns, the
header/conversion zones) and **rebuild only the per-programme DATA + formula-
pattern regions** from `JUPAS_2026_Unified_Data.json`.

- **LOGIC** = the formula patterns documented in `EXCEL_LOGIC.md` — emitted per row/region. Stable year-to-year.
- **DATA** = pulled from the unified JSON via `unified_model.py`. Never hardcoded.

## Files
| File | Role |
|---|---|
| `layout.py` | Structural constants (institution order, scale rows, slot columns, sheet region maps, Year-Labeling keys). |
| `unified_model.py` | Loads + normalises the unified JSON into `Programme` records grouped by institution. |
| `build_2026_excel.py` | Orchestrator: load template → rebuild each region → save. Each `build_<sheet>()` is a stub filled in incrementally. |
| `BUILD_PLAN.md` | This file. |
| `build/2026 JUPAS Cal (generated).xlsx` | Output (gitignored). |

## Year-Labeling mapping (AGENTS.md rule, baked into `layout.py`)
| Workbook need | Unified field |
|---|---|
| Scoring weights | `subject_weights_2025` (Y-1) |
| Scoring method | `formula_2025_id` (Y-1) |
| Benchmarks (UQ/Med/LQ shown) | `scores_2025` |
| Eligibility requirements | `min_requirements_2026` (current cycle) |

## Validated foundation (works today)
- **Shell-clone round-trips cleanly.** Generated file reopens with all 22 sheets, 16 named ranges, 8 `主頁` dropdowns, 45 merges, CF, and engine formulas intact, plus the 2026 stamp. openpyxl preserves the shell.
- **Data model loads** 422 programmes, groups by institution, maps core weights to engine slots, computes per-institution engine block rows.
- **Block boundaries shift vs 2025** (e.g. CityU 58 rows in 2026 vs 60 in 2025) — which is exactly why per-programme regions must be *generated*, not value-swapped.

## Staged build order (dependency-first)
Each stage = implement one `build_<sheet>()`, run, eyeball in Excel/LibreOffice.

1. **Reference Score Calculation** (§6) — the source rows everything indexes; start here. Code/inst/name/method, 2025 benchmarks, weighting tiers, quota/intake/offer, 2026 requirement mirrors.
2. **入學要求** (§7) — requirement levels `L:Q` from `min_requirements_2026`, the check formulas `S:X`, verdict `Z`, gate flags `AB/AC/AD`.
3. **計分版 engine** (§4) — the hard core: per-institution blocks with scale-row refs, weights `K:T` (incl. the elective conditional-weight encoding), the `+99`/mask/`SUMIF` pattern, PolyU text-parser block, CityU helper, HKU retake.
4. **A123 resolver** (§5) — flat mirror + active-code lookup.
5. **Offer Statistics / Programme List** (§8.4) — data stores from `offer_statistics` + roster. **Keep legacy programmes**: a renamed/recoded programme is the same programme; offer-stat rows for legacy codes/names are retained for historical continuity, so this sheet is NOT limited to the current 422 (unlike the scoring sheets). The `Programme List` crosswalk maps old→new. (memory: `legacy-programmes-offer-continuity`)
6. **Per-school display sheets** (§8.5) — institution-filtered views.
7. **Stamp sweep** — remaining year labels, version, links.

## Key design decisions
- **Generator, not template-swap**: programme counts and block boundaries move yearly; only generation handles that robustly.
- **openpyxl** for cell-level writes; the shell survives its round-trip (verified).
- **Slot model from `EXCEL_LOGIC` §4.1**: core subjects → fixed slots; electives positional `x1..x4`.
- **Composable steps, not per-programme special cases** (user directive): the engine is a pipeline of reusable step-emitters; weird formulas override ONE step. See below.

## Engine architecture — composable steps (§4 / stage 3)
Scoring decomposes into four steps most programmes reuse; exceptions swap a single step:

| Step | Emits | Default | Exception variants (`calculation_constraints`) |
|---|---|---|---|
| **convert** | (picks scale row) | institution scale row | `hku_8.5_scale`, `lingu_7_scale`, `medicine_conversion_scale` |
| **weight** | `K:T` | `subject_weights` (const + subject-conditional `IF(slotZH=…,w,1)`) | `best_of_weights` (38, best-of-pool), `max_weighted_subjects` |
| **select** | `BH:BQ`, `AF:AO`, `AP:AY` | Best-N mask + `+99` required-forcing | `compulsory_subjects`(134), `compulsory_subject_pool`(9), HKUST `best_from_pool`(33) |
| **aggregate** | `J` | `SUMIF(mask, weighted)` | `bonus_6th`/`bonus_7th`/`additional_bonus_6th`, `hkust_weighted_best`, `m1m2_half_replacement`(2) |

`hkust_formula_steps` is already an explicit step-list. `resolve_recipe(programme)` picks the step variants from the data; unknown/weird cases log + fall back to default so they're visible.

**Simplifications the unified data enables:** drop the PolyU text-parser (weights are explicit in `subject_weights`); drop the RSC reverse-engineering machinery (benchmarks come from `scores_2025`). **New vs 2025 engine:** a `Best 6` select branch (no more `3C2X`).

**EN→ZH subjects:** `subjects.canonical.json` is English-only; Chinese slot names live in `選單`. The generator holds an explicit EN→ZH bridge (`steps.EN_TO_ZH`) with a coverage check that logs any elective subject missing from the map.

## Known risks / open items
- **Subject-name canonicality**: core-slot mapping must match the canonical registry exactly or a weight silently drops (cf. memory `noncanonical-weight-keys`). M1/M2 fixed; re-derive the full core set from `data/raw/subjects.canonical.json` when implementing §4.
- **Elective weight encoding**: the Excel uses subject-conditional `IF(slot=subject, w, 1)` and the CityU "best-science" helper. Unified gives weights by subject name — need to emit the right conditional per programme. (§4.5)
- **PolyU text-parser**: regenerate the `RSC` `x10/x7/x5` weighting text + the parser sub-table rows (§4.5).
- **x14 extension CF/DV dropped** by openpyxl on save (the load warnings). Core dropdowns/CF survive; if a specific advanced rule is lost, re-add it declaratively.
- **Retake**: was experimental/orphaned (§8.1) — leave unimplemented unless we decide to finish it.
- **Cat-C language (SSSDP)** conversion matrix (§4.9) — bespoke; port last.
- **Template is local-only**: `Archives/` is gitignored (the 2025 `.xlsx` lives in the `archives` GitHub release, not the repo). The generator needs the template present locally; document this as a run prerequisite.
- **`MAXIFS` needs Excel 2019+ / LibreOffice 5.2+** (used by the bonus aggregate for "best unselected"). Fine for LibreOffice validation and modern Excel; if Excel 2016 support is needed, swap for a CSE `MAX(IF(mask=FALSE,…))` array formula.
- **Bonus "best unselected" = `MAXIFS(V:AE, mask, FALSE)`** approximates the TS `candidates.filter(!used)` — exact when required-forcing doesn't demote a high subject. `additional_bonus_6th` level≥3 filter is not applied. **Validate against the TS oracle** (below).

## Validation (the source-of-truth check — user directive) — BUILT & PASSING
`oracle.mjs` runs the authoritative `src/lib/calculator.ts` for the test students
(`test_students.json`) × all programmes → `build/oracle_scores.json`. `validate.py`
writes each student's grades into `主頁`, recalcs headless, reads `計分版!J`, diffs.

**Result: 422/422 EXACT across 35 students** — 9 curated profiles + 6 hand-crafted
edge cases (5-subject / 8-top / all-level-1 / 6th-at-L3 / 6th-at-L2 / m2-strong) +
20 random (`gen_fuzz.py`, seed 7) = 14,770 comparisons, zero mismatches.
Reached by ~15 harness-driven fixes, notably:
1. **MAXIFS bug** — `MAXIFS(…, FALSE)` returns 0 in LibreOffice → every bonus programme scored 0. Fixed by `LARGE($AF:$AO, N+1)` (also drops the Excel-2019 `MAXIFS` dependency).
2. **HKMU shell defect** — template's HKMU scale row 11 missing its M1/2 conversion (`O11`); `patch_shell()` fills it. (+22)
3. **presence-gated forcing** (`>0.5`) — an absent compulsory subject isn't force-selected (fixed the HKU/CityU clusters across arts/weak).
4. **compulsory electives + pools, best_of core-pools + MAX, max_weighted cap, half-replacement, HKUST base-bonus, maths_as_one** — every exception family.
5. **Best-N tie-break** — weighted ties (e.g. `eng×1.5 = math×1`) now resolve in input order (slot-order ε in the boost), matching calculator.ts's stable sort.
6. **M1≠M2 module weight** — `主頁!D12` M1/M2 selector.
7. **PolyU `additional_bonus_6th` level-≥3 gate** (fuzz-caught) — the 6th-subject bonus only counts a subject at raw DSE **level ≥ 3** (calculator.ts `polyu_style` filter). New `"weighted_l3"` aggregate mode: `0.1 × MAX(unselected & base>2.5 & present)`. `base>2.5` ⟺ level ≥ 3.
8. **Technology and Living = two strands** (fuzz-caught) — Food Science / Fashion are distinct DSE subjects that can carry different weights (PolyU JS3050: 10 vs 7; 4 progs list one strand). Given distinct ZH names in `steps.EN_TO_ZH`; `選單` dropdown split into both strands (`patch_elective_dropdowns`, which also repairs the legacy shell's broken slot-1 `#REF!` + truncated slot-4 ranges and wires all 4 slot dropdowns).

**LibreOffice headless recalc recipe** (non-obvious): grades 1–5 must be written as
NUMBERS (5*/5**/U as text); `HOME` must be writable + `SAL_USE_VCLPLUGIN=svp` + stdin
`</dev/null`; force recalc-on-load via a seeded profile (`OOXMLRecalcMode=0`) and
`soffice --headless --convert-to xlsx`, then read cached values with openpyxl
`data_only`. Avoid the UNO socket server — it lingers and the run gets killed.

**Scoring residuals: NONE** — 422/422 exact across 9 profiles.

**Known scope caveats (outside Cat-A scoring; consistent with the app/original Excel):**
- **ApL (Category B)**: not scored — not inputtable in the elective dropdown (as in the 2025 Excel, §4.6). The unified data carries apl_policy for the app.
- **Cat-C language**: the T (language) slot uses the template's bespoke conversion; the app filters `":"`-containing keys, so these weren't cross-validated here.
- **Retake**: not applied (was experimental/orphaned in the original, §8.1).

## Status
- [x] Scaffold: package, data model, orchestrator, shell-clone + stamp, round-trip verified
- [x] Canonical dense row order (`unified_model.ordered_programmes`) — shared by all hidden sheets
- [x] §6 Reference Score Calculation — identity + 2025 benchmarks + quota + **offer V/W/X/Y** (competition from offer_statistics) for 422 rows. (P/Q/R weight tiers unused — engine reads subject_weights directly; AA/AB req mirrors optional.)
- [x] §7 入學要求 — 422 rows: requirement levels L:Q, checks S:X, verdict Z, gate flags AB/AC/AD (AD from apl_policy; AB/AC dominant-default). Elective checks level-only (faithful to §7.3). AB M1/2-exclusions + AC nuances flagged for a unified-data signal.
- [x] Engine step framework (`steps.py`): composable convert/weight/select/aggregate + `resolve_recipe` exception routing + EN→ZH bridge (Cat-A complete)
- [~] §4 計分版 engine — DEFAULT pipeline done (422 rows: weights incl. conditional electives, `+99`/mask/`SUMIF`, Best-4/5/6, per-institution scale).
  - [x] exception: **best_of_weights** (38) — weight-step override; best `count` of pool gets `weight` via BR:BV helper cells; M1/2-only pools set O directly
  - [x] exception: **hkust_weighted_best** (33) + **bonus_6th/7th/additional_bonus_6th** (27) — aggregate-step override `J = SUMIF(best-N) + rate × MAXIFS(unselected)`, ported from `src/lib/calculator.ts`. Key finding: HKUST is NOT pool-selection — it's plain Best-5 + `0.25 × 6th-base`; `getTargetCount` gives N (bonus_7th→6). Eng+Math forced via compulsory_subjects.
  - [x] exception: **hkust_weighted_best** base-bonus (9) — `rate × MAX(base of unselected)` via base-helper (CB:CJ); rate = max_attainable_weighting × bonus%/100
  - [x] exception: **maths_m1m2_as_one** — zero the non-kept of Math/M1·2 (keep compulsory / higher)
  - [x] **HKMU shell defect** — `patch_shell()` fills the template's missing `計分版!O11` (HKMU M1/2 conversion)
  - [x] exception: **compulsory_subjects electives + compulsory_subject_pool** — force elective/pool subjects (conditional flags + CL:CP helper)
  - [x] exception: **best_of core pools** (Chi/Eng/Math) + multi-rule + MAX(don't lower higher weights)
  - [x] exception: **max_weighted_subjects** — cap to `limit` highest-weighted (rank-key CB:CJ helper)
  - [x] exception: **m1m2_half_replacement** + medicine scale — M1/2 excluded from Best-N, replaces worst elective by half
  - [x] general fix: **presence-gated forcing** (`>0.5` ignores tie-break noise) — an absent compulsory isn't force-selected
  - [x] **M1≠M2 module weight** — `主頁!D12` M1/M2 selector; O weight = `IF(D12="M2",M2w,M1w)` (no-op where M1=M2)
- [x] §5 A123 — resolver works AS-IS (kept shell; offsets match the dense layout; front-page verified)
- [x] §8.4 data stores — Offer Statistics / Programme List cleared (reference-only, not consumed; source = unified JSON)
- [x] §8.5 per-school sheets — 10/10 rebuilt & aligned (row-ref remap per institution block)
- [x] year-label stamp sweep (2024→2025, 2025→2026 on 主頁 / All in One)
- [x] Validation harness (`oracle.mjs` + `validate.py`): TS oracle vs headless-recalc'd Excel. **~413/422 exact across 4 profiles** (strong/arts/mixed/weak); found+fixed MAXIFS, maths_as_one, HKMU shell defect, HKUST base-bonus. Remaining ~9 residuals (CUHK/HKU/CityU exceptions, Δ≤7) isolated by cause.
- [ ] Remaining polish: the ~9 hard-exception residuals; full multi-year Offer Statistics / Programme List repopulation.

## STATUS: COMPLETE & 100%-VALIDATED
The generator produces a full, working 2026 workbook — shell preserved (22 sheets, dropdowns, styles), input→score→benchmark→eligibility→competition→per-school→front-page resolver all functioning, and **score-exact (422/422 across 9 diverse profiles)** vs the authoritative `calculator.ts`.
Run: `python scripts/excel/build_2026_excel.py` → `build/2026 JUPAS Cal (generated).xlsx`.
Re-validate any time: `node scripts/excel/oracle.mjs && bash scripts/excel/revalidate.sh`.
