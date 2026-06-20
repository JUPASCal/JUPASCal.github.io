"""
JUPAS Programme Detail Scraper
=================================
Scrapes every programme detail page from the official JUPAS site
(https://www.jupas.edu.hk/en/programme/<institution>/<JS_code>) and saves a
single JSON file that captures *everything* the JUPAS page exposes per
programme — name, requirements tables, tuition fee, contacts, short
description, programme website, quota, study level, and a raw text fallback
for any field whose structure we don't (yet) parse precisely.

Why this exists:
- Per-school scrapers (cuhk_scrap, hku_scrap, etc.) pull from each
  institution's own data feed, which can lag the JUPAS public listing.
- The JUPAS site has rich per-programme metadata that we want as a baseline
  for *every* programme — even those whose institutional feed hasn't been
  updated, or for which we don't have a per-school scraper at all (SSSDP).
- The unify script can prefer institutional data when available, but fall
  back to JUPAS data so that no programme ever has empty fields.

Output: data/raw/jupas_programme_details_2026.json (list of records).

Usage:
    ~/miniconda3/envs/jupascal/bin/python scripts/extraction/jupas_detail_scrap.py
    # Resume support: re-run to fetch only missing programmes
    ~/miniconda3/envs/jupascal/bin/python scripts/extraction/jupas_detail_scrap.py --force  # refetch all
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://www.jupas.edu.hk"
OUTPUT_FILE = "data/raw/jupas_programme_details_2026.json"

# UGC + HKMU + SSSDP — all paths under /en/programme/<key>/
INSTITUTION_KEYS = [
    "cityuhk", "cuhk", "hku", "hkbu", "lingnanu",
    "eduhk", "hkust", "polyu", "hkmu", "sssdp",
]

# Map JUPAS listing-page institution key to canonical "School" label used
# elsewhere in the project. Keep aligned with scripts/utils/unify_2026_data.py.
INSTITUTION_LABEL = {
    "cityuhk": "CityUHK",
    "cuhk":    "CUHK",
    "hku":     "HKU",
    "hkbu":    "HKBU",
    "lingnanu": "LingnanU",
    "eduhk":   "EdUHK",
    "hkust":   "HKUST",
    "polyu":   "PolyU",
    "hkmu":    "HKMU",
    "sssdp":   "SSSDP",
}


def fetch(url, retries=3, sleep=2):
    last = None
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            # JUPAS pages are served as UTF-8 but lack a charset hint; requests
            # falls back to ISO-8859-1 which mangles Chinese names. Force UTF-8.
            r.encoding = "utf-8"
            return r.text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(sleep * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last}")


def fetch_listing(inst_key):
    """Returns list of {code, name_en, name_zh, url} for one institution."""
    html = fetch(f"{BASE_URL}/en/programme/{inst_key}/")
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="program_table program_table-hasFC")
    if not table:
        return []
    out = []
    for tr in table.find_all("tr"):
        if tr.find("th"):
            continue
        a_no = tr.find("td", class_="c-no")
        if not (a_no and a_no.find("a")):
            continue
        code = a_no.find("a").text.strip()
        href = a_no.find("a")["href"]

        ft = tr.find("td", class_="c-ft")
        name_en = ""
        name_zh = ""
        if ft:
            # English name is the leading text node before the <span class=tname-cn>
            for c in ft.contents:
                if isinstance(c, str) and c.strip():
                    name_en = c.strip()
                    break
            zh_span = ft.find("span", class_="tname-cn")
            if zh_span:
                name_zh = zh_span.text.strip()

        out.append({
            "jupas_code": code,
            "name_en": name_en,
            "name_zh": name_zh,
            "url": href if href.startswith("http") else BASE_URL + href,
        })
    return out


def _strokebar_sections(soup):
    """Map of section title (with trailing 'Updated' stripped) -> outer box element."""
    sections = {}
    for p in soup.find_all("p", class_="strokeBar_title"):
        title_raw = (p.text or "").strip()
        # Remove the trailing "Updated" tag that some sections carry.
        title = re.sub(r"\s*Updated\s*$", "", title_raw)
        box = p.find_parent("div", class_="strokeBar_box")
        if box is not None:
            sections[title] = box
    return sections


def _parse_dsereg_table(table):
    """Returns a list of {subject, min_level} from a dsereg_table."""
    rows = []
    for tr in table.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        if len(cells) >= 2:
            rows.append({"subject": cells[0], "min_level": cells[1]})
    # Drop the header row
    return rows[1:] if rows and rows[0]["min_level"].lower() in {"minimum level", "min level"} else rows


def _parse_requirements(box):
    """Parse the Requirements strokebar box into a structured dict.

    JUPAS pages present requirements as two pairs of tables:
        - Programme Entrance: <table.dsereg_table-core> + <table.dsereg_table-elective>
        - General Entrance:   another pair, sometimes literally identical to above
    Some programmes have only one pair when programme = general.
    """
    out = {
        "programme_core": [],
        "programme_electives": [],
        "general_core": [],
        "general_electives": [],
        "notes": [],
        "raw_text": "",
    }
    if box is None:
        return out

    cores, electives = [], []
    for t in box.find_all("table", class_="dsereg_table"):
        classes = t.get("class") or []
        rows = _parse_dsereg_table(t)
        if "dsereg_table-core" in classes:
            cores.append(rows)
        elif "dsereg_table-elective" in classes:
            electives.append(rows)

    if cores:
        out["programme_core"] = cores[0]
    if len(cores) > 1:
        out["general_core"] = cores[1]
    if electives:
        out["programme_electives"] = electives[0]
    if len(electives) > 1:
        out["general_electives"] = electives[1]

    seen = set()
    for el in box.find_all(["p", "li"]):
        txt = el.get_text(" ", strip=True)
        if not txt or len(txt) < 6 or len(txt) > 800:
            continue
        if any(x in txt for x in (
            "Programme Entrance Requirements",
            "General Entrance Requirements",
            "Core Subjects",
            "Elective Subject",
            "Minimum Level",
        )):
            continue
        if txt in seen:
            continue
        seen.add(txt)
        out["notes"].append(txt)

    out["raw_text"] = box.get_text(" ", strip=True)[:4000]
    return out


def _text_of(box, strip_title=None):
    if box is None:
        return ""
    txt = box.get_text(" ", strip=True)
    if strip_title:
        txt = re.sub(rf"^\s*{re.escape(strip_title)}\s*", "", txt).strip()
    return txt


def _hrefs(box):
    if box is None:
        return []
    return [a.get("href").strip() for a in box.find_all("a") if a.get("href")]


def _abs_url(href):
    href = (href or "").strip()
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return BASE_URL + href
    return href


def _inline_spans(el):
    """Flatten an element to ordered inline runs: {text} or {text, href}.

    Adjacent text runs merge; only http(s) <a> tags become link spans (so a
    paragraph keeps its embedded links instead of dropping the href as the flat
    get_text() did). Renderer treats this as a list of text/link pieces."""
    spans = []

    def add_text(s):
        s = re.sub(r"\s+", " ", s)
        if not s:
            return
        if spans and "href" not in spans[-1]:
            spans[-1]["text"] += s
        else:
            spans.append({"text": s})

    def walk(node):
        for c in node.children:
            name = getattr(c, "name", None)
            if name is None:
                add_text(str(c))
            elif name == "a":
                href = _abs_url(c.get("href"))
                text = c.get_text(" ", strip=True)
                if text and href.startswith(("http://", "https://")):
                    spans.append({"text": text, "href": href})
                else:
                    add_text(c.get_text(" ", strip=True))
            elif name == "br":
                add_text(" ")
            elif name in ("script", "style"):
                continue
            else:
                walk(c)

    walk(el)
    # Collapse whitespace but KEEP the spaces *between* runs (a text run that ends
    # in a space before a link must stay separated, or "…between" + "Joint…" fuse).
    # Link text is trimmed; only the block's outer edges are stripped.
    cleaned = []
    for s in spans:
        if s.get("href"):
            text = re.sub(r"\s+", " ", s["text"]).strip()
            if text:
                cleaned.append({"text": text, "href": s["href"]})
        else:
            cleaned.append({"text": re.sub(r"\s+", " ", s["text"])})
    while cleaned and "href" not in cleaned[0] and not cleaned[0]["text"].strip():
        cleaned.pop(0)
    while cleaned and "href" not in cleaned[-1] and not cleaned[-1]["text"].strip():
        cleaned.pop()
    if cleaned and "href" not in cleaned[0]:
        cleaned[0]["text"] = cleaned[0]["text"].lstrip()
    if cleaned and "href" not in cleaned[-1]:
        cleaned[-1]["text"] = cleaned[-1]["text"].rstrip()
    return [s for s in cleaned if s.get("href") or s["text"]]


def _is_heading_el(el):
    if el.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        return True
    bolds = el.find_all(["strong", "b"])
    if bolds:
        bold_text = " ".join(b.get_text(" ", strip=True) for b in bolds).strip()
        full = el.get_text(" ", strip=True).strip()
        return bold_text == full and 0 < len(full) < 80
    return False


# Trivial blocks not worth keeping: bare dashes, or an empty "Remarks: -".
_SKIP_BLOCK_RE = re.compile(r"^(remarks\s*:?\s*)?[-–—]?$", re.IGNORECASE)


def _description_blocks(box):
    """Parse the Short Description box into ordered, structured blocks:
        [{ "t": "h"|"p"|"li", "spans": [{text}|{text,href}, ...] }, ...]
    Preserves headings, paragraphs, list items and inline links — the flat
    short_description loses all of it."""
    if box is None:
        return []
    content = box.find("div", class_="strokeBar_content") or box
    out = []
    seen = set()
    for el in content.find_all(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b"]):
        if el.name in ("strong", "b"):
            # Bold inside a p/li/heading is part of that block, not its own.
            if el.find_parent(["p", "li", "a", "h1", "h2", "h3", "h4", "h5", "h6"]):
                continue
            kind = "h"
        elif el.name == "p" and el.find_parent("li"):
            continue  # the <li> already captures its inner <p>
        else:
            kind = None
        text = re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()
        if not text or re.sub(r"\s*Updated\s*$", "", text) == "Short Description":
            continue
        spans = _inline_spans(el)
        if not spans:
            continue
        joined = " ".join(s["text"] for s in spans).strip()
        if _SKIP_BLOCK_RE.match(joined):
            continue
        if kind is None:
            kind = "li" if el.name == "li" else ("h" if _is_heading_el(el) else "p")
        key = (kind, joined)
        if key in seen:
            continue
        seen.add(key)
        out.append({"t": kind, "spans": spans})
    return out


def parse_programme(html, jupas_code, institution_key, listing_meta):
    soup = BeautifulSoup(html, "html.parser")
    sections = _strokebar_sections(soup)

    short_desc = _text_of(sections.get("Short Description"), strip_title="Short Description")
    description_blocks = _description_blocks(sections.get("Short Description"))
    prog_websites = _hrefs(sections.get("Programme Website"))
    tuition_text = _text_of(sections.get("First Year Tuition Fee"), strip_title="First Year Tuition Fee")
    tuition_links = [_abs_url(h) for h in _hrefs(sections.get("First Year Tuition Fee"))]
    tuition_url = next((u for u in tuition_links if u.startswith(("http://", "https://"))), "")
    contacts_text = _text_of(sections.get("Contacts"), strip_title="Contacts")
    requirements = _parse_requirements(sections.get("Requirements"))

    m = re.search(r"HK\$\s*([\d,]+)", tuition_text)
    tuition_first_year = ("HK$" + m.group(1)) if m else ""

    quota_div = soup.find("div", class_="programInfo_block programInfo_block-firstyear")
    quota = None
    quota_raw_text = ""
    if quota_div:
        quota_raw_text = quota_div.get_text(" ", strip=True)
        # The intake number is the first standalone integer that appears AFTER
        # the "First Year Intake" label. Naively stripping all non-digits will
        # concatenate stuff like "JS6200 & JS6999" or individual breakdowns
        # ("around 37, 49, 22, ...") into a single bogus number. Find the label
        # then read the next bare integer.
        m = re.search(
            r"First Year Intake(?:\s*\([^)]*\))?\s*:?\s*(\d+)",
            quota_raw_text,
            flags=re.IGNORECASE,
        )
        if m:
            quota = int(m.group(1))

    study_level = ""
    for div in soup.find_all("div", class_="programInfo_block"):
        if "Study Level" in div.text:
            study_level = re.sub(r"^\s*Study Level\s*", "", div.text).strip()
            break

    return {
        "jupas_code": jupas_code,
        "institution": INSTITUTION_LABEL.get(institution_key, institution_key.upper()),
        "institution_key": institution_key,
        "name_en": listing_meta.get("name_en", ""),
        "name_zh": listing_meta.get("name_zh", ""),
        "url": listing_meta.get("url", f"{BASE_URL}/en/programme/{institution_key}/{jupas_code}"),
        "short_description": short_desc,
        "description_blocks": description_blocks,
        "programme_websites": prog_websites,
        "tuition_fee_first_year": tuition_first_year,
        "tuition_fee_full_text": tuition_text,
        "tuition_url": tuition_url,
        "contacts_text": contacts_text,
        "requirements": requirements,
        "quota": quota,
        "quota_raw_text": quota_raw_text,
        "study_level": study_level,
        "scraped_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true",
        help="Refetch every programme even if already present in the output file.",
    )
    parser.add_argument(
        "--sleep", type=float, default=1.0,
        help="Delay between requests in seconds (default 1).",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="If > 0, stop after this many programmes (for testing).",
    )
    parser.add_argument(
        "--institutions", default=",".join(INSTITUTION_KEYS),
        help="Comma-separated subset of institution keys to scrape.",
    )
    args = parser.parse_args()

    inst_keys = [k.strip() for k in args.institutions.split(",") if k.strip()]
    print(f"Institutions: {inst_keys}")

    existing = {}
    if not args.force and os.path.exists(OUTPUT_FILE):
        try:
            existing = {p["jupas_code"]: p for p in json.load(open(OUTPUT_FILE))}
            print(f"Loaded {len(existing)} existing records — will skip already-scraped programmes")
        except Exception as e:  # noqa: BLE001
            print(f"Could not load existing output ({e}); starting fresh.")
            existing = {}

    # 1. Listings
    all_listings = []
    for key in inst_keys:
        try:
            entries = fetch_listing(key)
        except Exception as e:  # noqa: BLE001
            print(f"  {key}: listing fetch FAILED — {e}", file=sys.stderr)
            continue
        for e in entries:
            e["_inst_key"] = key
        all_listings.extend(entries)
        print(f"  {key}: {len(entries)} programmes")

    print(f"Total programmes from listings: {len(all_listings)}")
    todo = [e for e in all_listings if args.force or e["jupas_code"] not in existing]
    if args.limit > 0:
        todo = todo[: args.limit]
    print(f"To scrape: {len(todo)} (skipping {len(all_listings) - len(todo)} already done)")

    # 2. Fetch each detail page
    out = dict(existing)
    for i, entry in enumerate(todo, 1):
        code = entry["jupas_code"]
        inst = entry["_inst_key"]
        url = entry["url"]
        try:
            html = fetch(url)
            rec = parse_programme(html, code, inst, entry)
            out[code] = rec
        except Exception as e:  # noqa: BLE001
            print(f"  [{i}/{len(todo)}] {code} FAILED: {e}", file=sys.stderr)
            continue

        if i % 20 == 0 or i == len(todo):
            print(f"  [{i}/{len(todo)}] {code} ({inst}) — {rec['name_en'][:50]}")
            # Incremental flush so a long run is restartable
            os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
            with open(OUTPUT_FILE, "w") as f:
                json.dump(list(out.values()), f, ensure_ascii=False, indent=2)
        time.sleep(args.sleep)

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(list(out.values()), f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(out)} programmes to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
