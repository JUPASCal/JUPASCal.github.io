#!/usr/bin/env python
"""
hkbu_apl_extract.py
===================
Extract HKBU's per-programme Category B (Applied Learning / ApL) acceptance from
each programme's OWN page on the HKBU Admissions website (NOT the GER summary
PDF). The GER PDF only marks some programmes as accepting "specified" Category B
subjects without listing them; the per-programme "Programme Requirements" /
"Notes for elective subjects" block on each programme page gives the actual
treatment, in one of these forms:

  (1) plain "Category B (Applied Learning) subjects with 'Attained with
      Distinction (I)' or above"               -> accepts ALL ApL        -> "any"
  (2) "Specified/Related Category B (Applied Learning) subjects ... listed in
      the following website: <URL>"            -> a SPECIFIED list       -> [..]
      where <URL> is one of:
        (2a) a linked PDF table of the subjects (JS2020 fass PDF;
             JS2310/JS2370 share the comm 2-column PDF; JS2330 FTV PDF),
        (2b) a department webpage that lists them under a
             "Category B subjects (For 2026 entry only)" heading (JS2025),
  (3) the specified subjects listed INLINE on the admissions page itself
      ("..., including: - Subject; - Subject; ...")  (JS2620)            -> [..]
  (4) no Category B as a 2nd elective at all (electives must be Category A /
      Category C only; or "Category B ... will be considered in the admissions
      selection process" which is NOT a qualifying-elective route)       -> "none"

SCOPE: the 22 HKBU JUPAS-coded year-1 programmes (CODES below).

SOURCES
-------
* Programme list + per-programme page URLs:
    https://admissions.hkbu.edu.hk/programmes.html
  -> backed by the AEM JSON feed:
    .../programmes/jcr:content/.../programmesearch_copy.programmesearch.json
  The feed's `link` is the Mainland-JEE variant (`...-year1-jee.html`); the
  HKDSE/JUPAS page (which carries the Category-B requirement) is the same URL
  with the `-jee` suffix stripped (`...-year1.html`).
* Specified-list sources are followed per programme (PDF via curl + pdfplumber,
  or the department webpage HTML).

OUTPUT
------
  Reference(2026)/HKBU/hkbu_apl.json
    { "<JS code>": {"name": "...", "apl": "any" | "none" | ["...", ...]}, ... }
  ApL subject names are kept VERBATIM (the main unify pipeline canonicalises).

ROBUSTNESS
----------
* Network-resilient: each remote fetch is independent; a programme that cannot be
  retrieved keeps its prior value and is reported as a FLAGGED failure rather than
  guessed. The comm PDF (JS2310/JS2370) and FTV PDF (JS2330) are committed under
  Reference(2026)/HKBU/apl_sources/ as offline fallbacks.
* The comm PDF is a 2-column weight table (JS2310 vs JS2370); a subject counts as
  accepted for a programme iff a numeric weight appears in that programme's column
  on the subject's row. The 5 "alternative-Chinese" rows (weight = "same as HKDSE
  Chinese Language") are NOT 2nd-elective ApL and are excluded.

Re-runnable; idempotent. Prints a summary (any / none / list counts + sources).
"""

import html
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "Reference(2026)" / "HKBU" / "hkbu_apl.json"
NAMES_REF_PATH = ROOT / "Reference(2026)" / "HKBU" / "HKBU_2026_Data.json"
FALLBACK_DIR = ROOT / "Reference(2026)" / "HKBU" / "apl_sources"

ADM = "https://admissions.hkbu.edu.hk"
FEED_URL = (ADM + "/content/ao/en/programmes/jcr:content/root/layoutcontainer/"
            "layoutcontainer_1880071545/programmesearch_copy.programmesearch.json")

CODES = [
    "JS2020", "JS2025", "JS2060", "JS2110", "JS2120", "JS2310", "JS2330",
    "JS2340", "JS2370", "JS2410", "JS2420", "JS2510", "JS2610", "JS2620",
    "JS2660", "JS2810", "JS2910", "JS2920", "JS2930", "JS2940", "JS2950",
    "JS2960",
]

# The comm 2-column PDF (JS2310 = BCOMM JOUR/PRA ; JS2370 = BCOMM GDA) carries the
# specified lists for BOTH communication programmes. JS2370's own page links to a
# stale `www.comm.hkbu.edu.hk/.../ApL_2025_entry.pdf` that frequently times out;
# the 2026 comm PDF (linked by JS2310) supersedes it and includes the JS2370 column.
COMM_PDF_URL = ("https://comm.hkbu.edu.hk/content/dam/comm-assets/document/"
                "admissions/comm-apl-2026-entry.pdf")
# JS2330 (Film & Television) specified-list PDF (Academy of Film).
FTV_PDF_URL = ("https://af.hkbu.edu.hk/content/dam/af-assets/programmes/"
               "bachelor-of-arts-honours-in-film-and-television/"
               "2026%20entry_FTV_List%20of%20Category%20of%20Assessment%20Criteria.pdf")
# JS2020 specified-list PDF (Faculty of Arts and Social Sciences).
JS2020_PDF_URL = ("https://fass.hkbu.edu.hk/content/dam/fass-assets/documents/"
                  "public/JS2020%20Cat%20B%20Subject%20List.pdf")
# JS2025 specified list lives on a department webpage (not a PDF).
JS2025_DEPT_URL = ("https://rel.hkbu.edu.hk/studying-at-rel/"
                   "b-a-hons-in-religion-philosophy-and-ethics/"
                   "programme-information.html?tabs1=tab-3-tab")

CURL_TIMEOUT = 60


# --------------------------------------------------------------------------- #
# Fetch helpers
# --------------------------------------------------------------------------- #
def curl_text(url, timeout=CURL_TIMEOUT):
    """GET `url` as text via curl (-k: some HKBU sub-hosts have broken TLS chains).
    Returns the body string, or None on failure/timeout."""
    try:
        r = subprocess.run(["curl", "-sSL", "-k", "--max-time", str(timeout), url],
                           capture_output=True, timeout=timeout + 10)
        if r.returncode == 0 and r.stdout:
            return r.stdout.decode("utf-8", "replace")
    except (subprocess.SubprocessError, OSError):
        pass
    return None


def curl_pdf(url, dest, timeout=CURL_TIMEOUT):
    """Download a PDF to `dest`; return True iff it looks like a real PDF."""
    try:
        subprocess.run(["curl", "-sSL", "-k", "--max-time", str(timeout),
                       "-o", dest, url], check=True, timeout=timeout + 10)
    except (subprocess.SubprocessError, OSError):
        return False
    try:
        with open(dest, "rb") as f:
            return f.read(5) == b"%PDF-"
    except OSError:
        return False


def get_pdf(url, fallback_name):
    """Return a path to the PDF: download to a temp file, else committed fallback
    in FALLBACK_DIR. Returns (path, is_temp, source_label) or (None, False, None)."""
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    if curl_pdf(url, tmp.name):
        return tmp.name, True, "web"
    os.unlink(tmp.name)
    fb = FALLBACK_DIR / fallback_name
    if fb.exists():
        return str(fb), False, "fallback"
    return None, False, None


# --------------------------------------------------------------------------- #
# Page-HTML helpers (AEM embeds the requirement text double-escaped in the HTML)
# --------------------------------------------------------------------------- #
def decode_page(raw):
    """Decode the AEM page HTML to plain text for the requirements block."""
    s = raw.replace("\\r\\n", "\n").replace("\\/", "/").replace('\\"', '"')
    s = html.unescape(html.unescape(s))
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"[ \t]+", " ", s)


def elective_notes_block(text):
    """Return the 'Notes for elective subjects' block (or the smallest region that
    contains the second-elective clause), else ''. """
    low = text.lower()
    i = low.find("the other elective")
    if i < 0:
        i = low.find("notes for elective")
    if i < 0:
        return ""
    return text[i:i + 1200]


# --------------------------------------------------------------------------- #
# Specified-list extractors
# --------------------------------------------------------------------------- #
def parse_inline_list(block):
    """Parse the inline specified list (JS2620 style):
    '..., including: - Subject; - Subject; ... and - Subject'."""
    m = re.search(r"including:(.*?)(?:Remarks on other requirements|$)", block,
                  re.S | re.I)
    seg = m.group(1) if m else block
    # Split on ';' and on leading '- ' bullets; some bullets share a wrapped line.
    parts = re.split(r"[;•]|\n", seg)
    out = []
    for p in parts:
        p = p.strip()
        p = re.sub(r"^[-–—\s]+", "", p)        # leading dash / bullet
        # The last bullet is joined with "and " ("...; and - AI and Robotics");
        # strip a leading conjunction (and a bare "and" fragment splits to nothing).
        p = re.sub(r"^and\b\s*", "", p, flags=re.I)
        p = re.sub(r"^[-–—\s]+", "", p).strip()
        # JS2620 prints two subjects on one wrapped line:
        # "Exercise Science and Health Fitness; Foundation in Chinese Medicine"
        # (already split by ';'); guard against a trailing 'and' join.
        if not p or p.lower().startswith("remarks"):
            continue
        out.append(re.sub(r"\s+", " ", p).strip().rstrip("."))
    return out


def parse_dept_webpage_list(raw):
    """Parse a department-webpage specified list under the
    'Category B subjects (For 2026 entry only)' heading (JS2025)."""
    text = decode_page(raw)
    low = text.lower()
    i = low.find("category b subjects (for 2026 entry only)")
    if i < 0:
        i = low.find("category b subjects")
    if i < 0:
        return []
    # The list runs until the next 'Category C' heading.
    j = low.find("category c", i + 10)
    seg = text[i:j if j > 0 else i + 800]
    # Drop the heading line itself.
    seg = re.sub(r"(?i)category b subjects \(for 2026 entry only\)", "", seg)
    seg = re.sub(r"(?i)category b subjects", "", seg)
    out = []
    for line in re.split(r"\n", seg):
        line = re.sub(r"\s+", " ", line).strip()
        if not line or line.lower().startswith("category"):
            continue
        out.append(line.rstrip("."))
    return out


def parse_js2020_pdf(pdf_path):
    """JS2020 fass PDF: rows 'B### ABBR <verbatim name>'. Name = words right of the
    abbr column (x0 > 410)."""
    out = []
    with pdfplumber.open(pdf_path) as pdf:
        words = pdf.pages[0].extract_words()
    anchors = sorted((w["top"], w["text"]) for w in words
                     if re.match(r"^B\d{3}$", w["text"]) and 285 < w["x0"] < 300)
    for top, _ in anchors:
        nm = sorted((w["x0"], w["text"]) for w in words
                    if abs(w["top"] - top) < 4 and w["x0"] > 410)
        name = re.sub(r"\s+", " ", " ".join(t for _, t in nm)).strip()
        name = name.replace("^", "").strip()
        if name:
            out.append(name)
    return out


def parse_ftv_pdf(pdf_path):
    """JS2330 FTV PDF: the 'Cat B: Applied Learning Subjects' column (B-codes at
    x~426). Name = words between the abbr and the Cat-C column."""
    out = []
    with pdfplumber.open(pdf_path) as pdf:
        words = pdf.pages[0].extract_words()
    catc_xs = [w["x0"] for w in words if re.match(r"^C\d", w["text"])]
    catc_left = min(catc_xs) if catc_xs else 617
    anchors = sorted((w["top"], w["text"]) for w in words
                     if re.match(r"^B\d{3}$", w["text"]) and 415 < w["x0"] < 440)
    for top, _ in anchors:
        nm = sorted((w["x0"], w["text"]) for w in words
                    if abs(w["top"] - top) < 4 and 472 < w["x0"] < catc_left - 5)
        name = re.sub(r"\s+", " ", " ".join(t for _, t in nm)).strip()
        name = name.replace("^", "").strip()
        if name:
            out.append(name)
    return out


# Verbatim overrides for the handful of comm-PDF rows whose name wraps across the
# weight columns or absorbs a learning-area label fragment (geometry can't cleanly
# separate them). Each value is the subject name exactly as printed in the PDF.
COMM_NAME_OVERRIDES = {
    "B693": "Data Application For Business (former name: Business Data Analysis)",
    "B735": "Food Technology and Nutrition",
    "B616": "Western Cuisine",
    "B615": "Hotel Operations",
    "B675": "Building Technology",
    "B692": "Public Relations and Communication",
    "B678": "Magazine Editing and Production",
    "B687": "Accounting in Practice",
}
# Learning-area label fragments that bleed into the right of a name row.
COMM_TRAIL_LABELS = [
    "Media and Communication", "Media and", "Business, Management and Law",
    "Management and Law", "Applied Science", "Engineering and Production",
    "Engineering and", "(JOUR/PRA)", "(GDA)",
]


def parse_comm_pdf(pdf_path):
    """Parse the comm 2-column weight PDF. Returns (js2310_list, js2370_list).

    A subject (row anchored by a B### code in the code column, x~129) is accepted
    by a programme iff a numeric weight token appears in that programme's column:
      JS2310 weight column  ~ x 420..485
      JS2370 weight column  ~ x 505..565
    The 5 alternative-Chinese rows carry no numeric weight (text spans columns) and
    are excluded. Verbatim names come from the raw text rows (with overrides for the
    wrap/label artifacts)."""
    col_2310, col_2370 = (420, 485), (505, 565)
    subjcode = re.compile(r"^B\d{3}$")
    weight = re.compile(r"^\d+(?:\.\d+)?$")

    with pdfplumber.open(pdf_path) as pdf:
        allwords = [(p.page_number, w) for p in pdf.pages
                    for w in p.extract_words()]
        text = "".join(p.extract_text() + "\n" for p in pdf.pages)

    # Weight flags per B-code (geometry).
    anchors = sorted((pg, w["top"], w["text"]) for pg, w in allwords
                     if subjcode.match(w["text"]) and 120 < w["x0"] < 175)
    flags, order = {}, []
    for i, (pg, top, bcode) in enumerate(anchors):
        nb = 10 ** 9
        for pg2, top2, _ in anchors[i + 1:]:
            nb = top2 if pg2 == pg else 10 ** 9
            break
        lo, hi = top - 3, nb - 1
        w10 = w70 = False
        for pg2, w in allwords:
            if pg2 != pg or not (lo <= w["top"] < hi):
                continue
            cx = (w["x0"] + w["x1"]) / 2.0
            if weight.match(w["text"]):
                if col_2310[0] < cx < col_2310[1]:
                    w10 = True
                if col_2370[0] < cx < col_2370[1]:
                    w70 = True
        flags[bcode] = (w10, w70)
        order.append(bcode)

    # Verbatim names from text rows (handle inline / wrapped codes).
    txt = re.sub(r"(?<!\n)(B\d{3}\s+[A-Za-z])", r"\n\1", text)
    skip_pref = ("BCOMM", "Subject", "Learning areas", "group code",
                 "For the second", "Remark", "http", "^ Obsolete",
                 "Same subject", "(for non-Chinese", "speaking students",
                 "Applied Learning Chinese")
    recs, cur = [], None
    for line in txt.split("\n"):
        s = line.strip()
        if not s or s in ("1", "2", "3") or any(s.startswith(h) for h in skip_pref):
            continue
        m = re.match(r"^(B\d{3})\s+(\S+)\s+(.*)$", s)
        if m:
            if cur:
                recs.append(cur)
            cur = {"bcode": m.group(1), "frag": [m.group(3)]}
        elif re.match(r"^B\d{3}\s+\S+\s*$", s):
            if cur:
                recs.append(cur)
            cur = {"bcode": s.split()[0], "frag": []}
        elif cur:
            cur["frag"].append(s)
    if cur:
        recs.append(cur)

    def build_name(frag):
        joined = " ".join(frag)
        joined = re.split(r"\bB\) offered from|For details of subject", joined)[0]
        toks = [t for t in joined.split() if not weight.match(t)]
        name = " ".join(toks)
        for a in sorted(["Creative Studies", "Media and Communication",
                         "Business, Management and Law", "Business, Management and",
                         "Management and Law", "Applied Science",
                         "Engineering and Production", "Engineering and",
                         "(JOUR/PRA)", "(GDA)"], key=len, reverse=True):
            name = name.replace(a, "")
        name = name.replace("^", "")
        name = re.sub(r"\s+", " ", name).strip()
        name = re.sub(r"^\W+|\s*[–-]\s*$", "", name)
        return name

    names = {}
    for r in recs:
        nm = build_name(r["frag"])
        if r["bcode"] not in names or len(nm) > len(names[r["bcode"]]):
            names[r["bcode"]] = nm
    names.update(COMM_NAME_OVERRIDES)

    def strip_trailing(nm):
        changed = True
        while changed:
            changed = False
            for t in sorted(COMM_TRAIL_LABELS, key=len, reverse=True):
                if nm.endswith(" " + t):
                    nm = nm[:-len(t)].rstrip()
                    changed = True
        return nm

    js2310, js2370 = [], []
    for c in order:
        nm = names.get(c, "")
        if c not in COMM_NAME_OVERRIDES:
            nm = strip_trailing(nm)
        if flags[c][0]:
            js2310.append(nm)
        if flags[c][1]:
            js2370.append(nm)
    return js2310, js2370


# --------------------------------------------------------------------------- #
# Classification per programme
# --------------------------------------------------------------------------- #
def classify_block(block):
    """Classify a programme's elective-notes block.
    Returns (kind, payload) where kind in {'any','none','specified-inline',
    'specified-link'} and payload is the inline list or the source URL."""
    low = block.lower()
    if "category b" not in low and "applied learning" not in low:
        return "none", None
    # Specified/Related with an explicit source link.
    m = re.search(r"(?:specified|related)\s+category b.*?(https?://\S+)",
                  block, re.S | re.I)
    if m:
        return "specified-link", m.group(1).rstrip(' ;\\"\'<')
    # Specified/Related listed INLINE on the page ("..., including:").
    if re.search(r"(?:specified|related)\s+category b", low) and "including" in low:
        return "specified-inline", None
    # "Category B ... will be considered in the admissions selection process" is
    # NOT a 2nd-elective route -> not an elective option -> none.
    if re.search(r"category b.*considered in the admissions", low):
        return "none", None
    # Plain "Category B (Applied Learning) subjects ..." as a 2nd-elective option.
    if re.search(r"category b \(applied learning\) subjects", low):
        return "any", None
    return "none", None


def load_reference_names():
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


def hkdse_url(feed_link):
    """Feed `link` is the Mainland-JEE variant; HKDSE page = strip the -jee suffix."""
    u = feed_link
    if u.endswith("-jee.html"):
        u = u[:-len("-jee.html")] + ".html"
    return ADM + u


def fetch_feed_links():
    """Return {code: hkdse_url} for the 22 scoped codes, or {} on failure."""
    raw = curl_text(FEED_URL)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    links = {}
    for fac in data:
        for p in fac.get("list", []):
            c = p.get("code")
            if c in CODES and p.get("link"):
                links[c] = hkdse_url(p["link"])
    return links


def main():
    ref_names = load_reference_names()
    prior = {}
    if OUT_PATH.exists():
        try:
            prior = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            prior = {}

    links = fetch_feed_links()
    if not links:
        print("ERROR: could not fetch the HKBU programme feed; aborting "
              "(prior hkbu_apl.json left unchanged).", file=sys.stderr)
        return 1

    # Pre-fetch the shared specified-list PDFs once (comm + FTV + JS2020).
    comm_2310 = comm_2370 = None
    comm_src = ftv_src = js2020_src = None
    p, t, comm_src = get_pdf(COMM_PDF_URL, "comm-apl-2026-entry.pdf")
    if p:
        comm_2310, comm_2370 = parse_comm_pdf(p)
        if t:
            os.unlink(p)
    ftv_list = None
    p, t, ftv_src = get_pdf(FTV_PDF_URL, "ftv-apl-2026-entry.pdf")
    if p:
        ftv_list = parse_ftv_pdf(p)
        if t:
            os.unlink(p)
    js2020_list = None
    p, t, js2020_src = get_pdf(JS2020_PDF_URL, "JS2020-cat-b-subject-list.pdf")
    if p:
        js2020_list = parse_js2020_pdf(p)
        if t:
            os.unlink(p)

    result, sources, flagged = {}, {}, []

    for code in CODES:
        name = ref_names.get(code) or prior.get(code, {}).get("name", code)
        url = links.get(code)
        if not url:
            result[code] = prior.get(code, {"name": name, "apl": None})
            flagged.append((code, "no feed link; kept prior value"))
            continue
        page = curl_text(url)
        if not page:
            result[code] = prior.get(code, {"name": name, "apl": None})
            flagged.append((code, f"page fetch failed: {url}; kept prior value"))
            continue
        block = elective_notes_block(decode_page(page))
        if not block:
            result[code] = prior.get(code, {"name": name, "apl": None})
            flagged.append((code, "no elective-notes block; kept prior value"))
            continue

        kind, payload = classify_block(block)
        apl, src = None, "admissions page (no Cat B route)"
        if kind == "any":
            apl, src = "any", "admissions page (plain Category B)"
        elif kind == "none":
            apl, src = "none", "admissions page (no Cat B route)"
        elif kind == "specified-inline":
            apl = parse_inline_list(block)
            src = "admissions page (inline list)"
        elif kind == "specified-link":
            # Route to the right extractor by code (the link target's format is
            # programme-specific and well known).
            if code in ("JS2310", "JS2370"):
                lst = comm_2310 if code == "JS2310" else comm_2370
                if lst is not None:
                    apl, src = lst, f"comm PDF ({comm_src})"
            elif code == "JS2330":
                if ftv_list is not None:
                    apl, src = ftv_list, f"FTV PDF ({ftv_src})"
            elif code == "JS2020":
                if js2020_list is not None:
                    apl, src = js2020_list, f"JS2020 PDF ({js2020_src})"
            elif code == "JS2025":
                raw = curl_text(JS2025_DEPT_URL)
                if raw:
                    lst = parse_dept_webpage_list(raw)
                    if lst:
                        apl, src = lst, "department webpage (JS2025)"
            if apl is None:
                # Could not retrieve the specified list -> keep prior, flag.
                result[code] = prior.get(code, {"name": name, "apl": None})
                flagged.append((code,
                    f"specified list source unreachable: {payload}; kept prior value"))
                sources[code] = "UNRETRIEVED"
                continue

        result[code] = {"name": name, "apl": apl}
        sources[code] = src

    ordered = {k: result[k] for k in CODES if k in result}
    OUT_PATH.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")

    # ---- Summary ----
    n_any = sum(1 for v in ordered.values() if v["apl"] == "any")
    n_none = sum(1 for v in ordered.values() if v["apl"] == "none")
    n_list = sum(1 for v in ordered.values() if isinstance(v["apl"], list))
    n_unk = sum(1 for v in ordered.values() if v["apl"] is None)

    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")
    print(f"Total programmes : {len(ordered)} (expected 22)")
    print(f"  any  : {n_any}")
    print(f"  none : {n_none}  -> "
          f"{', '.join(k for k, v in ordered.items() if v['apl'] == 'none')}")
    print(f"  list : {n_list}")
    if n_unk:
        print(f"  UNCLASSIFIED : {n_unk}")
    print()
    print("list (JS code -> #subjects, source):")
    for k, v in ordered.items():
        if isinstance(v["apl"], list):
            print(f"  {k}: {len(v['apl']):>3} subjects  [{sources.get(k, '?')}]")
            for s in v["apl"]:
                print(f"        - {s}")
    if flagged:
        print()
        print("FLAGGED (NOT retrieved from an official page -> prior value kept):")
        for code, reason in flagged:
            print(f"  {code}: {reason}")
    else:
        print()
        print("All 22 programmes classified from official HKBU pages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
