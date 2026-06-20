"""
JUPAS Combined PDF Auto-Splitter

Detects school page boundaries by parsing the running header on each page
(e.g. "City University of Hong Kong – 2025 JUPAS Admissions Scores Page 1 of 7"),
then splits the PDF into per-school files saved under Reference({year})/{school}/.

URL pattern: https://www.jupas.edu.hk/f/page/3667/af_{year}_JUPAS.pdf
(year in URL = score year, e.g. 2025 for 2025 entry scores)

Usage:
    ~/miniconda3/envs/jupascal/bin/python jupas_pdf_split.py [--year 2025]
"""

import argparse
import os
import re
import sys

import pdfplumber
from pypdf import PdfReader, PdfWriter

# ---------------------------------------------------------------------------
# Institution name → short folder key
# Match order matters: more specific patterns first.
# Uses keyword substrings (case-insensitive) from the extracted header text.
# ---------------------------------------------------------------------------
INSTITUTION_KEYWORDS = [
    ("Science and Technology",  "HKUST"),
    ("Polytechnic",             "PolyU"),
    ("Chinese University",      "CUHK"),
    ("Education University",    "EdUHK"),
    ("Baptist",                 "HKBU"),
    ("Metropolitan",            "HKMU"),
    # "City University" must come before "University of Hong Kong" (substring overlap)
    ("City University",         "CityU"),
    # "Lingnan" may appear as "Lin gnan" due to PDF kerning — match after space-collapse
    ("Lingnan",                 "LingU"),
    # HKU last: broadest match
    ("University of Hong Kong", "HKU"),
]

# Regex: institution name is everything before " – YYYY JUPAS" or " - YYYY JUPAS"
HEADER_RE = re.compile(r"^(.+?)\s*[–\-]\s*\d{4}\s+JUPAS", re.IGNORECASE)


def detect_institution(page) -> str | None:
    """
    Extract the first non-empty line of the page text and parse the institution name.
    Returns a short key (e.g. 'HKBU') or None if no match.
    """
    text = page.extract_text() or ""
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = HEADER_RE.match(line)
        if m:
            inst_name = m.group(1).strip()
            # Collapse internal spaces to handle kerning artifacts (e.g. "Lin gnan" → "Lingnan")
            inst_collapsed = re.sub(r"\s+", "", inst_name).lower()
            for keyword, key in INSTITUTION_KEYWORDS:
                if keyword.lower().replace(" ", "") in inst_collapsed:
                    return key
        break  # only check first non-empty line
    return None


def find_page_ranges(pdf_path: str) -> dict[str, tuple[int, int]]:
    """
    Scan all pages and return {school_key: (start_1indexed, end_1indexed)}.
    Page 1 (cover/intro) is skipped — detection starts from page 2.
    """
    ranges: dict[str, tuple[int, int]] = {}
    current_school = None
    current_start = None

    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"  Total pages: {total}")

        for i, page in enumerate(pdf.pages):
            page_num = i + 1  # 1-indexed

            if page_num == 1:
                print(f"  p{page_num:02d}  [cover — skipped]")
                continue

            school = detect_institution(page)

            if school != current_school:
                # Close previous school range
                if current_school is not None:
                    ranges[current_school] = (current_start, page_num - 1)
                    print(f"  → {current_school}: p{current_start}–p{page_num - 1}")
                current_school = school
                current_start = page_num

            print(f"  p{page_num:02d}  {school or '???'}")

        # Close last school
        if current_school is not None:
            ranges[current_school] = (current_start, total)
            print(f"  → {current_school}: p{current_start}–p{total}")

    return ranges


def split_pdf(pdf_path: str, ranges: dict[str, tuple[int, int]], year: int, ref_root: str):
    """Split the PDF into per-school files."""
    reader = PdfReader(pdf_path)

    for school, (start, end) in ranges.items():
        out_dir = os.path.join(ref_root, school)
        os.makedirs(out_dir, exist_ok=True)

        fname = f"af_{year}_{school}.pdf"
        out_path = os.path.join(out_dir, fname)

        writer = PdfWriter()
        for page_num in range(start - 1, end):  # 0-indexed
            writer.add_page(reader.pages[page_num])

        with open(out_path, "wb") as f:
            writer.write(f)

        print(f"  Saved {out_path}  ({end - start + 1} pages, p{start}–p{end})")


def main():
    parser = argparse.ArgumentParser(description="Split JUPAS combined PDF by school.")
    parser.add_argument("--year", type=int, default=2025,
                        help="Score year (used in filename and ref folder, default: 2025)")
    parser.add_argument("--ref-root", default=None,
                        help="Root reference folder (default: Reference({year+1}))")
    args = parser.parse_args()

    score_year = args.year
    ref_root = args.ref_root or f"Reference({score_year + 1})"
    pdf_path = os.path.join(ref_root, f"af_{score_year}_JUPAS.pdf")

    if not os.path.exists(pdf_path):
        print(f"ERROR: {pdf_path} not found.")
        print(f"  Download it first from:")
        print(f"  https://www.jupas.edu.hk/f/page/3667/af_{score_year}_JUPAS.pdf")
        sys.exit(1)

    print(f"Scanning: {pdf_path}")
    ranges = find_page_ranges(pdf_path)

    print(f"\nSplitting into {len(ranges)} school files under {ref_root}/...")
    split_pdf(pdf_path, ranges, score_year, ref_root)

    print(f"\nDone. Schools detected: {list(ranges.keys())}")


if __name__ == "__main__":
    main()
