#!/usr/bin/env python
"""HKMU JUPAS interview-arrangement scraper.

HKMU's interview page has table(s): JUPAS Code | Programme Title | Interview Date |
Interview Format | Mode/Remarks, with faculty banner rows interspersed. Only some
programmes interview (most after results). Timing derived from "Interview Date".

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/hkmu_interview_scrap.py
Out:  Reference(2026)/HKMU/hkmu_interview.json
"""
import json, re, sys
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

URL = "https://admissions.hkmu.edu.hk/ug/jupas-interview/"
OUT = Path(__file__).resolve().parents[2] / "Reference(2026)" / "HKMU" / "hkmu_interview.json"
CODE_RE = re.compile(r"^JS[A-Z0-9]{4}$")
BEFORE = re.compile(r"\b(before|january|february|march|april|may|june|jun)\b", re.I)
AFTER = re.compile(r"\b(after|release|july|jul|august|aug|september|sep)\b", re.I)


def derive_timing(d: str):
    d = (d or "").lower()
    if not d.strip():
        return None
    hb, ha = bool(BEFORE.search(d)), bool(AFTER.search(d))
    return "both" if hb and ha else "pre-results" if hb else "post-results" if ha else "unknown"


def main() -> int:
    html = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30, verify=False).text
    soup = BeautifulSoup(html, "html.parser")
    progs: dict[str, dict] = {}
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if len(cells) < 3 or not CODE_RE.match(cells[0]):
                continue  # skips header + faculty-banner rows
            code, name, idate = cells[0], cells[1], cells[2]
            fmt = cells[3] if len(cells) > 3 else ""
            timing = derive_timing(idate)
            if timing is None:
                continue
            progs[code] = {"name": name, "type": "interview", "timing": timing, "date": idate.strip(), "format": fmt.strip()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": URL, "fetched": date.today().isoformat(), "count": len(progs), "programmes": progs}, ensure_ascii=False, indent=2))
    by = {}
    for v in progs.values():
        by[v["timing"]] = by.get(v["timing"], 0) + 1
    print(f"Wrote {OUT}  ({len(progs)} programmes)  by timing: {by}")
    for c in list(progs)[:3]:
        print(f"  {c}: {progs[c]}")
    return 0


if __name__ == "__main__":
    import urllib3; urllib3.disable_warnings()
    sys.exit(main())
