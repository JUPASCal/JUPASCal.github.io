"""
EdUHK Applied Learning (ApL) heavier-weighting extractor.

Source: "Recognition of Applied Learning (ApL) (Category B) Subjects and Subject
Weightings for Score Calculation for the 2026 Entry" (EdUHK), at
  https://www.eduhk.hk/acadprog/downloads/EdUHK_ApL%20Recognition%20and%20Subject%20Weightings.pdf
(EdUHK's main "Entrance Requirements and Admission Score Calculation" PDF only
prints the generic phrase "Specified ApL subject(s) (x1.5)" — the per-programme
list of WHICH ApL courses get ×1.5 lives only in this Recognition PDF.)

EdUHK recognises ANY ApL (graded Attained with Distinction) as one elective
(Bachelor's: max 1; Higher Diploma: max 2); bare "Attained" = score 0. A handful
of programmes weight SPECIFIC ApL courses ×1.5 in the Best-5. This script extracts
that per-programme ×1.5 list.

The host needs legacy TLS renegotiation, so we fall back to the committed copy
Reference(2026)/EdUHK/EdUHK_ApL_Recognition_and_Subject_Weightings.pdf when the
download fails.

Output (verbatim course names — the unify pipeline canonicalises):
  Reference(2026)/EdUHK/eduhk_apl_weights.json
    { "JS8001": {"name": "...", "apl_weighted_1_5": ["Popular Music Production", ...]}, ... }
"""
import json
import os
import re
import ssl
import urllib.request

PDF_URL = "https://www.eduhk.hk/acadprog/downloads/EdUHK_ApL%20Recognition%20and%20Subject%20Weightings.pdf"
LOCAL_PDF = "Reference(2026)/EdUHK/EdUHK_ApL_Recognition_and_Subject_Weightings.pdf"
OUT = "Reference(2026)/EdUHK/eduhk_apl_weights.json"


def fetch_pdf():
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.options |= 0x4  # OP_LEGACY_SERVER_CONNECT (eduhk.hk uses legacy renegotiation)
        try:
            ctx.set_ciphers("DEFAULT@SECLEVEL=0")
        except ssl.SSLError:
            pass
        req = urllib.request.Request(PDF_URL, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, context=ctx, timeout=30).read()
        with open(LOCAL_PDF, "wb") as f:
            f.write(data)
        print(f"downloaded {len(data)} bytes")
    except Exception as e:  # noqa: BLE001 — offline fallback to the committed copy
        print(f"download failed ({e}); using committed {LOCAL_PDF}")


def parse():
    import pdfplumber

    with pdfplumber.open(LOCAL_PDF) as pdf:
        lines = []
        for pg in pdf.pages:
            lines += (pg.extract_text() or "").split("\n")

    out = {}
    cur = None
    code_re = re.compile(r"^(JS\d{4})\s+(.*)$")

    def add_bullets(target, text):
        # A line/cell may carry several "▪ name" items; the part before the first
        # "▪" is title/heading text (e.g. a wrapped programme name or the
        # "One of the best subjects among Category A & B:" header) — skip it.
        for seg in text.split("▪")[1:]:
            seg = seg.strip()
            if seg:
                target.append(seg)

    for raw in lines:
        line = raw.strip()
        m = code_re.match(line)
        if m:
            code, rest = m.group(1), m.group(2)
            cur = {"name": rest.split("▪")[0].strip(), "apl_weighted_1_5": []}
            out[code] = cur
            add_bullets(cur["apl_weighted_1_5"], rest)
            continue
        if cur is None:
            continue
        add_bullets(cur["apl_weighted_1_5"], line)

    # drop programmes that ended up with no ApL list (shouldn't happen) and clean
    out = {k: v for k, v in out.items() if v["apl_weighted_1_5"]}
    return out


if __name__ == "__main__":
    if not os.path.exists(LOCAL_PDF):
        fetch_pdf()
    data = parse()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{len(data)} programmes with ×1.5 ApL → {OUT}")
    for code, v in data.items():
        print(f"  {code}: {len(v['apl_weighted_1_5'])} — {', '.join(v['apl_weighted_1_5'])}")
