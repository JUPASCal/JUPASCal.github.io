#!/usr/bin/env python
"""EdUHK JUPAS interview-arrangement scraper.

EdUHK publishes a clean per-programme table (Code | Programme | Before Release |
After Release of HKDSE Results) at apply.eduhk.hk/ug/jupas_interview, plus
per-programme format blocks (audition / practical test / group interview). We take
the main timing table; audition/practical-test details for Music/Visual Arts/PE
are already captured separately from EdUHK's `remarks_pdf` in our scrape.

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/eduhk_interview_scrap.py
Out:  Reference(2026)/EdUHK/eduhk_interview.json
"""
import json, re, sys
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

URL = "https://www.apply.eduhk.hk/ug/jupas_interview"
OUT = Path(__file__).resolve().parents[2] / "Reference(2026)" / "EdUHK" / "eduhk_interview.json"
CODE_RE = re.compile(r"^JS[A-Z0-9]{4}$")


def kind(t: str) -> bool:
    return bool((t or "").strip()) and (t or "").strip() not in ("-", "–", "—", "N/A", "Nil")


def main() -> int:
    html = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30, verify=False).text
    soup = BeautifulSoup(html, "html.parser")
    progs: dict[str, dict] = {}
    for table in soup.find_all("table"):
        header = table.find("tr")
        if not header or "Before Release" not in header.get_text():
            continue
        for row in table.find_all("tr")[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if len(cells) < 4 or not CODE_RE.match(cells[0]):
                continue
            code, name, before, after = cells[0], cells[1], cells[2], cells[3]
            hb, ha = kind(before), kind(after)
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
    for c in ("JS8001", "JS8010", "JS8726"):
        print(f"  {c}: {progs.get(c, 'absent')}")
    return 0


if __name__ == "__main__":
    import urllib3; urllib3.disable_warnings()
    sys.exit(main())
