# Non-academic requirement (interview / portfolio / test) — official sources & findings

Research note for the `selection.ts` model. Goal: validate/enrich interview-portfolio
classification from each institution's **own** interview-arrangement pages, with
**timing** (before vs after HKDSE results — the key importance signal).

Status date: 2026-05-22. Gathered via web fetch/search; some sources blocked this
session (noted). **Treat per-programme lists as draft pending validation** — web
fetches summarise and can drop/merge rows; PDFs/eProspectus need real scraping.

## Key reframes confirmed
- **Interviews are near-universal**, especially *pre-results* ("good to have" — ace it →
  conditional offer). What matters is **timing + salience**, not mere presence.
- **Medicine = post-results interview, required (MMI).** Confirmed: HKU MBBS JS6456/JS6626
  (hkumed-ugadmissions.hku.hk), CUHK MBChB JS4501/JS4502 (med.cuhk.edu.hk → panel, English,
  ~15 min). → encoded in CURATED.
- **HKU Dental JS6107: interview REQUIRED, late-July (post-results).** Confirmed verbatim at
  admissions.hku.hk/apply/jupas/interview#dentistry ("Before: – / After: Late-July"). → CURATED.
  (Earlier note wrongly said "no interview" — a WebFetch-summary error: the table is two columns
  *Before | After*, and a dash in *Before* ≠ no interview.)
- JUPAS has **no central scrapeable interview feed**; news/changes pages are JS-rendered
  (WebFetch saw only the menu shell).

## Programme change spotted
- **PolyU JS3569** — JUPAS news "Updates on PolyU Programme (JS3569)":
  https://www.jupas.edu.hk/en/news/updates-on-polyu-programme-js3569/ (verify details).

## Per-institution sources
| Inst | Interview-arrangement source | Status |
|---|---|---|
| HKBU | https://admissions.hkbu.edu.hk/admissions/hkdse.html (Interview Arrangement section) | ✅ fetched (below) |
| HKU | https://admissions.hku.hk/apply/jupas/interview | ✅ fetched (below) |
| CUHK | https://admission.cuhk.edu.hk/application/jupas/download-area-for-important-information/ → "Interview Arrangement (2026)" PDF (per-programme table: code / before / after results) | ⚠️ TLS error this session — retry |
| PolyU | https://www.polyu.edu.hk/study/ug/admissions/jupas/jupas-interview-arrangement · eProspectus https://www51.polyu.edu.hk/eprospectus/ug/jupas/interview-arrangement/p · drupal pattern `/study/ug/admissions/jupas/jupas-interview-arrangement?combine={code}` | ⚠️ conn refused this session — retry |
| CityU / HKUST / EdUHK / LingnanU / HKMU | not yet fetched (EdUHK audition/practical/physical already in our scrape `remarks_pdf`) | ⬜ TODO |

## HKBU — interview arrangements (from their page)
- **Before results (pre-DSE → optional/good-to-have):** JS2060, JS2110, JS2120, JS2340, JS2410, JS2420, JS2810, JS2920, JS2930, JS2950
- **After results (post-DSE → weighty):** JS2330, JS2340, JS2370, JS2410, JS2420, JS2660, JS2810, JS2920, JS2930, JS2950, JS2960
- **Both:** JS2340, JS2410, JS2420, JS2810, JS2920, JS2930, JS2950
- Arts ones also imply portfolio/audition: JS2060 (Music→audition), JS2340 (Acting), JS2810 (Visual Arts→portfolio), JS2370 (Game Design→portfolio).

## HKU — interview schedule (from admissions.hku.hk/apply/jupas/interview)
Most programmes hold a **mid-June pre-results** interview (good-to-have), with a **late-July
post-results** round for shortlisted Band-A candidates. Examples (verify against raw table):
- Medicine: JS6456 MBBS, JS6626 MBBS(DMS) — pre + post; **post-results = the real gate**.
  Also JS6250, JS6418, JS6468, JS6482, JS6494, JS6949 (mid-June).
- Architecture/Design (portfolio): JS6004, JS6028, JS6236 (confirmed in our own `other_req` scrape too).
- ⚠️ **Earlier "no scheduled interview" list (JS6054/6107/6066/6080/6092/6119/6078/6406/6705/6717/6810/6729/6779)
  was a WebFetch-summary ERROR — do not trust it.** The HKU table has two columns (*Before | After*
  results); a dash in *Before* does NOT mean no interview (Dental JS6107 proved this — it interviews
  late-July). The HKU page must be re-extracted **column-by-column** before encoding; many of those
  likely have a post-results interview.

## CUHK
- Interviews generally **after** HKDSE results (July 2026). Medicine MBChB: panel interview,
  English, ~15 min. Full per-programme timing is in the downloadable **Interview Arrangement
  2026 PDF** (format: JUPAS Catalogue No. | Programme | Before release | After release).

## Already in our existing scrapes (no extra fetch needed)
- **EdUHK `remarks_pdf`:** audition (music), practical test (visual arts), written exam +
  physical fitness + aquatic test (PE) — e.g. JS8010, JS8002.
- **HKU `other_req`:** portfolios (JS6004/6028/6236), "may be interviewed" (JS6054).
- **CUHK remarks:** Architecture design portfolio.

## FINAL STATUS (2026-05-22) — all institutions scraped
206 programmes, 8/9 institutions. Each `scripts/extraction/<school>_interview_scrap.py` → `Reference(2026)/<school>/<school>_interview.json`:

| Inst | Count | Method |
|---|---|---|
| HKU | 50 | bs4, per-faculty Before/After tables |
| CUHK | 60 | pdfplumber, official PDF (5-col incl "No Interview") |
| PolyU | 33 | requests+bs4, **Drupal Views** `?page=N` pagination (no API) |
| EdUHK | 26 | bs4, Code\|Before\|After table (all "both": Feb/June + July) |
| HKBU | 14 | bs4, "Interview Arrangement Summary" table (N/A = none) |
| LingU | 9 | bs4, 2-col programme\|date (BBA-heavy, mostly pre) |
| HKMU | 9 | bs4, Code\|Title\|Date\|Format table (mostly post) |
| HKUST | 5 | hand-curated JSON — only JS5313/5331/5332/5814/5822 interview (pre-results, folded into score); all other HKUST programmes are score-only |
| **CityU** | **0** | **NOT available** — page unreachable here; interviews on a *selective basis*, no published per-programme list → leave to heuristic/text |

Salience policy (applied when combining): pre-results→optional ("good to have"), post-results/both→weighty, medicine/dental→required, HKUST→weighty (scored).

## Next steps
1. Retry CUHK PDF + PolyU eProspectus (blocked this session); fetch CityU/HKUST/LingU/HKMU.
2. Because WebFetch summaries are lossy, build a small per-institution scraper (scripts/extraction
   pattern) targeting these URLs → emit a structured `selection.curated.json` with type/salience/
   timing/source per JS code.
3. User validates; encode into CURATED.
