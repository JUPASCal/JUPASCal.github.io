#!/usr/bin/env python
"""HKU JUPAS interview-arrangement scraper.

Parses the REAL two-column table (Before | After release of HKDSE results) at
https://admissions.hku.hk/apply/jupas/interview — one table per faculty — into a
structured per-programme record. This replaces lossy one-shot web-fetch summaries
(which collapsed the two columns and e.g. mis-reported Dentistry as "no interview"
when it actually interviews late-July).

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/hku_interview_scrap.py
Out:  Reference(2026)/HKU/hku_interview.json

Per programme we record the raw before/after cells plus a derived `timing`:
  - both         : real sessions both before AND after results
  - pre-results  : session(s) only before results (after is empty or just an
                   "ENCOURAGED to attend before" note → no hard post-results round)
  - post-results : session(s) only after results
  - (omitted)    : both columns "-" → no interview at all
Salience (required vs good-to-have) is NOT decided here — that's policy applied at
integration time (e.g. medicine = required); this stays purely factual.
"""
import json, re, sys
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

URL = "https://admissions.hku.hk/apply/jupas/interview"
OUT = Path(__file__).resolve().parents[2] / "Reference(2026)" / "HKU" / "hku_interview.json"

CODE_RE = re.compile(r"^\s*(\d{4})\b")


def cell_kind(text: str) -> str:
    """Classify a Before/After cell."""
    t = (text or "").strip()
    if t in ("", "-", "–", "—"):
        return "none"
    if "ENCOURAGED" in t.upper():
        # "Selected candidates are ENCOURAGED to attend the interview before the
        # release…" — an encouragement note, not a scheduled post-results round.
        return "encouraged"
    return "scheduled"


def derive_timing(before_kind: str, after_kind: str) -> str | None:
    has_before = before_kind == "scheduled"
    has_after = after_kind == "scheduled"
    if has_before and has_after:
        return "both"
    if has_before:
        return "pre-results"          # after is none/encouraged → no hard post round
    if has_after:
        return "post-results"
    if after_kind == "encouraged":
        return "pre-results"
    return None                        # none/none → no interview


def main() -> int:
    html = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
    soup = BeautifulSoup(html, "html.parser")

    progs: dict[str, dict] = {}
    for table in soup.find_all("table"):
        header = table.find("tr")
        if not header or "Before Release" not in header.get_text():
            continue
        for row in table.find_all("tr")[1:]:
            cells = [c.get_text(" ", strip=True).replace("\xa0", " ") for c in row.find_all(["td", "th"])]
            if len(cells) < 3:
                continue
            prog, before, after = cells[0], cells[1], cells[2]
            m = CODE_RE.match(prog)
            if not m:
                continue
            code = "JS" + m.group(1)
            name = prog[m.end():].strip()
            bk, ak = cell_kind(before), cell_kind(after)
            timing = derive_timing(bk, ak)
            if timing is None:
                continue  # no interview — skip
            progs[code] = {
                "name": name,
                "type": "interview",
                "timing": timing,
                "before": before.strip(),
                "after": after.strip(),
            }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"source": URL, "fetched": date.today().isoformat(), "count": len(progs), "programmes": progs},
        ensure_ascii=False, indent=2,
    ))
    by_timing: dict[str, int] = {}
    for v in progs.values():
        by_timing[v["timing"]] = by_timing.get(v["timing"], 0) + 1
    print(f"Wrote {OUT}  ({len(progs)} programmes with an interview)")
    print("  by timing:", by_timing)
    for c in ("JS6107", "JS6456", "JS6755", "JS6119"):
        print(f"  {c}: {progs.get(c, 'no interview')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
