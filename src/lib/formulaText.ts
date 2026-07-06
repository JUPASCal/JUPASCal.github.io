// Standardized, bilingual formula description generated from the STRUCTURED model
// (formula id + compulsory subjects/pools + per-subject weights + bonus
// constraints) rather than the raw scraped string. The raw string is kept only as
// a fallback for the handful of bespoke formulas the model can't express, and as a
// muted "Official: …" secondary line for transparency. See the DetailPanel usage.
//
// Why generate instead of clean the raw text: the count is already normalized
// (formula_*_id) and the nuance already lives in calculation_constraints /
// subject_weights, so the display rides on the same fields the calculator + the
// validator already maintain — the annual data refresh no longer needs raw-text
// polishing, and 中文 is produced properly (the raw strings are English-only).
import type { Lang, Translate } from "./i18n";
import { localizedShortSubject } from "./subjectsI18n";
import type { Constraint, Programme } from "../types/jupas";

const FORMULA_N: Record<string, number> = { best4: 4, best5: 5, best6: 6, best7: 7 };

// Markers in the raw formula text that mean the structured model can't faithfully
// reconstruct it — keep the institution's wording instead. "better of" is the
// HKUST option-A/B formulas; the rest are leftover footnote codes.
const BESPOKE_RAW = /better of|Best\(|with WEIGHTING|[#^~]/i;

// Constraint types that make a formula unexpressible by the generator.
const UNMODELED = new Set(["m1m2_half_replacement"]);

export type FormulaDescription = { text: string; raw: string | null; showOfficial: boolean };

export function describeFormula(
  programme: Programme,
  year: "2025" | "2026",
  lang: Lang,
  t: Translate
): FormulaDescription {
  const raw = (year === "2025" ? programme.formula_2025 : programme.formula_2026) ?? null;
  const rawStr = (raw ?? "").trim();
  const fid = year === "2025" ? programme.formula_2025_id : programme.formula_2026_id;
  const constraints: Constraint[] = programme.calculation_constraints ?? [];

  const N = fid ? FORMULA_N[fid] : undefined;
  const unmodeled = constraints.some((c) => UNMODELED.has(c.type));

  // Fallback: keep the raw wording when we can't faithfully build the description.
  if (!N || unmodeled || (rawStr && BESPOKE_RAW.test(rawStr))) {
    return { text: rawStr || t("detail.formulaNA"), raw: null, showOfficial: false };
  }

  // Named compulsory parts: fixed cores, then "best k of …" pools. Weights are
  // deliberately NOT shown here — the headline conveys STRUCTURE only (which
  // subjects + how many); every subject's ×weight lives in the "Weighting details"
  // rows below, so cores and electives are treated consistently and nothing is
  // duplicated between the headline and the rows.
  const cores = constraints.find((c) => c.type === "compulsory_subjects")?.subjects ?? [];
  const pools = constraints.filter((c) => c.type === "compulsory_subject_pool");

  const parts: string[] = [];
  for (const subj of cores) {
    parts.push(localizedShortSubject(subj, lang));
  }
  let poolCount = 0;
  for (const pool of pools) {
    const count = Number(pool.count ?? 1);
    poolCount += count;
    const subs = (pool.subjects ?? []).map((s) => localizedShortSubject(s, lang)).join("/");
    parts.push(t("detail.formulaGen.bestOfPool", { count, subjects: subs }));
  }

  const remaining = N - (cores.length + poolCount);

  let text: string;
  if (parts.length) {
    const joined = parts.join(" + ");
    text =
      remaining > 0
        ? t("detail.formulaGen.coresPlusRest", { cores: joined, remaining })
        : t("detail.formulaGen.coresOnly", { cores: joined });
  } else {
    text = t(`detail.formulaId.best${N}`);
  }

  // Bonus-subject suffix (7th takes precedence over 6th when both somehow present).
  // HKUST models its extra 6th-subject bonus as `hkust_weighted_best` (a % of the
  // max attainable weighting applied to the best remaining subject) rather than a
  // plain bonus_6th, so surface that in the headline too — otherwise HKUST's
  // "+ 6th-subject bonus" would be invisible in the generated formula.
  let hasBonus = false;
  const hasHkust6th = constraints.some(
    (c) => c.type === "hkust_weighted_best" && (c.bonus_percentage ?? 0) > 0
  );
  if (constraints.some((c) => c.type === "bonus_7th")) {
    text += t("detail.formulaGen.bonus7");
    hasBonus = true;
  } else if (
    hasHkust6th ||
    constraints.some((c) => c.type === "bonus_6th" || c.type === "additional_bonus_6th")
  ) {
    text += t("detail.formulaGen.bonus6");
    hasBonus = true;
  }

  // Show the official wording underneath EXCEPT when the generated text adds
  // nothing over it — i.e. a plain "Best N" whose raw is just a phrasing variant
  // ("Best 5" / "Any Best 5 Subjects"). This check is language-neutral (compares
  // the raw English against the structure, never the localized text), so 中文
  // suppresses the redundant line too. Anything with cores/pools/bonus, or a raw
  // that says more than "best N" (e.g. JS6107 "Best of Bio/Chem + Best 5"), keeps it.
  const plain = parts.length === 0 && !hasBonus;
  const rawIsPlainBestN = new RegExp(`^(any\\s+)?best\\s*${N}\\s*(subjects?)?$`, "i").test(rawStr);
  const showOfficial = !!rawStr && !(plain && rawIsPlainBestN);
  return { text, raw: rawStr || null, showOfficial };
}
