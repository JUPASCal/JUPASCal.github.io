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
DELAY = 0.8                     # seconds between requests

# Each Cat-C "Other Language" qualification, with its TOP and BOTTOM grade (used to
# isolate the weight via a grade swap). One probe-pair per language verifies the
# weight is the same across languages (not just Japanese). IMPORTANT: probe the
# CERTIFICATE ids our app's canonical Cat-C set uses (JLPT / French & Spanish
# Diploma / Goethe / TOPIK / Urdu Intl) — NOT the DSE "<Lang> Language" subjects
# (DC81/82/83/85/86), which are different qualifications weighted differently.
LANGUAGES = [
    ("DC88", "Japanese (JLPT)", "N1P", "N3P"),
    ("DC90", "French (Diploma)", "C2P", "A2P"),
    ("DC91", "Spanish (Diploma)", "C2P", "A2P"),
    ("DC92", "German (Goethe)", "C2P", "A2P"),
    ("DC89", "Korean (TOPIK)", "G6", "G3"),
    ("DC93", "Urdu (Intl)", "A++", "C"),  # E/D are fails (don't count as an elective)
]


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


def measure_language(subj_id, top, bottom):
    """Per-programme weight of one Cat-C language: vary its grade (top vs bottom)
    holding Chi/Eng/Math + a filler elective fixed; self-calibrate (common Δ = 1.0)."""
    core = {"D020": "5", "D010": "5", "D030": "5", "D150": "5"}  # Eng, Chi, Math, Physics(filler)
    hi = probe({**core, subj_id: top}); time.sleep(DELAY)
    lo = probe({**core, subj_id: bottom})
    if not hi or set(hi) != set(lo):
        raise RuntimeError(f"{subj_id}: no / mismatched programmes")
    deltas = {c: round(hi[c] - lo.get(c, hi[c]), 3) for c in hi}
    base_delta = statistics.mode(deltas.values())
    if base_delta <= 0:
        raise RuntimeError(f"{subj_id}: could not calibrate")
    return {c: round(d / base_delta, 4) for c, d in deltas.items()}


def main():
    per_lang = {}
    for sid, name, top, bot in LANGUAGES:
        print(f"Probing {name} ({sid}: {top} vs {bot})…")
        per_lang[name] = measure_language(sid, top, bot)
        time.sleep(DELAY)

    codes = sorted(set().union(*(set(w) for w in per_lang.values())))
    # Per programme: are all languages in agreement? Take the consensus weight.
    final, disagree = {}, []
    print("\nPer-programme weight by language (✓ = all languages agree):")
    print("  code     " + "  ".join(f"{n.split()[0][:6]:>6}" for n, *_ in [(n,) for n in per_lang]))
    for c in codes:
        vals = [per_lang[n].get(c) for n in per_lang]
        uniform = max(vals) - min(vals) < 0.04
        consensus = round(statistics.mean(vals), 3)
        final[c] = round(consensus, 2)
        if not uniform:
            disagree.append((c, dict(zip(per_lang, vals))))
        flag = "✓" if uniform else "✗ DISAGREE"
        if abs(final[c] - 1.0) > 0.02 or not uniform:
            print(f"  {c}  " + "  ".join(f"{v:>6.2f}" for v in vals) + f"   -> {final[c]:g}  {flag}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, indent=2, sort_keys=True)
    nontrivial = {c: w for c, w in final.items() if abs(w - 1.0) > 0.02}
    print(f"\nLanguages probed: {len(per_lang)} | programmes: {len(codes)}")
    print(f"Uniform across languages: {'YES — every programme weights all languages the same' if not disagree else 'NO'}")
    if disagree:
        for c, d in disagree:
            print(f"  DISAGREE {c}: {d}")
    print(f"Wrote {OUT}; weighted (>1.0): {nontrivial or 'none'}")


if __name__ == "__main__":
    main()
