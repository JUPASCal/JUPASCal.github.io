"""
Data model: load JUPAS_2026_Unified_Data.json and normalise each programme into
the shape the Excel generator needs, grouped by institution in workbook order.

This is the DATA layer. It extracts only what the workbook consumes and maps it
onto the engine's slot model (see layout.ENGINE_SLOTS). It deliberately does NOT
hardcode any values — everything comes from the unified JSON.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field

from layout import (
    UNIFIED_JSON, INST_UNIFIED_TO_XLSX, INST_ORDER, INST_SCALE_ROW,
    SCORING_WEIGHTS_KEY, SCORING_FORMULA_KEY, ELIGIBILITY_REQ_KEY,
    BENCHMARK_SCORES_KEY,
)

# Canonical subject name -> core engine slot (names verified against
# subject_weights_2025 keys). Anything not here is an elective (x1..x4, assigned
# positionally per programme). NB: CSD never appears in subject_weights — it is
# computed for eligibility but NOT scored (EXCEL_LOGIC §4.6), so it has no weight.
CORE_SLOT_FOR_SUBJECT = {
    "Chinese Language": "chi",
    "English Language": "eng",
    "Mathematics (Compulsory Part)": "math",
    "Mathematics Extended Part (Module 1)": "m1m2",
    "Mathematics Extended Part (Module 2)": "m1m2",
}


@dataclass
class Programme:
    code: str
    name_en: str
    name_zh: str
    inst_xlsx: str            # workbook short name (CityU, HKBU, ...)
    scale_row: int            # 計分版 grade-scale row for this institution
    method_id: str            # formula_2025_id (Y-1 scoring)
    core_weights: dict        # slot -> weight, for chi/eng/math/csd/m1m2
    elective_weights: dict    # subject name -> weight (non-core)
    requirements: dict        # min_requirements_2026 (chi/eng/math/csd/elect1..)
    benchmarks: dict          # scores_2025 (median/lq/uq/mean/expected)
    quota: int | None
    offer_statistics: list
    apl_policy: str
    raw: dict = field(repr=False)  # the full unified record, for anything else


def _split_weights(unified_weights: dict) -> tuple[dict, dict]:
    """Partition subject_weights into core-slot weights and elective weights."""
    core, elect = {}, {}
    for subject, w in (unified_weights or {}).items():
        slot = CORE_SLOT_FOR_SUBJECT.get(subject)
        if slot:
            # m1m2 may appear twice (Module 1 / Module 2); keep the max.
            core[slot] = max(core.get(slot, 0), w)
        else:
            elect[subject] = w
    return core, elect


def load_programmes() -> list[Programme]:
    records = json.load(open(UNIFIED_JSON, encoding="utf-8"))
    out = []
    for r in records:
        inst = INST_UNIFIED_TO_XLSX.get(r["institution"])
        if inst is None:
            # Unknown institution -> surface loudly rather than silently drop.
            raise ValueError(f"{r['jupas_code']}: unmapped institution {r['institution']!r}")
        core, elect = _split_weights(r.get(SCORING_WEIGHTS_KEY) or {})
        out.append(Programme(
            code=r["jupas_code"],
            name_en=r.get("name_en", ""),
            name_zh=r.get("name_zh", ""),
            inst_xlsx=inst,
            scale_row=INST_SCALE_ROW[inst],
            method_id=r.get(SCORING_FORMULA_KEY) or "",
            core_weights=core,
            elective_weights=elect,
            requirements=r.get(ELIGIBILITY_REQ_KEY) or {},
            benchmarks=r.get(BENCHMARK_SCORES_KEY) or {},
            quota=r.get("quota"),
            offer_statistics=r.get("offer_statistics") or [],
            apl_policy=r.get("apl_policy", "none"),
            raw=r,
        ))
    return out


def group_by_institution(progs: list[Programme]) -> dict[str, list[Programme]]:
    """Group into the workbook's institution order, sorted by code within each."""
    groups = {inst: [] for inst in INST_ORDER}
    for p in progs:
        groups[p.inst_xlsx].append(p)
    for inst in groups:
        groups[inst].sort(key=lambda p: p.code)
    return groups


def ordered_programmes(progs: list[Programme] | None = None) -> list[Programme]:
    """The single canonical row order shared by all hidden compute sheets:
    institution-grouped (workbook order), code-sorted within institution, DENSE
    (no spacer rows). Index i here ⇒ RSC row 13+i, 計分版 row 36+i, 入學要求 row
    22+i, A123 row 21+i. All cross-sheet row refs are generated from this."""
    groups = group_by_institution(progs or load_programmes())
    out = []
    for inst in INST_ORDER:
        out.extend(groups[inst])
    return out


if __name__ == "__main__":
    progs = load_programmes()
    groups = group_by_institution(progs)
    print(f"loaded {len(progs)} programmes")
    print(f"{'institution':8} {'count':>5}  {'scale':>5}")
    row = 36
    for inst in INST_ORDER:
        n = len(groups[inst])
        print(f"{inst:8} {n:>5}  K${INST_SCALE_ROW[inst]:<4}  engine rows {row}-{row+n-1}")
        row += n + 2  # +2 spacer rows between blocks (header label rows)
    # spot-check the slot mapping on one programme
    ex = next(p for p in progs if p.elective_weights)
    print(f"\nexample {ex.code} ({ex.inst_xlsx}, {ex.method_id}):")
    print(f"  core_weights     = {ex.core_weights}")
    print(f"  elective_weights = {ex.elective_weights}")
    print(f"  requirements     = {ex.requirements}")
    print(f"  benchmarks       = {ex.benchmarks}")
