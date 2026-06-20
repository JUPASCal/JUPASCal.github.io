#!/usr/bin/env python
"""PolyU JUPAS interview-arrangement scraper.

PolyU's interview page is a Drupal Views listing (server-rendered, 10 rows/page,
paginated via ?page=N). NO XHR/JSON API — the rows are in the HTML as
`.views-row` with Drupal paragraph fields (field--field-prog-interview-date /
-mode / -rmk). So plain requests + pagination works (no headless browser needed).

Unlike HKU/CUHK (explicit Before|After columns), PolyU gives a free-text "Date of
Interview" (e.g. "June/July", "After the announcement of HKDSE results",
"June/July, if necessary"), so `timing` is DERIVED from that text and is
approximate. PolyU admits largely by broad scheme, so codes are scheme-level.

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/polyu_interview_scrap.py
Out:  Reference(2026)/PolyU/polyu_interview.json
"""
import json, re, sys
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

BASE = "https://www.polyu.edu.hk/study/ug/admissions/jupas/jupas-interview-arrangement"
OUT = Path(__file__).resolve().parents[2] / "Reference(2026)" / "PolyU" / "polyu_interview.json"
CODE_RE = re.compile(r"JS[A-Z0-9]{4}")
BEFORE = re.compile(r"\b(before|january|february|march|april|apr|may|june|jun)\b", re.I)
AFTER = re.compile(r"\b(after|july|jul|august|aug|september|sept|sep|october)\b", re.I)


def strip_label(t: str, label: str) -> str:
    return re.sub(rf"^\s*{label}\s*", "", t, flags=re.I).strip()


def derive_timing(date_text: str) -> str | None:
    d = date_text.lower()
    if not d:
        return None
    has_before = bool(BEFORE.search(d))
    has_after = bool(AFTER.search(d))
    if has_before and has_after:
        return "both"
    if has_before:
        return "pre-results"
    if has_after:
        return "post-results"
    return "unknown"  # has a date string we couldn't place (keep, flag for review)


def main() -> int:
    progs: dict[str, dict] = {}
    for page in range(0, 12):
        html = requests.get(f"{BASE}?page={page}", headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
        rows = BeautifulSoup(html, "html.parser").select(".views-row")
        if not rows:
            break
        for r in rows:
            code_el = r.select_one(".views-field-title")
            m = CODE_RE.search(code_el.get_text(strip=True)) if code_el else None
            if not m:
                continue
            code = m.group(0)
            name_el = r.select_one(".views-field-field-prog-subj-area")
            name = name_el.get_text(" ", strip=True) if name_el else ""
            dates = [strip_label(d.get_text(" ", strip=True), "Date of Interview") for d in r.select(".field--field-prog-interview-date")]
            rmks = [strip_label(d.get_text(" ", strip=True), "Remarks") for d in r.select(".field--field-prog-interview-rmk")]
            date_text = " / ".join(d for d in dates if d)
            timing = derive_timing(date_text)
            if timing is None and not rmks:
                continue  # no interview info at all
            progs[code] = {
                "name": name,
                "type": "interview",
                "timing": timing or "unknown",
                "date": date_text,
                "remarks": " ".join(rmks),
            }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"source": BASE, "fetched": date.today().isoformat(), "count": len(progs), "programmes": progs},
        ensure_ascii=False, indent=2,
    ))
    by_timing: dict[str, int] = {}
    for v in progs.values():
        by_timing[v["timing"]] = by_timing.get(v["timing"], 0) + 1
    print(f"Wrote {OUT}  ({len(progs)} programmes)")
    print("  by timing:", by_timing)
    for c in ("JS3000", "JS3006", "JS3003", "JS3569"):
        print(f"  {c}: {progs.get(c, 'absent')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
