#!/usr/bin/env python
"""
CityU 2025 JUPAS main-admission-score weightings, transcribed by VLM from
Reference(2025)/CityU/2025_JUPAS_Main_Admission_Score_Calculation.pdf (dated
2 Jan 2025). The per-school scrape's `subject_weights_2025` string was garbled
(dropped subjects, lost weight tiers, truncation), and unify was ALSO copying the
2026 weights onto 2025 — so 2025 scores used 2026 formulas. This is the
authoritative 2025 source; unify reads the emitted JSON for subject_weights_2025.

  ~/miniconda3/envs/jupascal/bin/python scripts/extraction/cityu_2025_weights_from_pdf.py

Compact input per programme: (eng, chi, math, elective_tiers, count, best_of).
  - elective_tiers: list of (weight, [subjects]); a subject gets that weight, else 1.
  - best_of: (weight, [subjects]) positional "1st Elective" best-of, or None.
  - count: "best5" | "best4". "M1M2" expands to Module 1 + Module 2.
"""
import json, os

OUT = os.path.join(os.path.dirname(__file__), "..", "..",
                   "Reference(2026)", "CityU", "cityu_2025_weights_vlm.json")

CANON = {
    "E": "English Language", "C": "Chinese Language", "M": "Mathematics (Compulsory Part)",
    "Bio": "Biology", "Chem": "Chemistry", "Phys": "Physics",
    "M1": "Mathematics Extended Part (Module 1)", "M2": "Mathematics Extended Part (Module 2)",
    "BAFS": "Business, Accounting and Financial Studies", "DAT": "Design and Applied Technology",
    "ICT": "Information and Communication Technology", "Econ": "Economics", "Geo": "Geography",
    "ChiHist": "Chinese History", "ChiLit": "Chinese Literature", "Hist": "History",
    "VA": "Visual Arts", "LitEng": "Literature in English",
}

def expand(subs):
    out = []
    for s in subs:
        out += ["M1", "M2"] if s == "M1M2" else [s]
    return out

# (eng, chi, math, [(w, [elec subjects])...], count, best_of=(w,[subjects]) or None)
PROG = {
    # — College of Biomedicine —
    "JS1211": (2, 1, 2, [(2, ["Bio", "Chem", "M1M2", "Phys"])], "best5", None),
    "JS1805": (2, 1, 1.5, [(2, ["Bio", "Chem"]), (1.5, ["BAFS", "DAT", "ICT", "M1M2", "Phys"])], "best5", None),
    "JS1806": (2, 1, 1.5, [(2, ["Bio", "Chem"]), (1.5, ["BAFS", "DAT", "ICT", "M1M2", "Phys"])], "best5", None),
    "JS1807": (2, 1, 1.5, [(2, ["Bio", "Chem"]), (1.5, ["BAFS", "DAT", "ICT", "M1M2", "Phys"])], "best5", None),
    # — College of Business —
    "JS1000": (1, 1, 1, [], "best5", None),
    "JS1001": (1, 1, 1, [], "best5", None),
    "JS1002": (1, 1, 1, [], "best5", None),
    "JS1005": (1, 1, 1, [], "best5", None),
    "JS1007": (1.5, 1, 1, [], "best5", None),
    "JS1012": (1, 1, 1, [], "best5", None),
    "JS1013": (1, 1, 1, [], "best5", None),
    "JS1014": (1, 1, 1, [], "best5", None),
    "JS1017": (1, 1, 1, [], "best5", None),
    "JS1018": (1, 1, 1, [], "best5", None),
    "JS1019": (1, 1, 1, [], "best5", None),
    "JS1025": (1, 1, 1, [], "best5", None),
    "JS1026": (1, 1, 1, [], "best5", None),
    "JS1027": (1, 1, 1, [], "best5", None),
    # — College of Computing —
    "JS1070": (2, 1, 2, [], "best5", None),
    "JS1071": (2, 1, 2, [], "best5", None),
    "JS1072": (2, 1, 2, [], "best5", None),
    "JS1074": (2, 1, 2, [], "best5", None),
    "JS1204": (1, 1, 1, [], "best5", None),
    "JS1218": (1, 1, 1, [], "best5", None),
    # — College of Engineering —
    "JS1201": (2.5, 1.5, 2.5, [(2.5, ["M1M2", "Phys"])], "best5", None),
    "JS1205": (2, 1, 2, [(2, ["ICT", "M1M2", "Phys"]), (1.5, ["Bio", "Chem"])], "best5", None),
    "JS1207": (2, 1, 2, [(2, ["Phys"]), (1.5, ["Chem", "DAT", "M1M2"])], "best5", None),
    "JS1210": (1.5, 1, 2, [(2, ["Phys"]), (1.5, ["Bio", "Chem", "M1M2"])], "best5", None),
    "JS1216": (2, 1, 2, [(2, ["ICT", "M1M2", "Phys"]), (1.5, ["Chem", "DAT"])], "best5", None),
    "JS1217": (2, 1, 2, [(2, ["Bio", "Chem", "DAT", "ICT", "M1M2", "Phys"])], "best5", None),
    "JS1219": (2, 1, 2, [(2, ["Bio", "Chem", "DAT", "Econ", "ICT", "M1M2", "Phys"])], "best5", None),
    # — College of Liberal Arts and Social Sciences —
    "JS1100": (2, 1, 1, [], "best4", None),
    "JS1102": (1.5, 1, 1, [], "best5", None),
    "JS1103": (2, 2, 1, [(1.5, ["ChiHist", "ChiLit", "Hist", "VA"])], "best5", None),
    "JS1104": (2.5, 1, 1, [(1.5, ["LitEng"])], "best5", None),
    "JS1106": (1.25, 1.25, 1, [], "best4", None),
    "JS1108": (1.5, 1, 1, [], "best5", None),
    "JS1109": (2, 1.5, 1.5, [], "best5", None),
    "JS1111": (2, 1, 1, [], "best4", None),
    "JS1112": (2, 1, 1, [], "best4", None),
    "JS1113": (2, 1, 1, [], "best4", None),
    # — College of Science —
    "JS1200": (2, 1, 2.5, [(2.5, ["Bio", "Chem", "Econ", "M1M2", "Phys"])], "best4", None),
    "JS1202": (2, 1, 1.5, [(2, ["Chem"])], "best4", None),
    "JS1206": (2, 1, 2.5, [(2, ["M1M2"]), (1.5, ["Bio", "Chem", "Phys"])], "best4", None),
    "JS1208": (2, 1, 1.25, [(2, ["Phys"]), (1.5, ["M1M2"])], "best4", None),
    # — Jockey Club College of Veterinary Medicine and Life Sciences —
    "JS1801": (1, 1, 1, [], "best5", None),
    # — School of Creative Media —
    "JS1040": (2, 1, 1, [], "best5", None),
    "JS1041": (2, 1, 1, [], "best5", None),
    "JS1042": (2, 1, 1, [], "best5", None),
    "JS1043": (2, 1, 1.5, [], "best5", None),
    "JS1044": (2, 1, 1, [], "best5", None),
    # — School of Energy and Environment (positional 1st/2nd elective) —
    "JS1050": (2, 1, 2.5, [(1.5, ["Bio", "Chem", "Geo", "M1M2", "Phys"])], "best5", (2.5, ["Bio", "Chem", "Phys"])),
    "JS1051": (2, 1, 2.5, [(1.5, ["Bio", "Chem", "Geo", "M1M2", "Phys"])], "best5", (2.5, ["Bio", "Chem", "Phys"])),
    "JS1053": (2, 1, 2.5, [(2.5, ["Econ", "BAFS"]), (1.5, ["Bio", "Chem", "Geo", "M1M2", "Phys"])], "best5", (2.5, ["Bio", "Chem", "Phys"])),
    # — School of Law —
    "JS1061": (1, 1, 1, [], "best5", None),
    # — Double Degree Programmes —
    "JS1052": (2, 1, 2.5, [(1.5, ["Bio", "Chem", "Geo", "M1M2", "Phys"])], "best5", (2.5, ["Bio", "Chem", "Phys"])),
    "JS1062": (1.5, 1, 1, [], "best5", None),
    "JS1123": (1, 1, 1, [], "best5", None),
    "JS1221": (1, 1, 1, [], "best5", None),
}

def build():
    out = {}
    for code, (eng, chi, math, tiers, count, best_of) in PROG.items():
        weights = {}
        if eng != 1: weights[CANON["E"]] = float(eng)
        if chi != 1: weights[CANON["C"]] = float(chi)
        if math != 1: weights[CANON["M"]] = float(math)
        for w, subs in tiers:
            for s in expand(subs):
                if w != 1: weights[CANON[s]] = float(w)
        entry = {"subject_weights_2025": weights, "count": count}
        if best_of:
            bw, bsubs = best_of
            entry["best_of_weights_2025"] = [
                {"count": 1, "subjects": [CANON[s] for s in expand(bsubs)], "weight": float(bw)}
            ]
        out[code] = entry
    return out

if __name__ == "__main__":
    data = build()
    with open(os.path.abspath(OUT), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"wrote {len(data)} CityU 2025 weight entries -> {os.path.abspath(OUT)}")
