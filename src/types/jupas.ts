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
};

export type BestOfPool = {
  count: number;
  subjects: string[];
  weight: number;
  [key: string]: unknown;
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
  //   undefined             – standard (Cat C per the institution's score policy)
  category_c_policy?: "none" | "elective_cat_a_only";
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
  score_grades_2025?: Record<string, Record<string, string> | null>;
  offer_statistics?: OfferStatistic[];
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
