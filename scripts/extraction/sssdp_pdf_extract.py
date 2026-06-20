"""
SSSDP PDF Extractor — af_2025_SSSDP.pdf
Extracts 2025 admission scores for all SSSDP institutions.

Institutions and JUPAS code prefixes:
  Pages 4-5:  HKMU (SSSDP)   JSSU  — Median + LQ, subject weights
  Page 6:     Shue Yan        JSSY  — Average score
  Pages 7-8:  Saint Francis   JSSA  — Mean score (Best 5)
  Pages 9-10: THEi            JSSV  — Average score (Best 5*)
  Page 11:    Hang Seng Univ  JSSH  — Average admission score
  Page 12:    Tung Wah        JSST  — Mean score
  Page 13:    UOW College HK  JSSW  — Admission score

*THEi formula: Best 5 = Eng + Chin + Math + CSD (Attained=Level 2) + best elective
 THEi Cat C scoring: A=3, B=3, C=3, D=2, E=2 (different from other schools)

Grade conversion (Cat A, all institutions): 5**=7, 5*=6, 5=5, 4=4, 3=3, 2=2, 1=1
Note: Shue Yan counts Level 1=1; others may not list Level 1 (treat as 0 or 1).

All HKMU SSSDP (JSSU) programmes already have JS9xxx equivalents in the main JUPAS
combined PDF. JSSU codes represent SSSDP-subsidised places at HKMU, distinct from
JS9xxx self-financed places.

Usage:
    ~/miniconda3/envs/jupascal/bin/python sssdp_pdf_extract.py
"""

import re
import json
import pdfplumber
import pandas as pd

PDF_PATH = "Reference(2026)/SSSDP/af_2025_SSSDP.pdf"
OUT_JSON = "Reference(2026)/SSSDP/SSSDP_2026_Data.json"
OUT_XLSX = "Reference(2026)/SSSDP/SSSDP_2026_Data.xlsx"

SOURCE = "af_2025_SSSDP.pdf (JUPAS SSSDP scores, 2025)"
CODE_RE   = re.compile(r"^JSS[A-Z]\d+")
NUM_RE    = re.compile(r"^\d+(\.\d+)?$")
ENDS_WGT  = re.compile(r'\(x\s*[\d.]+\)\*?$')


def parse_score(val):
    if not val:
        return None
    v = str(val).strip().rstrip("*")
    return float(v) if NUM_RE.match(v) else None


def parse_weights(raw):
    if not raw or raw.strip() in ("-", ""):
        return {}, ""
    raw = raw.strip()
    lines = [l.strip() for l in raw.split("\n") if l.strip()]
    entries, current = [], []
    for line in lines:
        current.append(line)
        if ENDS_WGT.search(line):
            entries.append(" ".join(current))
            current = []
    if current:
        entries.append(" ".join(current))
    weights = {}
    for entry in entries:
        for subj_raw, wgt in re.findall(r'(.+?)\s*\(x\s*([\d.]+)\)\*?', entry):
            for subj in subj_raw.split(","):
                subj = subj.strip()
                if subj:
                    weights[subj] = float(wgt)
    return weights, raw


def make_prog(code, name, institution, score_type, score_median=None, score_lq=None,
              score_mean=None, subject_weights=None, subject_weights_raw=""):
    return {
        "code":        code.rstrip("^").strip(),
        "name":        name.replace("\n", " ").strip(),
        "institution": institution,
        "formula":     "Best 5",
        "score_type":  score_type,   # "median+lq" | "mean"
        "score_median": score_median,
        "score_lq":     score_lq,
        "score_mean":   score_mean,
        "subject_weights":     subject_weights or {},
        "subject_weights_raw": subject_weights_raw,
        "data_year_scores":      2025,
        "data_year_weightings":  2025,
        "scores_source":    SOURCE,
        "weightings_source": SOURCE,
    }


# ---------------------------------------------------------------------------
# HKMU SSSDP — pages 4-5 (JSSU codes; two different table widths)
# ---------------------------------------------------------------------------

def parse_hkmu_sssdp(pdf):
    """Pages 4-5 (0-indexed 3-4). 15-col on p4, 9-col on p5."""
    institution = "Hong Kong Metropolitan University (SSSDP)"
    programmes = []
    current_school = ""
    current = None

    def finalize(p):
        name = " ".join(p.pop("name_parts")).strip()
        wgt_raw = "\n".join(filter(None, p.pop("weight_parts")))
        w, raw = parse_weights(wgt_raw)
        programmes.append(make_prog(
            p["code"], name, institution, "median+lq",
            score_median=p["median"], score_lq=p["lq"],
            subject_weights=w, subject_weights_raw=raw,
        ))

    for page_idx, col_layout in [(3, 15), (4, 9)]:
        page = pdf.pages[page_idx]
        main_table = next(
            (t for t in page.extract_tables() if t and len(t[0]) == col_layout), None
        )
        if not main_table:
            continue

        skip_rows = 4  # 4 header rows

        if col_layout == 15:
            # col0=code, col3-5=name, col6=median, col9=lq, col12-14=weights
            def get_code(r): return str(r[0] or "").strip()
            def get_name(r): return " ".join(str(r[i] or "").replace("\n"," ").strip() for i in [3,4,5] if r[i] and str(r[i]).strip())
            def get_med(r): return parse_score(r[6])
            def get_lq(r): return parse_score(r[9])
            def get_wgt(r): return "\n".join(str(r[i] or "").strip() for i in [12,13,14] if str(r[i] or "").strip() and str(r[i] or "").strip() != "-")
            is_school_hdr = lambda r: (str(r[0] or "").strip() and not CODE_RE.match(str(r[0] or "").strip())
                                       and all(str(r[i] or "").strip() == "" for i in [6, 9]))
        else:
            # 9-col: col0=code, col1-3=name, col4=median, col5=lq, col6-8=weights
            def get_code(r): return str(r[0] or "").strip()
            def get_name(r): return " ".join(str(r[i] or "").replace("\n"," ").strip() for i in [1,2,3] if r[i] and str(r[i]).strip())
            def get_med(r): return parse_score(r[4])
            def get_lq(r): return parse_score(r[5])
            def get_wgt(r): return "\n".join(str(r[i] or "").strip() for i in [6,7,8] if str(r[i] or "").strip() and str(r[i] or "").strip() != "-")
            is_school_hdr = lambda r: (str(r[0] or "").strip() and not CODE_RE.match(str(r[0] or "").strip())
                                       and all(str(r[i] or "").strip() == "" for i in [4, 5]))

        for row in main_table[skip_rows:]:
            c0 = get_code(row)
            wgt_row = get_wgt(row)
            name_row = get_name(row)

            if CODE_RE.match(c0):
                if current:
                    finalize(current)
                current = {
                    "code":        c0,
                    "school":      current_school,
                    "median":      get_med(row),
                    "lq":          get_lq(row),
                    "name_parts":  [name_row] if name_row else [],
                    "weight_parts": [wgt_row] if wgt_row else [],
                }
            elif is_school_hdr(row):
                if current:
                    finalize(current)
                    current = None
                current_school = c0
            else:
                if current is None:
                    continue
                if name_row:
                    current["name_parts"].append(name_row)
                if wgt_row:
                    current["weight_parts"].append(wgt_row)

    if current:
        finalize(current)
    return programmes


# ---------------------------------------------------------------------------
# Shue Yan University — page 6 (JSSY codes, code embedded in text)
# ---------------------------------------------------------------------------

def parse_shue_yan(pdf):
    institution = "Hong Kong Shue Yan University"
    programmes = []
    page = pdf.pages[5]
    for table in page.extract_tables():
        if len(table) < 2 or len(table[0]) < 2:
            continue
        for row in table[1:]:
            text = str(row[0] or "").strip()
            m = re.match(r"(JSS[A-Z]\d+)\s+(.+)", text)
            if not m:
                continue
            code = m.group(1)
            name = m.group(2).strip()
            score = parse_score(row[1] if len(row) > 1 else None)
            programmes.append(make_prog(code, name, institution, "mean", score_mean=score))
    return programmes


# ---------------------------------------------------------------------------
# Saint Francis University — page 7 (JSSA codes, clean 3-col table)
# ---------------------------------------------------------------------------

def parse_saint_francis(pdf):
    institution = "Saint Francis University"
    programmes = []
    page = pdf.pages[6]
    for table in page.extract_tables():
        if not table or len(table[0]) != 3:
            continue
        for row in table[1:]:  # skip header
            code = str(row[0] or "").strip()
            if not CODE_RE.match(code):
                continue
            name = str(row[1] or "").replace("\n", " ").strip()
            score = parse_score(row[2])
            programmes.append(make_prog(code, name, institution, "mean", score_mean=score))
    return programmes


# ---------------------------------------------------------------------------
# THEi — pages 9-10 (JSSV codes; code in col 7 on p9, col 2 on p10)
# ---------------------------------------------------------------------------

def parse_thei(pdf):
    institution = "Technological and Higher Education Institute of Hong Kong (THEi)"
    programmes = []

    # Page 9: programme in col0, code in col7, score in col10
    page9 = pdf.pages[8]
    for table in page9.extract_tables():
        for row in table:
            code = str(row[7] or "").strip() if len(row) > 7 else ""
            if not CODE_RE.match(code):
                continue
            name = str(row[0] or "").replace("\n", " ").strip()
            score = parse_score(row[10] if len(row) > 10 else None)
            if name and score is not None:
                programmes.append(make_prog(code, name, institution, "mean", score_mean=score))

    # Page 10: col1=programme, col2=code, col3=score
    page10 = pdf.pages[9]
    for table in page10.extract_tables():
        for row in table:
            code = str(row[2] or "").strip() if len(row) > 2 else ""
            if not CODE_RE.match(code):
                continue
            # name may span two cells due to row continuation
            name = str(row[1] or "").replace("\n", " ").strip()
            score_raw = str(row[3] or "").strip() if len(row) > 3 else ""
            score = parse_score(score_raw) if score_raw.lower() != "not applicable" else None
            programmes.append(make_prog(code, name, institution, "mean", score_mean=score))

    return programmes


# ---------------------------------------------------------------------------
# Hang Seng University — page 11 (JSSH codes embedded in programme text)
# ---------------------------------------------------------------------------

def parse_hang_seng(pdf):
    institution = "The Hang Seng University of Hong Kong"
    programmes = []
    page = pdf.pages[10]
    for table in page.extract_tables():
        if len(table) < 2:
            continue
        for row in table[1:]:
            # Code may be in col0 or embedded within col1 text
            text = " ".join(str(c or "") for c in row[:3])
            m = re.search(r"(JSS[A-Z]\d+)", text)
            if not m:
                continue
            code = m.group(1)
            # Clean name: remove the code from text
            name = re.sub(r"JSS[A-Z]\d+", "", text).strip()
            # Score: find first numeric-looking value in cols 3-5
            score = None
            for i in range(3, len(row)):
                v = parse_score(row[i])
                if v is not None:
                    score = v
                    break
            programmes.append(make_prog(code, name, institution, "mean", score_mean=score))
    return programmes


# ---------------------------------------------------------------------------
# Tung Wah College — page 12 (JSST codes, 5-col table)
# ---------------------------------------------------------------------------

def parse_tung_wah(pdf):
    institution = "Tung Wah College"
    programmes = []
    page = pdf.pages[11]
    for table in page.extract_tables():
        if not table or len(table[0]) != 5:
            continue
        for row in table[2:]:  # skip 2 header rows
            code = str(row[0] or "").strip()
            if not CODE_RE.match(code):
                continue
            name = str(row[3] or "").replace("\n", " ").strip()
            score = parse_score(row[4])
            programmes.append(make_prog(code, name, institution, "mean", score_mean=score))
    return programmes


# ---------------------------------------------------------------------------
# UOW College Hong Kong — page 13 (JSSW codes, 5-col table)
# ---------------------------------------------------------------------------

def parse_uow(pdf):
    institution = "UOW College Hong Kong"
    programmes = []
    page = pdf.pages[12]
    for table in page.extract_tables():
        if not table or len(table[0]) != 5:
            continue
        for row in table[1:]:  # skip header
            code = str(row[0] or "").strip()
            if not CODE_RE.match(code):
                continue
            name = str(row[1] or "").replace("\n", " ").strip()
            # Score appears in col2 (not col3 which is None)
            score = parse_score(row[2])
            programmes.append(make_prog(code, name, institution, "mean", score_mean=score))
    return programmes


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    all_programmes = []

    with pdfplumber.open(PDF_PATH) as pdf:
        parsers = [
            ("HKMU SSSDP",   parse_hkmu_sssdp(pdf)),
            ("Shue Yan",     parse_shue_yan(pdf)),
            ("Saint Francis",parse_saint_francis(pdf)),
            ("THEi",         parse_thei(pdf)),
            ("Hang Seng",    parse_hang_seng(pdf)),
            ("Tung Wah",     parse_tung_wah(pdf)),
            ("UOW",          parse_uow(pdf)),
        ]

    for inst, progs in parsers:
        print(f"\n{inst}: {len(progs)} programmes")
        for p in progs:
            w_str = ", ".join(f"{k} x{v}" for k, v in p["subject_weights"].items()) or "(none)"
            score_str = (f"med={p['score_median']} lq={p['score_lq']}"
                         if p["score_type"] == "median+lq"
                         else f"mean={p['score_mean']}")
            print(f"  {p['code']}  {score_str}  weights: {w_str}")
        all_programmes.extend(progs)

    print(f"\nTotal: {len(all_programmes)} programmes")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(all_programmes, f, ensure_ascii=False, indent=2)
    print(f"Saved {OUT_JSON}")

    df = pd.DataFrame(all_programmes)
    df["subject_weights"] = df["subject_weights"].apply(
        lambda d: ", ".join(f"{k} x{v}" for k, v in d.items()) if isinstance(d, dict) else ""
    )
    df.to_excel(OUT_XLSX, index=False)
    print(f"Saved {OUT_XLSX}")


if __name__ == "__main__":
    main()
