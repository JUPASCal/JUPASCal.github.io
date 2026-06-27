// Category B — Applied Learning (ApL). Mirrors categoryC.ts, but simpler: every
// institution we've checked (PolyU + HKUST calculators explicitly; LingU by probe)
// uses the SAME conversion — Attained with Distinction (II) → DSE Level 4, (I) →
// Level 3, bare "Attained" → not credited (0). So we don't need a per-institution
// ApL points scale; we score ApL through each programme's OWN Cat-A conversion
// table at the equivalent level. Per-PROGRAMME differences live in
// `programme.apl_policy` (which ApL subjects an elective accepts), emitted by unify.
import type { Programme, RequirementPool } from "../types/jupas";
import { APL_GRADES, CAT_B_SUBJECTS } from "./subjects";

const CAT_B_SET = new Set(CAT_B_SUBJECTS);

// ApL result level (upper-cased) → equivalent DSE level for the score conversion.
// null = "Attained" (bare pass), not credited by any institution measured.
const APL_LEVEL_EQUIV: Record<string, "3" | "4" | null> = {
  "ATTAINED WITH DISTINCTION (II)": "4",
  "ATTAINED WITH DISTINCTION (I)": "3",
  "ATTAINED": null,
};

export function isCategoryBSubject(subject: string): boolean {
  return CAT_B_SET.has(subject);
}

function normalizeApLGrade(grade: string): string {
  return (grade || "").trim().toUpperCase();
}

export function isCategoryBGrade(grade: string): boolean {
  return normalizeApLGrade(grade) in APL_LEVEL_EQUIV;
}

// Map any casing/spacing of an ApL result back to its canonical APL_GRADES form
// (the exact string the grade buttons compare against). undefined if not an ApL
// result. Used to keep stored/shared ApL grades aligned with the UI options.
export function canonicalCategoryBGrade(grade: string): string | undefined {
  const norm = normalizeApLGrade(grade);
  return APL_GRADES.find((g) => g.toUpperCase() === norm);
}

// Base points for an ApL subject at `grade` for this programme: the programme's
// Cat-A conversion value for the equivalent DSE level (Dist II → L4, Dist I → L3),
// or 0 for "Attained" / unknown. undefined when `subject` isn't an ApL subject.
export function categoryBBasePoints(programme: Programme, subject: string, grade: string): number | undefined {
  if (!isCategoryBSubject(subject)) return undefined;
  const level = APL_LEVEL_EQUIV[normalizeApLGrade(grade)];
  if (!level) return 0; // "Attained" (null) or unknown grade → not credited
  return programme.score_conversion_table.category_a?.[level] ?? 0;
}

// True unless the programme ignores ApL entirely (apl_policy === "none").
export function acceptsCategoryB(programme: Programme): boolean {
  return programme.apl_policy !== "none";
}

// Whether THIS ApL subject is considered by the programme (so it's scored and may
// count toward the best-N). "any" → all ApL; a list → only the listed subjects;
// undefined / "none" → none.
export function categoryBAccepted(programme: Programme, subject: string): boolean {
  if (!isCategoryBSubject(subject)) return false;
  const policy = programme.apl_policy;
  if (!policy || policy === "none") return false;
  if (policy === "any") return true;
  return Array.isArray(policy) && policy.includes(subject);
}

// Whether an ApL subject (at `grade`) may FILL an elective slot. Data-driven via
// `programme.apl_policy`:
//   undefined / "none" → ApL can't satisfy an elective here
//   "any"              → any ApL subject may (at ≥ Distinction)
//   string[]           → only the listed ApL subjects may (e.g. PolyU per-programme)
// ApL needs ≥ "Attained with Distinction (I)" (DSE Level 3) to count — bare
// "Attained" never satisfies an elective requirement.
export function categoryBCanSatisfyElective(
  programme: Programme,
  subject: string,
  grade: string,
  pool: RequirementPool,
): boolean {
  if (!isCategoryBSubject(subject)) return true; // not an ApL subject — not our concern
  const policy = programme.apl_policy;
  if (!policy || policy === "none") return false;
  if (Array.isArray(policy) && !policy.includes(subject)) return false;
  const level = APL_LEVEL_EQUIV[normalizeApLGrade(grade)];
  if (level !== "3" && level !== "4") return false; // bare Attained / unknown → not enough
  // The ApL's equivalent DSE level must meet the pool's required grade.
  const need = Number(pool.grade);
  return Number.isNaN(need) || Number(level) >= need;
}
