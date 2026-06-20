#!/usr/bin/env python
"""CityU non-academic requirement scraper (portfolio / interview / audition / test).

CityU's per-programme pages (www.cityu.edu.hk/admo/programmes/<slug>) state the
non-academic requirement in plain text — e.g. CREATE's page: "...(JS1040/JS1041/
JS1042/JS1043/JS1044)... are highly recommended to submit a portfolio...". Those
pages are server-rendered (unlike CityU's Incapsula-gated admo interview SPA), so
plain requests works. We reuse the per-programme URLs already in the unified data.

Captures TYPE + SALIENCE (highly recommended → weighty, required → required,
welcome/may → optional) + TIMING (before/after HKDSE results). One page often
lists several JS codes (a cluster) → the requirement is attached to every code it
names. Output → Reference(2026)/CityU/cityu_requirements.json (folded into the
official non_academic layer by unify; see docs/manuals/INTERVIEW_SCRAPING.md).

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/cityu_requirements_scrap.py
"""
import json, re, sys, time
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/processed/JUPAS_2026_Unified_Data.json"
OUT = ROOT / "Reference(2026)" / "CityU" / "cityu_requirements.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# NOTE: interview is intentionally NOT scraped here — programme pages mention
# "interview" generically (boilerplate), which over-matches. CityU interview data
# comes from the dedicated interview-arrangement page (cityu_interview.json). This
# scraper captures the more-specific, page-stated requirement types.
TYPE_PATTERNS = [
    # Portfolio only in a SUBMISSION context — bare "portfolio" matches curriculum
    # topics ("portfolio management" in finance, "portfolio of projects" in CS/eng).
    (re.compile(r"submit[^.;!?]{0,50}portfolio|portfolio[^.;!?]{0,40}(submission|submitt|required|recommend|welcom|encourag)", re.I), "portfolio"),
    (re.compile(r"audition", re.I), "audition"),
    (re.compile(r"practical test", re.I), "practical-test"),
    (re.compile(r"aptitude test", re.I), "aptitude-test"),
    (re.compile(r"(written|entrance)\s+(test|exam)", re.I), "written-test"),
]
CODE_RE = re.compile(r"JS\d{4}")


def salience(text: str) -> str:
    t = text.lower()
    if re.search(r"\b(required|compulsory|mandatory|must)\b", t):
        return "required"
    if re.search(r"highly recommend|strongly (recommend|encourag)", t):
        return "weighty"
    if re.search(r"recommend|welcom|encourag|may (be|submit|apply)|optional|if (invited|shortlist)", t):
        return "optional"
    return "weighty"


def timing(text: str):
    t = text.lower()
    after = re.search(r"after .{0,40}(result|announc)", t)
    before = re.search(r"before .{0,40}result", t)
    if after and before:
        return "both"
    if after:
        return "post-results"
    if before:
        return "pre-results"
    return None


def fetch(url: str) -> str | None:
    for attempt in (1, 2):
        try:
            html = requests.get(url, headers={"User-Agent": UA}, timeout=25).text
        except Exception:
            html = ""
        if len(html) > 5000 and "incapsula" not in html[:1500].lower():
            return html
        time.sleep(3 * attempt)  # cold/stub → wait & retry once
    return None


def parse(html: str, page_codes: set[str], cityu_codes: set[str]) -> dict[str, list]:
    """Return {code: [requirement,...]} for requirements stated on the page.

    Works per leaf text block (p/li/td) split into sentences, so codes / salience
    / timing stay local to the requirement — and a long paragraph (the SCM
    portfolio note lists JS1040–JS1044 in one sentence) is handled correctly.
    """
    soup = BeautifulSoup(html, "html.parser")
    found: dict[str, dict[str, dict]] = {}
    rank = {"optional": 0, "weighty": 1, "required": 2}
    for el in soup.find_all(["p", "li", "td"]):
        block = el.get_text(" ", strip=True)
        if len(block) < 20:
            continue
        block_codes = set(CODE_RE.findall(block)) & cityu_codes
        for sent in re.split(r"(?<=[.;!?])\s+", block):
            for pat, rtype in TYPE_PATTERNS:
                if not pat.search(sent):
                    continue
                codes = (set(CODE_RE.findall(sent)) & cityu_codes) or block_codes or page_codes
                item = {"type": rtype, "salience": salience(sent), "source": "official"}
                tm = timing(sent)
                if tm:
                    item["timing"] = tm
                for c in codes:
                    prev = found.setdefault(c, {}).get(rtype)
                    if not prev or rank[item["salience"]] > rank[prev["salience"]]:
                        found[c][rtype] = item
    return {c: list(d.values()) for c, d in found.items()}


def main() -> int:
    progs = [p for p in json.load(open(DATA)) if p["institution"] == "CityUHK"]
    cityu_codes = {p["jupas_code"] for p in progs}
    # url -> codes that use it (dedupe clustered pages)
    url_codes: dict[str, set[str]] = {}
    for p in progs:
        for w in (p.get("programme_websites") or []):
            if w and "admo/programmes" in w:
                url_codes.setdefault(w, set()).add(p["jupas_code"])
                break
    print(f"CityU: {len(progs)} programmes, {len(url_codes)} unique programme pages to fetch")

    result: dict[str, list] = {}
    ok = skipped = 0
    for url, codes in url_codes.items():
        html = fetch(url)
        if not html:
            skipped += 1
            print(f"  ⚠️ stub/blocked: {url.split('/')[-1]}")
            continue
        ok += 1
        for code, items in parse(html, codes, cityu_codes).items():
            result.setdefault(code, [])
            existing = {i["type"] for i in result[code]}
            result[code] += [i for i in items if i["type"] not in existing]
        time.sleep(0.6)  # be polite to the WAF

    OUT.write_text(json.dumps(
        {"source": "https://www.cityu.edu.hk/admo/programmes/", "fetched": date.today().isoformat(),
         "pages_ok": ok, "pages_blocked": skipped,
         "programmes": {c: {"requirements": v} for c, v in sorted(result.items())}},
        ensure_ascii=False, indent=2,
    ))
    from collections import Counter
    by = Counter(i["type"] for v in result.values() for i in v)
    print(f"Wrote {OUT}  ({len(result)} programmes; pages ok={ok} blocked={skipped})  types: {dict(by)}")
    for c in ("JS1040", "JS1041"):
        print(f"  {c}: {result.get(c, '(none)')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
