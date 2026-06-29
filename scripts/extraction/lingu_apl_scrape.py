#!/usr/bin/env python
"""Reverse-engineer LingnanU's per-programme Applied Learning (Category B / ApL)
RECOGNITION from LingU's official JUPAS score calculator (banner.ln.edu.hk).

LingU's published PDF only says ApL "may be recognised as electives / bonus /
tie-breakers by individual programmes" — no list, no conversion. But its online
calculator encodes the real per-programme rule, which we extract here.

What the calculator reveals (probed 2026-06):
  • Rule (verbatim error): "Candidates must have at least 2 Elective Subjects. If
    Category B and C subjects are taken, at most 1 subject from each category will
    be counted."  → at most ONE ApL counts (apl_max = 1).
  • Recognition is PER-PROGRAMME × PER-SUBJECT: an ApL only counts for a programme
    that recognises that specific course (e.g. AI and Robotics → 11 progs incl.
    tech; Fashion Image Design → 10 progs incl. design — different sets).
  • Conversion (vs the Cat-A level scale, on weight-1.0 programmes): Attained with
    Distinction (II) ≡ Level 4; Attained with Distinction (I) ≡ Level 3; bare
    "Attained" ≡ Level 3 too (TT and DI score the same).  → apl_min_level "l3".
  • Weight: ApL is weighted ×1.0 uniformly — even on JS7123, whose Cat-A electives
    are ×1.25, ApL stays ×1.0.

Method: submit Chi/Eng/Math + Physics (one Cat-A elective) + the ApL at grade D2.
With only one Cat-A elective, the input meets "≥2 electives" ONLY if the programme
recognises the ApL as the 2nd elective — so a returned score ⇔ the programme
recognises that ApL. (Cat-A baseline Phys+Chem returns all 23 programmes.)

Output: Reference(2026)/LingU/lingu_apl.json
  { "_meta": {conversion, weight, max}, "JS7211": ["AI and Robotics", ...], ... }
(consumed by unify_2026_data.py). Polite: ~55 probe pairs with delays.
"""
import json, re, time, urllib.request, urllib.parse, os, sys

BASE = "https://banner.ln.edu.hk/PROD/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
OUT = "Reference(2026)/LingU/lingu_apl.json"
REG = "data/raw/subjects.canonical.json"
DELAY = 0.7
CORE = {"D010": "5", "D020": "5", "D030": "5", "D150": "5"}  # Chi, Eng, Math, Physics(filler elective)


def _get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "ignore")


def probe(grades):
    """grades (subjID→grade) → {jupas_code: weighted_best5_score}, or {} on a rule error."""
    q = urllib.parse.urlencode({"p_dse_res": json.dumps([grades]), "callback": "cb"})
    resp = _get(BASE + "jp_score_calculator_b.p_web_input?" + q)
    m = re.search(r'"app_no":\s*"(\d+)"', resp)
    if not m:
        return {}
    time.sleep(DELAY * 0.6)
    html = _get(BASE + "jp_score_calculator.p_print_result?p_app_no=" + m.group(1))
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        c = [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if c and re.match(r"JS7\w{3}$", c[0]) and len(c) >= 3 and re.match(r"[0-9.]+$", c[2] or ""):
            out[c[0]] = float(c[2])
    return out


def build_surface():
    reg = json.load(open(REG, encoding="utf-8"))
    catb = set(reg["category_b"])
    surface = {n.lower(): n for n in catb}
    for a, c in reg["aliases"].items():
        if c in catb:
            surface[a.lower()] = c
    return catb, surface


def main():
    catb, surface = build_surface()
    subs = json.loads(_get(BASE + "jp_score_calculator.p_get_elec_subj"))
    # canonical ApL → the LingU calculator IDs that map to it (prefer current D7xx)
    canon_ids = {}
    for s in subs:
        if s["id"][:2] not in ("D5", "D6", "D7"):
            continue
        c = surface.get(s["name"].strip().lower())
        if c:
            canon_ids.setdefault(c, []).append(s["id"])
    print(f"Mapped {len(canon_ids)}/{len(catb)} canonical ApL to a LingU id.", file=sys.stderr)

    by_prog = {}
    for canon in sorted(canon_ids):
        # a programme recognises this ApL if ANY of its LingU ids returns a score
        recognising = set()
        for sid in sorted(canon_ids[canon], key=lambda i: (i[:2] != "D7", i)):  # try D7xx first
            scores = probe({**CORE, sid: "D2"})
            recognising |= set(scores)
            time.sleep(DELAY)
            if recognising:
                break  # one id sufficed
        for code in recognising:
            by_prog.setdefault(code, []).append(canon)
        print(f"  {canon}: {len(recognising)} programme(s)", file=sys.stderr)

    out = {"_meta": {
        "source": "banner.ln.edu.hk JUPAS score calculator (reverse-engineered)",
        "conversion": {"Attained with Distinction (II)": 4, "Attained with Distinction (I)": 3, "Attained": 3},
        "weight": 1.0, "max_apl": 1,
        "note": "Recognition is per-programme×per-subject; score returned ⇔ programme recognises that ApL.",
    }}
    for code in sorted(by_prog):
        out[code] = sorted(by_prog[code])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Wrote {OUT}: {len(by_prog)} programmes recognise ≥1 ApL")
    for code in sorted(by_prog):
        print(f"  {code}: {len(out[code])} ApL")


if __name__ == "__main__":
    main()
