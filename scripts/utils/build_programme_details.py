#!/usr/bin/env python
"""Build the lazy-loaded programme-detail sidecar.

The unified dataset (loaded up front for the whole 419-programme list) carries
only a ~280-char preview of each `short_description`, with no structure or
links, so the first payload stays lean. The full overview — headings,
paragraphs, list items and the links the institutions embed — is only worth its
bytes once a user opens a single programme's detail page, so we emit it into a
separate file the app fetches lazily on detail-open (see
`src/lib/programmeDetails.ts`).

Source: `data/raw/jupas_programme_details_2026.json` (the JUPAS detail scrape,
which now captures `description_blocks` + `tuition_url`; rerun
`scripts/extraction/jupas_detail_scrap.py --force` to refresh it).

Output: `data/processed/programme_details_2026.json`, a map
    { "<JS code>": { "blocks": [ {t, spans:[{text, href?}]} ], "tuition_url": "" } }
restricted to the canonical programmes in the unified dataset. Empty fields are
omitted; programmes with neither blocks nor a tuition URL are skipped.

Run:  ~/miniconda3/envs/jupascal/bin/python scripts/utils/build_programme_details.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "jupas_programme_details_2026.json"
UNIFIED = ROOT / "data" / "processed" / "JUPAS_2026_Unified_Data.json"
OUT = ROOT / "data" / "processed" / "programme_details_2026.json"


def clean_blocks(blocks):
    """Keep only well-formed {t, spans:[{text, href?}]} blocks."""
    out = []
    for b in blocks or []:
        if not isinstance(b, dict):
            continue
        t = b.get("t")
        if t not in ("h", "p", "li"):
            continue
        spans = []
        for s in b.get("spans") or []:
            text = (s.get("text") or "").strip() if isinstance(s, dict) else ""
            if not text:
                continue
            span = {"text": text}
            href = (s.get("href") or "").strip() if isinstance(s, dict) else ""
            if href.startswith(("http://", "https://")):
                span["href"] = href
            spans.append(span)
        if spans:
            out.append({"t": t, "spans": spans})
    return out


def main() -> None:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    unified = json.loads(UNIFIED.read_text(encoding="utf-8"))
    canonical = {p.get("jupas_code") for p in unified if p.get("jupas_code")}

    details: dict[str, dict] = {}
    for entry in raw:
        code = entry.get("jupas_code")
        if not code or code not in canonical:
            continue
        rec = {}
        blocks = clean_blocks(entry.get("description_blocks"))
        if blocks:
            rec["blocks"] = blocks
        tuition_url = (entry.get("tuition_url") or "").strip()
        if tuition_url.startswith(("http://", "https://")):
            rec["tuition_url"] = tuition_url
        if rec:
            details[code] = rec

    OUT.write_text(
        json.dumps({k: details[k] for k in sorted(details)}, ensure_ascii=False),
        encoding="utf-8",
    )
    n_blocks = sum(1 for v in details.values() if v.get("blocks"))
    n_url = sum(1 for v in details.values() if v.get("tuition_url"))
    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {len(details)} programmes ({n_blocks} with blocks, {n_url} with tuition URL) "
          f"→ {OUT.relative_to(ROOT)} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
