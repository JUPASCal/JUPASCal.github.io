import type {
  CalculationResult,
  CandidateScore,
  Constraint,
  EligibilityDetail,
  EligibilityResult,
  MinRequirements,
  Programme,
  RequirementPool,
  StudentGrades,
} from "../types/jupas";
import { acceptsCategoryC, categoryCBasePoints, categoryCCanSatisfyElective, isCategoryCGrade, isCategoryCSubject } from "./categoryC";
import { categoryBAccepted, categoryBAdvisory, categoryBBasePoints, categoryBCanSatisfyElective, isCategoryBSubject } from "./categoryB";
import { canonicalSubject, CAT_A_SUBJECTS, SUBJECT_EXPANSIONS } from "./subjects";

const CAT_A_SET = new Set(CAT_A_SUBJECTS);

// HKUST's max attainable base points (a 5** subject — see its score-conversion
// table). Only used to phrase the bonus as a "% of a full-marks subject" label.
const UST_MAX_BASE_POINTS = 8.5;

function normalizeSubjectKey(name: string) {
  if (!name) return name;
  const n = name.toUpperCase();
  if (n === "MATHEMATICS COMPULSORY PART" || n === "MATHEMATICS" || n === "MATHEMATICS (COMPULSORY PART)") {
    return "Mathematics (Compulsory Part)";
  }
  if ((n.includes("MODULE 1") || n.includes("CALCULUS AND STATISTICS") || n.includes("M1")) && (n.includes("EXTENDED") || n.includes("PART"))) {
    return "Mathematics Extended Part (Module 1)";
  }
  if ((n.includes("MODULE 2") || n.includes("ALGEBRA AND CALCULUS") || n.includes("M2")) && (n.includes("EXTENDED") || n.includes("PART"))) {
    return "Mathematics Extended Part (Module 2)";
  }
  return name;
}

// Does a candidate subject satisfy a pool of accepted subjects? Both sides are
// resolved to canonical names first (via the shared registry), so an alias or
// variant spelling still matches even if one ever slips past the data pipeline.
// A candidate that stands for a family (e.g. "… Module 1 or 2") also matches
// when the pool lists any family member ("… Module 1" / "… Module 2").
function includesM12Aware(subjects: string[] = [], candidate: string) {
  const cand = canonicalSubject(candidate);
  const pool = subjects.map(canonicalSubject);
  if (pool.includes(cand)) return true;
  // Family-aware in BOTH directions: a generic candidate ("… Module 1 or 2")
  // matches a pool listing a specific member, AND a specific candidate
  // ("… Module 1") matches a pool listing the generic family.
  const members = SUBJECT_EXPANSIONS[cand];
  if (members && members.some((m) => pool.includes(m))) return true;
  return pool.some((p) => SUBJECT_EXPANSIONS[p]?.includes(cand));
}

// The programme's most common subject weight — the "standard elective" weight on
// this programme's scale (1 for most institutions; 7 for PolyU's uniform ×7 model).
// Used as the default multiplier for a subject not explicitly listed (ApL).
function modalWeight(weights: Record<string, number>): number {
  const counts = new Map<number, number>();
  for (const w of Object.values(weights)) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = 1;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

export function calculateScore(studentGrades: StudentGrades, programme: Programme, year: "2025" | "2026" = "2025"): CalculationResult {
  if (!programme?.score_conversion_table) {
    return { totalScore: 0, selected: [], allCandidates: [], score_type: "actual" };
  }

  const rawWeights = programme[`subject_weights_${year}`] || {};
  const weights: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawWeights)) {
    weights[normalizeSubjectKey(key)] = value;
  }

  const bestOfPools = (programme[`best_of_weights_${year}`] || []).map((pool) => ({
    ...pool,
    subjects: pool.subjects.map(normalizeSubjectKey),
  }));
  const constraints = programme.calculation_constraints || [];
  const convTable = programme.score_conversion_table.category_a || {};
  const catCTable = programme.score_conversion_table.category_c || {};
  // Weight for an ApL subject (never listed in the weights map): treat it as a
  // STANDARD elective. Two weight-map shapes exist:
  //   • DENSE (PolyU): every Cat-A subject is listed on a uniform scale (×5/7/10)
  //     — an unlisted subject has no natural ×1 default, so ApL takes the modal
  //     (standard-elective) weight, else it'd be ~7× under-credited and never count.
  //   • SPARSE (CityU/LingU/HKUST): only the specially-weighted subjects are listed;
  //     any unlisted elective defaults to ×1 — so ApL (a non-preferred elective)
  //     is ×1 too. Using the modal of the few listed subjects would over-credit it.
  const catACovered = CAT_A_SUBJECTS.filter((subject) => subject in weights).length;
  const denseWeightMap = catACovered >= CAT_A_SET.size * 0.6;
  const aplDefaultWeight = denseWeightMap ? modalWeight(weights) : 1;
  const candidates: CandidateScore[] = [];

  for (const [subject, grade] of Object.entries(studentGrades)) {
    if (!grade || grade === "U") continue;
    // Programmes that ignore Category C (Other Languages) entirely — the
    // language never enters their score (e.g. HKBU JS2120 "不計日文").
    if (isCategoryCSubject(subject) && !acceptsCategoryC(programme)) continue;
    // Applied Learning (Cat B): only scored when the programme considers it.
    if (isCategoryBSubject(subject) && !categoryBAccepted(programme, subject)) continue;
    const basePoints = isCategoryCSubject(subject)
      ? categoryCBasePoints(programme, subject, grade, catCTable) ?? 0
      : isCategoryBSubject(subject)
        ? categoryBBasePoints(programme, subject, grade) ?? 0
        : convTable[grade] ?? 0;
    let multiplier = weights[subject] || (isCategoryBSubject(subject) ? aplDefaultWeight : 1);
    if (subject === "Mathematics Extended Part (Module 1 or 2)") {
      multiplier = weights["Mathematics Extended Part (Module 1)"] || weights["Mathematics Extended Part (Module 2)"] || 1;
    }
    candidates.push({
      subject,
      grade,
      basePoints,
      multiplier,
      weightedScore: basePoints * multiplier,
      isCompulsory: false,
      isBestOfPool: false,
      used: false,
      isBonus: false,
    });
  }

  // Category B (Applied Learning): at most apl_max ApL subjects may count toward
  // the score (default 1; HKMU/SSSDP allow 2) — keep the highest-scoring ones,
  // exclude the rest from selection.
  const aplMax = programme.apl_max ?? 1;
  const aplCandidates = candidates
    .filter((candidate) => isCategoryBSubject(candidate.subject))
    .sort((a, b) => b.weightedScore - a.weightedScore);
  for (let i = aplMax; i < aplCandidates.length; i++) aplCandidates[i].used = true;

  for (const pool of bestOfPools) {
    const poolCandidates = candidates
      .filter((candidate) => includesM12Aware(pool.subjects, candidate.subject))
      .sort((a, b) => b.weightedScore - a.weightedScore);
    for (let index = 0; index < Math.min(pool.count, poolCandidates.length); index++) {
      const candidate = poolCandidates[index];
      if (pool.weight > candidate.multiplier) {
        candidate.multiplier = pool.weight;
        candidate.weightedScore = candidate.basePoints * candidate.multiplier;
        candidate.isBestOfPool = true;
      }
    }
  }

  const maxWeightedConstraint = constraints.find((constraint) => constraint.type === "max_weighted_subjects");
  if (maxWeightedConstraint) {
    candidates.sort((a, b) => b.multiplier - a.multiplier);
    let weightedCount = 0;
    for (const candidate of candidates) {
      if (candidate.multiplier > 1) {
        if (weightedCount < Number(maxWeightedConstraint.limit || 0)) {
          weightedCount++;
        } else {
          candidate.multiplier = 1;
          candidate.weightedScore = candidate.basePoints;
          candidate.isBestOfPool = false;
        }
      }
    }
  }

  const compulsoryConstraint = constraints.find((constraint) => constraint.type === "compulsory_subjects");
  if (compulsoryConstraint?.subjects) {
    for (const candidate of candidates) {
      candidate.isCompulsory = includesM12Aware(compulsoryConstraint.subjects, candidate.subject);
    }
  }

  const compulsoryPools = constraints.filter((constraint) => constraint.type === "compulsory_subject_pool");
  const selectedSubjects: CandidateScore[] = [];
  let totalScore = 0;
  let targetCount = getTargetCount(programme, year, constraints);

  for (const candidate of candidates.filter((candidate) => candidate.isCompulsory)) {
    candidate.used = true;
    selectedSubjects.push(candidate);
    totalScore += candidate.weightedScore;
  }

  for (const pool of compulsoryPools) {
    const poolCandidates = candidates
      .filter((candidate) => !candidate.used && includesM12Aware(pool.subjects || [], candidate.subject))
      .sort((a, b) => b.weightedScore - a.weightedScore);
    for (let index = 0; index < Math.min(Number(pool.count || 0), poolCandidates.length); index++) {
      if (selectedSubjects.length >= targetCount) break;
      const candidate = poolCandidates[index];
      candidate.used = true;
      selectedSubjects.push(candidate);
      totalScore += candidate.weightedScore;
    }
  }

  // When a programme uses the M1/M2 half-replacement rule (CUHK medicine, Note 4),
  // M1/M2 is NOT an elective subject — it must NOT be picked as one of the "Best N"
  // here, so it stays unused for the half-replacement step below (where it can only
  // upgrade the worst subject by half its value).
  const m1m2NotElective = constraints.some((constraint) => constraint.type === "m1m2_half_replacement");
  const isExtendedMath = (subject: string) =>
    subject.includes("Module 1") || subject.includes("Module 2") || subject === "Mathematics Extended Part (Module 1 or 2)";
  const remainingPotentials = candidates.filter((candidate) => !candidate.used).sort((a, b) => b.weightedScore - a.weightedScore);
  for (const candidate of remainingPotentials) {
    if (selectedSubjects.length >= targetCount) break;
    if (m1m2NotElective && isExtendedMath(candidate.subject)) continue;
    // HKUST: ApL never enters the Best-N — it stays unused so it can only feed the
    // 6th-subject bonus below (hkust_weighted_best).
    if (programme.apl_bonus_only && isCategoryBSubject(candidate.subject)) continue;
    const mathConstraint = constraints.find((constraint) => constraint.type === "maths_m1m2_as_one");
    if (mathConstraint && candidate.subject.includes("Mathematics") && selectedSubjects.some((subject) => subject.subject.includes("Mathematics"))) {
      continue;
    }
    candidate.used = true;
    selectedSubjects.push(candidate);
    totalScore += candidate.weightedScore;
  }

  let bonusCandidates = candidates.filter((candidate) => !candidate.used).sort((a, b) => b.weightedScore - a.weightedScore);
  const bonus6 = getBonusConstraint(constraints, "bonus_6th");
  if (bonus6 && selectedSubjects.length === 5) {
    let eligible = bonusCandidates;
    if (bonus6.polyu_style) {
      const gradeToVal: Record<string, number> = { "5**": 7, "5*": 6, "5": 5, "4": 4, "3": 3, "2": 2, "1": 1 };
      eligible = eligible.filter((candidate) => (gradeToVal[candidate.grade] || 0) >= 3);
    }
    const bonusSubject = eligible[0];
    if (bonusSubject) {
      const bonusPoints = bonusSubject.weightedScore * Number(bonus6.multiplier || 0);
      totalScore += bonusPoints;
      bonusSubject.used = true;
      bonusSubject.isBonus = true;
      bonusSubject.weightedScore = bonusPoints;
      bonusSubject.bonusValue = `+${bonus6.multiplier}x`;
      selectedSubjects.push(bonusSubject);
      bonusCandidates = bonusCandidates.filter((candidate) => candidate !== bonusSubject);
    }
  }

  const bonus7 = getBonusConstraint(constraints, "bonus_7th");
  if (bonus7 && selectedSubjects.length === 6) {
    const bonusSubject = bonusCandidates[0];
    if (bonusSubject) {
      const bonusPoints = bonusSubject.weightedScore * Number(bonus7.multiplier || 0);
      totalScore += bonusPoints;
      bonusSubject.used = true;
      bonusSubject.isBonus = true;
      bonusSubject.weightedScore = bonusPoints;
      bonusSubject.bonusValue = `+${bonus7.multiplier}x`;
      selectedSubjects.push(bonusSubject);
    }
  }

  const ustBonusConstraint = constraints.find((constraint) => constraint.type === "hkust_weighted_best");
  if (ustBonusConstraint && selectedSubjects.length === ustBonusConstraint.subject_count) {
    const bonusSubject = candidates.filter((candidate) => !candidate.used).sort((a, b) => b.basePoints - a.basePoints)[0];
    if (bonusSubject) {
      const bonusRate = Number(ustBonusConstraint.max_attainable_weighting || 5) * (Number(ustBonusConstraint.bonus_percentage || 5) / 100);
      const bonusPoints = bonusRate * bonusSubject.basePoints;
      totalScore += bonusPoints;
      bonusSubject.weightedScore = bonusPoints;
      bonusSubject.used = true;
      bonusSubject.isBonus = true;
      bonusSubject.bonusValue = `+${((bonusSubject.basePoints / UST_MAX_BASE_POINTS) * Number(ustBonusConstraint.bonus_percentage || 5)).toFixed(2)}% of total`;
      selectedSubjects.push(bonusSubject);
    }
  }

  const halfReplaceConstraint = constraints.find((constraint) => constraint.type === "m1m2_half_replacement");
  if (halfReplaceConstraint) {
    const unusedM12 = candidates
      .filter((candidate) => !candidate.used && (candidate.subject.includes("Module 1") || candidate.subject.includes("Module 2") || candidate.subject === "Mathematics Extended Part (Module 1 or 2)"))
      .sort((a, b) => b.weightedScore - a.weightedScore)[0];
    if (unusedM12) {
      const worstSubject = selectedSubjects.filter((subject) => !subject.isCompulsory && !subject.isBonus).sort((a, b) => a.weightedScore - b.weightedScore)[0];
      if (worstSubject) {
        const originalWorstScore = worstSubject.weightedScore;
        const halfReplacementScore = originalWorstScore / 2 + unusedM12.weightedScore / 2;
        if (halfReplacementScore > originalWorstScore) {
          totalScore = totalScore - originalWorstScore + halfReplacementScore;
          worstSubject.weightedScore = originalWorstScore / 2;
          worstSubject.bonusValue = "50% counted";
          unusedM12.used = true;
          unusedM12.weightedScore = unusedM12.weightedScore / 2;
          unusedM12.isBonus = true;
          unusedM12.bonusValue = "50% replacement";
          selectedSubjects.push(unusedM12);
        }
      }
    }
  }

  // ApL the student holds that this programme recognises but doesn't quantify
  // (CUHK advisory-only) — surfaced to the candidate as an advantage, never scored.
  const recognizedApL = programme.apl_advisory_only
    ? Object.entries(studentGrades)
        .filter(([subject, grade]) => grade && grade !== "U" && categoryBAdvisory(programme, subject))
        .map(([subject]) => subject)
    : [];

  return {
    totalScore: Number(totalScore.toFixed(3)),
    formula: programme[`formula_${year}`],
    selected: selectedSubjects,
    allCandidates: candidates,
    score_type: programme.scores_2025?.score_type || "actual",
    ...(recognizedApL.length ? { recognizedApL } : {}),
  };
}

// Derive the base subject count from the formula TEXT, for the institutions
// whose stored `formula_*_id` is unreliable. HKU writes additive formulas
// ("Eng + Best 5" = 6, "Best of Bio/Chem + Best 5" = 6, "2×Eng+2×Math+Best 4"
// = 6) and CityU writes "Best 4 subjects" (= 4) — yet both are stored as id
// "best5". The text is also per-year (HKU JS6602 is Best 4 in 2025 but Best 3
// in 2026), so parsing the year-specific text gets the count AND the year
// right. Returns null when the text doesn't clearly encode a count, so the
// caller falls back to the id-based logic (correct for CUHK/HKUST/PolyU/etc.).
function parseFormulaCount(formula: string, institution: string): number | null {
  if (!formula) return null;
  if (institution !== "HKU" && institution !== "CityUHK") return null;
  // Drop the bonus term ("+ 0.2 x 7th Best Subject"); it's added separately
  // by the bonus_6th/7th blocks and is not part of the base count.
  // Strip the ordinal bonus ("+ 0.2 x 7th Best Subject"). `Best\b[^+]*Subject`
  // tolerates OCR noise between the words (e.g. "0.5 x 6th Best a Subject") while
  // staying within the term, so a real trailing "Best Remaining Subject" (no
  // "x Nth" prefix) is NOT stripped and still counts.
  const f = formula.replace(/\+?\s*\d*\.?\d+\s*x\s*\d+(?:st|nd|rd|th)\s+Best\b[^+]*Subject/gi, " ");

  if (institution === "CityUHK") {
    const core = f.match(/(\d+)\s*core\s*\+\s*(\d+)\s*elective/i);
    if (core) return Number(core[1]) + Number(core[2]);
    const best = f.match(/Best\s+(\d+)\s+subjects?/i);
    return best ? Number(best[1]) : null;
  }

  // HKU: sum each "+"-separated term — a "Best N" pool contributes N, every
  // other term (a named/weighted subject, a "Best of …" pool, a "Best Sci
  // Subject", or a trailing "Best Subject") contributes 1.
  let total = 0;
  let matched = false;
  for (const raw of f.split("+")) {
    const t = raw.trim();
    if (!t) continue;
    const bestN = t.match(/Best\s+(\d+)\b/i);
    if (bestN) { total += Number(bestN[1]); matched = true; continue; }
    // A single-subject term: a "Best of …" pool, any "Best … Subject" (incl.
    // "Best Subject", "Best Remaining Subject", "Best Sci Subject"), or a named
    // subject. The subject regex has no trailing \b so it also matches the full
    // words "English"/"Mathematics"/"Chinese", not just "Eng"/"Math"/"Chin".
    if (/Best of /i.test(t) || /\bBest\b.*\bSubject\b/i.test(t) || /\b(Eng|Math|Chin|M1|M2)/i.test(t)) {
      total += 1; matched = true; continue;
    }
  }
  return matched && total >= 1 && total <= 8 ? total : null;
}

function getTargetCount(programme: Programme, year: "2025" | "2026", constraints: Constraint[]) {
  const formula = programme[`formula_${year}`] || "";
  // Primary: the per-year formula text (accurate where the id is too blunt).
  const parsed = parseFormulaCount(formula, programme.institution);
  if (parsed != null) return parsed;

  // Fallback: id-based logic (correct for CUHK/HKUST/PolyU/EdUHK/… whose ids
  // and "Best 5"/"Best 6" texts are reliable).
  const formulaId = programme[`formula_${year}_id`];
  const hasBonus6 = constraints.some((constraint) => constraint.type === "bonus_6th" || constraint.type === "additional_bonus_6th");
  // A `bonus_7th` programme counts SIX base subjects (the bonus is the 7th),
  // mirroring how `bonus_6th` forces 5.
  const hasBonus7 = constraints.some((constraint) => constraint.type === "bonus_7th");
  if (formulaId === "best4") return 4; // CityU "Best 4 subjects" (post-unify-fix id)
  if (formulaId === "best6" || hasBonus7) return 6;
  if (formulaId === "best5" || hasBonus6) return 5;
  if (formula.includes("Best 6") || formula.includes("3 Core + 3 Elective") || formula.includes("4 Core + 2 Elective")) return 6;
  return 5;
}

function getBonusConstraint(constraints: Constraint[], type: string): (Constraint & { polyu_style?: boolean }) | undefined {
  const constraint = constraints.find((item) => item.type === type);
  if (!constraint && type === "bonus_6th" && constraints.some((item) => item.type === "additional_bonus_6th")) {
    return { type, multiplier: 0.1, polyu_style: true };
  }
  return constraint;
}

export function checkEligibility(studentGrades: StudentGrades, reqs: MinRequirements, programme: Programme): EligibilityResult {
  const details: EligibilityDetail[] = [];
  let eligible = true;
  for (const key of ["chi", "eng", "math", "csd"] as const) {
    const studentGrade = studentGrades[mapReqKeyToSubject(key)];
    const reqGrade = reqs?.[key];
    const pass = compareGrades(studentGrade, reqGrade, programme);
    if (!pass) eligible = false;
    details.push({ label: key.toUpperCase(), pass, got: studentGrade || "N/A", need: reqGrade });
  }

  // Subjects that can never fill an elective slot: the three required cores and
  // CSD. CSD is "Attained"/"A" — not an elective — but its grade evaluates to 2,
  // so without this exclusion it could wrongly satisfy an "Any" pool at grade ≤2.
  const used = new Set([
    "Chinese Language",
    "English Language",
    "Mathematics (Compulsory Part)",
    "Citizenship and Social Development",
  ]);

  // Assign the student's spare subjects to the elective pools as a whole rather
  // than greedily one pool at a time. Greedy order lets an unconstrained "Any"
  // pool swallow a subject that a specific pool needs — e.g. JS4719 requires
  // [Any] + [M1/M2]; a candidate with one elective + M1/2 must put the elective
  // in "Any" and M1/2 in the M1/M2 slot. Bipartite matching finds that.
  const electiveDefs: Array<{ label: string; pool?: RequirementPool }> = [
    { label: "Elective 1", pool: reqs?.elect1 },
    { label: "Elective 2", pool: reqs?.elect2 },
  ];
  const definedPools = electiveDefs.map((e) => e.pool).filter((p): p is RequirementPool => !!p);
  const assigned = matchElectives(studentGrades, definedPools, used, programme);

  let poolIdx = 0;
  for (const def of electiveDefs) {
    if (!def.pool) {
      details.push({ label: def.label, pass: true, got: "N/A", need: "N/A" });
      continue;
    }
    const got = assigned[poolIdx++];
    const pass = got.length >= def.pool.count;
    if (!pass) eligible = false;
    details.push({
      label: def.label,
      pass,
      got: got.length > 0 ? (studentGrades[got[0]] as string) : "None",
      need: def.pool.grade,
      note: def.pool.note || def.pool.subjects.join("/") || "",
    });
  }

  return { eligible, details };
}

// Extra admission gate beyond the per-subject requirements, applied AFTER the
// score is computed (so it can test the total). Data-driven via
// `programme.extra_eligibility` — e.g. CUHK MBChB-GPS (JS4502): total ≥ 40 with
// 5** in any 4 subjects. Returns the eligibility result, failing it (and adding a
// detail row) when the gate isn't met.
export function applyExtraEligibility(
  result: EligibilityResult,
  programme: Programme,
  studentGrades: StudentGrades,
  totalScore: number,
): EligibilityResult {
  const rule = programme.extra_eligibility;
  if (!rule) return result;
  const topGrade = rule.top_grade || "5**";
  const topCount = Object.values(studentGrades).filter((g) => g === topGrade).length;
  const scoreOk = typeof rule.min_total !== "number" || totalScore >= rule.min_total;
  const topOk = typeof rule.min_top_grade_count !== "number" || topCount >= rule.min_top_grade_count;
  if (scoreOk && topOk) return result;
  const needParts: string[] = [];
  if (typeof rule.min_total === "number") needParts.push(`≥${rule.min_total}`);
  if (typeof rule.min_top_grade_count === "number") needParts.push(`${rule.min_top_grade_count}× ${topGrade}`);
  return {
    eligible: false,
    details: [
      ...result.details,
      { label: "Extra requirement", pass: false, got: `${totalScore.toFixed(1)}, ${topCount}× ${topGrade}`, need: needParts.join(" + ") },
    ],
  };
}

// Whether a student subject (at `grade`) can fill a slot of `pool`.
function electiveCanTake(pool: RequirementPool, subject: string, grade: string, programme: Programme) {
  let isMatch =
    pool.subjects.includes("Any") ||
    pool.subjects.includes("*") ||
    // "CategoryA" token: any Category A elective — by definition this EXCLUDES
    // M1/M2 (Extended Maths, not in the Cat A list) and Cat C/B subjects. Used
    // e.g. for HKBU's first elective ("must be Category A, excluding M1/M2").
    (pool.subjects.includes("CategoryA") && CAT_A_SET.has(canonicalSubject(subject))) ||
    includesM12Aware(pool.subjects, subject);
  if (!isMatch && pool.note?.includes("Category A") && (subject.includes("Module 1") || subject.includes("Module 2"))) {
    isMatch = true;
  }
  if (!isMatch) return false;
  // Applied Learning (Cat B): its own acceptance + level rule (not a DSE grade, so
  // it skips the numeric compareGrades below).
  if (isCategoryBSubject(subject)) return categoryBCanSatisfyElective(programme, subject, grade, pool);
  if (!categoryCCanSatisfyElective(programme, subject, grade, pool)) return false;
  return compareGrades(grade, pool.grade, programme, subject);
}

// Max bipartite matching of the student's spare subjects to the elective
// requirement pools. Each pool contributes `count` slots; every subject fills
// at most one slot. Returns, per pool (in input order), the subjects assigned
// to it — a pool is satisfied iff it receives `count` subjects. Solving this
// globally (vs greedily per pool) is what lets a constrained pool reserve the
// only subject that fits it, so a feasible assignment is always found when one
// exists (and the result is never worse than the old greedy pass).
function matchElectives(
  studentGrades: StudentGrades,
  pools: RequirementPool[],
  used: Set<string>,
  programme: Programme,
): string[][] {
  const subjects = Object.keys(studentGrades).filter(
    (s) => !used.has(s) && !s.includes(":subject"),
  );

  // Expand each pool into `count` slots, then build slot → eligible-subject adjacency.
  const slotPool: number[] = [];
  pools.forEach((pool, pi) => {
    for (let i = 0; i < Math.max(0, pool.count || 0); i++) slotPool.push(pi);
  });
  const adj: number[][] = slotPool.map((pi) =>
    subjects
      .map((s, si) => (electiveCanTake(pools[pi], s, studentGrades[s] as string, programme) ? si : -1))
      .filter((si) => si >= 0),
  );

  // Kuhn's algorithm. Most-constrained slots first → deterministic max matching.
  const subjToSlot = new Array<number>(subjects.length).fill(-1);
  const slotToSubj = new Array<number>(slotPool.length).fill(-1);
  const augment = (slot: number, seen: boolean[]): boolean => {
    for (const si of adj[slot]) {
      if (seen[si]) continue;
      seen[si] = true;
      if (subjToSlot[si] === -1 || augment(subjToSlot[si], seen)) {
        subjToSlot[si] = slot;
        slotToSubj[slot] = si;
        return true;
      }
    }
    return false;
  };
  const order = slotPool.map((_, k) => k).sort((a, b) => adj[a].length - adj[b].length);
  for (const slot of order) augment(slot, new Array<boolean>(subjects.length).fill(false));

  const perPool: string[][] = pools.map(() => []);
  slotToSubj.forEach((si, slot) => {
    if (si >= 0) perPool[slotPool[slot]].push(subjects[si]);
  });
  return perPool;
}

function compareGrades(student: string | undefined, required: string | undefined, programme: Programme, subject?: string) {
  if (!required) return true;
  if (!student) return false;
  const convTable = programme.score_conversion_table.category_a || {};
  const catCTable = programme.score_conversion_table.category_c || {};
  const val = (grade: string) => {
    const normalized = String(grade).toUpperCase();
    // Only map ACTUAL Category C grades (A–E / C2 / N1 / …) through the Cat C
    // points policy. The required side is a numeric DSE level (e.g. "3"); routing
    // that through the Cat C function returns 0, which would let any Cat C pass
    // satisfy even a Level-4/5 elective. Letting the numeric required fall through
    // to the conversion table keeps both sides on the same point scale, so a Cat C
    // grade's institution-mapped points are compared against the real level.
    if (subject && isCategoryCSubject(subject) && isCategoryCGrade(normalized)) return categoryCBasePoints(programme, subject, normalized, catCTable) ?? 0;
    // "Attained" (CSD) is a pass/fail requirement, not a scored grade. The
    // scoring table maps "A"/"attained" to 0 points (correct for scoring), so it
    // MUST resolve to a pass-value here — before the table — otherwise a required
    // "A" reads as 0, a student "U" also reads as 0, and 0 >= 0 wrongly passes an
    // unattained CSD as eligible.
    if (normalized === "A" || normalized === "ATTAINED") return 2;
    if (convTable[normalized] !== undefined) return convTable[normalized];
    if (catCTable[normalized] !== undefined) return catCTable[normalized];
    return Number.parseFloat(normalized) || 0;
  };
  return val(student) >= val(required);
}

function mapReqKeyToSubject(key: "chi" | "eng" | "math" | "csd") {
  return {
    chi: "Chinese Language",
    eng: "English Language",
    math: "Mathematics (Compulsory Part)",
    csd: "Citizenship and Social Development",
  }[key];
}
