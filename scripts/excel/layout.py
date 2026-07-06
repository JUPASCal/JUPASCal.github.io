"""
Structural constants for the 2026 JUPAS Cal Excel generator.

These encode the LOGIC/layout of the legacy workbook (see
docs/manuals/EXCEL_LOGIC.md). They are stable year-to-year; only the DATA that
flows into these slots changes per cycle. Edit EXCEL_LOGIC.md first if the layout
itself ever changes.
"""

# --- Paths -------------------------------------------------------------------
TEMPLATE_XLSX = "Archives/2025 JUPAS 計分器/下載嚟用 (v1.0.3) 2025 JUPAS Cal.xlsx"
UNIFIED_JSON = "data/processed/JUPAS_2026_Unified_Data.json"
REGISTRY_JSON = "data/raw/subjects.canonical.json"  # canonical subject vocabulary
OUTPUT_XLSX = "build/2026 JUPAS Cal (generated).xlsx"

# --- Institutions ------------------------------------------------------------
# Unified `institution` value  ->  the workbook's short name.
INST_UNIFIED_TO_XLSX = {
    "CityUHK": "CityU", "HKBU": "HKBU", "PolyU": "PolyU", "CUHK": "CUHK",
    "HKUST": "HKUST", "HKU": "HKU", "LingnanU": "LingU", "EdUHK": "EdUHK",
    "HKMU": "HKMU", "SSSDP": "SSSDP",
}

# The order institution blocks appear in 計分版 / 入學要求 / RSC (EXCEL_LOGIC §4.7).
INST_ORDER = ["CityU", "HKBU", "PolyU", "CUHK", "HKUST", "HKU",
              "LingU", "EdUHK", "HKMU", "SSSDP"]

# Grade->score scale row used by each institution block in 計分版 (EXCEL_LOGIC §4.2/§4.7).
# Row 3..13 of 計分版 hold the per-institution conversion; we reference K$<row>.
INST_SCALE_ROW = {
    "CityU": 3, "HKBU": 4, "PolyU": 5, "CUHK": 6, "HKUST": 7,
    "HKU": 8, "LingU": 9, "EdUHK": 9, "HKMU": 11, "SSSDP": 13,
}

# Which institutions use the text-parsed weighting machine (EXCEL_LOGIC §4.5).
# Everyone else uses hand-keyed / conditional weights.
PARSER_INSTITUTIONS = {"PolyU"}

# --- 計分版 subject slots (the 10-slot model, EXCEL_LOGIC §4.1) ----------------
# slot key -> (weight col, weighted col, boosted col, mask col, required-flag col)
ENGINE_SLOTS = {
    "chi":   ("K", "V", "AF", "AP", "BH"),
    "eng":   ("L", "W", "AG", "AQ", "BI"),
    "math":  ("M", "X", "AH", "AR", "BJ"),
    "csd":   ("N", None, "AI", None, "BK"),   # CSD computed but NOT scored (§4.6)
    "m1m2":  ("O", "Z", "AJ", "AT", "BL"),
    "x1":    ("P", "AA", "AK", "AU", "BM"),
    "x2":    ("Q", "AB", "AL", "AV", "BN"),
    "x3":    ("R", "AC", "AM", "AW", "BO"),
    "x4":    ("S", "AD", "AN", "AX", "BP"),
    "lang":  ("T", "AE", "AO", "AY", "BQ"),
}

# 計分版 row where each institution's programme block starts is computed at build
# time from the grouped programme list (blocks are contiguous, institution order
# above). The header/conversion zone occupies rows 1-35; data starts at row 36.
ENGINE_DATA_START_ROW = 36

# --- Reference Score Calculation columns (EXCEL_LOGIC §6.1) -------------------
# Data rows start at row 13.
RSC_DATA_START_ROW = 13
RSC_COLS = {
    "code": "B", "institution": "C", "faculty": "D", "name": "E", "method": "F",
    "mean_2024": "G", "uq_2024": "H", "median_2024": "I", "lq_2024": "J",
    "weight_tier1": "P", "weight_tier2": "Q", "weight_tier3": "R",
    "quota": "U", "intake": "V", "banda_apply": "W", "banda_offer": "X",
    "req_2025_1": "AA", "req_2025_2": "AB", "method_2025": "AC",
    "weight_2025_t1": "AH", "weight_2025_t2": "AI", "weight_2025_t3": "AJ",
}

# --- 入學要求 columns (EXCEL_LOGIC §7) ----------------------------------------
ELIG_DATA_START_ROW = 22
ELIG_COLS = {  # requirement level inputs used by the live checks (L:Q)
    "req_chi": "L", "req_eng": "M", "req_math": "N", "req_csd": "O",
    "req_e1": "P", "req_e2": "Q",
    # pass/fail checks S:X, verdict Z, gate flags AB/AC/AD
    "verdict": "Z", "gate_m1m2": "AB", "gate_catc": "AC", "gate_apl": "AD",
}

# --- Year-Labeling Rule (AGENTS.md) ------------------------------------------
# Scores use Y-1 (2025) weights/method; eligibility uses current-year (2026)
# requirements; benchmarks compare against 2025 actual scores.
SCORING_WEIGHTS_KEY = "subject_weights_2025"
SCORING_FORMULA_KEY = "formula_2025_id"
ELIGIBILITY_REQ_KEY = "min_requirements_2026"
BENCHMARK_SCORES_KEY = "scores_2025"
