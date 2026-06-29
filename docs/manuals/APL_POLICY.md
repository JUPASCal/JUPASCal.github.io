# Applied Learning (Category B / ApL) — Authoritative Admission Policy by Institution

**Single source of truth for how each JUPAS institution treats HKDSE Applied
Learning (ApL, Category B) in admission, for the 2026 entry cycle.** Compiled from
**official institutional documents** (not JUPAS scraped notes), so it can be cited
and re-checked. Each row links the exact authoritative source + the date it
carries / was accessed.

- **Researched:** 2026-06-29 (web, official sources).
- **Re-verify annually** — institutions re-publish these PDFs each cycle; the URL
  patterns below are stable, the dates are not.
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
| **CUHK** | ✅ bonus | **Restricted**, 45 progs (3 accept all); per-programme list | n/a (shares 7th-subject bonus) | Dist (I) | not published numerically | none | extra elective for **bonus points** (up to 7th subject) |
| **HKUST** | ✅ bonus | **Any**, but only for "Cat A,B&C" programmes (Science, HSS, some joint) | 1 | Dist (I) | 4 / 3 / 0 | none | **6th-subject bonus** (≤5%), never in Best-5 |
| **PolyU** | ✅ Best-5 | **Per-programme list** with per-subject weight (published) | 1 | Dist (I) | L4 / L3 / 0 | via weight (5/7/10), not a multiplier | one relevant ApL, weighted like a Cat-A elective |
| **CityU** | ✅ elective | **Restricted to 9 programmes** (JS1040–1044, JS1300, JS1805–1807) | 1 | Dist (I) | 4 / 3 / not counted | none | one elective, listed programmes only |
| **HKBU** | ✅ elective | **Per-programme** (some ✓, some "specified subjects", some ✕); **2nd elective only** | 1 | Dist (I) | 4 / 3 / not counted | none | 2nd elective only; 1st must be Cat A |
| **LingnanU** | ⚠️ discretionary | per programme, **not published / unquantified** | n/a | not published | **no published conversion** | none | "may be elective / bonus / tie-breaker" — programme discretion |
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
- **Our model:** restricted lists (42) + 3 "any"; scored via Cat-A table at L4/L3, max 1, dist1. ✅ lists correct; ⚠️ we score ApL as a normal Best-N elective rather than CUHK's "bonus point up to 7th subject" mechanism (CUHK doesn't publish the value, so this is an approximation).

### HKUST — 6th-subject bonus, specific programme categories only
ApL is **NOT** an eligibility elective (HKUST electives = Category A only). Where
recognised, it is only the **"best 6th subject" bonus** (capped ≈5% of the Best-5
max), and **only for programmes flagged "Category A, B & C Subjects Applies"**
(School of Science, School of Humanities & Social Science, selected joint/
interdisciplinary). Min Dist (I); Dist II=4 / Dist I=3 / Attained=0.
- https://join.hkust.edu.hk/docs/ADMISSIONS%20REQUIREMENTS%20AND%20SCORE%20FORMULAE.pdf — "Admissions Requirements and Score Formulae" (built 2025-09-24, 2026 entry).
- https://join.hkust.edu.hk/docs/CONVERSION%20OF%20HKDSE%20LEVELS%20GRADES%20TO%20SCORES.pdf — conversion table (2025 scale).
- https://join.hkust.edu.hk/admissions/jupas
- **Our model (beta.12):** `apl_policy="none"` for all 33 HKUST — ApL not counted (it's never a Best-5 elective). The ≤5% 6th-subject bonus for Cat-A-B-C programmes is the only un-modelled effect (we lack HKUST's exact bonus formula). ✅

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

### HKBU — 2nd elective only, per-programme acceptance
ApL (Dist (I)+) may fulfil the **second elective** only (the **first elective must
be Category A**, excluding M1/M2). Acceptance is **per programme**: some accept
Category B ✓, some only "specified subjects" (e.g. JS2620 → PE-related), some **✕
do not accept** (e.g. JS2610, Chinese Medicine JS2410/JS2420). Dist II=4 / Dist I=3;
bare Attained not credited. Normal weight (×1).
- https://admissions.hkbu.edu.hk/content/ao/en/what-is-new/news/general-entrance-requirements-for-the-2026-Entry.html — "General Entrance Requirements … JUPAS Admissions (2026 Entry)", Sep 2025.
- **Our model (beta.12):** per-programme from the GER PDF — JS2410/JS2420/JS2610 → `none`; the other 19 → `any` (2nd-elective via the CategoryA gate). The 6 "specified subjects" programmes couldn't be enumerated (PDF says only "specified"/"PE-related") → fall back to `any`. ✅ (specified-subject restriction is the residual gap)

### LingnanU — discretionary, unquantified
ApL "**may be recognised as electives, given bonus scores, or taken as tie-breakers
by individual programmes**" — programme discretion. LingU publishes **no ApL
conversion table, no ApL weighting, and its score calculator has no ApL input**.
- https://www.ln.edu.hk/admissions/ug/f/upload/511/2837/Admission%20Requirements_JUPAS%20(UG%20Website).pdf — "JUPAS ADMISSIONS (2026 Entry)", © 2025, Note 2.
- https://banner.ln.edu.hk/PROD/jp_score_calculator.p_main — calculator (no ApL selector).
- **Our model (beta.12):** `apl_policy="none"` for all 23 LingU — no invented conversion. ✅ (revisit if LingU publishes one)

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
   (`scripts/extraction/polyu_apl_extract.py` → `Reference(2026)/PolyU/polyu_apl_weights.json`).
   Only **13 of 45** programmes have a Category B section → those recognise ApL (with
   the per-subject 5/7/10 weight injected, e.g. JS3050 Fashion Image Design = 7,
   JS3569 design ApL = 10); the other 32 → `none`.
5. **HKBU** ✅ — per-programme from the GER PDF (`scripts/extraction/hkbu_apl_extract.py`
   → `Reference(2026)/HKBU/hkbu_apl.json`): JS2410/JS2420/JS2610 → `none`; the rest
   `any` (2nd-elective via the CategoryA gate). The 6 "specified subjects" programmes
   couldn't be enumerated from the PDF (it only says "specified" / "PE-related"), so
   they fall back to `any` — slightly permissive, flagged.
6. **LingnanU** ✅ — all 23 → `none` (LingU publishes no ApL conversion; avoids
   inventing a score). Revisit if LingU later publishes one.
7. **CUHK** — scoring approximated via the Cat-A table at the equivalent level; CUHK's
   actual "bonus point up to 7th subject" value is unpublished, so this is an
   approximation (acceptance lists are exact).
