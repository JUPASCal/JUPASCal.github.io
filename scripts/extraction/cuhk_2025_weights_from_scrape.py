#!/usr/bin/env python
"""
Authoritative CUHK 2025 scoring weights, parsed from the VLM-transcribed
"Useful Information for JUPAS Applicants" 2025 booklet
(Reference(2026)/CUHK/vlm_extract/cuhk_weights_vlm_2025.json).

WHY the booklet, not the PDF-requirements text: CUHK's PDF *requirements* table
(CUHK_PDF_2025_Requirements.json `weight`) SILENTLY DROPS weighting cells and
records "--", manufacturing false "unweighted" programmes (e.g. JS4648, JS4682,
JS4719 all carry real x2 / x3.5 weightings the text parser lost). The booklet,
read by a vision model, is the ground truth. See docs/manuals/VLM_WEIGHT_EXTRACTION.md
and the memory note cuhk-2026-formula-changes-vlm.

unify_2026_data.py loads the emitted JSON (CUHK_2025_WEIGHTS) and applies it as
the 2025 scoring weights, so 2025 scores follow the actual 2025 formula (Year-
Labeling Rule) rather than a copy of the 2026 API weights.

  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/cuhk_2025_weights_from_scrape.py

Booklet weighting grammar (items separated by ';'):
  "English (x 2)"                          -> flat {English: 2}
  "Biology, Chemistry, Physics (x 2)"      -> flat, each x2
  "M1 or M2 (x 2)"                         -> flat M1 & M2 x2 (mutually exclusive)
  "Chinese or English (x 1.5)"             -> best_of {Chinese, English} count 1
  "best one of Physics, Economics or ICT (x 1.5)" -> best_of pool count 1
  "best one of Mathematics or M1 or M2 (x 1.5)"   -> best_of {Math, M1, M2} count 1
  "... must be included ...", "max 3 weighted", "(Chi + Best 4)", "no M1/M2"
                                           -> constraint text, NO "(x N)" -> ignored
"""
import json, os, re

BOOKLET = "Reference(2026)/CUHK/vlm_extract/cuhk_weights_vlm_2025.json"
UNIFIED = "data/processed/JUPAS_2026_Unified_Data.json"
OUT = "Reference(2026)/CUHK/cuhk_2025_weights.json"
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

M1 = "Mathematics Extended Part (Module 1)"
M2 = "Mathematics Extended Part (Module 2)"
CANON = {
    "english": "English Language", "chinese": "Chinese Language",
    "mathematics": "Mathematics (Compulsory Part)", "maths": "Mathematics (Compulsory Part)",
    "math": "Mathematics (Compulsory Part)",
    "biology": "Biology", "chemistry": "Chemistry", "physics": "Physics",
    "m1": M1, "m2": M2,
    "dat": "Design and Applied Technology", "ict": "Information and Communication Technology",
    "bafs": "Business, Accounting and Financial Studies", "economics": "Economics",
    "geography": "Geography", "visual arts": "Visual Arts", "music": "Music",
    "hmsc": "Health Management and Social Care",
    "tech and living fst": "Technology and Living (Food Science and Technology)",
    "tech and living (fst)": "Technology and Living (Food Science and Technology)",
}


def canon_one(s):
    s = s.strip().lower().strip(".")
    if s in ("m1/m2", "m1 or m2"):
        return [M1, M2]
    return [CANON.get(s, s)]  # leave unknown as-is (surfaces in validation)


def subj_list(text):
    # split a pool list on commas, "/" and "or"; expand M1/M2; canonicalise.
    text = text.strip()
    out = []
    # normalise separators to commas, but keep "m1/m2" recognisable
    text = re.sub(r"\bm1\s*/\s*m2\b", "m1 , m2", text, flags=re.I)
    text = text.replace(" or ", ", ").replace("/", ", ")
    for part in re.split(r",", text):
        part = part.strip()
        if part:
            out += canon_one(part)
    # de-dup preserving order
    seen, uniq = set(), []
    for s in out:
        if s not in seen:
            seen.add(s); uniq.append(s)
    return uniq


def parse(text):
    if not text or not text.strip():
        return {}, []
    flat, best_of = {}, []
    for item in text.split(";"):
        item = " ".join(item.split())
        m = re.search(r"\(x\s*([\d.]+)\)", item)
        if not m:
            continue  # a constraint / "must be included" note — no weight
        w = float(m.group(1))
        st = item[: m.start()].strip().rstrip(",").strip()
        low = st.lower()
        bo = re.match(r"best\s+one\s+of\s+(.*)", low)
        if bo:
            best_of.append({"count": 1, "subjects": subj_list(bo.group(1)), "weight": w})
        elif low in ("m1 or m2", "m1/m2"):
            flat[M1] = w
            flat[M2] = w
        elif " or " in low:  # "Chinese or English", "English or Mathematics", "Economics or ICT"
            best_of.append({"count": 1, "subjects": subj_list(low), "weight": w})
        else:  # single subject or a comma-list that ALL get the weight
            for s in subj_list(low):
                flat[s] = w
    return flat, best_of


def main():
    booklet = json.load(open(os.path.join(ROOT, BOOKLET)))
    src = {e["code"]: e.get("weighting", "") for e in booklet if isinstance(e, dict) and e.get("code")}
    cuhk = {p["jupas_code"] for p in json.load(open(os.path.join(ROOT, UNIFIED))) if p["institution"] == "CUHK"}
    out = {}
    for code in sorted(cuhk):
        if code not in src:
            continue  # absent from the booklet -> unify keeps the 2026 copy (don't force {})
        flat, best_of = parse(src[code])
        entry = {"subject_weights_2025": flat}
        if best_of:
            entry["best_of_weights_2025"] = best_of
        out[code] = entry
    with open(os.path.join(ROOT, OUT), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    covered = sum(1 for c in cuhk if c in src)
    weighted = sum(1 for e in out.values() if e["subject_weights_2025"] or e.get("best_of_weights_2025"))
    print(f"wrote {len(out)} CUHK entries ({weighted} weighted; {covered}/{len(cuhk)} in booklet) -> {OUT}")
    # surface any non-canonical subject that leaked through (validation aid)
    bad = set()
    for e in out.values():
        for k in e["subject_weights_2025"]:
            if k not in CANON.values():
                bad.add(k)
        for p in e.get("best_of_weights_2025", []):
            for s in p["subjects"]:
                if s not in CANON.values():
                    bad.add(s)
    if bad:
        print("  ⚠ non-canonical subjects (check parser):", bad)
    missing = sorted(c for c in cuhk if c not in src)
    if missing:
        print(f"  ⚠ {len(missing)} CUHK programmes absent from the booklet (fall back to 2026 copy in unify):", missing)


if __name__ == "__main__":
    main()
