export type Grade = "5**" | "5*" | "5" | "4" | "3" | "2" | "1" | "A" | "B" | "C" | "D" | "E" | "U" | "";

export type StudentGrades = Record<string, string>;

export type Profile = {
  id: string;
  name: string;
  grades: StudentGrades;
  // Profile-scoped picks. Optional for migration from pre-per-profile
  // localStorage shapes – reads should treat `undefined` as `[]`.
  pickedCodes?: (string | null)[];
};

export type RequirementPool = {
  count: number;
  subjects: string[];
  grade: string;
  note?: string;
};

export type MinRequirements = {
  chi?: string;
  eng?: string;
  math?: string;
  csd?: string;
  elect1?: RequirementPool;
  elect2?: RequirementPool;
  conditional_remarks?: string;
  // OR-alternatives: some JUPAS programmes list the requirement as two (or more)
  // acceptable patterns (e.g. JS1202: "Math 3 + any elective" OR "Math 2 +
  // a specific science elective", encoded on the listing as a conditional
  // elective row). A student is eligible if the base pattern OR ANY alternative
  // is fully satisfied. Each alternative is a self-contained pattern; its own
  // `alternatives` (if any) is ignored to keep the check one level deep.
  alternatives?: MinRequirements[];
};

export type BestOfPool = {
  count: number;
  subjects: string[];
  weight: number;
  // Pools sharing a slot tag compete for ONE positional slot — the first pool
  // to claim a candidate wins it (CityU "in 2nd Elective" alternatives).
  slot?: string;
  [key: string]: unknown;
};

export type HkustFormulaStep = {
  type: "required" | "best_from_pool" | "better_of";
  subject?: string;               // required
  weight?: number;                // required
  subject_filter?: string[];      // best_from_pool — [] means "any remaining"
  weights?: Array<{ subjects: string[]; weight: number }>; // tiered pool weights
  options?: HkustFormulaStep[][]; // better_of — take whichever branch scores higher
  eligible_categories?: string[];
};

export type Constraint = {
  type: string;
  description?: string;
  subjects?: string[];
  count?: number;
  limit?: number;
  multiplier?: number;
  subject_count?: number;
  max_attainable_weighting?: number;
  bonus_percentage?: number;
  [key: string]: unknown;
};

export type Scores2025 = {
  median?: number | null;
  lq?: number | null;
  uq?: number | null;
  mean?: number | null;
  expected_score?: number | null;
  score_type?: "actual" | "estimated" | string;
  // HKBU programmes rescored on the 2026 weighting (score_basis =
  // "hkbu_2026_simulated"): the official mean was computed under the OLD
  // formula and can't be re-based, so it's parked here instead of `mean`.
  mean_official_2025_basis?: number | null;
};

export type ScoreConversionTable = {
  category_a?: Record<string, number>;
  category_c?: Record<string, number>;
};

export type OfferStatistic = {
  Year: number;
  Type: "Application" | "Offer" | string;
  School?: string;
  JUPAS?: string;
  Quota?: number;
  Total?: number;
  "Band A"?: number;
  "Band B"?: number;
  "Band C"?: number;
  "Band D"?: number;
  "Band E"?: number;
};

// One officially-scraped non-academic requirement (interview / portfolio /
// audition / practical / physical / written / aptitude test) — see unify Step 4c.
export type ProgrammeRequirement = {
  type: string; // interview | portfolio | audition | physical-test | practical-test | written-test | aptitude-test
  timing?: "pre-results" | "post-results" | "both" | string | null;
  when?: string; // human-readable timing detail ("Before results: Mid-June · After results: Late-July")
  before?: string | null;
  after?: string | null;
  date?: string | null;
  format?: string | null;
  salience?: "required" | "weighty" | "optional" | string; // provided by source (HKUST); else derived in selection.ts
  scored?: boolean; // HKUST: interview folded into the admission score
};

// One 2025→2026 scoring change. Discriminated on `type`:
//  - weighting:           a DSE subject's multiplier changed (from/to are ×N)
//  - pool:                a best-of weighting pool changed shape (rare; generic)
//  - formula_count:       Best N → Best M (from_id/to_id are "best5" etc.)
//  - compulsory_added/removed: a core became / stopped being force-included
export type YearChangeItem =
  | { type: "weighting"; subject: string; from: number; to: number }
  | { type: "pool" }
  | { type: "formula_count"; from_id: string; to_id: string }
  | { type: "compulsory_added"; subject: string }
  | { type: "compulsory_removed"; subject: string };

export type YearChanges = {
  weighting_changed: boolean;
  formula_changed: boolean;
  items: YearChangeItem[];
};

export type Programme = {
  jupas_code: string;
  name_en: string;
  name_zh?: string | null;
  institution: string;
  faculty?: string | null;
  formula_2025?: string | null;
  formula_2025_id?: string | null;
  formula_2026?: string | null;
  formula_2026_id?: string | null;
  subject_weights_2025?: Record<string, number>;
  subject_weights_2026?: Record<string, number>;
  best_of_weights_2025?: BestOfPool[];
  best_of_weights_2026?: BestOfPool[];
  // HKUST-only: the sequential graded-pool formula (English/Math ×2 → tiered
  // "best from pool" → best-of-other pools, optionally a `better_of`). This is
  // the AUTHORITATIVE HKUST model the calculator walks; the flat
  // subject_weights/best_of fields can't represent it and mislead the display,
  // so the DetailPanel breakdown renders from this for HKUST.
  hkust_formula_steps?: HkustFormulaStep[];
  // Noise-filtered 2025→2026 scoring changes (unify computes this; present only
  // when a real weighting/formula change exists). Drives the DetailPanel pills
  // + "what changed" panel.
  year_changes?: YearChanges | null;
  min_requirements_2026: MinRequirements;
  calculation_constraints?: Constraint[];
  score_conversion_table: ScoreConversionTable;
  // Category C (Other Languages) policy — DATA-DRIVEN (emitted by unify's curated
  // table) so the rule isn't a hardcoded JS-code list in the runtime:
  //   "none"                – Cat C ignored entirely (both eligibility & scoring)
  //   "elective_cat_a_only" – Cat C can't satisfy an elective (may still score)
  //   "score_excluded"      – Cat C not counted in the score, but may still satisfy
  //                           an elective for eligibility (HKU programmes whose
  //                           scoring formula lacks the "a"/"c" Cat-C footnote)
  //   undefined             – standard (Cat C per the institution's score policy)
  category_c_policy?: "none" | "elective_cat_a_only" | "score_excluded";
  // Category B (Applied Learning) acceptance — DATA-DRIVEN (emitted by unify):
  //   "none"   – ApL not counted at all (e.g. HKU: supporting info only)
  //   "any"    – any ApL subject is accepted
  //   string[] – only the listed ApL subjects (PolyU/CUHK per-programme lists)
  // ApL is scored through the programme's Cat-A table at the equivalent level.
  apl_policy?: "none" | "any" | string[];
  // Max number of ApL subjects that may count toward the score (default 1;
  // HKMU/SSSDP allow 2).
  apl_max?: number;
  // Minimum ApL attainment that counts (eligibility floor + how bare "Attained"
  // scores):
  //   "dist1"    (default) – needs ≥ Distinction (I) (→ L3); bare "Attained" → 0
  //   "attained"           – bare "Attained" accepted, scores DSE Level 2 (HKMU)
  //   "l3"                 – bare "Attained" accepted, scores DSE Level 3 (LingnanU:
  //                          its calculator scores both Attained and Dist (I) as L3)
  apl_min_level?: "dist1" | "attained" | "l3";
  // HKUST: ApL is accepted ONLY as a 6th-subject bonus, never a Best-5 elective and
  // never an eligibility elective. When set, ApL is excluded from the main Best-N
  // and from elective-requirement matching, but still feeds the 6th-subject bonus.
  apl_bonus_only?: boolean;
  // CUHK: ApL is recognised only as an EXTRA bonus subject whose value CUHK does
  // not publish — so it is NOT scored and NOT an eligibility elective. `apl_policy`
  // is kept solely to tell the candidate which of their ApL the programme recognises
  // (surfaced as an "unquantified advantage" note, never as points).
  apl_advisory_only?: boolean;
  // Extra admission gate beyond the per-subject requirements, enforced after the
  // score is computed (e.g. CUHK MBChB-GPS JS4502: total ≥ 40 with 5** in any 4).
  extra_eligibility?: { min_total?: number; min_top_grade_count?: number; top_grade?: string };
  max_achievable_score?: number | null;
  scores_2025: Scores2025;
  // Set when the stored benchmark is NOT a raw same-formula historical score but a
  // recalculation of the 2025 admission results with the (changed) 2026 formula, so
  // it stays comparable to a 2026-formula-scored student. Currently "cuhk_2026_recalculated"
  // for the CUHK programmes that changed formula for 2026 (see DetailPanel note).
  // Also "restructured": the benchmark is borrowed from a discontinued predecessor
  // programme (named in `restructured_from`), which the programme replaces.
  score_basis?: string;
  // TRUE 2025 weighting kept as displayable facts when the scoring fields
  // were mirrored onto the 2026 basis (CityU recalculated / HKBU simulated) —
  // the "2025" UI sections show these instead of the mirrored values.
  subject_weights_2025_official?: Record<string, number>;
  best_of_weights_2025_official?: BestOfPool[];
  subject_weights_2025_official_raw?: string | null;
  // JUPAS code of the predecessor when `score_basis === "restructured"` — the
  // benchmark shown is that (retired) programme's own admission score.
  restructured_from?: string;
  score_grades_2025?: Record<string, Record<string, string> | null>;
  offer_statistics?: OfferStatistic[];
  // HKDSE retake / repeater penalty (CUHK + HKU only; from data/raw/retake_2026.json).
  // Two different models:
  //   scope "retake_subject"  – HKU: 10% off the REPEATED SUBJECT only (per-subject),
  //                             applied to every HKU programme. `consideration` says
  //                             how previous/combined sittings are counted.
  //   scope "admission_score" – CUHK: a band ("5% or less" / "6% to 10%") off the
  //                             WHOLE admission score, for the listed programmes only.
  retake?: {
    penalty: string;                                  // "10%" | "5% or less" | "6% to 10%"
    scope: "retake_subject" | "admission_score";
    consideration?: string;                           // HKU only
    policy_en?: string | null;
    source?: string | null;
  } | null;
  quota?: number | null;
  // Joint-admission intake shared across several programmes: the combined total
  // + the JS codes that share it (so the UI can say "N places shared across M").
  quota_shared?: { total: number | null; codes: string[] } | null;
  remarks?: string | null;

  // Official non-academic requirements scraped from the institution's own
  // admission / interview-arrangement page (unify Step 4c; see
  // docs/manuals/INTERVIEW_SCRAPING.md). Authoritative layer for the covered
  // institutions — interview (all 9) plus portfolio/audition/test where the
  // source states it (e.g. PolyU "submit a portfolio").
  non_academic?: ProgrammeRequirement[] | null;

  // JUPAS-site baseline (populated by scripts/extraction/jupas_detail_scrap.py)
  jupas_url?: string | null;
  short_description?: string | null;
  programme_websites?: string[] | null;
  tuition_fee_first_year?: string | null;
  tuition_fee_full_text?: string | null;
  contacts_text?: string | null;
  study_level?: string | null;
  jupas_requirements?: JupasRequirements | null;
};

export type JupasRequirement = {
  subject: string;
  min_level: string;
};

export type JupasRequirements = {
  programme_core?: JupasRequirement[];
  programme_electives?: JupasRequirement[];
  general_core?: JupasRequirement[];
  general_electives?: JupasRequirement[];
  notes?: string[];
  raw_text?: string;
};

export type CandidateScore = {
  subject: string;
  grade: string;
  basePoints: number;
  multiplier: number;
  weightedScore: number;
  isCompulsory: boolean;
  isBestOfPool: boolean;
  used: boolean;
  isBonus: boolean;
  bonusValue?: string;
};

export type CalculationResult = {
  totalScore: number;
  formula?: string | null;
  selected: CandidateScore[];
  allCandidates: CandidateScore[];
  score_type: string;
  // ApL subjects the student holds that this programme recognises but does NOT
  // quantify into the score (CUHK advisory-only) — surfaced as an advantage note.
  recognizedApL?: string[];
};

export type EligibilityDetail = {
  label: string;
  pass: boolean;
  got: string;
  need?: string;
  note?: string;
};

export type EligibilityResult = {
  eligible: boolean;
  details: EligibilityDetail[];
};

export type BenchmarkKey = "uq" | "median" | "lq" | "mean" | "expected_score";

export type BenchmarkComparison = {
  key: BenchmarkKey;
  label: string;
  score: number;
  delta: number;
  percent: number;
};

export type BenchmarkBand = "above-uq" | "above-median" | "above-lq" | "below-lq" | "no-score";

export type ProgrammeResult = {
  programme: Programme;
  calculation: CalculationResult;
  eligibility: EligibilityResult;
  comparisons: BenchmarkComparison[];
  band: BenchmarkBand;
  hasScoreData: boolean;
};
