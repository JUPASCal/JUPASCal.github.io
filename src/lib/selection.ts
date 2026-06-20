// Non-academic admission requirements ("duties beyond your grades") — the typed,
// salience-tiered model behind the analysis reminders. NOT a score-risk signal:
// because our data is incomplete and we can't be certain a programme interviews,
// these are surfaced as informational reminders, never blockers.
//
// Three layers, in precedence order (see getSelection):
//   1. CURATED  — human-validated overrides keyed by JUPAS code. Authoritative.
//   2. text     — parsed from the programme's own requirement notes. Reliable
//                 where present, but the source data is sparse (e.g. medicine has
//                 NO interview text at all → that's what the curated layer is for).
//   3. heuristic — inferred from the programme's discipline (name/faculty). Broad
//                 but fuzzy → always tagged `inferred`, language stays hedged.
//
// To correct a programme: add/edit its entry in CURATED below (highest priority).

import type { Programme } from "../types/jupas";

export type SelectionType =
  | "interview"
  | "portfolio"
  | "audition"
  | "physical-test"
  | "practical-test"
  | "written-test"
  | "aptitude-test"
  // Not a selection STEP but an application tip: document relevant experience in
  // the JUPAS "Other Experiences & Achievements" section (e.g. a sports programme
  // whose non-JUPAS routes demand proof of competition results → put it in OEA).
  | "oea";

// How much the step matters, per the advisor model:
//   required — a gate or near-gate you MUST satisfy (medicine interview, arts
//              portfolio, PE physical test). Score alone won't carry you.
//   weighty  — a real ranking factor / bonus (typically post-DSE interviews).
//   optional — good-to-have / may be invited (often pre-DSE interviews).
export type SelectionSalience = "required" | "weighty" | "optional";
export type SelectionSource = "curated" | "official" | "text" | "heuristic";
// When the step happens relative to HKDSE results — the key importance signal:
// pre-results interviews are typically "good to have" (ace it → conditional
// offer), post-results ones carry real ranking weight. Only known from official
// per-institution interview-arrangement pages → populated in the curated layer.
export type SelectionTiming = "pre-results" | "post-results" | "both";

export type SelectionItem = {
  type: SelectionType;
  salience: SelectionSalience;
  source: SelectionSource;
  timing?: SelectionTiming;
  // When set, the UI hedges this item rather than stating it as confirmed:
  //   "type"  – inferred from the programme name/discipline (heuristic guess)
  //   "stale" – from an official source we believe is out of date (e.g. an
  //             institution that hasn't published this cycle's arrangements yet)
  inferred?: "type" | "stale";
  // Optional i18n key for extra programme-specific guidance shown under the item
  // (e.g. what to put in the OEA). Curated layer only.
  note?: string;
};
export type Selection = {
  items: SelectionItem[];
  // True only when every item is from curated/text (official) — drives whether
  // the UI hedges ("may require") vs states it. Heuristic-derived = inferred.
  confirmed: boolean;
};

// ── 1. CURATED overrides (HUMAN-VALIDATED) ───────────────────────────────────
// Highest-precedence manual override, keyed by JUPAS code. Add an entry only to
// correct something the official scrape / text / heuristic gets wrong — interview
// data now comes from the official per-institution scrape baked into
// `programme.non_academic` (unify Step 4c), so this is normally empty.
export const CURATED: Record<string, SelectionItem[]> = {
  // HKBU JS2620 Physical Education: its JUPAS "Remarks on other requirements" row
  // is bare (no interview/test), so OFFICIAL_FULL drops the name-heuristic. But
  // every NON-JUPAS route (International Qualifications, Mainland 高考) explicitly
  // demands certificates/testimonials of outstanding sports results → the
  // programme clearly weighs athletic achievement. Remind JUPAS applicants to
  // evidence theirs in the OEA section.
  JS2620: [{ type: "oea", salience: "weighty", source: "curated", note: "sel.oea.js2620" }],
};

// Institutions whose interview arrangements are scraped from their OWN official
// page (→ `programme.non_academic`). For these, the official record is the SOLE
// interview source — we suppress the name/text interview guesses (absence ⇒ no
// interview). Portfolio/audition/test detection still applies everywhere.
const OFFICIAL_INTERVIEW_INSTITUTIONS = new Set([
  // NB: must match programme.institution exactly — it's "CityUHK" / "LingnanU",
  // not "CityU" / "LingU" (a mismatch silently disables suppression).
  "HKU", "CUHK", "PolyU", "EdUHK", "HKBU", "LingnanU", "HKMU", "HKUST", "CityUHK",
]);

// Institutions whose OFFICIAL scrape covers EVERY non-academic type (interview +
// portfolio + …) — we crawled all their programme pages, so absence ⇒ none and
// ALL inferred (heuristic/text) items are dropped. CityU: interview from its
// interview page + portfolio from per-programme pages (cityu_requirements scrape).
// PolyU added: its JUPAS interview-arrangement page describes each programme's
// full admission process (interview/assessment + any portfolio in the remarks),
// so absence ⇒ none — drops JS3050 Fashion's false heuristic "portfolio" (it's
// interview-assessed) and JS3160's false "physical-test" (academic sports degree).
// HKBU added: the central JUPAS programme page's "Remarks on other requirements"
// section authoritatively lists each HKBU programme's portfolio/audition/practical
// needs (parsed into non_academic by unify §4e) and the interview scrape covers
// interviews — so absence ⇒ none, dropping JS2620's false "physical-test" (its
// JUPAS page states only "high choice banding preferred", no fitness test).
const OFFICIAL_FULL_INSTITUTIONS = new Set(["CityUHK", "PolyU", "HKBU"]);

// Institutions whose scraped page is believed STALE (last cycle's data, not yet
// updated for this cycle) — their official items are shown hedged ("based on last
// year, not yet confirmed") rather than as confirmed. LingnanU: page still shows
// last-cycle dates (e.g. "26 June 2025"). Remove once they refresh + we re-scrape.
const STALE_OFFICIAL_INSTITUTIONS = new Set(["LingnanU"]);

// Confirmed hard interview gates → salience "required" regardless of timing
// (medicine / dentistry). Everything else is graded from timing.
const REQUIRED_INTERVIEW = new Set(["JS6456", "JS6626", "JS4501", "JS4502", "JS6107"]);

// Salience policy for a scraped interview: explicit source value wins (HKUST),
// else medicine/dentistry = required, else pre-results = optional ("good to
// have") and post-results / both = weighty (a real ranking factor).
function interviewSalience(code: string, timing: SelectionTiming | undefined, given?: string): SelectionSalience {
  if (given === "required" || given === "weighty" || given === "optional") return given;
  if (REQUIRED_INTERVIEW.has(code)) return "required";
  return timing === "pre-results" ? "optional" : "weighty";
}

// Official non-academic requirements baked from the institution scrapes
// (programme.non_academic): interview for all 9 covered schools, plus
// portfolio/audition/test where the source states it (e.g. PolyU). Authoritative.
function officialItems(p: Programme): SelectionItem[] {
  const list = p.non_academic;
  if (!list || !list.length) return [];
  const stale = STALE_OFFICIAL_INSTITUTIONS.has(p.institution);
  return list.map((r) => {
    const type = r.type as SelectionType;
    const timing = (r.timing as SelectionTiming) || undefined;
    const salience: SelectionSalience =
      type === "interview"
        ? interviewSalience(p.jupas_code, timing, r.salience)
        : ((r.salience as SelectionSalience) || "required");
    const item: SelectionItem = { type, salience, source: "official", timing };
    if (stale) item.inferred = "stale";
    return item;
  });
}

// ── 2. Text extraction from the programme's own notes ─────────────────────────
const TYPE_PATTERNS: Array<[RegExp, SelectionType]> = [
  [/audition/i, "audition"],
  [/portfolio/i, "portfolio"],
  // A "practical test" (e.g. Visual Arts art-making) is its OWN thing — not a
  // physical/PE test. Keep it distinct so a language/arts programme never reads
  // "physical test".
  [/practical test/i, "practical-test"],
  // Physical/PE test must be an explicit "<physical|fitness|aquatic|swimming> test"
  // — NOT a bare "physical"/"fitness" (which show up in prose like "physical
  // sciences", "Exercise and Fitness Coaching").
  [/\b(physical fitness|fitness|physical|aquatic|swimming)\s+test\b/i, "physical-test"],
  [/(written|entrance)\s+(examination|exam|test)/i, "written-test"],
  [/aptitude/i, "aptitude-test"],
  [/interview/i, "interview"],
];

function selectionTexts(p: Programme): string[] {
  const out: string[] = [];
  const notes = p.jupas_requirements?.notes;
  if (notes) out.push(...notes);
  const conditional = p.min_requirements_2026?.conditional_remarks;
  if (conditional) out.push(conditional);
  if (p.remarks) out.push(p.remarks);
  // Deliberately NOT scanning short_description: it's the programme blurb /
  // curriculum description, where words like "portfolio management" or "physical
  // sciences" are TOPICS taught, not admission requirements (false positives).
  return out;
}

function salienceFromText(sentence: string): SelectionSalience {
  if (/may be (required|invited|asked)|if (necessary|shortlisted|applicable)|optional|priority consideration|where applicable/i.test(sentence)) return "optional";
  if (/\b(required|must|compulsory|mandatory|shall|is required|are required)\b/i.test(sentence)) return "required";
  return "weighty";
}

function detectFromText(p: Programme): SelectionItem[] {
  const found = new Map<SelectionType, SelectionSalience>();
  for (const text of selectionTexts(p)) {
    // Split into sentences so salience words attach to the right requirement.
    // NOTE: no regex lookbehind here — it's a SyntaxError on iOS Safari < 16.4
    // (would fail the whole bundle). Splitting ON the punctuation (dropping it)
    // is fine for keyword/salience matching.
    for (const sentence of text.split(/[.;!?]\s+|\n+/)) {
      for (const [re, type] of TYPE_PATTERNS) {
        if (re.test(sentence)) {
          const sal = salienceFromText(sentence);
          // Keep the strongest salience seen for this type.
          const rank = { optional: 0, weighty: 1, required: 2 } as const;
          const prev = found.get(type);
          if (prev === undefined || rank[sal] > rank[prev]) found.set(type, sal);
        }
      }
    }
  }
  return [...found].map(([type, salience]) => ({ type, salience, source: "text" as const }));
}

// ── 3. Discipline heuristics (name/faculty → likely requirement) ──────────────
// Word-boundary patterns to avoid "Bachelor of Arts" / "...dent..." style false
// positives. Always emitted as `heuristic` (inferred); curated/text override.
const HEURISTICS: Array<[RegExp, SelectionItem]> = [
  // Interview gates (post-DSE, well established):
  [/bachelor of medicine|\bMBBS\b|\bMBChB\b/i, { type: "interview", salience: "required", source: "heuristic" }],
  [/dentistry|dental surgery/i, { type: "interview", salience: "required", source: "heuristic" }],
  [/chinese medicine/i, { type: "interview", salience: "required", source: "heuristic" }],
  [/\bnursing\b/i, { type: "interview", salience: "required", source: "heuristic" }],
  [/social work/i, { type: "interview", salience: "required", source: "heuristic" }],
  [/\beducation\b|\bteacher\b|teaching|early childhood/i, { type: "interview", salience: "weighty", source: "heuristic" }],
  // Portfolio / audition (creative disciplines):
  [/\bmusic\b|\bdrama\b|theatre|theater|\bdance\b|performing arts/i, { type: "audition", salience: "required", source: "heuristic" }],
  // "design" → portfolio. Educational/engineering "design" phrases are stripped
  // from the haystack first (see detectFromHeuristics) so they don't match here —
  // avoids a regex lookbehind, which throws on iOS Safari < 16.4.
  [/fine arts?|visual arts?|creative media|media arts|\bfilm\b|cinema|animation|\bdesign\b|architectur|fashion/i, { type: "portfolio", salience: "required", source: "heuristic" }],
  // Physical test (avoid bare "sport(s)" — matches academic Sports Management):
  [/physical education|exercise science|kinesiolog|sports science|sports? coaching/i, { type: "physical-test", salience: "required", source: "heuristic" }],
];

function detectFromHeuristics(p: Programme): SelectionItem[] {
  // Match on the programme NAME only — matching the faculty over-applies (e.g.
  // Surveying / Urban Studies sit in an Architecture faculty but need no
  // portfolio; everything in an Education faculty is not an interview gate).
  // School-wide policies belong in CURATED, not a faculty-substring guess.
  // Strip educational/engineering "design" phrases so the portfolio "design"
  // heuristic doesn't fire on "Learning Design and Technology" /
  // "Innovation, Design and Technology" etc. (a non-creative "design").
  const hay = (p.name_en || "").replace(/learning design|instructional design|design and technology/gi, " ");
  const out: SelectionItem[] = [];
  // Heuristic items are inferred from the name → always hedged ("likely").
  for (const [re, item] of HEURISTICS) if (re.test(hay)) out.push({ ...item, inferred: "type" });
  // Dedupe by type (e.g. don't emit two interview items).
  const seen = new Set<SelectionType>();
  return out.filter((i) => (seen.has(i.type) ? false : (seen.add(i.type), true)));
}

// ── Merge: curated > text > heuristic, deduped by type ────────────────────────
const SRC_RANK: Record<SelectionSource, number> = { curated: 4, official: 3, text: 2, heuristic: 1 };

export function getSelection(p: Programme): Selection {
  // Merge all four layers, highest-precedence source winning per requirement type:
  //   curated > official (scraped programme.non_academic) > text > heuristic.
  // For institutions with an official interview scrape, the official record is
  // the only interview source — drop the inferred interview guesses so a
  // programme absent from the scrape correctly reads as "no interview" (the
  // discipline/text heuristics over-guess interviews). Portfolio/audition/test
  // detection from text+heuristic always applies (the scrape only covers interviews).
  const fullOfficial = OFFICIAL_FULL_INSTITUTIONS.has(p.institution);
  const suppressInferredInterview = OFFICIAL_INTERVIEW_INSTITUTIONS.has(p.institution);
  const byType = new Map<SelectionType, SelectionItem>();
  const add = (item: SelectionItem | null) => {
    if (!item) return;
    const inferred = item.source !== "official" && item.source !== "curated";
    // CityU et al.: official scrape is complete → drop ALL inferred items.
    if (inferred && fullOfficial) return;
    // Other covered schools: official interview is complete → drop inferred interview.
    if (inferred && item.type === "interview" && suppressInferredInterview) return;
    const prev = byType.get(item.type);
    if (!prev || SRC_RANK[item.source] >= SRC_RANK[prev.source]) byType.set(item.type, item);
  };
  detectFromHeuristics(p).forEach(add);
  detectFromText(p).forEach(add);
  officialItems(p).forEach(add);
  (CURATED[p.jupas_code] || []).forEach(add);

  const items = [...byType.values()];
  return { items, confirmed: items.length > 0 && items.every((i) => !i.inferred) };
}

export function hasSelection(p: Programme): boolean {
  return getSelection(p).items.length > 0;
}

// ── i18n key helpers (shared by DetailPanel + analysis so labels stay in sync) ──
export function selectionTypeKey(type: SelectionType): string {
  return {
    interview: "sel.type.interview",
    portfolio: "sel.type.portfolio",
    audition: "sel.type.audition",
    "physical-test": "sel.type.physical",
    "practical-test": "sel.type.practical",
    "written-test": "sel.type.written",
    "aptitude-test": "sel.type.aptitude",
    oea: "sel.type.oea",
  }[type];
}

export function selectionTimingKey(timing?: SelectionTiming): string | null {
  if (timing === "pre-results") return "sel.timing.pre";
  if (timing === "post-results") return "sel.timing.post";
  if (timing === "both") return "sel.timing.both";
  return null;
}

// What the requirement means for the applicant — gates the tone of the reminder.
export function selectionSalienceKey(salience: SelectionSalience): string {
  return {
    required: "sel.salience.required",
    weighty: "sel.salience.weighty",
    optional: "sel.salience.optional",
  }[salience];
}
