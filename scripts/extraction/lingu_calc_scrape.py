#!/usr/bin/env python
"""Reverse-engineer LingnanU's per-programme Category C (Other Language) weightings
from LingU's OFFICIAL JUPAS score calculator — values its published PDF omits.

Why: the PDF lists per-programme subject weights for Cat A only. The online
calculator (banner.ln.edu.hk) silently applies a Cat-C weight too, and it is NOT
uniform — most programmes weight languages at x1.0, but a programme that weights
its whole elective pool higher (e.g. JS7123 at x1.25) weights languages the same.
We previously assumed a blanket x1.25 for all LingU programmes; this proved wrong.

Method (no manual anchor — self-calibrating):
  The calculator returns each programme's "Weighted Best-5 Score" for a grade set.
  With EXACTLY 5 subjects, all 5 always count, so varying ONE subject's grade
  isolates  Δscore = weight * Δ(base points).  We submit two probes that differ
  only in the Japanese (JLPT, subj DC88) grade — N1P vs N3P — holding Chi/Eng/Math
  + one filler elective fixed. Δscore per programme = catc_weight * (base(N1P) -
  base(N3P)). Since (base(N1P)-base(N3P)) is a programme-INDEPENDENT grade
  conversion, the most common Δ across programmes corresponds to weight 1.0; every
  programme's weight = its Δ / that common Δ. (Cross-checked against known Cat-A
  PDF weights via a Physics probe — recovers them exactly.)

Output: Reference(2026)/LingU/lingu_catc_weights.json  →  {jupas_code: weight}
        (consumed by unify_2026_data.py). Only weights != 1.0 actually matter.

Polite: a handful of requests with delays. Run occasionally, not in a loop.
"""
import json, re, time, urllib.request, urllib.parse, os, statistics, sys

BASE = "https://banner.ln.edu.hk/PROD/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
OUT = "Reference(2026)/LingU/lingu_catc_weights.json"
JAPANESE_JLPT = "DC88"          # representative Cat-C language (uniform within a programme)
DELAY = 0.8                     # seconds between requests


def _get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "ignore")


def probe(grades):
    """Submit a grade dict (subjID -> grade) → {jupas_code: weighted_best5_score}."""
    q = urllib.parse.urlencode({"p_dse_res": json.dumps([grades]), "callback": "cb"})
    resp = _get(BASE + "jp_score_calculator_b.p_web_input?" + q)
    m = re.search(r'"app_no":\s*"(\d+)"', resp)
    if not m:
        err = re.search(r'"Errors":\s*"([^"]+)"', resp)
        raise RuntimeError("calculator error: " + (err.group(1) if err else resp[:160]))
    time.sleep(DELAY * 0.7)
    html = _get(BASE + "jp_score_calculator.p_print_result?p_app_no=" + m.group(1))
    scores = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if cells and re.match(r"JS7\w{3}$", cells[0]) and len(cells) >= 3 and re.match(r"[0-9.]+$", cells[2] or ""):
            scores[cells[0]] = float(cells[2])
    return scores


def main():
    core = {"D020": "5", "D010": "5", "D030": "5", "D150": "5"}  # Eng, Chi, Math, Physics(filler)
    print("Probing LingU calculator (Japanese N1P vs N3P)…")
    hi = probe({**core, JAPANESE_JLPT: "N1P"}); time.sleep(DELAY)
    lo = probe({**core, JAPANESE_JLPT: "N3P"})
    if not hi or set(hi) != set(lo):
        print("ERROR: probe returned no / mismatched programmes", file=sys.stderr); sys.exit(1)

    deltas = {c: round(hi[c] - lo.get(c, hi[c]), 3) for c in hi}
    base_delta = statistics.mode(deltas.values())   # most common Δ == weight 1.0
    if base_delta <= 0:
        print("ERROR: could not calibrate base_delta", file=sys.stderr); sys.exit(1)

    weights = {c: round(d / base_delta, 4) for c, d in deltas.items()}
    print(f"calibration: base(N1P)-base(N3P) = {base_delta} (the weight-1.0 Δ)\n")
    for c in sorted(weights):
        note = "  <-- weighted" if abs(weights[c] - 1.0) > 0.02 else ""
        print(f"  {c}: Δ={deltas[c]:.2f}  Cat-C weight = {weights[c]:g}{note}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(weights, f, ensure_ascii=False, indent=2, sort_keys=True)
    nontrivial = {c: w for c, w in weights.items() if abs(w - 1.0) > 0.02}
    print(f"\nWrote {OUT}: {len(weights)} programmes; weighted (>1.0): {nontrivial or 'none'}")


if __name__ == "__main__":
    main()
