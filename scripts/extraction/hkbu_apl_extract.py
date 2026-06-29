#!/usr/bin/env python
"""
hkbu_apl_extract.py
===================
Extract HKBU's per-programme Category B (Applied Learning / ApL) acceptance from
the official PDF:

    Reference(2026)/HKBU/2026-GER-PERs.pdf
    "General Entrance Requirements and Programme Entrance Requirements
     for JUPAS Admissions (2026 Entry)" (HKBU Admissions Office, Sep 2025)

CONTEXT
-------
HKBU accepts ApL only as the SECOND elective subject (the first elective must be
Category A). The per-programme requirement table (pages 2-5) has a "2nd Elective
Subject" group with two indicator columns: "Category B*" and "Category C*".

The Category B* cell is one of:
  * a Wingdings tick (U+F0FC)              -> ACCEPTS any Category B (ApL)  -> "any"
  * a Wingdings tick PLUS a parenthetical
    annotation, e.g. "(specified subjects)"
    or "(subjects related to Physical
    Education)"                            -> accepts only SPECIFIED ApL   -> [text]
  * a Wingdings2 cross (U+F04F)            -> does NOT accept Category B    -> "none"

Per the PDF legend (Remarks 1-4):
  * Remark 1: one elective must be Cat A (excl. M1/M2); the 2nd elective may be
    any Cat A (incl. M1/M2).
  * Remark 2: individual programmes may consider Category B (Applied Learning)
    with "Attained with Distinction (I)" or above for the 2nd elective; see the
    per-programme rows.
  * Remark 3: ApL Chinese is an alt. Chinese qualification, NOT a 2nd-elective
    fulfilment (so it is out of scope for this map).

GLYPH NOTES
-----------
  U+F0FC  Wingdings   = tick (accept)
  U+F04F  Wingdings2  = cross (reject)
  U+F072  Wingdings3  = small arrow/bullet used as a footnote pointer next to
                        free text (e.g. the "co-offered by" note). NOT a B/C
                        indicator; ignored (it never lands in the B/C x-band).

OUTPUT
------
  Reference(2026)/HKBU/hkbu_apl.json
    { "<JS code>": {"name": "...", "apl": "any" | "none" | ["...", ...]}, ... }

Re-runnable; idempotent. Prints a summary (counts of any / specified / none).
"""

import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "Reference(2026)" / "HKBU" / "2026-GER-PERs.pdf"
OUT_PATH = ROOT / "Reference(2026)" / "HKBU" / "hkbu_apl.json"
# Read-only reference for clean, authoritative programme names (the PDF title
# column overlaps the Admissions-Approach column, so PDF titles are messy).
NAMES_REF_PATH = ROOT / "Reference(2026)" / "HKBU" / "HKBU_2026_Data.json"

TICK = "\uf0fc"   # Wingdings  glyph U+F0FC -> accept
CROSS = "\uf04f"  # Wingdings2 glyph U+F04F -> reject
# Private-use-area glyphs (Wingdings tick/cross/arrow) to strip from text.
GLYPH_CODEPOINTS = {"\uf0fc", "\uf04f", "\uf072"}

CODE_RE = re.compile(r"^JS\d{4}")

# Half-width (pts) of a column for assigning a glyph/word by x-centre.
COL_TOL = 24.0
# Indicator zone: the M1/M2 + Category B* + Category C* glyph columns all sit at
# x > ~640. We cluster glyph x-centres in this zone into the three columns.
INDICATOR_X_MIN = 640.0


def is_wingding(ch):
    return "wingding" in (ch.get("fontname") or "").lower()


def find_section_headers(page):
    """Return the table-section header rows on the page as a sorted list of
    (top, b_centre, c_centre), one tuple per 'B*'/'C*' header pair.

    The header centres are only a rough guide; actual cell *content* is offset
    from them, so we use them just to know how many sections / their vertical
    order. Column content centres are derived from the glyphs (see
    section_columns)."""
    words = page.extract_words()
    b_hdrs = [(w["top"], (w["x0"] + w["x1"]) / 2.0) for w in words if w["text"] == "B*"]
    c_hdrs = [(w["top"], (w["x0"] + w["x1"]) / 2.0) for w in words if w["text"] == "C*"]
    sections = []
    for bt, bc in sorted(b_hdrs):
        # pair with the C* header on (about) the same row
        cc = None
        for ct, cv in c_hdrs:
            if abs(ct - bt) < 6.0:
                cc = cv
                break
        sections.append((bt, bc, cc))
    return sorted(sections)


def cluster_centres(xs, gap=18.0):
    """Cluster a list of x values into columns; return sorted cluster centres."""
    xs = sorted(xs)
    clusters = []
    cur = [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] <= gap:
            cur.append(x)
        else:
            clusters.append(sum(cur) / len(cur))
            cur = [x]
    clusters.append(sum(cur) / len(cur))
    return clusters


def section_columns(page, sections):
    """For each table section, derive the Category B and Category C content
    x-centres by clustering the actual indicator glyphs that fall within that
    section's vertical span.

    Returns list of dicts: {top, bottom, b_centre, c_centre}."""
    cols = []
    for i, (htop, bhdr, chdr) in enumerate(sections):
        sec_top = htop
        sec_bottom = sections[i + 1][0] if i + 1 < len(sections) else page.height
        xs = []
        for ch in page.chars:
            if not is_wingding(ch):
                continue
            cx = (ch["x0"] + ch["x1"]) / 2.0
            if cx < INDICATOR_X_MIN:
                continue          # footnote arrows live far left -> ignore
            if sec_top <= ch["top"] < sec_bottom:
                xs.append(cx)
        b_centre = c_centre = None
        if xs:
            centres = cluster_centres(xs)
            # Expect up to 3 columns: M1/M2, Category B, Category C (L->R).
            # Identify B and C by nearest-to-header where headers exist, else
            # fall back to positional (middle = B, right = C).
            if chdr is not None and len(centres) >= 1:
                c_centre = min(centres, key=lambda x: abs(x - chdr))
            if bhdr is not None and len(centres) >= 1:
                # B is the cluster nearest the B* header, but never the same as C.
                cand = [x for x in centres if x != c_centre] or centres
                b_centre = min(cand, key=lambda x: abs(x - bhdr))
            # Positional fallbacks
            if b_centre is None or c_centre is None:
                if len(centres) >= 3:
                    b_centre = centres[1]
                    c_centre = centres[2]
                elif len(centres) == 2:
                    b_centre, c_centre = centres[0], centres[1]
                elif len(centres) == 1:
                    b_centre = centres[0]
        cols.append({"top": sec_top, "bottom": sec_bottom,
                     "b_centre": b_centre, "c_centre": c_centre,
                     "b_header": bhdr, "c_header": chdr})
    return cols


def section_for_row(anchor_top, cols):
    """Pick the section-columns dict governing a row at anchor_top."""
    above = [c for c in cols if c["top"] <= anchor_top]
    if above:
        return max(above, key=lambda c: c["top"])
    return min(cols, key=lambda c: abs(c["top"] - anchor_top))


def horizontal_rules(page):
    """Return sorted 'top' positions of horizontal table rules on the page.
    Cells are top-aligned within a row, while the code is vertically centred,
    so a tick/annotation can sit well above the code baseline. The ruled row
    boundaries give us the true cell band per programme."""
    tops = set()
    for e in page.edges:
        if e["orientation"] == "h":
            tops.add(round(e["top"], 1))
    for ln in page.lines:
        if abs(ln["y0"] - ln["y1"]) < 0.5:   # horizontal line
            tops.add(round(ln["top"], 1))
    return sorted(tops)


def collect_rows(page):
    """Build per-programme row bands using the ruled row boundaries.

    Returns list of dicts: {code, top, bottom, anchor} where [top, bottom) is
    the cell band that contains this programme code."""
    words = page.extract_words()
    codes = []
    for w in words:
        m = CODE_RE.match(w["text"])
        if m:
            codes.append({"code": m.group(0), "top": w["top"]})
    codes.sort(key=lambda c: c["top"])

    rules = horizontal_rules(page)
    rows = []
    for c in codes:
        anchor = c["top"]
        # Band = the pair of consecutive rules straddling the code baseline.
        top = max([r for r in rules if r <= anchor + 2.0], default=anchor - 24.0)
        bottom = min([r for r in rules if r > anchor + 2.0], default=page.height)
        # Guard: if no rule sits above, fall back to a generous upward band so a
        # top-aligned tick isn't missed.
        if top > anchor:
            top = anchor - 24.0
        rows.append({"code": c["code"], "top": top, "bottom": bottom,
                     "anchor": anchor})
    return rows


# Admissions-Approach column vocabulary (a tiny closed set). Its words sit just
# right of the title column and sometimes overlap it horizontally, so we drop
# them by value rather than by a brittle x cutoff.
APPROACH_WORDS = {"Broad-based", "Programme-", "Programme-based", "based",
                  "Programme"}


def extract_title(page, row):
    """Join the 'Programme Full Title' column words for this row band.

    The title column sits between the code column (right edge ~x60) and the
    Admissions-Approach column. Their x-ranges overlap, so we exclude the
    approach column by its small fixed vocabulary instead of a hard x cutoff."""
    parts = []
    for w in page.extract_words():
        if not (row["top"] <= w["top"] < row["bottom"]):
            continue
        if w["x0"] < 58 or w["x0"] > 305:
            continue
        txt = CODE_RE.sub("", w["text"])  # strip a glued leading JS#### prefix
        if not txt or txt in APPROACH_WORDS:
            continue
        parts.append((round(w["top"], 1), w["x0"], txt))
    parts.sort(key=lambda p: (p[0], p[1]))
    text = " ".join(p[2] for p in parts).strip()
    return re.sub(r"\s+", " ", text)


def load_reference_names():
    """Load clean, authoritative programme names from the per-school data file
    (read-only). Returns {code: name}; empty dict if unavailable."""
    if not NAMES_REF_PATH.exists():
        return {}
    try:
        data = json.loads(NAMES_REF_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    progs = data
    if isinstance(progs, dict):
        progs = progs.get("programmes", list(progs.values()))
    names = {}
    for p in progs:
        if not isinstance(p, dict):
            continue
        code = p.get("code") or p.get("jupas_code")
        name = p.get("name") or p.get("programme") or p.get("programme_en")
        if code and name:
            names[code] = re.sub(r"\s+", " ", str(name)).strip()
    return names


def _strip_glyphs(text):
    """Remove Wingdings private-use glyph characters from a word string."""
    return "".join(c for c in text if c not in GLYPH_CODEPOINTS).strip()


def extract_b_cell(page, row, sec):
    """Return (glyph, annotation_text) for the Category B column of this row.

    glyph: TICK / CROSS / None
    annotation_text: parenthetical specified-subject text, or '' """
    b_centre = sec["b_centre"]
    c_centre = sec["c_centre"]
    if b_centre is None:
        return None, ""
    # Right boundary of the B column = midpoint between B and C content centres
    # (so we never read the Category C tick/cross into the B cell).
    if c_centre is not None:
        b_right = (b_centre + c_centre) / 2.0
    else:
        b_right = b_centre + COL_TOL
    b_left = b_centre - COL_TOL

    glyph = None
    for ch in page.chars:
        if not is_wingding(ch):
            continue
        cx = (ch["x0"] + ch["x1"]) / 2.0
        if not (b_left <= cx < b_right):
            continue
        if not (row["top"] <= ch["top"] < row["bottom"]):
            continue
        t = ch["text"]
        if t == TICK:
            glyph = TICK
        elif t == CROSS:
            glyph = CROSS

    # Collect any B-column annotation words (e.g. "(specified subjects)" /
    # "(subjects related to Physical Education)"). Annotation text is left-
    # aligned in the cell and may wrap several lines; keep words whose centre
    # falls left of the B/C boundary and within the B cell.
    ann_words = []
    for w in page.extract_words():
        cx = (w["x0"] + w["x1"]) / 2.0
        if not (b_left - 6.0 <= cx < b_right):
            continue
        if not (row["top"] <= w["top"] < row["bottom"]):
            continue
        txt = _strip_glyphs(w["text"])
        if not txt:
            continue
        ann_words.append((round(w["top"], 1), w["x0"], txt))
    ann_words.sort(key=lambda p: (p[0], p[1]))
    annotation = re.sub(r"\s+", " ", " ".join(p[2] for p in ann_words)).strip()
    return glyph, annotation


def classify(glyph, annotation):
    """Map (glyph, annotation) -> apl value and a confidence flag.

    Returns (apl_value, low_confidence_reason_or_None)."""
    has_paren = bool(annotation) and ("(" in annotation)
    if glyph == CROSS:
        # A cross can co-exist with nothing -> reject.
        if has_paren:
            return "none", f"cross + annotation text {annotation!r}"
        return "none", None
    if glyph == TICK:
        if has_paren:
            # Specified-subjects case: keep the parenthetical text verbatim
            # (strip the outer parentheses).
            inner = annotation.strip()
            inner = re.sub(r"^\((.*)\)$", r"\1", inner).strip()
            return [inner], None
        if annotation:
            # Tick but stray non-paren text fell into the band -> flag it.
            return "any", f"tick + unexpected text {annotation!r}"
        return "any", None
    # No glyph detected
    if has_paren:
        # Specified text but no tick captured -> still specified, flag low conf.
        inner = re.sub(r"^\((.*)\)$", r"\1", annotation.strip()).strip()
        return [inner], "specified text but no tick glyph captured"
    return None, "no glyph and no annotation in Category B cell"


def main():
    if not PDF_PATH.exists():
        raise SystemExit(f"PDF not found: {PDF_PATH}")

    result = {}
    low_conf = []   # (code, reason)
    ref_names = load_reference_names()

    with pdfplumber.open(str(PDF_PATH)) as pdf:
        # Programme tables live on pages 2..end (page 1 is the GER/legend).
        for pidx in range(1, len(pdf.pages)):
            page = pdf.pages[pidx]
            sections = find_section_headers(page)
            if not sections:
                continue
            cols = section_columns(page, sections)
            rows = collect_rows(page)
            for row in rows:
                code = row["code"]
                sec = section_for_row(row["anchor"], cols)
                glyph, annotation = extract_b_cell(page, row, sec)
                apl, reason = classify(glyph, annotation)
                # Prefer the clean authoritative name; fall back to PDF title.
                title = ref_names.get(code) or extract_title(page, row)

                rec = {"name": title, "apl": apl}
                if code in result:
                    # Duplicate (a programme listed under two faculties /
                    # Transdisciplinary). Keep the richer name; verify apl agrees.
                    prev = result[code]
                    if prev["apl"] != apl and apl is not None:
                        # disagreement -> flag, prefer a non-None / specified value
                        low_conf.append((code,
                            f"duplicate rows disagree: {prev['apl']!r} vs {apl!r}"))
                        if prev["apl"] is None:
                            prev["apl"] = apl
                    if len(title) > len(prev.get("name", "")):
                        prev["name"] = title
                else:
                    result[code] = rec

                if reason and not any(c == code for c, _ in low_conf):
                    low_conf.append((code, reason))

    # Stable ordering by JS code
    ordered = {k: result[k] for k in sorted(result)}
    OUT_PATH.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")

    # Summary
    n_any = sum(1 for v in ordered.values() if v["apl"] == "any")
    n_none = sum(1 for v in ordered.values() if v["apl"] == "none")
    n_spec = sum(1 for v in ordered.values() if isinstance(v["apl"], list))
    n_unk = sum(1 for v in ordered.values() if v["apl"] is None)

    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")
    print(f"Total programmes : {len(ordered)}")
    print(f"  any (accepts all Cat B) : {n_any}")
    print(f"  specified subset        : {n_spec}")
    print(f"  none (no Cat B)         : {n_none}")
    if n_unk:
        print(f"  UNCLASSIFIED            : {n_unk}")
    print()
    print("none (JS codes): " +
          ", ".join(k for k, v in ordered.items() if v["apl"] == "none"))
    print()
    print("specified (JS code -> subjects):")
    for k, v in ordered.items():
        if isinstance(v["apl"], list):
            print(f"  {k}: {v['apl']}")
    if low_conf:
        print()
        print("LOW-CONFIDENCE / FLAGGED rows:")
        for code, reason in low_conf:
            print(f"  {code}: {reason}")
    else:
        print()
        print("No low-confidence rows: every Category B cell classified cleanly.")


if __name__ == "__main__":
    main()
