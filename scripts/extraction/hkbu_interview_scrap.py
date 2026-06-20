#!/usr/bin/env python
"""HKBU JUPAS interview-arrangement scraper.

HKBU's HKDSE admissions page contains an "Interview Arrangement Summary" table
(Programme Code | Title | Before the Announcement of HKDSE Results | After …)
server-rendered in the HTML. "N/A" cells mean no session in that window.

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/hkbu_interview_scrap.py
Out:  Reference(2026)/HKBU/hkbu_interview.json
"""
import json, re, sys
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

URL = "https://admissions.hkbu.edu.hk/en/hkdse.html"
OUT = Path(__file__).resolve().parents[2] / "Reference(2026)" / "HKBU" / "hkbu_interview.json"
CODE_RE = re.compile(r"^JS[A-Z0-9]{4}$")


def has(t: str) -> bool:
    return bool((t or "").strip()) and (t or "").strip().upper() not in ("-", "–", "—", "N/A", "NA", "NIL")


def main() -> int:
    html = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30, verify=False).text
    soup = BeautifulSoup(html, "html.parser")
    progs: dict[str, dict] = {}
    for table in soup.find_all("table"):
        header = table.find("tr")
        if not header or "Announcement of HKDSE" not in header.get_text():
            continue
        for row in table.find_all("tr")[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if len(cells) < 4 or not CODE_RE.match(cells[0]):
                continue
            code, name, before, after = cells[0], cells[1], cells[2], cells[3]
            hb, ha = has(before), has(after)
            timing = "both" if hb and ha else "pre-results" if hb else "post-results" if ha else None
            if timing is None:
                continue
            progs[code] = {"name": name, "type": "interview", "timing": timing, "before": before.strip(), "after": after.strip()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": URL, "fetched": date.today().isoformat(), "count": len(progs), "programmes": progs}, ensure_ascii=False, indent=2))
    by = {}
    for v in progs.values():
        by[v["timing"]] = by.get(v["timing"], 0) + 1
    print(f"Wrote {OUT}  ({len(progs)} programmes)  by timing: {by}")
    for c in ("JS2060", "JS2660", "JS2410"):
        print(f"  {c}: {progs.get(c, 'absent')}")
    return 0


if __name__ == "__main__":
    import urllib3; urllib3.disable_warnings()
    sys.exit(main())
