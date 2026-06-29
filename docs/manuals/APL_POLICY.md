# Applied Learning (Category B / ApL) — Authoritative Admission Policy by Institution

**Single source of truth for how each JUPAS institution treats HKDSE Applied
Learning (ApL, Category B) in admission, for the 2026 entry cycle.** Compiled from
**official institutional documents** (not JUPAS scraped notes), so it can be cited
and re-checked. Each row links the exact authoritative source + the date it
carries / was accessed.

- **Researched:** 2026-06-29 (web, official sources).
- **Re-verify annually** — institutions re-publish these PDFs each cycle; the URL
  patterns below are stable, the dates are not.
- **Consistency gate:** `npm run audit:apl` (`scripts/apl_audit.mjs`) checks the whole
  model after every data regen — coverage, per-institution invariants (this doc's
  table), conversion tables, restricted-list canonical-ness, PolyU weight injection,
  EdUHK ×1.5, HKUST bonus-only, SSSDP per-offering, plus a live calculator +
  eligibility sweep over all programmes. Keep it green.
- **Conversion convention:** ApL results map to DSE-level equivalents — *Attained
  with Distinction (II)* → **Level 4**, *Attained with Distinction (I)* (or pre-2018
  *"Attained with Distinction"*) → **Level 3**, bare *"Attained"* → varies (often not
  counted; HKMU/most SSSDP = Level 2). Each institution then applies its own scale.
- **Applied Learning Chinese (for NCS students)** is universally excluded from the
  elective/score count — it's only an alternative Chinese-language qualification.

---

## Summary table

| Institution | Counts ApL? | Accepted ApL | Max | Min result | Conversion (II / I / Attained) | Extra weighting | Mechanism |
|---|---|---|---|---|---|---|---|
| **HKU** | ❌ No | — | — | — | not counted | — | "additional supporting information" only |
| **CUHK** | ⚠️ advisory | **Restricted**, 45 progs (3 accept all); per-programme list | — | — | **not scored** | — | extra bonus subject; value unpublished → notify only |
| **HKUST** | ✅ bonus | **11 progs** (JS5101/5102/5103/5118/5181/5411/5412/5711/5811/5812/5813) | 1 (bonus) | Dist (I) | 4 / 3 / not counted | none | **6th-subject bonus** (≤5%), never in Best-5 |
| **PolyU** | ✅ Best-5 | **Per-programme list** with per-subject weight (published) | 1 | Dist (I) | L4 / L3 / 0 | via weight (5/7/10), not a multiplier | one relevant ApL, weighted like a Cat-A elective |
| **CityU** | ✅ elective | **Restricted to 9 programmes** (JS1040–1044, JS1300, JS1805–1807) | 1 | Dist (I) | 4 / 3 / not counted | none | one elective, listed programmes only |
| **HKBU** | ✅ elective | **Per-programme** (some ✓, some "specified subjects", some ✕); **2nd elective only** | 1 | Dist (I) | 4 / 3 / not counted | none | 2nd elective only; 1st must be Cat A |
| **LingnanU** | ✅ Best-5 | **per-programme** (17/23 recognise; calculator-derived) | 1 | Attained | L4 / L3 / **L3** | none (×1.0) | per-programme × per-subject recognition (from its calculator) |
| **EdUHK** | ✅ Best-5 | **Any** at Distinction | 1 (HD: 2) | Dist (I) | 4 / 3 / 0 | **×1.5** on specified ApL for 13 progs | one elective; some progs boost specific ApL |
| **HKMU** | ✅ Best-5 | **Any** | 2 | **Attained** | 4 / 3 / **2** | none (equal weight) | Best-5 across Cat A/B/C |
| **SSSDP** | ✅ varies | per **offering institution** (see below) | 1–2 | Attained (HKSYU: Dist I) | mostly 4 / 3 / **2** | none | follows the offering institution |

---

## Per-institution detail + sources

### HKU — not counted
ApL (other than ApL Chinese) is **used only as "additional supporting
information"** — it does **not** meet the elective entrance requirement and is
**not** converted to a score. Verbatim: *"…in Applied Learning subjects (other than
Applied Learning Chinese) will be used as additional supporting information."*
- https://aal.hku.hk/admissions/local/admissions-information?page=jupas-admissions-scheme — "Admissions Information | Undergraduate Admissions for JUPAS Students", HKU.
- https://admissions.hku.hk/jupas2024onwards — "University Entrance Requirements for HKDSE Candidates in 2024 and Onwards".
- **Our model:** `apl_policy="none"` for all HKU. ✅ correct.

### CUHK — extra elective for bonus points (45 programmes)
ApL recognised as an **extra elective subject for awarding bonus points** (up to the
7th subject), only for **45 programmes** that each publish a recognised-ApL list (3
accept *all* ApL: JS4111 Theology, JS4874 Social Work, JS4886 Sociology). Min
**"Attained with Distinction I/II"**. **No numeric ApL→points conversion is
published** by CUHK (its own calculator excludes Category B) — flag.
- https://admission.cuhk.edu.hk/wp-content/uploads/2025/05/ApL-2026.pdf — "Programmes which Recognise Applied Learning Courses (2026 Entry)" (the per-programme list).
- https://admission.cuhk.edu.hk/wp-content/uploads/2025/05/Useful-Information-for-JUPAS-Applicants-2026.pdf — "Useful Information for JUPAS Applicants (2026 Entry)", v20260512.
- https://admission.cuhk.edu.hk/application/jupas/faq/ — JUPAS FAQ Q09.
- Extracted to `Reference(2026)/CUHK/cuhk_apl.json` via `scripts/extraction/cuhk_apl_extract.py`.
- **Our model (beta.16):** `apl_advisory_only` — CUHK recognises ApL only as an EXTRA bonus subject whose value it doesn't publish, so it is **NOT scored and NOT an eligibility elective**. The restricted lists are kept only to tell the candidate which of their ApL the programme recognises: the calculator returns `recognizedApL`, and the DetailPanel shows an "unquantified advantage" note (never points). Superseded the beta.14 Attained=L2 scoring. ✅

### HKUST — 6th-subject bonus, specific programme categories only
ApL is **NOT** an eligibility elective (HKUST electives = Category A only). Where
recognised, it is only the **"best 6th subject" bonus** (capped ≈5% of the Best-5
max), and **only for programmes flagged "Category A, B & C Subjects Applies"**
(School of Science, School of Humanities & Social Science, selected joint/
interdisciplinary). Min Dist (I); Dist II=4 / Dist I=3 / Attained=0.
- https://join.hkust.edu.hk/docs/ADMISSIONS%20REQUIREMENTS%20AND%20SCORE%20FORMULAE.pdf — "Admissions Requirements and Score Formulae" (built 2025-09-24, 2026 entry).
- https://join.hkust.edu.hk/docs/CONVERSION%20OF%20HKDSE%20LEVELS%20GRADES%20TO%20SCORES.pdf — conversion table (2025 scale).
- https://join.hkust.edu.hk/admissions/jupas
- **Our model (beta.14):** ApL is a **6th-subject bonus** (`apl_bonus_only`) for the 11 programmes JS5101/5102/5103/5118/5181/5411/5412/5711/5811/5812/5813 — excluded from the Best-5 and from eligibility, fed only into the existing `hkust_weighted_best` bonus (D2 → +2.35% of total, D1 → +1.76%; Attained not counted). The other 22 → `none`. ✅

### PolyU — per-programme weighted list (your fashion hunch was right)
ApL counts in the competitive score (PolyU = "Any Best 5 with subject weighting").
PolyU publishes a **per-programme Subject Weightings PDF** that lists each
recognised ApL course with a numeric weight on the **same 5 / 7 / 10 scale as
Category A** — a *more relevant* ApL simply gets a **higher weight** (not a separate
multiplier). One relevant ApL; min Dist (I) (Dist II=L4 / Dist I=L3 / Attained=0).
- URL pattern (authoritative per-programme): `https://www.polyu.edu.hk/aradm/jupas/{YEAR}_{JSCODE}_SW.pdf`
  - **JS3050** (BA Scheme in Fashion): https://www.polyu.edu.hk/aradm/jupas/2026_JS3050_SW.pdf — *Fashion Image Design = 7* (vs base 5 for most ApL); plus fashion/design/business ApL at 7.
  - **JS3569** (BA Scheme in Design): https://www.polyu.edu.hk/aradm/jupas/2025_JS3569_SW.pdf — design-relevant ApL = **10**; Fashion Image Design = 7.
- https://www.polyu.edu.hk/study/ug/admissions/jupas/jupas-scheme-programme-requirements — per-programme "RELEVANT APPLIED LEARNING SUBJECTS" + links to the SW PDFs.
- https://www.polyu.edu.hk/study/ug/admissions/jupas/jupas-admission-selection — Distinction→Level scoring.
- **Our model (beta.12):** per-programme from the SW PDFs — **13 progs** recognise ApL (with the per-subject 5/7/10 weight injected into `subject_weights_2025`); the other 32 → `none`. Fashion/design relevance is preserved (Fashion Image Design=7 for JS3050; design ApL=10 for JS3569). ✅

### CityU — 9 programmes only
ApL is **not** an elective by default. Recognised as **one elective only for 9
programmes**: **JS1040, JS1041, JS1042, JS1043, JS1044, JS1300, JS1805, JS1806,
JS1807** ("recognize some Category B Applied Learning subjects as one elective").
Score: Dist (I)=3 / Dist (II)=4; bare Attained not counted. No extra weighting.
- https://www.cityu.edu.hk/admo/sites/default/files/2026-01/2026_JUPAS_AdmissionScoreFormulaAndScores.pdf — "Admission Score Formula and Admissions Scores for 2026 JUPAS" (Jan 2026; note on final page).
- https://www.cityu.edu.hk/admo/admissions/jupas-admission
- **Our model (beta.12):** `apl_policy="any"` for the 9 listed programmes only; the other 49 → `none`. ✅

### HKBU — 2nd elective only, per-programme (scraped from each programme page)
ApL (Dist (I)+) may fulfil the **second elective** only (the **first elective must
be Category A**, excluding M1/M2). Acceptance is **per programme**: some accept
Category B ✓, some only "specified subjects" (e.g. JS2620 → PE-related), some **✕
do not accept** (e.g. JS2610, Chinese Medicine JS2410/JS2420). Dist II=4 / Dist I=3;
bare Attained not credited. Normal weight (×1).
- https://admissions.hkbu.edu.hk/programmes.html — each programme's **Requirements tab** carries the actual Category B treatment (3 formats: a specified-subjects PDF e.g. JS2020; an on-page list e.g. JS2025; or "accepts all ApL"). Scraped by `scripts/extraction/hkbu_apl_extract.py` → `Reference(2026)/HKBU/hkbu_apl.json` (source PDFs cached under `Reference(2026)/HKBU/apl_sources/`).
- https://admissions.hkbu.edu.hk/content/ao/en/what-is-new/news/general-entrance-requirements-for-the-2026-Entry.html — GER summary (Sep 2025).
- **Our model (beta.14):** per-programme from the programme pages — **13 any / 3 none (JS2410/JS2420/JS2610) / 6 specified lists** (JS2020, JS2025, JS2310, JS2330, JS2370, JS2620). The programme pages corrected the GER PDF on two: **JS2340** is actually `any` (not specified) and **JS2370** is a specified list (not `any`). ✅

### LingnanU — per-programme recognition (reverse-engineered from the calculator)
ApL "may be recognised as electives, given bonus scores, or taken as tie-breakers
by individual programmes" — programme discretion, with no list/conversion in the
PDF. But LingU's **JUPAS score calculator DOES score Cat B**, and encodes the rule:
- Recognition is **per-programme × per-subject** — an ApL only counts for a
  programme that recognises that specific course. **17 of 23** programmes recognise
  ≥1 ApL (9 recognise ~all → "any"; 8 a discipline subset, e.g. JS7133 design → 9
  ApL; JS7225 → AI & Robotics + Computer Forensic Technology); 6 recognise none.
- **At most 1** ApL counts (verbatim calculator rule: "If Category B and C subjects
  are taken, at most 1 subject from each category will be counted").
- **Conversion**: Dist II ≡ L4; Dist I ≡ L3; **bare "Attained" ≡ L3** too (calculator
  scores Attained and Dist I identically) → modelled as `apl_min_level: "l3"`.
- **Weight ×1.0** uniformly (even JS7123, whose Cat-A electives are ×1.25).
- https://banner.ln.edu.hk/PROD/jp_score_calculator.p_main — the calculator; subjects
  via `p_get_elec_subj`, grades via `p_get_elec_grade`. Extracted by
  `scripts/extraction/lingu_apl_scrape.py` → `Reference(2026)/LingU/lingu_apl.json`.
- https://www.ln.edu.hk/admissions/ug/f/upload/511/2837/Admission%20Requirements_JUPAS%20(UG%20Website).pdf — "JUPAS ADMISSIONS (2026 Entry)", Note 2.
- **Our model (beta.13):** per-programme recognised-ApL list (or "any"); 6 progs → none; Attained ≡ L3. ✅

### EdUHK — any ApL; ×1.5 on specified courses (13 programmes)
Any ApL at Distinction recognised as one elective (Bachelor's max 1, **Higher
Diploma max 2**). Dist II=4 / Dist I=3 / Attained=0. **13 programmes weight specific
ApL courses ×1.5** (e.g. JS8002 → Interior & Exhibition Design; JS8714 → 10 courses).
- https://www.eduhk.hk/acadprog/downloads/EdUHK_ApL%20Recognition%20and%20Subject%20Weightings.pdf — "Recognition of ApL Subjects and Subject Weightings (2026 Entry)", 6 Oct 2025.
- https://www.eduhk.hk/acadprog/downloads/EdUHK_Entrance%20Requirements%20and%20Admission%20Score%20Calculation.pdf — GER + score calc.
- Extracted to `Reference(2026)/EdUHK/eduhk_apl_weights.json` via `scripts/extraction/eduhk_apl_extract.py`.
- **Our model:** any/1(HD 2)/dist1 + ×1.5 for the 13. ✅ correct.

### HKMU — any ApL, Best-5, Attained = Level 2
Best-5 may draw from Category A/B/C. **Up to 2** ApL; bare **"Attained" accepted**.
Dist II=4 / Dist I=3 / **Attained=2**; equal weight.
- https://www.hkmu.edu.hk/REG/reg_ftae/Admission/Scores_JUPAS.pdf — "HKMU 2025 JUPAS Admission Scores" (conversion table).
- **Our model:** any/2/attained (Attained→L2). ✅ correct.

### SSSDP — follows the offering institution (no scheme-wide rule)
There is **no SSSDP-wide ApL rule**; each JSSxxx programme follows its **offering
institution**. 2026 roster = 8 providers. Consolidated source:
**https://www.jupas.edu.hk/f/page/3669/af_2025_SSSDP.pdf** — "2025 JUPAS Admissions
Scores of SSSDP Institutions" (gives explicit ApL conversion for HKMU, HKSYU, SFU,
THEi, UOWCHK).

| Offering inst. | JSS prefix | ApL | Max | Min | Conversion (II/I/Attained) | Source |
|---|---|---|---|---|---|---|
| HKMU | JSSU | yes, Best-5 | 2 | Attained | 4 / 3 / 2 | hkmu.edu.hk Scores_JUPAS.pdf |
| HKSYU (Shue Yan) | JSSY | yes, 1 *relevant* | 1 | **Dist (I)** | 4 / 3 / **N/A** | uao.hksyu.edu/en/qualifications/dse |
| SFU (Saint Francis) | JSSA | yes | — | Attained | 4 / 3 / 2 | af_2025_SSSDP.pdf p.6 |
| THEi / VTC | JSSV | yes, 1 elective | 1 | Attained | 4 / 3 / 2 | af_2025_SSSDP.pdf p.8; thei.edu.hk/admission/sssdp |
| HSUHK (Hang Seng) | JSSH | yes, Best-5 | — | Attained | ≈4 / 3 / 2 (comparability) | admission.hsu.edu.hk … hkdse-sssdp |
| TWC (Tung Wah) | JSST | yes, Best-5 | — | Attained | ≈4 / 3 / 2 (comparability) | twc.edu.hk … admission_requirement |
| UOWCHK | JSSW | yes, 1, **relevant discipline** | 1 | Attained | 4 / 3 / 2 | uowchk.edu.hk/study-at-uowchk/admission-requirements |
| HKCHC (Chu Hai) | JSSC | yes, 1 elective | 1 | Attained | not published (assume 4/3/2) | chuhai.edu.hk/en/hkdse-students |

- **Our model (beta.12):** per offering institution (parsed from "Offered by X:") — HKMU max 2/Attained; HKSYU max 1/Dist (I); all others max 1/Attained (=L2). ✅

---

## Corrections applied (v0.1.0-beta.12)

The full sweep below reconciled the data model to these official sources. Final ApL
policy: **225 `none`, 142 `any`, 55 restricted** (42 CUHK + 13 PolyU).

1. **CityU** ✅ — ApL restricted to the 9 listed programmes; the other 49 → `none`.
2. **HKUST** ✅ — all 33 → `none`. HKUST ApL is only a capped 6th-subject bonus (≤5%,
   Cat-A-B-C programmes), never a Best-5 elective; we don't model that small bonus,
   so we don't count ApL (was over-crediting it as a full elective). *Un-modelled
   bonus is the one remaining HKUST approximation.*
3. **SSSDP** ✅ — min-level per offering institution: HKMU max 2 / Attained; HKSYU
   (Shue Yan) Dist (I); all others (SFU/THEi/HSUHK/TWC/UOWCHK/HKCHC) Attained = L2.
4. **PolyU** ✅ — per-programme ApL acceptance + weight from each programme's SW PDF
   (`scripts/extraction/polyu_apl_extract.py` → `Reference(2026)/PolyU/polyu_apl_weights.json`;
   prefers the 2025 PDF, falls back to the 2026 PDF for new programmes e.g. JS3160).
   **14** programmes have a Category B section → those recognise ApL (with the
   per-subject 5/7/10 weight injected, e.g. JS3050 Fashion Image Design = 7,
   JS3569 design ApL = 10); the rest → `none`.
5. **HKBU** ✅ — per-programme scraped from each programme's Requirements tab
   (`scripts/extraction/hkbu_apl_extract.py` → `Reference(2026)/HKBU/hkbu_apl.json`):
   13 `any` / 3 `none` (JS2410/JS2420/JS2610) / 6 specified lists (now enumerated:
   JS2020, JS2025, JS2310, JS2330, JS2370, JS2620). The programme pages corrected the
   GER PDF on JS2340 (→ any) and JS2370 (→ list). beta.12 had the 6 as `any` fallback.
6. **LingnanU** ✅ — initially set to `none` (beta.12), then **reverse-engineered from
   LingU's JUPAS calculator (beta.13)**: per-programme recognition (17/23 recognise,
   9 "any" + 8 restricted, 6 none), Attained ≡ L3 (`l3` mode), ×1.0, max 1
   (`scripts/extraction/lingu_apl_scrape.py` → `Reference(2026)/LingU/lingu_apl.json`).
7. **CUHK** ✅ (beta.16) — ApL is `apl_advisory_only`: recognised but NOT scored and NOT
   an eligibility elective, because CUHK treats it as an extra bonus subject whose
   value it doesn't publish. The candidate is *notified* (DetailPanel "unquantified
   advantage" note via `recognizedApL`) instead of being given fabricated points.
