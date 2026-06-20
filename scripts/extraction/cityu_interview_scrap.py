#!/usr/bin/env python
"""CityUHK JUPAS interview-arrangement scraper.

CityUHK's admissions page is protected by Imperva Incapsula. A plain HTTP GET
returns only the challenge stub, so this scraper renders the page with
Playwright Chromium, saves the rendered DOM, then parses the programme table.

CityUHK provides one free-text "Interview Arrangements" column rather than
explicit before/after HKDSE-results columns. Timing is derived against the 2026
HKDSE result release date (15 July 2026):
  - May/June/early-July dates: pre-results
  - late-July/August dates: post-results
  - broad July or June/July ranges: both
  - undated "When necessary": kept as possible interviews in both windows

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/cityu_interview_scrap.py
Out:  Reference(2026)/CityU/cityu_interview.html
      Reference(2026)/CityU/cityu_interview.json
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

URL = "https://www.cityu.edu.hk/admo/interview-arrangements-local-jupas-applicants"
ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "Reference(2026)" / "CityU"
HTML_OUT = OUT_DIR / "cityu_interview.html"
JSON_OUT = OUT_DIR / "cityu_interview.json"

CODE_RE = re.compile(r"JS\d{4}")
NO_INTERVIEW_RE = re.compile(r"^\s*not\s+required\s*$", re.I)


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def fetch_rendered_html() -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            viewport={"width": 1365, "height": 900},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        page.goto(URL, wait_until="networkidle", timeout=90_000)
        page.wait_for_function(
            "() => /JS\\d{4}/.test(document.body.innerText)",
            timeout=45_000,
        )
        html = page.content()
        browser.close()
        return html


def july_days(text: str) -> list[int]:
    days: list[int] = []
    for match in re.finditer(r"(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+july", text, re.I):
        days.append(int(match.group(1)))
        if match.group(2):
            days.append(int(match.group(2)))
    return days


def derive_timing(arrangement: str) -> str | None:
    text = clean_text(arrangement).lower()
    compact = re.sub(r"\s+", "", text)
    if not text or NO_INTERVIEW_RE.match(text):
        return None
    if text == "when necessary":
        return "both"

    if "june/july" in compact:
        return "both"
    if re.search(r"\b(late july|august)\b", text):
        return "post-results"
    if re.search(r"\bearly\s+july\b", text) and "mid" not in text:
        return "pre-results"
    if re.search(r"\b(early\s+to\s+mid[- ]?july|mid[- ]?july)\b", text):
        return "both"

    days = july_days(text)
    if days:
        has_before = any(day <= 15 for day in days)
        has_after = any(day > 15 for day in days)
        if has_before and has_after:
            return "both"
        if has_before:
            return "pre-results"
        return "post-results"

    has_before = bool(re.search(r"\b(january|february|march|april|may|june)\b", text))
    if "july" in text:
        return "both" if has_before else "both"
    return "pre-results" if has_before else None


def parse_programmes(html: str) -> dict[str, dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    programmes: dict[str, dict[str, str]] = {}

    for row in soup.select("table tr"):
        code_cell = row.select_one(".views-field-field-admission-code")
        title_cell = row.select_one(".views-field-title")
        interview_cell = row.select_one(".views-field-field-interview-jupas")
        if not code_cell or not title_cell or not interview_cell:
            continue

        code_match = CODE_RE.search(clean_text(code_cell.get_text(" ", strip=True)))
        if not code_match:
            continue
        code = code_match.group(0)

        link = title_cell.find("a")
        name = clean_text(link.get_text(" ", strip=True) if link else title_cell.get_text(" ", strip=True))
        name = re.sub(r"^.*?JS\d{4}\s*-\s*", "", name).strip()

        arrangement = clean_text(interview_cell.get_text(" ", strip=True))
        timing = derive_timing(arrangement)
        if timing is None:
            continue

        programmes[code] = {
            "name": name,
            "type": "interview",
            "timing": timing,
            "before": arrangement if timing in ("pre-results", "both") else "",
            "after": arrangement if timing in ("post-results", "both") else "",
        }

    return programmes


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    html = fetch_rendered_html()
    HTML_OUT.write_text(html, encoding="utf-8")

    programmes = parse_programmes(html)
    JSON_OUT.write_text(
        json.dumps(
            {
                "source": URL,
                "fetched": date.today().isoformat(),
                "count": len(programmes),
                "programmes": programmes,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    by_timing: dict[str, int] = {}
    for programme in programmes.values():
        by_timing[programme["timing"]] = by_timing.get(programme["timing"], 0) + 1
    print(f"Wrote {HTML_OUT}")
    print(f"Wrote {JSON_OUT}  ({len(programmes)} programmes)  by timing: {by_timing}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
