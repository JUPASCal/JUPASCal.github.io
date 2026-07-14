#!/usr/bin/env python
"""Extract HKDSE retake / repeater penalty data for CUHK + HKU → data/raw/retake_2026.json.

CUHK: the "Arrangement for Applicants with More Than One Sitting of HKDSE (2026
Entry)" table. Its per-programme penalty band (5%-or-less vs 6%-to-10%) is
transcribed HERE from the official table IMAGE (VLM-verified) — the PDF text
layer mis-assigns the Wingdings tick marks (it put JS4434 in 6-10%, dropped
JS4502), so we do NOT trust the PDF parser for this table.

HKU: parsed from the JUPAS API dump (structured JSON — reliable). Every HKU
programme carries a 10% penalty on the RETAKE SUBJECT only; the per-programme
"Consideration of HKDSE Previous / Combined Results" text (how previous/combined
sittings are counted) lives in accordionHTML.
"""
import json
import re
from bs4 import BeautifulSoup

ROOT = "/home/user/Desktop/projects/JUPASCal.github.io"
HKU_API = f"{ROOT}/Reference(2026)/HKU/hku_raw_api.json"
OUT = f"{ROOT}/data/raw/retake_2026.json"

# ── CUHK — VLM-verified from the official table image (do NOT re-derive from PDF text) ──
CUHK_5_OR_LESS = [
    "JS4123", "JS4202", "JS4214", "JS4226", "JS4238", "JS4240", "JS4252",
    "JS4264", "JS4320", "JS4329", "JS4331", "JS4361", "JS4434", "JS4848", "JS4903",
]
CUHK_6_TO_10 = ["JS4501", "JS4502"]  # Medicine (MBChB) + MBChB Global Physician-Leadership Stream
CUHK_POLICY = ("For 2026 entry, the best result in the same subject taken by a candidate in "
               "his/her three most recent attempts of the HKDSE examination will be used for "
               "calculation of the admission score. For some programmes, the admission scores "
               "of applicants seeking admission on the strength of results from more than one "
               "sitting of the HKDSE examination will be adjusted.")

HKU_HEADING = "Consideration of HKDSE Previous"  # substring match inside the accordion <th>


def extract_hku():
    root = json.load(open(HKU_API, encoding="utf-8"))
    progs = root["data"]["programme"]
    out = {}
    for _fac, pmap in progs.items():
        for _pn, rec in pmap.items():
            code = str(rec.get("programme_code") or "").strip()
            if not code or code.upper() in ("N/A", "NA"):
                continue
            js = code if code.startswith("JS") else "JS" + code
            if not re.fullmatch(r"JS\w{4}", js):   # skip non-JUPAS placeholder rows
                continue
            soup = BeautifulSoup(rec.get("accordionHTML") or "", "html.parser")
            cons = None
            for th in soup.find_all("th"):
                if HKU_HEADING in th.get_text():
                    td = th.find_next_sibling("td")
                    if td:
                        cons = " ".join(td.get_text(" ", strip=True).split())
                    break
            out[js] = cons  # None when the programme omits the row
    return out


def main():
    hku = extract_hku()
    data = {
        "cuhk": {
            "policy_en": CUHK_POLICY,
            "penalty_scope": "admission_score",   # % off the whole admission score (全Cert)
            "source": "Reference(2026)/CUHK/Arrangement-for-more-than-one-sitting-2026.pdf "
                      "(penalty band VLM-verified from the table image; PDF text layer unreliable)",
            "programmes": {**{c: "5% or less" for c in CUHK_5_OR_LESS},
                           **{c: "6% to 10%" for c in CUHK_6_TO_10}},
        },
        "hku": {
            "policy_en": "A penalty of 10% is applied to the RETAKE SUBJECT only for HKDSE repeaters.",
            "penalty": "10%",
            "penalty_scope": "retake_subject",     # 10% off the repeated subject only (重考科目)
            "source": "Reference(2026)/HKU/hku_raw_api.json → accordionHTML "
                      "'Consideration of HKDSE Previous / Combined Results & Penalty for HKDSE Repeaters'",
            "programmes": {k: v for k, v in sorted(hku.items())},
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"wrote {OUT}")
    print(f"  CUHK: {len(CUHK_5_OR_LESS)} @ 5%-or-less, {len(CUHK_6_TO_10)} @ 6%-to-10%")
    print(f"  HKU : {len(hku)} programmes (all 10% retake-subject), "
          f"{sum(1 for v in hku.values() if v)} with consideration text")


if __name__ == "__main__":
    main()
