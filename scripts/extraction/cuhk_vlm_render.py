#!/usr/bin/env python
"""
Render CUHK "Useful Information for JUPAS Applicants" booklet pages into
code+weighting image STRIPS for VLM (vision) transcription.

Why this exists
---------------
CUHK's authoritative per-programme subject weightings live in the annual booklet
"Useful-Information-for-JUPAS-Applicants-<YEAR>.pdf" (a wide, colour-banded, multi-
row table). Extracting it with a PDF *text* parser (pdfplumber ->
CUHK_PDF_*_Requirements.json) is UNRELIABLE: cells wrap, columns misalign, and a
whole weighting cell frequently comes out as "--" when it actually contains
"English (x 1.3)" etc. That silent dropping produced false "weighting changed"
diffs (e.g. JS4801/JS4550/JS4719 looked like new-2026 weightings but were
unchanged) AND hid real changes.

Reading the RENDERED PAGE as an image with a vision model transcribes the same
table cleanly. This script only does the deterministic part — render + crop the
relevant columns into legible strips. A human/VLM then transcribes each strip.

See docs/manuals/VLM_WEIGHT_EXTRACTION.md for the full workflow.

Usage
-----
    python scripts/extraction/cuhk_vlm_render.py \
        --pdf "Reference(2026)/CUHK/Useful-Information-for-JUPAS-Applicants-2026.pdf" \
        --tag y26 --out /tmp/cuhk_strips

Requires: pdftoppm (poppler-utils) on PATH, plus Pillow + pypdf in the
~/miniconda3/envs/jupascal env.
"""
import argparse
import os
import subprocess

import pypdf
from PIL import Image


def render_and_strip(pdf_path: str, tag: str, out_dir: str, dpi: int = 200) -> int:
    os.makedirs(out_dir, exist_ok=True)
    n_pages = len(pypdf.PdfReader(pdf_path).pages)
    made = 0
    for i in range(1, n_pages):  # page 0 is the cover; tables start at page 1
        pg1 = i + 1  # pdftoppm is 1-based
        raw_prefix = os.path.join(out_dir, f"_{tag}_p{i:02d}")
        subprocess.run(
            ["pdftoppm", "-f", str(pg1), "-l", str(pg1), "-r", str(dpi), "-png", pdf_path, raw_prefix],
            check=True, stderr=subprocess.DEVNULL,
        )
        raw = next(x for x in os.listdir(out_dir) if x.startswith(f"_{tag}_p{i:02d}"))
        im = Image.open(os.path.join(out_dir, raw))
        w, h = im.size
        # LEFT: "JUPAS Code" + "Programme" (row identity). RIGHT: "No. of Subject
        # to be Considered" + "Specific Subject Weighting / Remarks". The middle
        # requirement columns (Chi/Eng/Math/CS/electives) are dropped — they are
        # not needed for the weighting diff and dropping them enlarges the text.
        left = im.crop((0, 0, int(w * 0.22), h))
        right = im.crop((int(w * 0.53), 0, int(w * 0.98), h))
        strip = Image.new("RGB", (left.width + right.width + 16, h), "white")
        strip.paste(left, (0, 0))
        strip.paste(right, (left.width + 16, 0))
        strip.save(os.path.join(out_dir, f"{tag}_p{i:02d}.png"))
        os.remove(os.path.join(out_dir, raw))
        made += 1
    return made


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pdf", required=True, help="Path to the Useful-Information booklet PDF")
    ap.add_argument("--tag", required=True, help="Filename tag, e.g. y25 or y26")
    ap.add_argument("--out", default="/tmp/cuhk_strips", help="Output dir for strips")
    ap.add_argument("--dpi", type=int, default=200)
    args = ap.parse_args()
    n = render_and_strip(args.pdf, args.tag, args.out, args.dpi)
    print(f"Wrote {n} strips to {args.out} (prefix {args.tag}_pNN.png)")
