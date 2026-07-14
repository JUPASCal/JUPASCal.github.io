# VLM Weight Extraction (CUHK booklet) — annual workflow

**When to use this:** extracting or re-verifying CUHK per-programme subject
weightings each cycle, and any time you need to decide which programmes genuinely
changed their scoring formula year-over-year.

## Why we read the PDF as an image, not as text

CUHK's authoritative weightings live in the annual booklet
**`Useful-Information-for-JUPAS-Applicants-<YEAR>.pdf`** — a wide, colour-banded,
multi-row table (see `Reference(2026)/CUHK/`; prior years under `Archives/.../CUHK/`).

The PDF **text** parser (`scripts/extraction/cuhk_pdf_req_extract.py` →
`CUHK_PDF_<YEAR>_Requirements.json`) is **not reliable** for the weighting column.
Cells wrap across lines and the columns misalign, so a weighting cell that actually
reads `English (x 1.3)` frequently comes out as `"--"` (empty). This silent dropping
caused two classes of error in 2026:

- **False positives** — programmes that looked like they gained a new 2026 weighting
  but were unchanged (the 2025 text parser dropped the weight). Confirmed for
  **JS4801** (Eng ×1.3), **JS4550** (Eng/Bio/Chem ×1.5), **JS4719** (Maths ×2, M1/M2 ×2),
  and ~15 others.
- **Hidden real changes** — when both years' text dropped, the diff saw nothing.

CUHK's coded **API `weight` field** (`CUHK_2026_Data.json`) is cleaner but can be
**stale**: for **JS4903** the API still returned `AENGL:2` while the 2026 booklet had
already **removed** the English ×2 weighting. So the **booklet image is the source of
truth**; the API is only a cross-check.

**A vision model (VLM) reading the rendered page transcribes the table cleanly.**
That is what this workflow does.

## Workflow

### 1. Render code+weighting strips
`scripts/extraction/cuhk_vlm_render.py` renders each booklet page and crops it to
just the **JUPAS Code + Programme** (left) and **No. of Subject to be Considered +
Specific Subject Weighting / Remarks** (right) columns — dropping the middle
requirement columns makes the weighting text much larger/legible.

```bash
PY=~/miniconda3/envs/jupascal/bin/python
$PY scripts/extraction/cuhk_vlm_render.py \
    --pdf "Reference(2026)/CUHK/Useful-Information-for-JUPAS-Applicants-2026.pdf" \
    --tag y26 --out /tmp/cuhk_strips
# and the prior-year booklet for the diff:
$PY scripts/extraction/cuhk_vlm_render.py \
    --pdf "Archives/.../CUHK/Useful-Information-for-JUPAS-Applicants-2025.pdf" \
    --tag y25 --out /tmp/cuhk_strips
```
Needs `pdftoppm` (poppler-utils) + Pillow + pypdf.

### 2. Transcribe each strip with a VLM
Read every `*_pNN.png` strip and transcribe, per programme row, **verbatim**:
`code`, `formula` (the "No. of Subject to be Considered" text), and `weighting`
(the full "Specific Subject Weighting / Remarks" cell, every bullet + any
"must be included" note). Empty / "--" → `weighting: ""`.

Rules that matter:
- **Never guess a multiplier.** Zoom (crop + upscale with PIL) until legible, or mark UNREADABLE.
- Ignore faculty header rows and any row without a `JS####` code.
- Some programmes are **cross-listed** under two faculties (e.g. JS4725, JS4264,
  JS4750) and appear on two pages — dedupe by code; the values should agree.

This is well-suited to a **fan-out of subagents** (one per ~5 pages) returning a
strict JSON array. That was how the 2026 pass was done. Save the merged result as
`Reference(2026)/CUHK/vlm_extract/cuhk_weights_vlm_<YEAR>.json`.

### 3. Diff + cross-check
Canonicalise each `weighting` into an **order-insensitive set of
(subject-group, multiplier)** plus a normalised "must be included" signature, then
diff 2025 vs 2026. Reordering of a pool (CUHK re-alphabetises subject lists most
years) must **not** count as a change.

Then **cross-check the 2026 side against the API multipliers** and hand-verify any
disagreement by re-reading that row in the booklet — this is what caught the stale
JS4903 API value. Treat the booklet as authoritative.

### 4. Apply
Feed the verified per-year structured weights into `unify_2026_data.py` for the CUHK
branch **instead of** copying the 2026 weights into the 2025 fields. See the warning
below.

## ⚠️ Do NOT copy 2026 weights into the 2025 fields

Historically the CUHK branch of `unify_2026_data.py` did:

```python
obj["subject_weights_2025"] = obj["subject_weights_2026"].copy()   # DANGEROUS
obj["best_of_weights_2025"] = obj["best_of_weights_2026"].copy()
```

because there was no clean structured 2025 source. This silently assumes
**2025 weighting == 2026 weighting**. It is harmless for the ~65 programmes that did
not change, but for the ones that did it:
- scores the "2025-logic" number with the **2026** weighting and then compares it to
  the genuine **2025** admission benchmark → distorted odds (this is the JS4725 bug a
  student reported: scored with ×1.5, compared to an un-weighted median of 27.5);
- blinds `compute_year_changes` (it compares 2026-vs-2026, sees nothing, so no
  "Weighting changed" pill).

The VLM extraction gives us the real 2025 weights, so the 2025 fields must be built
from them, not copied. Keep the Year Labeling Rule intact: 2025 logic for scoring vs
2025 benchmarks; 2026 requirements for eligibility.

## Programmes that genuinely changed for 2026 (verified from both booklets)

| Code | 2025 (real) | 2026 (real) |
|------|-------------|-------------|
| JS4725 Biotech/Entrep/Healthcare | none | best-2 of Eng/Bio/Chem ×1.5, **must include Bio/Chem** |
| JS4903 Bachelor of Laws | Eng ×2, must include Chi+Eng+Math | none, **must include Eng only** |
| JS4100 Public Humanities | none | Chi ×1.5, Eng ×1.5 |
| JS4428 Financial Technology | elective pool ×1.5 | elective pool ×1.25 |
| JS4109 Religious Studies | none | Eng ×1.25 |
| JS4070 Linguistics | none | Eng ×1.2 |

New-for-2026 programme (no 2025 history): **JS4898** Diplomacy & International Studies.

## Benchmark handling for the changed programmes

When a programme's formula changes, the stored 2025 benchmark (computed with the OLD
formula) is no longer comparable to a 2026-formula-scored student. Three cases, all
routed through `Reference(2026)/CUHK/cuhk_weight_corrections.json`:

1. **Official recalc published** — CUHK prints the 2025 scores recalculated with the
   2026 formula on the [Programme-specific Requirements and Score Calculator](https://admission.cuhk.edu.hk/application/jupas/programme-specific-requirements-and-score-calculator/)
   page (a "(1)" footnote), e.g. **JS4725** (UQ 33.75 / Med 33 / LQ 32.44 / 2026 exp 32). Use those directly; keep `subject_weights`/
   `best_of_weights_2025` = 2026 so the student is scored on the same basis. This is the
   same model as the HKUST School of Engineering simulated scores
   (`[[hkust-simulated-scores-6th-bonus]]`). `score_basis: "cuhk_2026_recalculated"`.

2. **Self-simulated (CORE-subject weighting only)** — no official recalc, but CUHK
   publishes the per-subject grade profile of the UQ/median/LQ admitted students
   (`cuhk_grades_2025.json`, from the admission-score PDF). Our calculator fed those
   profiles reproduces the published 2025 scores EXACTLY, so we re-apply the 2026
   weighting to the **named core subjects** (Chinese/English/Maths) and recompute — the
   anonymised electives stay ×1 (unknowable). e.g. **JS4070** (Eng ×1.2), **JS4109**
   (Eng ×1.25), **JS4100** (Chi+Eng ×1.5). `score_basis: "cuhk_2026_simulated"`.
   **Caveats** (it is a 3-point estimate, not CUHK's full-cohort recalc): a strong
   weighting re-orders the 3 sampled students (JS4100's median<LQ before sorting), so we
   SORT the recomputed scores to keep uq≥median≥lq; and some LQ profiles are absent, so
   LQ is estimated from the median's uplift. Only viable when the weighting is on named
   cores — **elective**-weighted changes (JS4428, JS4725's pool) can't be self-simulated.

3. **Weighting removed / elective-only change, no recalc** — keep the real 2025 formula
   vs the real 2025 benchmark (consistent), and let the automatic "Weighting changed"
   pill tell the user the 2026 formula differs. e.g. **JS4903** (Eng ×2 removed — 2025
   scoring stays right for a fair comparison with the past score), **JS4428** (elective
   pool ×1.5→×1.25).
