import type { Programme, RequirementPool } from "../types/jupas";
import { CAT_C_SUBJECTS } from "./subjects";

type CatCLanguage = "french" | "german" | "spanish" | "japanese" | "korean" | "urdu";
type GradePoints = Partial<Record<string, number>>;
type Policy = Partial<Record<CatCLanguage, GradePoints>>;

const CAT_C_SET = new Set(CAT_C_SUBJECTS);
const LEVEL_OPTIONS: Record<CatCLanguage, string[]> = {
  french: ["C2", "C1", "B2", "B1", "A2"],
  german: ["C2", "C1", "B2", "B1", "A2"],
  spanish: ["C2", "C1", "B2", "B1", "A2"],
  japanese: ["N1", "N2", "N3"],
  korean: ["Grade 6", "Grade 5", "Grade 4", "Grade 3"],
  urdu: ["A++", "A+", "A", "B++", "B+", "B", "C", "D", "E"],
};
const BROAD_TO_EXACT: Record<CatCLanguage, Record<string, string>> = {
  french: { A: "C2", B: "C1", C: "B2", D: "B1", E: "A2" },
  german: { A: "C2", B: "C1", C: "B2", D: "B1", E: "A2" },
  spanish: { A: "C2", B: "C1", C: "B2", D: "B1", E: "A2" },
  japanese: { A: "N1", B: "N2", C: "N3" },
  korean: { A: "Grade 6", B: "Grade 5", C: "Grade 4", D: "Grade 3" },
  urdu: { A: "A", B: "B++", C: "B", D: "C", E: "D" },
};

const POLICIES: Record<string, Policy> = {
  CityUHK: {
    japanese: { N1: 7, N2: 5.5, N3: 4 },
    korean: { "GRADE 6": 7, "GRADE 5": 5.5, "GRADE 4": 4, "GRADE 3": 3 },
    french: { C2: 7, C1: 5.5, B2: 4, B1: 3, A2: 3 },
    german: { C2: 7, C1: 5.5, B2: 4, B1: 3, A2: 3 },
    spanish: { C2: 7, C1: 5.5, B2: 4, B1: 3, A2: 3 },
    urdu: { "A++": 7, "A+": 7, A: 7, "B++": 5.5, "B+": 5.5, B: 4, C: 4, D: 3, E: 3 },
  },
  HKBU: {
    japanese: { N1: 7, N2: 5.5, N3: 4 },
    korean: { "GRADE 6": 7, "GRADE 5": 5.5, "GRADE 4": 5.5, "GRADE 3": 4 },
    french: { C2: 7, C1: 7, B2: 5.5, B1: 5.5, A2: 4 },
    german: { C2: 7, C1: 7, B2: 5.5, B1: 5.5, A2: 4 },
    spanish: { C2: 7, C1: 7, B2: 5.5, B1: 5.5, A2: 4 },
    urdu: { "A++": 7, "A+": 7, A: 7, "B++": 5.5, "B+": 4, B: 4, C: 2.5, D: 2.5, E: 1 },
  },
  PolyU: {
    japanese: { N1: 8.5, N2: 5.5, N3: 3 },
    korean: { "GRADE 6": 8.5, "GRADE 5": 7, "GRADE 4": 4, "GRADE 3": 3 },
    french: { C2: 8.5, C1: 7, B2: 5.5, B1: 4, A2: 3 },
    german: { C2: 8.5, C1: 7, B2: 5.5, B1: 4, A2: 3 },
    spanish: { C2: 8.5, C1: 7, B2: 5.5, B1: 4, A2: 3 },
  },
  CUHK: {
    japanese: { N1: 7, N2: 5.5, N3: 4 },
    korean: { "GRADE 6": 7, "GRADE 5": 5.5, "GRADE 4": 4, "GRADE 3": 3 },
    french: { C2: 7, C1: 5.5, B2: 4, B1: 3, A2: 3 },
    german: { C2: 7, C1: 5.5, B2: 4, B1: 3, A2: 3 },
    spanish: { C2: 7, C1: 5.5, B2: 4, B1: 3, A2: 3 },
    urdu: { "A++": 7, "A+": 7, A: 7, "B++": 5.5, "B+": 5.5, B: 5.5, C: 4, D: 3, E: 3 },
  },
  HKUST: {
    japanese: { N1: 8.5, N2: 5.5, N3: 3 },
    korean: { "GRADE 6": 8.5, "GRADE 5": 5.5, "GRADE 4": 4, "GRADE 3": 3 },
    french: { C2: 8.5, C1: 7, B2: 5.5, B1: 4, A2: 3 },
    german: { C2: 8.5, C1: 7, B2: 5.5, B1: 4, A2: 3 },
    spanish: { C2: 8.5, C1: 7, B2: 5.5, B1: 4, A2: 3 },
    urdu: { "A++": 8.5, "A+": 7, A: 7, "B++": 5.5, "B+": 4, B: 3, C: 3, D: 2, E: 1 },
  },
  HKU: {
    japanese: { N1: 8.5, N2: 7, N3: 4 },
    korean: { "GRADE 6": 8.5, "GRADE 5": 7, "GRADE 4": 5.5, "GRADE 3": 4 },
    french: { C2: 8.5, C1: 8.5, B2: 7, B1: 5.5, A2: 4 },
    german: { C2: 8.5, C1: 8.5, B2: 7, B1: 5.5, A2: 4 },
    spanish: { C2: 8.5, C1: 8.5, B2: 7, B1: 5.5, A2: 4 },
    urdu: { "A++": 8.5, "A+": 8.5, A: 8.5, "B++": 7, "B+": 5.5, B: 4, C: 3, D: 2, E: 1 },
  },
  LingnanU: {
    japanese: { N1: 7, N2: 5, N3: 4 },
    korean: { "GRADE 6": 7, "GRADE 5": 6, "GRADE 4": 5, "GRADE 3": 4 },
    french: { C2: 7, C1: 7, B2: 6, B1: 5, A2: 4 },
    german: { C2: 7, C1: 7, B2: 6, B1: 5, A2: 4 },
    spanish: { C2: 7, C1: 7, B2: 6, B1: 5, A2: 4 },
    urdu: { "A++": 7, "A+": 7, A: 7, "B++": 6, "B+": 5, B: 4 },
  },
  EdUHK: {
    japanese: { N1: 7, N2: 5, N3: 4 },
    korean: { "GRADE 6": 7, "GRADE 5": 6, "GRADE 4": 5, "GRADE 3": 4 },
    french: { C2: 7, C1: 6, B2: 5, B1: 4, A2: 3 },
    german: { C2: 7, C1: 6, B2: 5, B1: 4, A2: 3 },
    spanish: { C2: 7, C1: 6, B2: 5, B1: 4, A2: 3 },
    urdu: { "A++": 7, "A+": 7, A: 7, "B++": 6, "B+": 5, B: 5, C: 4, D: 3, E: 2 },
  },
};

const HKMU_STYLE: Policy = {
  japanese: { N1: 7, N2: 5, N3: 4 },
  korean: { "GRADE 6": 7, "GRADE 5": 6, "GRADE 4": 5, "GRADE 3": 4 },
  french: { C2: 7, C1: 6, B2: 5, B1: 4, A2: 3 },
  german: { C2: 7, C1: 6, B2: 5, B1: 4, A2: 3 },
  spanish: { C2: 7, C1: 6, B2: 5, B1: 4, A2: 3 },
  urdu: { "A++": 7, "A+": 7, A: 7, "B++": 6, "B+": 5, B: 5, C: 4, D: 3, E: 2 },
};

const SSSDP_SCORE_POLICIES: Record<string, Policy> = {
  JSSU: HKMU_STYLE,
  JSSA: HKMU_STYLE,
  JSSV: HKMU_STYLE,
  JSST: HKMU_STYLE,
};

const ELECTIVE_THRESHOLDS: Record<string, Partial<Record<CatCLanguage, string>>> = {
  // Shue Yan: specified levels are counted as Level 2 for best-five scoring.
  JSSY: { japanese: "N2", korean: "Grade 4", french: "B2", german: "B2", spanish: "B2", urdu: "C" },
  JSSC: { japanese: "N3", korean: "Grade 3", french: "A2", german: "A2", spanish: "A2", urdu: "E" },
  JSSH: { japanese: "N3", korean: "Grade 3", french: "A2", german: "A2", spanish: "A2", urdu: "E" },
  JSSW: { japanese: "N3", korean: "Grade 3", french: "A2", german: "A2", spanish: "A2", urdu: "E" },
};

const SHUE_YAN_LEVEL_2_POLICY: Policy = {
  japanese: { N1: 2, N2: 2 },
  korean: { "GRADE 6": 2, "GRADE 5": 2, "GRADE 4": 2 },
  french: { C2: 2, C1: 2, B2: 2 },
  german: { C2: 2, C1: 2, B2: 2 },
  spanish: { C2: 2, C1: 2, B2: 2 },
  urdu: { "A++": 2, "A+": 2, A: 2, "B++": 2, "B+": 2, B: 2, C: 2 },
};

for (const policy of [...Object.values(POLICIES), HKMU_STYLE, SHUE_YAN_LEVEL_2_POLICY]) {
  addLegacyBroadAliases(policy);
}

export function isCategoryCSubject(subject: string): boolean {
  return CAT_C_SET.has(subject);
}

export function categoryCLevelOptions(subject: string): string[] {
  const language = categoryCLanguage(subject);
  return language ? LEVEL_OPTIONS[language] : [];
}

export function normalizeCategoryCGrade(grade: string): string | undefined {
  const raw = String(grade || "").trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  for (const options of Object.values(LEVEL_OPTIONS)) {
    const match = options.find((option) => option.toUpperCase() === upper);
    if (match) return match;
  }
  if (["A", "B", "C", "D", "E", "U"].includes(upper)) return upper;
  return undefined;
}

export function isCategoryCGrade(grade: string): boolean {
  return normalizeCategoryCGrade(grade) !== undefined;
}

export function categoryCBasePoints(
  programme: Programme,
  subject: string,
  grade: string,
  fallbackTable: Record<string, number> = {},
): number | undefined {
  if (!isCategoryCSubject(subject)) return undefined;
  const language = categoryCLanguage(subject);
  const normalized = normalizeGradeForLookup(grade);
  if (!language || !normalized || normalized === "U") return 0;

  const policy = scorePolicyFor(programme);
  const languagePolicy = policy?.[language];
  if (languagePolicy) return languagePolicy[normalized] ?? 0;
  return fallbackTable[normalized] ?? 0;
}

// Category C acceptance is DATA-DRIVEN via `programme.category_c_policy`, emitted
// by unify's single curated table (see CURATED_PROGRAMME_RULES in
// unify_2026_data.py) — no hardcoded JS-code list lives in the runtime anymore.
//   "none"                – Cat C ignored entirely (eligibility + scoring); e.g.
//                           HKBU JS2620/2110/2120/2410/2420.
//   "elective_cat_a_only" – Cat C can't satisfy an elective (Cat-A-only electives);
//                           e.g. CUHK JS4550/4601/4648/4719.
// See docs/manuals/CATEGORY_C_LANGUAGE_RULES.md.

// True unless the programme ignores Category C languages entirely. Used by the
// calculator to drop Cat C subjects from the scoring candidates.
export function acceptsCategoryC(programme: Programme): boolean {
  return programme.category_c_policy !== "none";
}

export function categoryCCanSatisfyElective(
  programme: Programme,
  subject: string,
  grade: string,
  pool: RequirementPool,
): boolean {
  if (!isCategoryCSubject(subject)) return true;
  if (programme.category_c_policy === "none" || programme.category_c_policy === "elective_cat_a_only") return false;
  const note = pool.note?.toLowerCase() || "";
  if (note.includes("except") && (note.includes("other language") || note.includes("category c"))) return false;

  const language = categoryCLanguage(subject);
  const normalized = normalizeCategoryCGrade(grade);
  if (!language || !normalized || normalized === "U") return false;

  const threshold = electiveThresholdFor(programme)?.[language];
  if (threshold && !meetsLevelThreshold(language, normalized, threshold)) return false;

  const points = categoryCBasePoints(programme, subject, normalized, programme.score_conversion_table.category_c || {});
  return points !== undefined && points > 0;
}

function scorePolicyFor(programme: Programme): Policy | undefined {
  if (programme.institution === "HKMU") return HKMU_STYLE;
  if (programme.institution !== "SSSDP") return POLICIES[programme.institution];
  if (programme.jupas_code.startsWith("JSSY")) return SHUE_YAN_LEVEL_2_POLICY;
  for (const [prefix, policy] of Object.entries(SSSDP_SCORE_POLICIES)) {
    if (programme.jupas_code.startsWith(prefix)) return policy;
  }
  return undefined;
}

function electiveThresholdFor(programme: Programme): Partial<Record<CatCLanguage, string>> | undefined {
  if (programme.institution === "SSSDP") {
    for (const [prefix, threshold] of Object.entries(ELECTIVE_THRESHOLDS)) {
      if (programme.jupas_code.startsWith(prefix)) return threshold;
    }
  }
  return undefined;
}

function categoryCLanguage(subject: string): CatCLanguage | undefined {
  if (subject.startsWith("French:")) return "french";
  if (subject.startsWith("German:")) return "german";
  if (subject.startsWith("Spanish:")) return "spanish";
  if (subject.startsWith("Japanese:")) return "japanese";
  if (subject.startsWith("Korean:")) return "korean";
  if (subject.startsWith("Urdu:")) return "urdu";
  return undefined;
}

function normalizeGradeForLookup(grade: string): string {
  const normalized = normalizeCategoryCGrade(grade);
  return normalized ? normalized.toUpperCase() : String(grade || "").trim().toUpperCase();
}

function addLegacyBroadAliases(policy: Policy): void {
  for (const [language, map] of Object.entries(policy) as Array<[CatCLanguage, GradePoints | undefined]>) {
    if (!map) continue;
    const aliases = BROAD_TO_EXACT[language];
    for (const [broad, exact] of Object.entries(aliases)) {
      const score = map[exact.toUpperCase()];
      if (score !== undefined && map[broad] === undefined) map[broad] = score;
    }
  }
}

function meetsLevelThreshold(language: CatCLanguage, grade: string, threshold: string): boolean {
  const order = LEVEL_OPTIONS[language].map((item) => item.toUpperCase());
  const gradeIndex = order.indexOf(resolveGradeForLanguage(language, grade));
  const thresholdIndex = order.indexOf(normalizeGradeForLookup(threshold));
  if (gradeIndex < 0 || thresholdIndex < 0) return false;
  return gradeIndex <= thresholdIndex;
}

function resolveGradeForLanguage(language: CatCLanguage, grade: string): string {
  const normalized = normalizeGradeForLookup(grade);
  const broad = BROAD_TO_EXACT[language][normalized];
  return broad ? broad.toUpperCase() : normalized;
}
