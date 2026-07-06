#!/usr/bin/env python
"""
Generate a diverse, edge-case-focused test-student set for the Excel↔TS oracle
validation. Keeps the curated 9 (test_students_curated.json) and appends N random
students that stress every exception family at once (each student is scored across
ALL 422 programmes, so one student exercises best_of, pools, HKUST/PolyU bonuses,
half-replacement, etc. simultaneously). Diversity is in the INPUT dimensions:
grade spread (incl. level 1/2), elective count (2–4), and M1/M2/none.

  ~/miniconda3/envs/jupascal/bin/python scripts/excel/gen_fuzz.py [N] [seed]
  node scripts/excel/oracle.mjs && bash scripts/excel/revalidate.sh
"""
import json, os, random, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))
from steps import EN_TO_ZH  # noqa: E402  (EN canonical -> 選單 ZH)

# Valid electives = the canonical Cat-A vocabulary (the ONLY subjects a real
# student can pick), NOT the raw EN_TO_ZH keys — sourcing from the registry keeps
# the fuzzer honest (e.g. no non-canonical "Technology and Living" plain name).
_REGISTRY = json.load(open(os.path.join(ROOT, "data/raw/subjects.canonical.json")))
ELECTIVES = [(en, EN_TO_ZH[en]) for en in _REGISTRY.get("category_a", [])
             # skip the 3 Combined Science variants: the ": " in the EN name is a
             # dataWorker-filtered key (test artifact, not a real elective input).
             if ":" not in en and en in EN_TO_ZH]
GRADES = ["5**", "5*", "5", "4", "3", "2", "1"]
# Weighted toward the middle/low so level-<3 6th subjects (the PolyU-bonus edge)
# and weak profiles are well represented.
GRADE_WEIGHTS = [1, 1, 2, 3, 3, 3, 2]


def rand_student(rng, i):
    chi, eng, math = (rng.choices(GRADES, GRADE_WEIGHTS)[0] for _ in range(3))
    m12 = None
    if rng.random() < 0.6:
        m12 = {"module": rng.choice([1, 2]), "grade": rng.choices(GRADES, GRADE_WEIGHTS)[0]}
    n_elect = rng.choice([2, 2, 3, 3, 4, 4])
    picks = rng.sample(ELECTIVES, n_elect)
    electives = [{"en": en, "zh": zh, "grade": rng.choices(GRADES, GRADE_WEIGHTS)[0]}
                 for en, zh in picks]
    return {"name": f"fuzz{i:02d}",
            "cores": {"chi": chi, "eng": eng, "math": math},
            "m12": m12, "electives": electives}


def edge_cases():
    """Hand-crafted boundary students the random sampler rarely hits."""
    def s(name, chi, eng, math, m12, electives):
        return {"name": name, "cores": {"chi": chi, "eng": eng, "math": math},
                "m12": m12, "electives": [{"en": e, "zh": EN_TO_ZH[e], "grade": g}
                                          for e, g in electives]}
    return [
        # exactly 5 subjects (no M12, 2 electives) — bonus/best-6 have nothing extra
        s("edge-5subj", "4", "4", "4", None, [("Physics", "4"), ("Chemistry", "4")]),
        # 8 subjects, all top — every bonus/best-of pool fully populated
        s("edge-8top", "5**", "5**", "5**", {"module": 2, "grade": "5**"},
          [("Physics", "5**"), ("Chemistry", "5**"), ("Biology", "5**"), ("Economics", "5**")]),
        # all level 1 — everything present but below every level-3 bonus gate
        s("edge-all1", "1", "1", "1", {"module": 1, "grade": "1"},
          [("Physics", "1"), ("Chemistry", "1"), ("Economics", "1")]),
        # 6th subject exactly at the gate (level 3) vs below — PolyU-bonus boundary
        s("edge-6th-L3", "5", "5", "5", {"module": 1, "grade": "5"},
          [("Physics", "5"), ("Chemistry", "3")]),
        s("edge-6th-L2", "5", "5", "5", {"module": 1, "grade": "5"},
          [("Physics", "5"), ("Chemistry", "2")]),
        # M2 strong, math weak — HKUST/max-weighted/half-replacement interplay
        s("edge-m2", "3", "4", "2", {"module": 2, "grade": "5**"},
          [("Physics", "5*"), ("Chemistry", "5"), ("Biology", "4")]),
    ]


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    rng = random.Random(seed)
    curated = json.load(open(os.path.join(ROOT, "scripts/excel/test_students_curated.json")))
    fuzz = [rand_student(rng, i) for i in range(n)]
    out = curated + edge_cases() + fuzz
    with open(os.path.join(ROOT, "scripts/excel/test_students.json"), "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"wrote {len(out)} students: {len(curated)} curated + "
          f"{len(edge_cases())} edge + {n} random (seed {seed})")


if __name__ == "__main__":
    main()
