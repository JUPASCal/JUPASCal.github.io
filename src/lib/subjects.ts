// Canonical subject vocabulary — SINGLE SOURCE OF TRUTH shared with the Python
// data pipeline. The same file is read by unify_2026_data.py / validate_unified.py
// so the subjects the UI offers can never drift from the subjects stored in the
// unified data (a drift that silently breaks exact-match eligibility). To add a
// subject or institutional spelling, edit data/raw/subjects.canonical.json.
import registry from "../../data/raw/subjects.canonical.json";

export const CORE_SUBJECTS = registry.core as string[];

export const M12_SUBJECT = registry.math_extended.combined as string;

export const CAT_A_SUBJECTS = registry.category_a as string[];

export const CAT_C_SUBJECTS = registry.category_c as string[];

// Category B — Applied Learning (ApL) subjects.
export const CAT_B_SUBJECTS = (registry as { category_b?: string[] }).category_b ?? [];

// alias spelling -> canonical, and one canonical name -> its family members
// (M1/M2, Combined Science). Used by the eligibility matcher to compare subject
// names robustly even if a non-canonical value ever slips through.
export const SUBJECT_ALIASES = registry.aliases as Record<string, string>;
export const SUBJECT_EXPANSIONS = registry.expansions as Record<string, string[]>;

/** Resolve any alias spelling to its canonical subject name (identity if none). */
export function canonicalSubject(name: string): string {
  return SUBJECT_ALIASES[name] ?? name;
}

export const DSE_GRADES = ["", "5**", "5*", "5", "4", "3", "2", "1", "U"];
export const CSD_GRADES = ["", "A", "U"];
export const CAT_C_GRADES = ["", "A", "B", "C", "D", "E", "U"];
// Applied Learning (Cat B) result levels, best → worst. "Attained" is the bare
// pass; the two Distinction tiers map to DSE Level 3 / 4 (see categoryB.ts).
export const APL_GRADES = ["", "Attained with Distinction (II)", "Attained with Distinction (I)", "Attained", "U"];

const SUBJECT_SHORT_NAMES: Record<string, string> = {
  "Chinese Language": "Chinese",
  "English Language": "English",
  "Mathematics (Compulsory Part)": "Math",
  "Technology and Living (Food Science and Technology)": "T&L (Food)",
  "Technology and Living (Fashion, Clothing and Textiles)": "T&L (Fashion)",
  "Mathematics Extended Part (Module 1 or 2)": "M1/M2",
  "Mathematics Extended Part (Module 1)": "M1",
  "Mathematics Extended Part (Module 2)": "M2",
  "Citizenship and Social Development": "CSD",
  "Business, Accounting and Financial Studies": "BAFS",
  "Information and Communication Technology": "ICT",
  "French: Advanced Diploma of French Language Studies / Diploma of French Language Studies": "French",
  "German: Goethe-Certificate": "German",
  "Japanese: Japanese-Language Proficiency Test": "Japanese",
  "Korean: Test of Proficiency in Korean II": "Korean",
  "Spanish: Diploma of Spanish as a Foreign Language": "Spanish",
  "Urdu: Urdu (International)": "Urdu",
};

export function shortSubjectName(subject: string) {
  return SUBJECT_SHORT_NAMES[subject] || subject;
}

// Ultra-compact chip label for narrow contexts like the grade-summary
// pills in the panel heading. Kept distinct from `shortSubjectName`
// (which still surfaces fuller forms like "Biology" in audit rows /
// eligibility detail where horizontal room isn't a problem).
const SUBJECT_CHIP_NAMES: Record<string, string> = {
  // Cat A – 3-4 char abbreviations recognisable to DSE students.
  "Biology": "Bio",
  "Chemistry": "Chem",
  "Physics": "Phys",
  "Economics": "Econ",
  "Geography": "Geog",
  "History": "Hist",
  "Chinese History": "CHis",
  "Information and Communication Technology": "ICT",
  "Business, Accounting and Financial Studies": "BAFS",
  "Design and Applied Technology": "DAT",
  "Health Management and Social Care": "HMSC",
  "Tourism and Hospitality Studies": "THS",
  "Chinese Literature": "CLit",
  "Literature in English": "ELit",
  "Technology and Living (Food Science and Technology)": "T&L",
  "Technology and Living (Fashion, Clothing and Textiles)": "T&L(F)",
  "Visual Arts": "VA",
  "Music": "Mus",
  "Physical Education": "PE",
  "Ethics and Religious Studies": "ERS",
  "Integrated Science": "ISci",
  "Combined Science: Biology + Chemistry": "B+C",
  "Combined Science: Biology + Physics": "B+P",
  "Combined Science: Physics + Chemistry": "P+C",
  // Maths + CSD share the same tight chip form as their existing
  // short names – pre-populated here so callers can use one helper
  // for both core and elective slots.
  "Mathematics (Compulsory Part)": "Math",
  "Mathematics Extended Part (Module 1 or 2)": "M1/2",
  "Citizenship and Social Development": "CSD",
};

export function subjectChipName(subject: string): string {
  return SUBJECT_CHIP_NAMES[subject] || shortSubjectName(subject);
}
