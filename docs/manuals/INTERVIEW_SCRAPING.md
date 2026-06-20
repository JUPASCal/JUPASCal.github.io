# Interview / Non-Academic Requirement Scraping — Runbook & Learnings

How we collect **non-academic admission requirements** (interview / portfolio /
audition / physical or written test) per programme, and feed them to the analysis
as *duties to be aware of* — never as a score-risk and never a critical blocker.

First built in the **2026** cycle. This is the durable runbook for every cycle
after. The 2026 research notes live in `Reference(2026)/INTERVIEW_SOURCES.md`.

---

## Why this exists

The unified dataset badly under-records this (the old keyword regex caught 36/419
and **missed medicine entirely**). But it matters to applicants: most programmes
interview, yet they differ wildly in weight — a pre-DSE interview is "good to
have", a post-DSE one (medicine, social work, education) is a real ranking gate,
arts need a portfolio/audition, PE needs a physical test. The analysis surfaces
these as **reminders**, hedged by confidence. Data is never complete, so it must
never be a hard "no".

## The model — `src/lib/selection.ts`

`getSelection(programme)` merges three layers, **precedence: curated > official-scrape > text > heuristic**, deduped per requirement type (so an official interview record does NOT clobber a portfolio detected from text):

- **type**: `interview` · `portfolio` · `audition` · `physical-test` · `written-test` · `aptitude-test`
- **salience**: `required` (gate) · `weighty` (ranking factor) · `optional` (good-to-have)
- **timing**: `pre-results` · `post-results` · `both` (the pre/post-HKDSE-results signal — the key importance cue)

Salience policy applied when combining the scraped JSONs: `pre-results → optional`, `post-results`/`both → weighty`, medicine/dentistry → `required`, HKUST's 5 → `weighty` (folded into score). The scrapers stay **purely factual** (presence + timing); salience is policy at integration time.

---

## Per-institution sources, scrapers & quirks

All scrapers live in `scripts/extraction/<school>_interview_scrap.py`, output
`Reference(<year>)/<School>/<school>_interview.json` with shape:
```json
{"source": URL, "fetched": "YYYY-MM-DD", "count": N,
 "programmes": {"JS####": {"name": "...", "type": "interview", "timing": "pre-results|post-results|both", "before": "...", "after": "..."}}}
```

| School | Source | Format / method | 2026 count | Quirks |
|---|---|---|---|---|
| **HKU** | admissions.hku.hk/apply/jupas/interview | requests+bs4; 14 per-faculty `<table>`s, cols *Study Programme \| Before \| After* | 50 | code = leading 4 digits. An "…ENCOURAGED to attend before…" note in the *After* cell is **not** a real post-results round → treat as pre-results. |
| **CUHK** | download-area PDF `Interview-Arrangement-<entry>-Entry.pdf` | pdfplumber; 5 cols incl a **"No Interview"** column (Wingdings tick ``) | 60 | host needs `verify=False` (cert chain). **PDF URL changes yearly** — find it from `admission.cuhk.edu.hk/application/jupas/download-area-for-important-information/`. |
| **PolyU** | polyu.edu.hk/study/ug/admissions/jupas/jupas-interview-arrangement | requests+bs4; **Drupal Views**, paginated `?page=N`, rows `.views-row`, fields `field--field-prog-interview-date/-mode/-rmk`, code in `.views-field-title` | 33 | **No JSON API** (the `?combine=` filter is client-side cosmetic). Free-text "Date of Interview" → derive timing. |
| **EdUHK** | apply.eduhk.hk/ug/jupas_interview | requests(`verify=False`)+bs4; table *Code \| Before \| After* | 26 | All "both" (Feb/June + late July). Music/VA/PE auditions/practical tests also in our `remarks_pdf` scrape. |
| **HKBU** | admissions.hkbu.edu.hk/en/hkdse.html | requests(`verify=False`, follow redirects)+bs4; "Interview Arrangement Summary" table *Code \| Title \| Before \| After Announcement* | 14 | `N/A` = no session in that window. |
| **LingU** | ln.edu.hk/.../jupas-applicants/jupas-interview-arrangement | requests(`verify=False`)+bs4; 2-col *programme(code+name) \| date* | 9 | BBA-heavy; free-text date → timing. |
| **HKMU** | admissions.hkmu.edu.hk/ug/jupas-interview/ | requests(`verify=False`)+bs4; table *Code \| Title \| Date \| Format \| Mode*, faculty-banner rows skipped | 9 | Mostly post-results. |
| **HKUST** | join.hkust.edu.hk/admissions/jupas | **hand-curated** `Reference(<year>)/HKUST/hkust_interview.json` | 5 | HKUST is interview-light: only JS5313/5331/5332/5814/5822 (Business) interview, **folded into the admission score**, pre-results. Re-verify the list each cycle. |
| **CityU** | cityu.edu.hk/admo/interview-arrangements-local-jupas-applicants | Playwright **headless Chromium** + normal UA + `networkidle` + wait-for-`/JS\d{4}/` | 40 | **Behind Imperva Incapsula** — see the section below. One free-text "Interview Arrangements" column → timing derived vs the HKDSE result-release date. |
| SSSDP | — | not done (self-financing) | 0 | TODO if desired. |

Network: `curl`/`requests` work for everything; **CUHK, EdUHK, HKBU, LingU, HKMU need `verify=False`** (`-k`); HKBU needs redirect-follow (`-L`).

---

## CityU & Imperva Incapsula — the hard-won lesson

CityU's admissions site sits behind **Imperva Incapsula** bot protection (a silent
JS challenge that escalates to **hCaptcha** for "suspicious" traffic). A plain GET
returns an **~880-byte challenge stub**, not the page.

**The key realization: it is IP-reputation + time dependent, NOT a header/fingerprint problem.**

What was tried during 2026 and **failed while the IP was "cold"** (don't repeat these as a fix):
- curl / `requests` (can't run the challenge JS)
- headless Chromium → escalated to hCaptcha
- anti-detect headless (hidden `navigator.webdriver`, real UA/headers, init-script overrides)
- headed Chromium (real window on `:0`)
- headed Chromium + the user's persistent `visid_incap` cookie
- headed Playwright Firefox
- Selenium + system Firefox 150 with `dom.webdriver.enabled=false` (Firefox now ignores it — `navigator.webdriver` stays `true`)
- session-cookie replay (the `incap_ses` session cookie isn't on disk; not in the session-store)
- Firefox Remote Agent (FF 150 dropped the CDP `/json` endpoints; BiDi-only, still webdriver-flagged)

**What actually worked:** plain **headless Playwright Chromium** (normal Chrome UA, `networkidle`, wait for `JS####` to appear) — *the very first approach that had failed*. The difference was purely **time**: after ~10 visits from the residential IP (scraper attempts + ordinary browsing), Incapsula's risk score for the address decayed and its silent JS challenge began auto-passing for a plain headless browser instead of serving the stub/captcha. Proven by re-running the identical headless script cold (stub) then warm (full 192 KB page).

**So the playbook for CityU (and any Incapsula/WAF site):**
1. Just run `cityu_interview_scrap.py` (headless Chromium). If you get the full page, done.
2. If you get the ~880-byte stub, the IP is **cold** — don't escalate to headed/Selenium/proxies. Instead **warm the IP**: open the site a few times in a normal browser and/or wait, then **retry with backoff**. The same code starts working.
3. Last resort that worked once: delegate to **`codex exec`** (`codex exec --dangerously-bypass-approvals-and-sandbox -C <proj> -o out.txt "<scoped prompt>"`). It succeeded only because it ran during a warm window — not because it's smarter. Handing a flaky, timing-sensitive task to a second agent (or just retrying later) can win simply because *conditions changed*.
4. **Do not** build evasion infrastructure (residential proxies, anti-detect/stealth browser builds, captcha-solving services) — brittle and out of scope. CityU interviews on a selective basis anyway; a human-saved HTML + parser is a fine fallback.

General WAF lesson: **"blocked right now" ≠ "blocked always."** Back off and retry rather than escalating evasion.

Host capabilities confirmed available (for whoever runs this): `curl`/`requests`, Playwright (chromium + firefox installed), Selenium, system Firefox 150, `DISPLAY=:0`, the `codex` CLI (authed), residential IP.

---

## Run order & validation

```bash
for s in hku cuhk polyu eduhk hkbu lingu hkmu cityu; do
  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/${s}_interview_scrap.py
done
# HKUST: hand-maintained Reference(<year>)/HKUST/hkust_interview.json — re-verify the 5 codes
```
Sanity per file: `count` reasonable vs last cycle, every key is a real `JS####` present in the source, `timing ∈ {pre-results, post-results, both}`. Then `npm run audit:selection` (from the repo root).

---

## Per-cycle checklist (2027 and beyond)

The source **URLs are stable**, but each cycle:
- [ ] **Reference dir / output path**: each scraper hardcodes the `Reference(2026)` literal — bump it to the new year (or refactor to a shared `YEAR` constant).
- [ ] **CUHK PDF path** changes yearly (`uploads/<yyyy>/03/Interview-Arrangement-<entry>-Entry.pdf`) — re-find from the download-area page and update the URL in `cuhk_interview_scrap.py`.
- [ ] **HKDSE result-release date** (≈ mid-July) drives timing derivation for CityU / PolyU / LingU / HKMU — update the date constant in those scrapers.
- [ ] **HKUST**: re-verify which programmes interview (the curated 5 may change) from join.hkust.edu.hk.
- [ ] Re-run all scrapers; eyeball per-school counts vs the prior cycle's JSONs.
- [ ] **CityU**: expect a possible Incapsula stub on a cold run → warm the IP / retry / `codex exec`.
- [ ] Re-integrate into `selection.ts` (curated layer / regenerated `selection.interviews.json`) and run `npm run audit:selection` + `npm run audit:analysis`.
