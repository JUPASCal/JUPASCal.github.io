"""
PolyU per-programme Applied Learning (ApL / Category B) weighting extractor.

PolyU publishes one "Subject Weighting" PDF per JUPAS programme:
  https://www.polyu.edu.hk/aradm/jupas/{YEAR}_{JSCODE}_SW.pdf
(committed locally under Reference(2026)/PolyU/2025_JS####_SW.pdf — the 2025/26
exercise, which is the weighting the calculator scores on per the Year-Labeling
Rule). Each PDF lists Category A, optionally "Category B: Applied Learning
Subjects", and Category C, each subject with a weight on the SAME 5/7/10 scale.

Key fact: only SOME programmes have a "Category B" section. A programme with NO
Category B section does NOT recognise ApL at all — so the presence of the section
is the authoritative per-programme ApL-acceptance signal, and the per-subject
weight is how "relevant" each ApL is (e.g. Fashion Image Design = 7 for the Fashion
scheme; design ApL = 10 for the Design scheme; most ApL = base 5).

Output (verbatim names; the unify pipeline canonicalises to the 57-course vocab):
  Reference(2026)/PolyU/polyu_apl_weights.json
    { "JS3050": {"name": "...", "apl": {"Fashion Image Design": 7, "Film and Transmedia": 5, ...}}, ... }
Programmes with no Category B section are simply absent (→ unify sets apl_policy "none").
"""
import glob
import json
import os
import re

import pdfplumber

PDF_GLOB = "Reference(2026)/PolyU/2025_JS*_SW.pdf"
OUT = "Reference(2026)/PolyU/polyu_apl_weights.json"

CATB_HDR = re.compile(r"Category B\s*:?\s*Applied Learning", re.I)
CATC_HDR = re.compile(r"Category C\b", re.I)
# "<Subject Name> <weight>" with an optional trailing "*"; weight is the only number.
ROW = re.compile(r"^(.+?)\s+(\d+(?:\.\d+)?)\s*\*?\s*$")
# header/legend lines inside the block that must NOT be read as subject rows
SKIP = re.compile(r"Subject Name|Subject Weighting|Admission Exercise|Remark|Note", re.I)


def parse_pdf(path):
    text = "\n".join((pg.extract_text() or "") for pg in pdfplumber.open(path).pages)
    lines = text.split("\n")
    b = next((i for i, l in enumerate(lines) if CATB_HDR.search(l)), None)
    if b is None:
        return None  # no Category B section → ApL not recognised
    c = next((i for i in range(b + 1, len(lines)) if CATC_HDR.search(lines[i])), len(lines))
    apl = {}
    for l in lines[b + 1:c]:
        l = l.strip()
        if not l or SKIP.search(l):
            continue
        m = ROW.match(l)
        if m:
            name = m.group(1).strip()
            apl[name] = float(m.group(2))
    return apl or None


def main():
    out = {}
    for path in sorted(glob.glob(PDF_GLOB)):
        code = os.path.basename(path).split("_")[1]
        apl = parse_pdf(path)
        if apl:
            # normalise integer-valued weights to ints for a clean artifact
            apl = {k: (int(v) if v == int(v) else v) for k, v in apl.items()}
            out[code] = {"apl": apl}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{len(out)} PolyU programme(s) recognise ApL → {OUT}")
    for code, v in out.items():
        ws = sorted(set(v["apl"].values()))
        print(f"  {code}: {len(v['apl'])} ApL, weights {ws}")


if __name__ == "__main__":
    main()
