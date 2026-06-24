import { getScoreBand, getSlotRisk, A_SLOT_COUNT, FEW_QUOTA } from "./analysis";
import { effectiveBenchmarks } from "./results";
import type { ProgrammeResult } from "../types/jupas";

// Alternative / safety programme suggestions.
//
// During a teacher consultation, for the student's risky Band-A picks, surface
// programmes in a SIMILAR DIRECTION (same faculty or discipline keywords) that
// the student is MORE LIKELY to get into (eligible + at/above the programme's
// own median, ideally above its UQ). These are realistic safety options the
// student could add — never a replacement for the calculation, just a prompt.
//
// Pure function (no React / i18n) so it can be unit-fuzzed by a Node harness,
// mirroring analyzePortfolio. It consumes the already-computed `allResults`
// (the worker scores every programme for the current grades) so there's no
// recompute here.

// A_SLOT_COUNT (Band-A size) and FEW_QUOTA (small-intake threshold) are imported
// from ./analysis so the two modules can't drift out of sync.
const PER_PICK_CAP = 6; // options offered per backed-up slot (one reach can't dominate)
// Natural ceiling, NOT a round number plucked from the air: at most PER_PICK_CAP
// options for each of the 3 Band-A slots. It scales with how many slots actually
// get backups (6 / 12 / 18 for 1 / 2 / 3 backed-up slots). The UI shows a few
// then "show more"; the detail pager shows the whole set.
const MAX_SUGGESTIONS = PER_PICK_CAP * A_SLOT_COUNT; // = 18

// Risk buckets that NEED a safety net — these back-up lists rank first. Safe
// picks ("safe"/"fair") still get backups too ("just in case"), but below the
// risky ones. "unknown" (no benchmark) is skipped — unestimable, so no
// meaningful backup can be ranked.
const RISKY_TIERS = new Set(["risky", "high-risk", "unsafe", "blocked"]);
const SAFE_TIERS = new Set(["safe", "fair"]);

export type Suggestion = {
  result: ProgrammeResult; // the candidate (from allResults)
  forSlot: string; // the risky pick it backs up, e.g. "A2"
  forSlotIndex: number; // that pick's index in the picks array (A1=0, A2=1, A3=2)
  forCode: string; // that pick's JUPAS code
  forSlotRisky: boolean; // is the backed-up pick risky (vs a safe "just in case" pick)?
  band: "uq" | "med"; // the student's standing on the candidate
  similarity: number; // ranking aid (higher = closer field match)
  sharedFaculty: boolean;
  fewPlaces: boolean;
};

export type AlternativesResult = {
  hasRiskyPicks: boolean; // any genuinely risky/blocked Band-A pick
  show: boolean; // whether to render the section (risky picks, or any backup found)
  suggestions: Suggestion[];
  reason?: "none-found";
};

// ── Similarity helpers ────────────────────────────────────────────────────────

// Normalise a faculty string to a coarse bucket. Faculty data is inconsistent
// (only about two-thirds of programmes have it; CityUHK/EdUHK/SSSDP have none), so this is
// only ONE of two signals — keyword overlap (below) covers the rest.
const FACULTY_CODE_MAP: Record<string, string> = {
  art: "arts", arts: "arts", ba: "business", business: "business",
  eng: "engineering", engineering: "engineering", sci: "science", science: "science",
  med: "medicine", medicine: "medicine", soc: "social sciences", ssc: "social sciences",
  edu: "education", education: "education", law: "law",
};

function normFaculty(raw?: string | null): string {
  if (!raw) return "";
  let s = raw.toLowerCase().trim();
  s = s.replace(/&/g, "and");
  s = s.replace(/\b(faculty|school|academy|college|department|division)\s+of\s+/g, "");
  s = s.replace(/\b(faculty|school|academy|college)\b/g, "");
  s = s.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (FACULTY_CODE_MAP[s]) return FACULTY_CODE_MAP[s];
  // collapse a multi-word faculty to its first mapped keyword if present
  for (const w of s.split(" ")) {
    if (FACULTY_CODE_MAP[w]) return FACULTY_CODE_MAP[w];
  }
  return s;
}

// Discipline vocabulary: the words that actually signal "same direction". A
// shared discipline word is a strong match; otherwise we fall back to any two
// shared content words ≥4 chars.
const DISCIPLINE_WORDS = new Set([
  "engineering", "nursing", "medicine", "medical", "biomedical", "health",
  "business", "accounting", "finance", "economics", "management", "marketing",
  "computing", "computer", "data", "science", "sciences", "information",
  "technology", "law", "legal", "education", "teaching", "design", "architecture",
  "social", "psychology", "sociology", "policy", "arts", "humanities", "language",
  "linguistics", "translation", "journalism", "communication", "media", "music",
  "biology", "chemistry", "physics", "mathematics", "statistics", "environmental",
  "geography", "history", "philosophy", "nutrition", "pharmacy", "surveying",
  "logistics", "hospitality", "tourism", "veterinary", "dentistry", "physiotherapy",
  "occupational", "speech", "optometry", "actuarial", "biochemistry", "biotechnology",
]);

const STOPWORDS = new Set([
  "and", "the", "of", "in", "for", "with", "bachelor", "degree", "scheme",
  "programme", "program", "studies", "study", "honours", "hons", "bsc", "ba",
  "beng", "bba", "year", "first", "major", "majors", "features", "stream",
  "double", "joint", "common", "broad", "based", "global", "school", "faculty",
]);

function contentWords(name: string): string[] {
  // Drop the trailing "(Features: …)" / "(Majors: …)" parentheticals — written
  // with ROUND parens (CityUHK) or SQUARE brackets (e.g. HKU "[Majors: …]") —
  // before tokenising. Without stripping "[…]", a programme inherits the
  // discipline words of every major/feature it lists (e.g. "BSc Physics
  // [Features: …Medical Physics…]" leaked "medical"), causing cross-field
  // matches. Then tokenise to lowercase words ≥3 chars minus stopwords.
  const base = name.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").toLowerCase();
  return base
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function disciplineKeywords(name: string): Set<string> {
  return new Set(contentWords(name).filter((w) => DISCIPLINE_WORDS.has(w)));
}

// Umbrella / degree-type words that are too broad to signal a shared field on
// their own: every "Bachelor of SCIENCE in X" shares "science", every BBA shares
// "management", etc. Sharing one of these counts as only a HALF signal, so a
// single broad word never reaches the match threshold (1) — a specific field
// word, a shared faculty, or two signals is required. (Previously any single
// shared discipline word triggered a match, which paired unrelated programmes
// like Physics ↔ Physiotherapy purely on "science".)
const BROAD_WORDS = new Set([
  "science", "sciences", "arts", "humanities", "management", "technology", "information",
]);

// Similarity between the risky pick and a candidate. Suggested only at score ≥ 1.
function similarityScore(pick: ProgrammeResult, cand: ProgrammeResult): { score: number; sharedFaculty: boolean } {
  const pf = normFaculty(pick.programme.faculty);
  const cf = normFaculty(cand.programme.faculty);
  const sharedFaculty = pf !== "" && pf === cf;

  const pk = disciplineKeywords(pick.programme.name_en);
  const ck = disciplineKeywords(cand.programme.name_en);
  let strong = 0, broad = 0;
  for (const w of pk) if (ck.has(w)) (BROAD_WORDS.has(w) ? broad++ : strong++);

  // Faculty = 2, each specific field word = 1, each broad word = 0.5.
  let score = (sharedFaculty ? 2 : 0) + strong + 0.5 * broad;

  // Below threshold → fall back to ≥2 shared content words (≥4 chars).
  if (score < 1) {
    const pc = new Set(contentWords(pick.programme.name_en).filter((w) => w.length >= 4));
    const cc = contentWords(cand.programme.name_en).filter((w) => w.length >= 4);
    let shared = 0;
    for (const w of cc) if (pc.has(w)) shared++;
    if (shared >= 2) score = 1;
  }
  return { score, sharedFaculty };
}

// The label a suggestion carries. `getScoreBand` returns "uq" off a SYNTHETIC
// UQ when none is published (median + k·spread), which would wrongly read as
// "Above UQ". Only HKU/CUHK publish a real UQ, so claim "uq" solely when the
// student clears a REAL published upper quartile above the median; everything
// else at/above the median is "med" ("Above median") — accurate, not inflated.
function suggestionBand(cand: ProgrammeResult): "uq" | "med" {
  const { median, uq } = effectiveBenchmarks(cand.programme);
  const total = cand.calculation.totalScore;
  if (uq != null && median != null && uq > median && total != null && total >= uq) return "uq";
  return "med";
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function suggestAlternatives(
  picks: (ProgrammeResult | null)[],
  allResults: ProgrammeResult[],
): AlternativesResult {
  const filled = picks.filter((p): p is ProgrammeResult => p != null);
  const pickedCodes = new Set(filled.map((p) => p.programme.jupas_code));

  // Every Band-A pick with a benchmark gets a backup list: risky ones because
  // they NEED a safety net, safe ones "just in case". Track which are risky so
  // the urgent backups rank first. "unknown" (no benchmark) picks are skipped.
  const backableA: { result: ProgrammeResult; slot: string; index: number; median: number | null; risky: boolean }[] = [];
  picks.forEach((p, i) => {
    if (!p || i >= A_SLOT_COUNT) return;
    const tier = getSlotRisk(p, i);
    if (!RISKY_TIERS.has(tier) && !SAFE_TIERS.has(tier)) return; // skip "unknown" (no benchmark)
    backableA.push({
      result: p,
      slot: `A${i + 1}`,
      index: i,
      median: effectiveBenchmarks(p.programme).median,
      risky: RISKY_TIERS.has(tier),
    });
  });

  const anyRisky = backableA.some((b) => b.risky);
  if (backableA.length === 0) return { hasRiskyPicks: false, show: false, suggestions: [] };

  // Pre-filter the pool to eligible, benchmarked, achievable candidates once.
  const pool = allResults.filter((r) => {
    if (pickedCodes.has(r.programme.jupas_code)) return false;
    if (!r.eligibility.eligible) return false;
    const band = getScoreBand(r);
    return band === "uq" || band === "med";
  });

  // Assign each candidate to the risky slot it BEST backs up: the highest-
  // similarity reach it is NOT harder than. A candidate backs up at most one slot,
  // so "Swap with AX" always targets the right reach.
  const assigned: Suggestion[] = [];
  for (const cand of pool) {
    const candMedian = effectiveBenchmarks(cand.programme).median;
    let best: { slot: string; index: number; code: string; score: number; sharedFaculty: boolean; risky: boolean } | null = null;
    for (const r of backableA) {
      const { score, sharedFaculty } = similarityScore(r.result, cand);
      if (score < 1) continue; // a single broad word (0.5) isn't enough — needs a real signal
      // A safety should not be HARDER than the pick it backs up.
      if (r.median != null && candMedian != null && candMedian > r.median) continue;
      if (!best || score > best.score) {
        best = { slot: r.slot, index: r.index, code: r.result.programme.jupas_code, score, sharedFaculty, risky: r.risky };
      }
    }
    if (!best) continue;
    const quota = cand.programme.quota ?? null;
    assigned.push({
      result: cand,
      forSlot: best.slot,
      forSlotIndex: best.index,
      forCode: best.code,
      forSlotRisky: best.risky,
      band: suggestionBand(cand),
      similarity: best.score,
      sharedFaculty: best.sharedFaculty,
      fewPlaces: quota != null && quota <= FEW_QUOTA,
    });
  }

  // Per-slot cap (don't let one reach dominate), then global ranking + total cap.
  const bySlot = new Map<string, Suggestion[]>();
  for (const s of assigned) {
    const list = bySlot.get(s.forSlot);
    if (list) list.push(s);
    else bySlot.set(s.forSlot, [s]);
  }
  const capped: Suggestion[] = [];
  for (const group of bySlot.values()) {
    group.sort(compareSuggestions);
    capped.push(...group.slice(0, PER_PICK_CAP));
  }
  capped.sort(compareSuggestions);
  const suggestions = capped.slice(0, MAX_SUGGESTIONS);
  // Show the section when a pick genuinely needs a safety net (even if nothing
  // suitable was found → a muted "none" line), or when we found any backup at
  // all (incl. "just in case" ones for safe picks). An all-safe portfolio with
  // no same-direction options found stays hidden, so we don't nag a strong plan.
  const show = anyRisky || suggestions.length > 0;
  return {
    hasRiskyPicks: anyRisky,
    show,
    suggestions,
    reason: anyRisky && suggestions.length === 0 ? "none-found" : undefined,
  };
}

// Rank: most-comfortably-clear first, then closer field match, then a larger
// intake (less volatile), then a higher-but-cleared median (stronger option),
// then stable by code. The comfort signal uses getScoreBand's "uq" (which
// includes the synthetic UQ) — a score well above the median is a comfier
// safety regardless of whether the UQ is published. That's separate from the
// displayed `band` LABEL, which only says "Above UQ" for a REAL published UQ.
function compareSuggestions(a: Suggestion, b: Suggestion): number {
  // Backups for genuinely risky picks rank above "just in case" backups for safe
  // picks — the urgent safety nets should be the first ones the student sees.
  if (a.forSlotRisky !== b.forSlotRisky) return a.forSlotRisky ? -1 : 1;
  const bandRank = (s: Suggestion) => (getScoreBand(s.result) === "uq" ? 0 : 1);
  if (bandRank(a) !== bandRank(b)) return bandRank(a) - bandRank(b);
  if (a.similarity !== b.similarity) return b.similarity - a.similarity;
  if (a.fewPlaces !== b.fewPlaces) return a.fewPlaces ? 1 : -1;
  const am = effectiveBenchmarks(a.result.programme).median ?? 0;
  const bm = effectiveBenchmarks(b.result.programme).median ?? 0;
  if (am !== bm) return bm - am;
  return a.result.programme.jupas_code.localeCompare(b.result.programme.jupas_code);
}
