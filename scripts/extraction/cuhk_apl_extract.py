"""
CUHK Applied Learning (ApL) Recognition Extractor — ApL{YEAR}.pdf

Source: "Programmes which Recognise Applied Learning Courses (2026 Entry)"
  Landing page (JS-redirect): https://www.cuhk.edu.hk/adm/jupas/ApL2026
  Actual PDF:                 https://admission.cuhk.edu.hk/wp-content/uploads/2025/09/ApL2026.pdf

The PDF maps each CUHK JUPAS programme -> the specific ApL (Applied Learning)
courses it recognises as an EXTRA elective subject. Three programmes accept ALL
ApL courses (rendered as the literal text "All ApL Courses" with no course list):
  JS4111 Theology, JS4874 Social Work, JS4886 Sociology.

Output artifact (verbatim — NOT canonicalised; the main unify pipeline canonicalises):
  Reference(2026)/CUHK/cuhk_apl.json
    { "JS####": {"name": "<programme>", "apl": ["<exact course name>", ...]},
      "JS4111": {"name": "Theology", "apl": "ALL"}, ... }

------------------------------------------------------------------------------
PARSING NOTES (why this is column/geometry aware, not a naive line parse)
------------------------------------------------------------------------------
The PDF is a 4-column bordered table. Column x-boundaries (from the table's own
vertical edges) are approximately:
    x 40..110   col A : JUPAS Catalogue No.  (e.g. "JS4006")
    x 110..270  col B : Programme name       (e.g. "Anthropology")
    x 270..336  col C : ApL Course Code       (3-digit catalogue no., e.g. "609")
    x 336..531  col D : ApL Course Name        (e.g. "Film and Video")

Pitfalls that a naive parse hits (and how we avoid them):
  1. The (code, name) cell in cols A/B is VERTICALLY CENTERED within its block of
     course rows — it does NOT sit at the top of the block. So you cannot anchor a
     programme by "the row where its code appears".
  2. There are NO per-programme horizontal borders, and row gaps are uniform (~12px)
     even across a programme boundary on most pages. The only full-width rules are
     the zebra-shading bands, which sometimes group TWO programmes — useless as 1:1
     boundaries.
  3. A programme's course list can spill across a PAGE BREAK (the same JUPAS code is
     repeated as the block header on the next page).

ROBUST ALGORITHM actually used (two complementary boundary signals):
  * PRIMARY signal — ascending reset: within a single programme the ApL course
    *codes* (col C) are always listed in ASCENDING numeric order. A drop (next code <
    previous) marks a new programme block. This is reliable and page-break safe.
  * SECONDARY signal — code position: occasionally two adjacent programmes have
    ascending ranges (no drop between them, e.g. JS4006 ...719 -> JS4018 726), so a
    single ascending segment can still contain >1 col-A code. We then sub-split that
    segment at each contained code's vertical anchor (a row joins the last col-A code
    whose top <= row center).
  * GROUND TRUTH for count & order = the col-A JUPAS codes themselves. Codes that end
    up with no numeric rows but a "All ApL Courses" col-D line -> emitted as "ALL".
  * Continuation pages (code repeated as the next page's header) are merged by code.
  * The footer page-number ("n / 12") sits BELOW the table bottom border; we drop any
    row whose center is at/under that border.

Re-runnable: downloads the PDF fresh with `curl -k` (the admission.cuhk.edu.hk host
has a broken TLS chain) to a temp path, then parses. Falls back to the committed
Reference(2026)/CUHK/ApL-2026.pdf if the download fails (offline re-runs).
"""

import json
import os
import re
import subprocess
import sys
import tempfile

import pdfplumber

PDF_URL = "https://admission.cuhk.edu.hk/wp-content/uploads/2025/09/ApL2026.pdf"
FALLBACK_PDF = "Reference(2026)/CUHK/ApL-2026.pdf"
OUTPUT_JSON = "Reference(2026)/CUHK/cuhk_apl.json"

# Fallback column x-boundaries (midpoints between the table's 5 vertical edges).
# These are auto-detected per-PDF from the actual vertical edges at runtime; the
# constants are only used if edge detection fails. NOTE: CUHK has re-saved this PDF
# with a ~11px-shifted column layout before (committed copy uses edges at
# 40/110/270/336/531; the live copy uses 52/122/282/348/544), so we never rely on
# fixed thresholds — see detect_columns().
DEFAULT_COL_BOUNDS = (110.0, 270.0, 336.0)  # A|B , B|C , C|D thresholds

ROW_MATCH_TOL = 5.0        # y tolerance pairing col-C code with its col-D name
CODE_ANCHOR_TOL = 8.5      # row joins a code if code.top <= row.center + this

JS_RE = re.compile(r"^JS\w+$")
ALL_RE = re.compile(r"all\s+ap\s*l\s+courses", re.IGNORECASE)


APL_CODE_MIN = 580   # observed real ApL catalogue range is ~590..735
APL_CODE_MAX = 760


def detect_columns(pdf):
    """Return (ab, bc, cd) x-thresholds from the table's 5 vertical edges.

    The ApL table is a 4-column bordered grid -> 5 vertical rules. We cluster the
    vertical edges across all pages and put each threshold at the midpoint between
    consecutive rules. Falls back to DEFAULT_COL_BOUNDS if we don't find 5 rules.
    """
    xs = []
    for page in pdf.pages:
        xs += [e["x0"] for e in page.edges if e["orientation"] == "v"]
    xs.sort()
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= 3:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    rules = sorted(sum(g) / len(g) for g in clusters if len(g) >= 2)
    if len(rules) >= 5:
        # 5 vertical rules bound 4 columns: [A-left, A|B, B|C, C|D, D-right].
        # The inner rules ARE the column thresholds. Nudge +1px so a word sitting
        # exactly on the left border of a cell classifies into that cell.
        return (rules[1] + 1.0, rules[2] + 1.0, rules[3] + 1.0)
    return DEFAULT_COL_BOUNDS


def make_column(bounds):
    ab, bc, cd = bounds

    def column(x0):
        if x0 < ab:
            return "A"
        if x0 < bc:
            return "B"
        if x0 < cd:
            return "C"
        return "D"

    return column


def valid_course_code(text):
    """Return the real 3-digit ApL code from a col-C token, else None.

    Plain 3-digit codes in range pass through. A footer-fused token like "12726"
    (page-number "12" + course "726") is salvaged by taking its trailing 3 digits.
    Page numbers ("1".."12") and stray small ints fall outside the range -> None.
    """
    if not text.isdigit():
        return None
    n = int(text)
    if APL_CODE_MIN <= n <= APL_CODE_MAX and len(text) == 3:
        return n
    if len(text) > 3:                      # footer-fused, e.g. "12726"
        tail = int(text[-3:])
        if APL_CODE_MIN <= tail <= APL_CODE_MAX:
            return tail
    return None


def download_pdf(dest):
    """Download the ApL PDF with `curl -k` (broken TLS chain on the host)."""
    print(f"Downloading {PDF_URL} -> {dest}")
    try:
        subprocess.run(
            ["curl", "-k", "-sSL", "--fail", "-o", dest, PDF_URL],
            check=True,
            timeout=120,
        )
        if os.path.getsize(dest) > 1000:
            return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        print(f"  download failed: {e}")
    return False


def parse_page(page, column, bc_threshold):
    """
    Extract this page's structure.

    `column`       : x0 -> "A"/"B"/"C"/"D" classifier (built from detected edges).
    `bc_threshold` : the B|C x-boundary (used to locate the footer "/" token).

    Returns:
      codes      : [(top, "JS####"), ...]            col-A codes, reading order
      name_words : [(top, x0, text), ...]            col-B name fragments
      rows       : [(cy, course_int, course_name), ...] numeric ApL course rows
      all_rows   : [(cy, text), ...]                 "All ApL Courses" lines
    """
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)

    # Identify the footer page-number row ("n / 12"): the row carrying a "/" token in
    # the col-C/D x-range near the page bottom. We drop tokens on that exact row, but
    # NOT the whole bottom area — a real course row can render alongside the footer
    # (its 3-digit code can even visually fuse with the "12", e.g. "12726").
    footer_cys = []
    for w in words:
        if w["text"] == "/" and w["x0"] >= bc_threshold - 10 and w["top"] > page.height * 0.85:
            footer_cys.append((w["top"] + w["bottom"]) / 2.0)

    def on_footer(cy):
        return any(abs(cy - fy) <= ROW_MATCH_TOL for fy in footer_cys)

    codes = []
    name_words = []
    course_codes = []   # (cy, course_int)  col C
    col_d = []          # (cy, x0, text)     col D

    for w in words:
        cy = (w["top"] + w["bottom"]) / 2.0
        c = column(w["x0"])
        if c == "A" and JS_RE.match(w["text"]):
            codes.append((w["top"], w["text"]))
        elif c == "B":
            name_words.append((w["top"], w["x0"], w["text"]))
        elif c == "C" and w["text"].isdigit():
            cc = valid_course_code(w["text"])
            # The page number ("1".."12") and the lone "12" never pass the range
            # filter. A footer-fused token like "12726" -> recover trailing "726".
            if cc is not None and not (on_footer(cy) and len(w["text"]) <= 2):
                course_codes.append((cy, cc))
        elif c == "D":
            # On the footer row, keep only the course-name portion (drop the "n / 12").
            if not (on_footer(cy) and w["text"] in ("/",) ):
                col_d.append((cy, w["x0"], w["text"]))

    codes.sort()

    # Pair each numeric col-C code with the col-D words on its row.
    rows = []
    used_d = set()
    for cy, cc in sorted(course_codes):
        parts = []
        for j, (dy, dx, dt) in enumerate(col_d):
            if abs(dy - cy) <= ROW_MATCH_TOL:
                parts.append((dx, dt, j))
        parts.sort()
        for _, _, j in parts:
            used_d.add(j)
        rows.append((cy, int(cc), " ".join(t for _, t, _ in parts)))
    rows.sort()

    # "All ApL Courses" lines: col-D text on a row with no numeric col-C code.
    all_rows = []
    leftover = {}
    for j, (dy, dx, dt) in enumerate(col_d):
        if j in used_d:
            continue
        leftover.setdefault(round(dy, 1), []).append((dx, dt))
    for ky, parts in leftover.items():
        parts.sort()
        txt = " ".join(t for _, t in parts)
        if ALL_RE.search(txt):
            all_rows.append((ky, txt))

    return codes, name_words, rows, all_rows


def name_for_code(code_top, name_words):
    """Programme name = col-B words sharing the code's vertical band (+/- 8px)."""
    frags = [(t, x, txt) for (t, x, txt) in name_words if abs(t - code_top) <= 8]
    frags.sort(key=lambda f: (round(f[0]), f[1]))
    return " ".join(txt for _, _, txt in frags).strip()


def assign_rows_to_codes(codes, rows):
    """Partition numeric course `rows` among the page's `codes`.

    Returns {code: [(course_int, course_name), ...]} for every code on the page
    (codes with no numeric rows -> empty list, e.g. an "ALL" programme).

    Boundary logic:
      1. Split rows into ASCENDING segments (a numeric drop starts a new segment).
      2. For each segment, find col-A codes whose `top` falls within the segment's
         vertical span. One code -> whole segment is that code's. Multiple codes ->
         sub-split: each row joins the LAST code whose top <= row.center + tol.
      3. A code that no segment claims (no rows under it) stays empty.
    """
    out = {c: [] for _, c in codes}
    if not rows:
        return out

    # 1. Ascending segments.
    segments = []
    cur = [rows[0]]
    for r in rows[1:]:
        if r[1] < cur[-1][1]:
            segments.append(cur)
            cur = []
        cur.append(r)
    segments.append(cur)

    code_tops = [t for t, _ in codes]
    code_names = [c for _, c in codes]

    for seg in segments:
        seg_lo = seg[0][0]
        seg_hi = seg[-1][0]
        # Codes anchored inside this segment's vertical span (inclusive-ish).
        contained = [i for i, t in enumerate(code_tops)
                     if seg_lo - CODE_ANCHOR_TOL <= t <= seg_hi + CODE_ANCHOR_TOL]
        if len(contained) <= 1:
            # Whole segment -> the single contained code, else nearest code above.
            if contained:
                tgt = code_names[contained[0]]
            else:
                # No code anchored here (rare): attach to last code starting at/above.
                cand = [i for i, t in enumerate(code_tops) if t <= seg_lo + CODE_ANCHOR_TOL]
                tgt = code_names[cand[-1]] if cand else code_names[0]
            for _, cc, nm in seg:
                out[tgt].append((cc, nm))
        else:
            # Multiple codes share this ascending segment -> sub-split by code anchor.
            for cy, cc, nm in seg:
                chosen = contained[0]
                for i in contained:
                    if code_tops[i] <= cy + CODE_ANCHOR_TOL:
                        chosen = i
                    else:
                        break
                out[code_names[chosen]].append((cc, nm))
    return out


def extract(pdf_path):
    """Return ordered dict: code -> {'name':..., 'apl': [...] | 'ALL'}."""
    result = {}            # code -> {'name', 'apl_list', 'all', 'order'}
    order_counter = [0]
    ambiguous = []

    with pdfplumber.open(pdf_path) as pdf:
        npages = len(pdf.pages)
        bounds = detect_columns(pdf)
        column = make_column(bounds)
        print(f"  detected column thresholds (A|B, B|C, C|D): "
              f"{tuple(round(b, 1) for b in bounds)}")
        for pi, page in enumerate(pdf.pages):
            codes, name_words, rows, all_rows = parse_page(page, column, bounds[1])
            if not codes:
                continue

            assigned = assign_rows_to_codes(codes, rows)

            for code_top, code in codes:
                name = name_for_code(code_top, name_words)
                courses = assigned.get(code, [])
                # "ALL": an All-ApL line anchored at this code AND no numeric rows.
                near_all = any(abs(ay - code_top) <= 20 for ay, _ in all_rows)
                is_all = near_all and not courses

                # Sanity: courses within a programme must stay ascending.
                seq = [cc for cc, _ in courses]
                if seq != sorted(seq):
                    ambiguous.append(
                        f"page {pi + 1} {code}: non-ascending course codes {seq}"
                    )

                entry = result.get(code)
                if entry is None:
                    entry = {"name": name, "apl_list": [], "all": False,
                             "order": order_counter[0]}
                    order_counter[0] += 1
                    result[code] = entry
                if name and not entry["name"]:
                    entry["name"] = name
                if is_all:
                    entry["all"] = True
                entry["apl_list"].extend(nm for _cc, nm in courses if nm.strip())

    # Build final mapping in first-seen order.
    ordered = sorted(result.items(), key=lambda kv: kv[1]["order"])
    out = {}
    for code, e in ordered:
        if e["all"]:
            out[code] = {"name": e["name"], "apl": "ALL"}
        else:
            # de-dup while preserving order (a course can legitimately repeat across
            # a page break only if the run merge double-counted — guard against it)
            seen = set()
            uniq = []
            for c in e["apl_list"]:
                if c not in seen:
                    seen.add(c)
                    uniq.append(c)
            out[code] = {"name": e["name"], "apl": uniq}

    return out, ambiguous, npages


def main():
    # Resolve to repo root regardless of cwd.
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    os.chdir(root)

    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    pdf_path = tmp.name
    if not download_pdf(pdf_path):
        os.unlink(pdf_path)
        pdf_path = FALLBACK_PDF
        print(f"  using committed fallback PDF: {pdf_path}")

    out, ambiguous, npages = extract(pdf_path)

    # Clean up temp download.
    if pdf_path != FALLBACK_PDF and os.path.exists(pdf_path):
        os.unlink(pdf_path)

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # ---- Summary ----
    all_codes = [c for c, v in out.items() if v["apl"] == "ALL"]
    distinct_courses = set()
    for v in out.values():
        if isinstance(v["apl"], list):
            distinct_courses.update(v["apl"])

    print(f"\nParsed {npages} pages -> {OUTPUT_JSON}")
    print(f"Programmes recognising ApL : {len(out)}")
    print(f"'ALL' programmes ({len(all_codes)}): {sorted(all_codes)}")
    print(f"Distinct ApL course names  : {len(distinct_courses)}")
    if ambiguous:
        print("\nAMBIGUOUS rows (code/run count mismatch — review):")
        for a in ambiguous:
            print(f"  - {a}")
    else:
        print("No ambiguous code/run mismatches.")

    # ---- Validation assertions ----
    assert 40 <= len(out) <= 50, f"expected ~45 programmes, got {len(out)}"
    for c in ("JS4111", "JS4874", "JS4886"):
        assert out.get(c, {}).get("apl") == "ALL", f"{c} should be ALL"
    assert "Practical Translation (CHI-ENG)" in out.get("JS4018", {}).get("apl", []), \
        "JS4018 should include 'Practical Translation (CHI-ENG)'"
    assert "AI and Robotics" in out.get("JS4462", {}).get("apl", []), \
        "JS4462 should include 'AI and Robotics'"
    print("\nValidation: PASS")


if __name__ == "__main__":
    sys.exit(main())
