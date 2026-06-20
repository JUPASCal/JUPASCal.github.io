"""
HKU JUPAS Data Scraper & PDF Extractor

Sources:
  API:  https://admissions.hku.hk/api/hkdse/admission_standard
        → 2026 scoring formula + min requirements + subject weightings
  PDF:  Reference(2026)/HKU/HKU-JUPAS-Admissions-Information-2026.pdf
        → 2025 actual admission scores (UQ / Median / LQ)
        → 2026 scoring formula (as cross-reference)
        → 2025 historical formula
        → Min requirements

Column layout in PDF (varies by page):
  col[0]  = HKU 4-digit code (e.g. 6004) → JUPAS code = "JS" + code
  col[1]  = Programme name
  col[2]  = 2026 scoring formula
  col[3]  = Min English
  col[4]  = Min Chinese
  col[5]  = Min Mathematics
  col[6]  = Min CSD/LS
  col[7]  = Min 1st Elective Subject
  col[8]  = Min 2nd Elective Subject / M1/M2
  col[9]  = Specific elective subjects / Other requirements
  col[10] = 2025 historical scoring formula (or "–" for new programmes)
  col[11] = Upper Quartile score (2025)
  14-col pages: col[12] = Median, col[13] = LQ
  13-col pages: col[12] = Median + LQ merged (truncated) — use extract_words instead

Score extraction: Use extract_words x-coordinate bands for ALL pages
  (bypasses pdfplumber merged-cell issues on 13-col pages)
  UQ  ≈ x0 in [1035, 1065]
  Med ≈ x0 in [1080, 1110]
  LQ  ≈ x0 in [1125, 1155]
"""

import re
import json
import warnings
import requests
import pdfplumber
import pandas as pd
from bs4 import BeautifulSoup

warnings.filterwarnings("ignore")

API_URL      = "https://admissions.hku.hk/api/hkdse/admission_standard"
PDF_PATH     = "Reference(2026)/HKU/HKU-JUPAS-Admissions-Information-2026.pdf"
OUTPUT_JSON  = "Reference(2026)/HKU/HKU_2026_Data.json"
OUTPUT_EXCEL = "Reference(2026)/HKU/HKU_2026_Data.xlsx"
RAW_API_JSON = "Reference(2026)/HKU/hku_raw_api.json"

# PDF score column x-bands (empirically determined from extract_words)
UQ_X  = (1035, 1065)
MED_X = (1080, 1110)
LQ_X  = (1125, 1155)

CODE_RE  = re.compile(r'^\d{4}$')
# 1-3 digit numbers or em-dash (–) — excludes 4-digit year numbers in headers
SCORE_RE = re.compile(r'^(\d{1,3}|\u2013)$')


# ── Helpers ───────────────────────────────────────────────────────────────────

def clean(val):
    if val is None:
        return ""
    return " ".join(str(val).split())


def get(row, col):
    return clean(row[col]) if len(row) > col else ""


# ── API parsing ───────────────────────────────────────────────────────────────

def parse_min_req(soup):
    """Extract minimum level requirements from accordionHTML."""
    table = soup.find("table", class_=lambda c: c and "section-Minimum-Level-Requirement" in c)
    if not table:
        return {}
    rows = table.find_all("tr")
    if len(rows) < 2:
        return {}
    cells = rows[1].find_all("td")
    keys = ["req_eng", "req_chin", "req_math", "req_csd", "req_e1", "req_e2"]
    return {keys[i]: clean(cells[i].get_text()) for i in range(min(len(keys), len(cells)))}


def parse_formula_api(soup):
    """Extract 2026 scoring formula from accordionHTML table-style-2."""
    for table in soup.find_all("table", class_=lambda c: c and "table-style-2" in c):
        for row in table.find_all("tr"):
            th = row.find("th")
            td = row.find("td")
            if th and td and "HKDSE Scoring Formula" in th.get_text():
                return clean(td.get_text())
    return ""


def parse_other_req(soup):
    """Extract other requirements text from accordionHTML."""
    table = soup.find("table", class_=lambda c: c and "section-Other-Requirements" in c)
    if not table:
        return ""
    td = table.find("td")
    return clean(td.get_text()) if td else ""


def parse_subject_weight(html):
    """Parse field_hkuad_dse_subject_w HTML into compact string."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    parts = []
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            th = row.find("th")
            td = row.find("td")
            if th and td:
                factor = clean(th.get_text())
                subjects = clean(td.get_text())
                if factor and subjects:
                    parts.append(f"{factor}: {subjects}")
    return " | ".join(parts)


def fetch_and_parse_api():
    resp = requests.get(API_URL, timeout=30)
    resp.raise_for_status()
    raw = resp.json()

    # Save raw response
    with open(RAW_API_JSON, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)
    print(f"Saved raw API: {RAW_API_JSON}")

    programme_data = raw["data"]["programme"]
    results = {}
    for fac, progs in programme_data.items():
        for name, prog in progs.items():
            code_raw = prog.get("programme_code", "")
            # Skip non-JUPAS programmes (e.g. self-financed with code "N/A")
            if not code_raw or not re.match(r'^\d{4}$', code_raw):
                continue
            jupas_code = f"JS{code_raw}"

            html = prog.get("accordionHTML", "") or ""
            soup = BeautifulSoup(html, "html.parser")

            min_req = parse_min_req(soup)
            formula_2026 = parse_formula_api(soup)
            other_req = parse_other_req(soup)
            subject_weight = parse_subject_weight(prog.get("field_hkuad_dse_subject_w"))

            results[jupas_code] = {
                "jupas_code":        jupas_code,
                "hku_code":          code_raw,
                "name":              prog.get("programme_name", ""),
                "degree_type":       prog.get("degree_type", ""),
                "faculty":           fac,
                "data_year_formula": "2026",
                "formula_2026_api":  formula_2026,
                "subject_weight":    subject_weight,
                "other_req":         other_req,
                **min_req,
            }
    return results


# ── PDF extraction ────────────────────────────────────────────────────────────

def get_page_scores(page):
    """
    Extract score words per column using x-coordinate bands.
    Returns (uq_words, med_words, lq_words) sorted top-to-bottom.
    """
    words = page.extract_words()

    def in_band(word, band):
        return band[0] <= word["x0"] <= band[1]

    uq_words  = sorted([w for w in words if in_band(w, UQ_X)  and SCORE_RE.match(w["text"])], key=lambda w: w["top"])
    med_words = sorted([w for w in words if in_band(w, MED_X) and SCORE_RE.match(w["text"])], key=lambda w: w["top"])
    lq_words  = sorted([w for w in words if in_band(w, LQ_X)  and SCORE_RE.match(w["text"])], key=lambda w: w["top"])
    return uq_words, med_words, lq_words


def parse_pdf():
    results = {}

    with pdfplumber.open(PDF_PATH) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue

            uq_words, med_words, lq_words = get_page_scores(page)

            # Collect programme rows (JUPAS code in col[0])
            page_progs = []
            for t in tables:
                if not t:
                    continue
                ncols = max(len(r) for r in t)
                if ncols < 12:
                    continue
                for row in t:
                    code = get(row, 0)
                    if CODE_RE.match(code):
                        page_progs.append(row)

            for i, row in enumerate(page_progs):
                code = get(row, 0)
                jupas_code = f"JS{code}"

                uq  = uq_words[i]["text"]  if i < len(uq_words)  else ""
                med = med_words[i]["text"] if i < len(med_words) else ""
                lq  = lq_words[i]["text"]  if i < len(lq_words)  else ""

                # Normalize em-dash to standard placeholder
                uq  = "" if uq  == "\u2013" else uq
                med = "" if med == "\u2013" else med
                lq  = "" if lq  == "\u2013" else lq

                results[jupas_code] = {
                    "jupas_code":      jupas_code,
                    "hku_code":        code,
                    "name_pdf":        get(row, 1),
                    "formula_2026_pdf": get(row, 2),
                    "req_eng_pdf":     get(row, 3),
                    "req_chin_pdf":    get(row, 4),
                    "req_math_pdf":    get(row, 5),
                    "req_csd_pdf":     get(row, 6),
                    "req_e1_pdf":      get(row, 7),
                    "req_e2_pdf":      get(row, 8),
                    "other_req_pdf":   get(row, 9),
                    "formula_2025":    get(row, 10),
                    "data_year_scores": "2025",
                    "score_uq":        uq,
                    "score_median":    med,
                    "score_lq":        lq,
                }

    return results


# ── Merge & output ────────────────────────────────────────────────────────────

print("Fetching API...")
api_data = fetch_and_parse_api()
print(f"API programmes: {len(api_data)}")

print("Parsing PDF...")
pdf_data = parse_pdf()
print(f"PDF programmes: {len(pdf_data)}")

# Merge: API is primary; PDF provides scores + historical formula
all_codes = sorted(set(api_data) | set(pdf_data))
results = []
for code in all_codes:
    api = api_data.get(code, {})
    pdf = pdf_data.get(code, {})

    # Prefer API name; fall back to PDF name
    name = api.get("name") or pdf.get("name_pdf", "")

    rec = {
        "jupas_code":          code,
        "hku_code":            api.get("hku_code") or pdf.get("hku_code", ""),
        "name":                name,
        "degree_type":         api.get("degree_type", ""),
        "faculty":             api.get("faculty", ""),

        # 2026 scoring formula (API is canonical, PDF as cross-reference)
        "data_year_formula":   "2026",
        "formula_2026":        api.get("formula_2026_api") or pdf.get("formula_2026_pdf", ""),
        "formula_2026_pdf":    pdf.get("formula_2026_pdf", ""),

        # 2025 historical formula (PDF only)
        "formula_2025":        pdf.get("formula_2025", ""),

        # Subject weightings (API only)
        "subject_weight":      api.get("subject_weight", ""),

        # Min requirements (API is canonical)
        "req_eng":             api.get("req_eng") or pdf.get("req_eng_pdf", ""),
        "req_chin":            api.get("req_chin") or pdf.get("req_chin_pdf", ""),
        "req_math":            api.get("req_math") or pdf.get("req_math_pdf", ""),
        "req_csd":             api.get("req_csd") or pdf.get("req_csd_pdf", ""),
        "req_e1":              api.get("req_e1") or pdf.get("req_e1_pdf", ""),
        "req_e2":              api.get("req_e2") or pdf.get("req_e2_pdf", ""),
        "other_req":           api.get("other_req") or pdf.get("other_req_pdf", ""),

        # 2025 actual admission scores (PDF only)
        "data_year_scores":    "2025",
        "score_uq":            pdf.get("score_uq", ""),
        "score_median":        pdf.get("score_median", ""),
        "score_lq":            pdf.get("score_lq", ""),
    }
    results.append(rec)

print(f"Total merged: {len(results)} programmes")

# Codes in API but not PDF (new programmes)
api_only = sorted(set(api_data) - set(pdf_data))
if api_only:
    print(f"  API only (no PDF scores): {api_only}")

# Codes in PDF but not API (unlikely)
pdf_only = sorted(set(pdf_data) - set(api_data))
if pdf_only:
    print(f"  PDF only (not in API): {pdf_only}")

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

df = pd.DataFrame(results)
df.to_excel(OUTPUT_EXCEL, index=False)

print(f"Saved JSON:  {OUTPUT_JSON}")
print(f"Saved Excel: {OUTPUT_EXCEL}")

print("\nSample (first 5):")
for r in results[:5]:
    print(f"  {r['jupas_code']} {r['name'][:32]} | formula={r['formula_2026'][:30]} | UQ={r['score_uq']} M={r['score_median']} LQ={r['score_lq']}")
