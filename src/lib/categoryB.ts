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

// The DSE level an ApL `grade` is worth for SCORING at this programme. Dist II→4,
// Dist I→3 universally; bare "Attained" → 2 only where the programme credits it
// (apl_min_level === "attained", i.e. HKMU), else not credited. null = no score.
function categoryBScoreLevel(programme: Programme, grade: string): string | null {
  const norm = normalizeApLGrade(grade);
  const level = APL_LEVEL_EQUIV[norm];
  if (level) return level;
  if (norm === "ATTAINED") {
    if (programme.apl_min_level === "attained") return "2"; // HKMU
    if (programme.apl_min_level === "l3") return "3"; // LingnanU (Attained ≡ L3)
  }
  return null;
}

// Base points for an ApL subject at `grade` for this programme: the programme's
// Cat-A conversion value for the equivalent DSE level. undefined when `subject`
// isn't an ApL subject.
export function categoryBBasePoints(programme: Programme, subject: string, grade: string): number | undefined {
  if (!isCategoryBSubject(subject)) return undefined;
  const level = categoryBScoreLevel(programme, grade);
  if (!level) return 0; // not credited (bare "Attained" where unaccepted / unknown)
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
//   "any"              → any ApL subject may
//   string[]           → only the listed ApL subjects may (PolyU/CUHK per-programme)
// The attainment floor follows apl_min_level: "dist1" (default) needs ≥ Attained
// with Distinction (I) (DSE L3); "attained" (HKMU) also accepts bare "Attained"
// (worth L2). The ApL's equivalent DSE level must then meet the pool's grade.
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
  const level = categoryBScoreLevel(programme, grade);
  if (!level) return false; // below the programme's floor / unknown grade
  const need = Number(pool.grade);
  return Number.isNaN(need) || Number(level) >= need;
}
