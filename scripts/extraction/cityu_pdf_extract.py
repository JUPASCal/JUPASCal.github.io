"""
CityU PDF Extractor — 2026_JUPAS_AdmissionScoreFormulaAndScores.pdf

Extracts admission scores and score formulas from CityU's annual PDF.
Note: scores are 2025 actuals; formula reflects 2026 weightings (as stated in PDF header).

Output: Reference(2026)/CityU/CityU_PDF_2026_Extracted.json
        Reference(2026)/CityU/CityU_PDF_2026_Extracted.xlsx
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH    = "Reference(2026)/CityU/2026_JUPAS_AdmissionScoreFormulaAndScores.pdf"
OUTPUT_JSON  = "Reference(2026)/CityU/CityU_PDF_2026_Extracted.json"
OUTPUT_EXCEL = "Reference(2026)/CityU/CityU_PDF_2026_Extracted.xlsx"

HEADER_ROWS = 6  # rows to skip at top of each page table (column headers)
JUPAS_PATTERN = re.compile(r'^(JS\w+)\n(.+)', re.DOTALL)


def parse_programme_cell(cell):
    """Extract JUPAS code and title from first column cell."""
    if not cell:
        return None, None
    cell = cell.strip()
    m = JUPAS_PATTERN.match(cell)
    if m:
        code  = m.group(1).strip()
        title = m.group(2).replace('\n', ' ').strip()
        return code, title
    return None, None


def is_section_header(row):
    """Detect college section header rows (e.g. 'College of Business')."""
    if not row[0]:
        return False
    text = str(row[0]).strip()
    return (
        text.startswith("College of") or
        text.startswith("School of") or
        text == "Interdisciplinary"
    ) and not JUPAS_PATTERN.match(text)


results = []

with pdfplumber.open(PDF_PATH) as pdf:
    print(f"Total pages: {len(pdf.pages)}")
    current_college = ""

    for page_num, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        if not tables:
            continue

        table = tables[0]

        for row in table[HEADER_ROWS:]:
            # Skip empty rows
            if all(cell is None or str(cell).strip() == "" for cell in row):
                continue

            # Detect college section headers
            if is_section_header(row):
                current_college = str(row[0]).strip()
                continue

            # Parse data row
            jupas_code, title = parse_programme_cell(row[0])
            if not jupas_code:
                continue

            formula      = str(row[1] or "").replace('\n', ' ').strip()
            weightings   = str(row[2] or "").replace('\n', '; ').strip()
            median       = str(row[3] or "").strip()
            lower_q      = str(row[4] or "").strip()

            results.append({
                "jupas_code":          jupas_code,
                "title":               title,
                "college":             current_college,
                "data_year_scores":    "2025",
                "data_year_formula":   "2026",
                "score_formula":       formula,
                "subject_weightings":  weightings,
                "median_score":        median,
                "lower_quartile":      lower_q,
            })

        print(f"  Page {page_num+1}: {len(results)} records so far")

print(f"\nTotal extracted: {len(results)} programmes")

# Save
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

# Quick sanity check
print(f"\nSample records:")
for r in results[:3]:
    print(f"  {r['jupas_code']} | median={r['median_score']} | lower={r['lower_quartile']} | formula={r['score_formula'][:50]}")
