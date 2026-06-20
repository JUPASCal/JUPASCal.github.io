#!/usr/bin/env python
"""CUHK JUPAS interview-arrangement scraper.

Parses CUHK's official per-programme interview table PDF (columns: JUPAS Catalogue
No. | Programme | Before release | After release | No Interview) into the same
structured shape as the HKU scraper.

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/cuhk_interview_scrap.py
PDF:  Reference(2026)/CUHK/Interview-Arrangement-2026-Entry.pdf  (download if absent)
Out:  Reference(2026)/CUHK/cuhk_interview.json

The PDF uses a Wingdings tick (\\uf0fc) for "yes" cells. Timing is derived from
which of the Before/After columns are populated; rows ticked under "No Interview"
are omitted. Salience is decided at integration time, not here.
"""
import json, re, sys
from datetime import date
from pathlib import Path
import pdfplumber
import requests

URL = "https://admission.cuhk.edu.hk/wp-content/uploads/2026/03/Interview-Arrangement-2026-Entry.pdf"
PDF = Path(__file__).resolve().parents[2] / "Reference(2026)" / "CUHK" / "Interview-Arrangement-2026-Entry.pdf"
OUT = PDF.with_name("cuhk_interview.json")
TICK = ""
CODE_RE = re.compile(r"^JS[A-Z0-9]{4}$")


def clean(c: str | None) -> str:
    return (c or "").replace(TICK, "✓").replace("\n", " ").strip()


def main() -> int:
    if not PDF.exists():
        PDF.parent.mkdir(parents=True, exist_ok=True)
        PDF.write_bytes(requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=40, verify=False).content)

    progs: dict[str, dict] = {}
    with pdfplumber.open(PDF) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if len(row) < 5:
                        continue
                    code = (row[0] or "").strip()
                    if not CODE_RE.match(code):
                        continue  # skip header / faculty-banner rows
                    name = clean(row[1])
                    before, after, none = clean(row[2]), clean(row[3]), clean(row[4])
                    if none and not before and not after:
                        continue  # explicitly no interview
                    has_before, has_after = bool(before), bool(after)
                    if has_before and has_after:
                        timing = "both"
                    elif has_before:
                        timing = "pre-results"
                    elif has_after:
                        timing = "post-results"
                    else:
                        continue  # nothing populated → treat as no interview
                    progs[code] = {
                        "name": name, "type": "interview", "timing": timing,
                        "before": before, "after": after,
                    }

    OUT.write_text(json.dumps(
        {"source": URL, "fetched": date.today().isoformat(), "count": len(progs), "programmes": progs},
        ensure_ascii=False, indent=2,
    ))
    by_timing: dict[str, int] = {}
    for v in progs.values():
        by_timing[v["timing"]] = by_timing.get(v["timing"], 0) + 1
    print(f"Wrote {OUT}  ({len(progs)} programmes with an interview)")
    print("  by timing:", by_timing)
    for c in ("JS4501", "JS4502", "JS4513", "JS4542", "JS4044"):
        print(f"  {c}: {progs.get(c, 'no interview')}")
    return 0


if __name__ == "__main__":
    import urllib3
    urllib3.disable_warnings()
    sys.exit(main())
