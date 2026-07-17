import { slotLabel } from "./slots";
import { effectiveBenchmarks } from "./results";
import { getSelection, selectionTypeKey, type SelectionItem, type SelectionType } from "./selection";
import { classifyConsideration } from "./retake";
import { takesBandB } from "./offers";
import { institutionLabel } from "./institutions";
import type { Lang, Translate } from "./i18n";
import type { OfferStatistic, Programme, ProgrammeResult } from "../types/jupas";

// Portfolio strategy analysis – a hard-coded, heuristic read of the
// user's choices AS A SET (the DetailPanel covers individual programmes).
//
// Domain reality this encodes (per advisor guidance):
//   - The tool is used AFTER results, so grades are FIXED. We never
//     suggest "improve a grade"; advice is about choice/ordering + risk.
//   - Most JUPAS offers come from Band A (A1–A3). Band A is where the
//     analysis lives. A1, A2, and A3 are a sequence: one strong choice does
//     not make the band safe if the next slots cannot back it up. Band B and
//     below are near-noise, so a lower-band place realistically needs you
//     ABOVE the programme's upper quartile – being above the median there
//     means little.
//   - Advisor stance: play safe. Surface eligibility first, then warn
//     loudly when the Band A plan is risky (long shots / few places /
//     interview-gated).
//
// Thresholds are tunable constants grounded in the 2026 dataset's own
// distributions: Band-A offer rate quartiles ≈ 7% / 13% / 21%; quota
// quartiles ≈ 20 / 32 / 80.

// Shared domain thresholds (also consumed by lib/suggestions.ts – import from
// here, don't re-declare, so the two stay in lockstep).
export const FEW_QUOTA = 20; // intake at/below this → noisy cut-off, never fully "safe"
export const A_SLOT_COUNT = 3; // Band A = the first 3 choices (where offers come from)
const RATE_VERY_HIGH = 7; // Band-A offer rate below this = bottom quartile
const RATE_HIGH = 12; // below the median Band-A offer rate
const RATE_MODERATE = 21; // up to the upper quartile

// Risk is graded per slot against a programme's benchmarks (UQ / median / LQ);
// see getSlotRisk. A small intake (few places) is a small sample whose cut-off
// swings year to year, so it never reads fully "safe" however high the score.
//
// Synthetic upper quartile: only HKU/CUHK publish a real UQ, so for everyone
// else we estimate it from the lower spread: median + K×spread. K>1 so the
// synthetic UQ sits a little further above the median than the LQ sits below it
// (admission distributions skew that way).
const UQ_K = 1.25;
// Many programmes publish median == LQ (or only an estimated single figure, e.g.
// HKBU), giving a zero/degenerate lower spread. Without a floor the score bands
// collapse and any score a hair below the median falls into "far below LQ". So
// the spread used for banding is at least this fraction of the median.
const SPREAD_FLOOR_FRAC = 0.05;

export type Severity = "critical" | "warning" | "info" | "good";

// A pick reference used in finding text + chips: its slot (A1…) and JUPAS code,
// so prose reads "A2 (JS1234)" and the chips can show + link the code.
export type SlotRef = { slot: string; code: string };

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  slots?: SlotRef[];
};

export type CompetitionTier = "very-high" | "high" | "moderate" | "low" | "unknown";

export type Competition = {
  quota: number | null;
  bandAApps: number;
  bandAOffers: number;
  rate: number | null;
  applicantsPerPlace: number | null;
  year: number | null;
  tier: CompetitionTier;
  fewPlaces: boolean;
};

// Per-pick risk, graded by SLOT (A1/A2/A3 each have their own thresholds –
// see getSlotRisk). The same score-vs-benchmark position escalates in risk
// as it moves A1 → A2 → A3 because each later slot is one fewer chance to
// play safe. Band B and below stay deliberately harsh (only a score above
// the programme's UQ is even a "Risky" maybe) because offers almost never
// reach them.
export type RiskLevel =
  | "safe"
  | "fair"
  | "risky"
  | "high-risk"
  | "unsafe"
  | "blocked"
  | "unknown";

export type PickChance = {
  slot: string;
  index: number;
  isBandA: boolean;
  result: ProgrammeResult;
  tier: RiskLevel;
  // Non-academic requirements (interview / portfolio / test) for this pick.
  // Informational only – these never affect the risk tier (a duty is a duty to
  // prepare for, not a score penalty); surfaced as a reminder in the findings.
  selection: SelectionItem[];
  // Small intake (quota ≤ FEW_QUOTA) → noisy cut-off, treat as less safe.
  fewPlaces: boolean;
};

export type PortfolioAnalysis = {
  total: number;
  eligibleCount: number;
  institutions: number;
  picks: PickChance[];
  bandA: PickChance[];
  bandB: PickChance[]; // B-band and below (everything past A1–A3)
  findings: Finding[];
  verdict: { tone: Severity; headline: string; sub: string };
};

export function getCompetition(programme: Programme): Competition {
  const stats = programme.offer_statistics || [];
  const apps = new Map<number, OfferStatistic>();
  const offers = new Map<number, OfferStatistic>();
  for (const row of stats) {
    if (!row.Year) continue;
    if (row.Type === "Application") apps.set(row.Year, row);
    else if (row.Type === "Offer") offers.set(row.Year, row);
  }
  const years = Array.from(new Set([...apps.keys(), ...offers.keys()])).sort((a, b) => b - a);
  const quota = programme.quota ?? null;
  if (years.length === 0) {
    return { quota, bandAApps: 0, bandAOffers: 0, rate: null, applicantsPerPlace: null, year: null, tier: "unknown", fewPlaces: false };
  }
  const year = years[0];
  const bandAApps = (apps.get(year)?.["Band A"] as number | undefined) ?? 0;
  const bandAOffers = (offers.get(year)?.["Band A"] as number | undefined) ?? 0;
  const rate = bandAApps > 0 ? (bandAOffers / bandAApps) * 100 : null;
  const applicantsPerPlace = quota && quota > 0 ? bandAApps / quota : null;
  let tier: CompetitionTier = "unknown";
  if (rate !== null) {
    if (rate < RATE_VERY_HIGH) tier = "very-high";
    else if (rate < RATE_HIGH) tier = "high";
    else if (rate < RATE_MODERATE) tier = "moderate";
    else tier = "low";
  }
  const fewPlaces = (tier === "very-high" || tier === "high") && quota != null && quota <= FEW_QUOTA;
  return { quota, bandAApps, bandAOffers, rate, applicantsPerPlace, year, tier, fewPlaces };
}

// Non-academic requirements (interview / portfolio / test) come from the shared
// selection model (official scrape > text > heuristic) in ./selection – no
// regex here. They feed an informational reminder, never the risk tier.

// Where the student's total sits relative to a programme's 2025 benchmarks
// (higher = better, so UQ > median > LQ). Bands are anchored on the median and
// sized by the lower spread (median − LQ), floored by SPREAD_FLOOR_FRAC so a
// degenerate median == LQ doesn't collapse them. The median→LQ gap is split at
// its midpoint into "near-med"/"near-lq"; below that, "below-lq" is within one
// more spread and "far-below-lq" is a whole band further down (clearly off).
export type ScoreBand = "uq" | "med" | "near-med" | "near-lq" | "below-lq" | "far-below-lq" | "unknown";

export function getScoreBand(result: ProgrammeResult): ScoreBand {
  // Central reference falls back median → mean → expected_score (see
  // effectiveBenchmarks), so a programme with only a mean/projected figure is
  // still banded rather than read as "no data".
  const { lq, median, uq: publishedUq } = effectiveBenchmarks(result.programme);
  const total = result.calculation.totalScore;
  if (median == null || !total) return "unknown";
  // Lower spread sizing the below-LQ bands, floored so median == LQ (or a
  // missing LQ) doesn't make every below-median score read as "far below LQ".
  // When an actual LQ exists, it remains the hard boundary: scores below the
  // published LQ must not be classified as "near-lq".
  const rawSpread = lq != null ? Math.max(median - lq, 0) : 0;
  const spread = Math.max(rawSpread, median * SPREAD_FLOOR_FRAC);
  const upperSpread = rawSpread > 0 ? rawSpread : spread;
  // Real published UQ when it's above the median (HKU/CUHK); else synthesise it
  // a little further above the median than the published LQ spread sits below.
  // The floor is only for lower-side banding; using it for UQ would make
  // programmes with a narrow median-LQ gap look artificially hard to clear.
  const uq = publishedUq != null && publishedUq > median ? publishedUq : median + UQ_K * upperSpread;
  if (total >= uq) return "uq";
  if (total >= median) return "med";
  if (lq != null) {
    const nearMedFloor = median - (rawSpread > 0 ? rawSpread / 2 : spread / 2);
    if (total >= nearMedFloor) return "near-med";
    if (total >= lq) return "near-lq";
    if (total >= lq - spread) return "below-lq";
    return "far-below-lq";
  }
  if (total >= median - spread / 2) return "near-med";
  if (total >= median - spread) return "near-lq";
  if (total >= median - 2 * spread) return "below-lq";
  return "far-below-lq";
}

// Per-SLOT risk. A1/A2/A3 share the same score bands but escalate in risk
// (A1 = dream, bold bets fine, never "unsafe"; A2 = realistic; A3 = pragmatic
// anchor). Band B and below stay harsh – only a score above the (effective) UQ
// is a "Risky" maybe, everything else "unsafe". A small intake caps the best
// level at "fair" (a UQ pick with few places isn't a sure thing).
//
//                A1 (Dream)   A2 (Target)   A3 (Anchor)
//   uq           safe         safe          safe
//   med          safe         fair          risky
//   near-med     fair         risky         high-risk
//   near-lq      fair         risky         unsafe
//   below-lq     high-risk    high-risk     unsafe
//   far-below-lq high-risk    unsafe        unsafe
// A2 below LQ is a bold-but-acceptable "highly risky" only while it's within a
// band of LQ; well below that it's just unsafe like A3. A1 never goes red.
export function getSlotRisk(result: ProgrammeResult, index: number): RiskLevel {
  if (!result.eligibility.eligible) return "blocked";
  const band = getScoreBand(result);
  if (band === "unknown") return "unknown";
  const quota = result.programme.quota ?? null;
  const fewPlaces = quota != null && quota <= FEW_QUOTA;

  let level: RiskLevel;
  if (index < A_SLOT_COUNT) {
    const A1: Record<Exclude<ScoreBand, "unknown">, RiskLevel> = {
      uq: "safe", med: "safe", "near-med": "fair", "near-lq": "fair", "below-lq": "high-risk", "far-below-lq": "high-risk",
    };
    const A2: Record<Exclude<ScoreBand, "unknown">, RiskLevel> = {
      uq: "safe", med: "fair", "near-med": "risky", "near-lq": "risky", "below-lq": "high-risk", "far-below-lq": "unsafe",
    };
    const A3: Record<Exclude<ScoreBand, "unknown">, RiskLevel> = {
      uq: "safe", med: "risky", "near-med": "high-risk", "near-lq": "unsafe", "below-lq": "unsafe", "far-below-lq": "unsafe",
    };
    level = (index === 0 ? A1 : index === 1 ? A2 : A3)[band];
  } else {
    // Band B and below: only clearing the UQ is a real shot.
    level = band === "uq" ? "risky" : "unsafe";
  }

  // Few places → volatile cut-off, so a "safe" reading is too generous.
  if (fewPlaces && level === "safe") level = "fair";
  return level;
}

export function riskMeta(tier: RiskLevel): { label: string; tone: "good" | "warn" | "alert" | "bad" | "neutral" } {
  switch (tier) {
    case "safe": return { label: "Safe", tone: "good" };
    case "fair": return { label: "Fair", tone: "good" };
    case "risky": return { label: "Risky", tone: "warn" };
    case "high-risk": return { label: "Highly risky", tone: "alert" };
    case "unsafe": return { label: "Unsafe", tone: "bad" };
    case "blocked": return { label: "Not eligible", tone: "bad" };
    case "unknown": return { label: "No data", tone: "neutral" };
  }
}

// i18n key for a risk tier's label – feed to `t()` so the chance tags localize.
export function riskLabelKey(tier: RiskLevel): string {
  switch (tier) {
    case "safe": return "risk.safe";
    case "fair": return "risk.fair";
    case "risky": return "risk.risky";
    case "high-risk": return "risk.highRisk";
    case "unsafe": return "risk.unsafe";
    case "blocked": return "risk.blocked";
    case "unknown": return "risk.unknown";
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };

const slotRef = (p: PickChance): SlotRef => ({ slot: p.slot, code: p.result.programme.jupas_code });

// Joins picks as "A2 (JS1234)" – referencing both the slot and the JUPAS code.
// Text references slots only (A1, A2 …) – the JUPAS code is shown once, in the
// clickable pills below each finding (and on the chance rows), so we don't repeat
// "A1 (JS4501)" inline everywhere.
function listSlots(refs: SlotRef[], lang: Lang): string {
  return listSlotNames(refs.map((r) => r.slot), lang);
}

function listSlotNames(slots: string[], lang: Lang): string {
  if (lang === "zh") return slots.join("、");
  if (slots.length === 1) return slots[0];
  if (slots.length === 2) return `${slots[0]} and ${slots[1]}`;
  return `${slots.slice(0, -1).join(", ")}, and ${slots[slots.length - 1]}`;
}

function humanList(items: string[], lang: Lang): string {
  if (lang === "zh") return items.join("、");
  const lower = items.map((i) => i.toLowerCase());
  if (lower.length === 1) return lower[0];
  if (lower.length === 2) return `${lower[0]} and ${lower[1]}`;
  return `${lower.slice(0, -1).join(", ")}, and ${lower[lower.length - 1]}`;
}

export function analyzePortfolio(rawPicks: (ProgrammeResult | null)[], t: Translate, lang: Lang, isRetaker = false): PortfolioAnalysis {
  const picks: PickChance[] = [];
  rawPicks.forEach((result, index) => {
    if (!result) return;
    picks.push({
      slot: slotLabel(index),
      index,
      isBandA: index < A_SLOT_COUNT,
      result,
      tier: getSlotRisk(result, index),
      selection: getSelection(result.programme).items,
      fewPlaces: result.programme.quota != null && result.programme.quota <= FEW_QUOTA,
    });
  });

  const total = picks.length;
  const eligibleCount = picks.filter((p) => p.result.eligibility.eligible).length;
  const institutions = new Set(picks.map((p) => p.result.programme.institution)).size;
  const bandA = picks.filter((p) => p.isBandA);
  const bandB = picks.filter((p) => !p.isBandA);

  // Band A is the only band that matters, so we classify each Band A pick
  // INDIVIDUALLY – a weak A3 must be named, not blurred into "risky Band A".
  // An interview is NOT inherently risky (medicine at A1 needs one and
  // that's fine). Risk = a *marginal* score made worse by an interview /
  // tiny intake, or a reach, or interviews stacked across the whole band.
  type ABucket = "solid" | "borderline" | "risky" | "reach" | "blocked" | "unknown";
  function classifyA(p: PickChance): ABucket {
    if (p.tier === "blocked") return "blocked";
    if (p.tier === "unknown") return "unknown";
    // Green (safe/fair) = a genuine shot for this slot. Red (unsafe) = a reach.
    // Amber/orange (risky/high-risk) are the in-between picks to call out; a tiny
    // intake pushes a plain "risky" from borderline into clearly risky. A
    // non-academic requirement (interview/portfolio) does NOT affect risk – it's
    // a duty surfaced as a reminder, not a score penalty.
    if (p.tier === "safe" || p.tier === "fair") return "solid";
    if (p.tier === "unsafe") return "reach";
    if (p.tier === "high-risk") return "risky";
    return p.fewPlaces ? "risky" : "borderline";
  }
  const aBuckets = bandA.map((p) => ({ p, bucket: classifyA(p) }));
  // "Realistic" = at or above the 2025 median (a genuine shot). Above the
  // LQ but BELOW the median is "marginal", not realistic – Band A is
  // competitive, so a below-median pick is a maybe, not a safe bet. An
  // ineligible pick is never a shot at all.
  const aSolid = aBuckets.filter((x) => x.bucket === "solid");
  const aBorderline = aBuckets.filter((x) => x.bucket === "borderline");
  const aMarginal = aBuckets.filter((x) => x.bucket === "borderline" || x.bucket === "risky");
  const aWeak = aBuckets.filter((x) => x.bucket === "reach" || x.bucket === "risky");
  // "No data" (a new / unrecorded programme with no 2025 benchmark) is its OWN
  // category, NOT a risk. A reach is below a known range; an unknown is simply
  // unestimable. We keep it out of the "problem" buckets (aUnusable / review)
  // so a no-data pick never reads as a risky choice to replace – instead it
  // gets a neutral "no data, check it yourself" note (see band-a-no-data).
  const aUnknown = aBuckets.filter((x) => x.bucket === "unknown");
  const aUnusable = aBuckets.filter((x) => x.bucket === "blocked" || x.bucket === "reach");
  // Ineligible Band A picks specifically – a hard, critical problem (a wasted top
  // slot), unlike a score-reach which is just an aggressive choice. The verdict
  // escalates to "critical" only for these; a reach beside a realistic anchor is
  // a "warning" like any other weak pick (see the followup vs weak branches).
  const aBlocked = aBuckets.filter((x) => x.bucket === "blocked");
  const aAllUnknown = bandA.length > 0 && aUnknown.length === bandA.length;
  const aFilledIndexes = new Set(bandA.map((p) => p.index));
  const aMissingSlots = Array.from({ length: A_SLOT_COUNT }, (_, index) => index)
    .filter((index) => !aFilledIndexes.has(index))
    .map((index) => slotLabel(index));
  const aLaterUnusable = aUnusable.filter((x) => x.p.index > 0);
  const aLaterSolid = aSolid.filter((x) => x.p.index > 0);
  const hasBandACoverage =
    bandA.length === A_SLOT_COUNT &&
    aMissingSlots.length === 0 &&
    aUnusable.length === 0 &&
    aWeak.length === 0 &&
    aLaterSolid.length > 0 &&
    aSolid.length >= 2;

  // "Aspirational A1": the dream slot is the ONLY weak pick and it's a
  // high-risk reach (the worst A1 can read – it never goes red), while A2 AND
  // A3 are both solid. In JUPAS the offer goes to your highest-ranked choice
  // that admits you, so a long-shot A1 does not lower the A2/A3 chances behind
  // it – ranking a dream first is "free" when the rest of the band holds it up.
  // We reframe instead of warning: keeping a genuine first choice at A1 here is
  // a sound plan, not a flaw to fix.
  const aspirationalA1 =
    bandA.length === A_SLOT_COUNT &&
    aMissingSlots.length === 0 &&
    aUnusable.length === 0 &&
    aWeak.length === 1 &&
    aWeak[0].p.index === 0 &&
    aWeak[0].p.tier === "high-risk" &&
    aLaterSolid.length === 2;

  function bandAAction(): string {
    // "review" = a score/risk pick to act on. EXCLUDES no-data (own neutral note)
    // AND blocked/ineligible – the eligibility finding owns those, so we don't
    // repeat "remove the ineligible pick" in another finding's action.
    const review = aBuckets.filter((x) => x.bucket !== "solid" && x.bucket !== "unknown" && x.bucket !== "blocked");
    const highRisk = review.filter((x) => x.bucket === "risky" || x.bucket === "reach");
    const laterHighRisk = highRisk.filter((x) => x.p.index > 0);

    if (aSolid.length === 0 && aBorderline.length > 0) {
      return t("find.bandAReview.action.borderline", { slots: listSlots(aBorderline.map((x) => slotRef(x.p)), lang) });
    }
    if (aSolid.length === 0) return t("find.bandAReview.action.none");
    if (laterHighRisk.length > 0) return t(laterHighRisk.length === 1 ? "find.bandAReview.action.moveEarlier.one" : "find.bandAReview.action.moveEarlier.many", { slots: listSlots(laterHighRisk.map((x) => slotRef(x.p)), lang) });
    if (review.length > 0) return t("find.bandAReview.action.review", { slots: listSlots(review.map((x) => slotRef(x.p)), lang) });
    if (aMissingSlots.length > 0) return t("find.bandAReview.action.fillMissing", { slots: listSlotNames(aMissingSlots, lang) });
    return t("find.bandAReview.action.addOption");
  }

  function bandAReviewDetail(): string {
    // No-data picks excluded (not a problem to fix here); blocked picks excluded
    // too – the eligibility finding owns them, so they don't double-appear in a
    // Band-A "review these" list.
    const review = aBuckets.filter((x) => x.bucket !== "solid" && x.bucket !== "unknown" && x.bucket !== "blocked");
    const action = bandAAction();
    if (aSolid.length === 0) {
      const possible = aBorderline.map((x) => slotRef(x.p));
      const problem = review.filter((x) => x.bucket !== "borderline");
      if (possible.length > 0 && problem.length > 0) {
        return t("find.bandAReview.detail.borderlineReview", {
          possible: listSlots(possible, lang),
          review: listSlots(problem.map((x) => slotRef(x.p)), lang),
          reasons: weakSummary(problem),
          action,
        });
      }
      if (possible.length > 0) {
        return t("find.bandAReview.detail.borderlineOnly", {
          possible: listSlots(possible, lang),
          action,
        });
      }
      return t("find.bandAReview.detail.noRealistic", {
        review: review.length > 0 ? listSlots(review.map((x) => slotRef(x.p)), lang) : listSlots(bandA.map(slotRef), lang),
        action,
      });
    }

    if (review.length === 0) {
      return t("find.bandAReview.detail.thin", {
        realistic: listSlots(aSolid.map((x) => slotRef(x.p)), lang),
        action,
      });
    }

    return t("find.bandAReview.detail.withReview", {
      realistic: listSlots(aSolid.map((x) => slotRef(x.p)), lang),
      review: listSlots(review.map((x) => slotRef(x.p)), lang),
      action,
    });
  }

  const findings: Finding[] = [];

  // 1. Eligibility – the hard gate, advisor's first concern. Post-results
  //    an ineligible pick is simply a wasted slot.
  const ineligible = picks.filter((p) => !p.result.eligibility.eligible);
  if (ineligible.length > 0) {
    const touchesA = ineligible.some((p) => p.isBandA);
    const one = ineligible.length === 1;
    findings.push({
      id: "eligibility",
      severity: touchesA ? "critical" : "warning",
      title: t(one ? "find.elig.title.one" : "find.elig.title.many", { n: ineligible.length }),
      detail: t(one ? "find.elig.detail.one" : "find.elig.detail.many", {
        slots: listSlots(ineligible.map(slotRef), lang),
        bandA: touchesA ? t("find.elig.bandANote") : "",
      }),
      slots: ineligible.map(slotRef),
    });
  } else if (total > 0) {
    findings.push({
      id: "eligibility-ok",
      severity: "good",
      title: t(total === 1 ? "find.eligOk.title.one" : "find.eligOk.title.many", { total }),
      detail: t("find.eligOk.detail"),
    });
  }

  // 2. Band A, read PER-SLOT – the single most important section. We name
  //    the specific weak slots rather than collapsing them into one
  //    "risky Band A" verdict, because Band A is where the offer comes from.
  function weakReason(x: { p: PickChance; bucket: ABucket }): string {
    const code = x.p.result.programme.jupas_code;
    const scoreBand = getScoreBand(x.p.result);
    if (scoreBand === "near-lq") {
      return t("find.weak.reason.aroundLq.one", { slot: x.p.slot, code });
    }
    if (scoreBand === "near-med") {
      return t("find.weak.reason.belowMedian.one", { slot: x.p.slot, code });
    }
    if (x.bucket === "reach") return t("find.weak.reason.belowRange.one", { slot: x.p.slot, code });
    // Intake size is NOT mentioned here – the few-places finding owns that caveat,
    // so "very few places" never appears in both a weak reason AND that finding.
    const bits = [t(scoreBand === "below-lq" || scoreBand === "far-below-lq" ? "find.weak.bit.belowRange" : "find.weak.bit.slotRisk")];
    return t("find.weak.reason.has", { slot: x.p.slot, code, bits: humanList(bits, lang) });
  }
  function weakSummary(items: { p: PickChance; bucket: ABucket }[]): string {
    if (items.length === 1) return weakReason(items[0]);
    const belowRange = items.filter((x) => {
      const band = getScoreBand(x.p.result);
      return band === "below-lq" || band === "far-below-lq";
    });
    const aroundLq = items.filter((x) => getScoreBand(x.p.result) === "near-lq");
    const belowMedian = items.filter((x) => getScoreBand(x.p.result) === "near-med");
    const other = items.filter((x) => !belowRange.includes(x) && !aroundLq.includes(x) && !belowMedian.includes(x));
    const groupReason = (group: { p: PickChance; bucket: ABucket }[], oneKey: string, manyKey: string) =>
      group.length === 0 ? "" : t(group.length === 1 ? oneKey : manyKey, { slots: listSlots(group.map((x) => slotRef(x.p)), lang) });
    const parts = [
      groupReason(belowRange, "find.weak.reason.belowRange.oneGrouped", "find.weak.reason.belowRange.many"),
      groupReason(aroundLq, "find.weak.reason.aroundLq.oneGrouped", "find.weak.reason.aroundLq.many"),
      groupReason(belowMedian, "find.weak.reason.belowMedian.oneGrouped", "find.weak.reason.belowMedian.many"),
      other.map(weakReason).join(lang === "zh" ? "；" : "; "),
    ].filter(Boolean);
    return parts.join(lang === "zh" ? "；" : "; ");
  }
  if (bandA.length === 0 && total > 0) {
    findings.push({
      id: "band-a-empty",
      severity: "warning",
      title: t("find.bandAEmpty.title"),
      detail: t("find.bandAEmpty.detail"),
    });
  } else if (bandA.length > 0) {
    if (aMissingSlots.length > 0) {
      findings.push({
        id: "band-a-incomplete",
        severity: "warning",
        title: t("find.bandAIncomplete.title"),
        detail: t("find.bandAIncomplete.detail", { slots: listSlotNames(aMissingSlots, lang) }),
      });
    }

    if (aAllUnknown) {
      // Every Band A pick is a no-data programme – not "no realistic option"
      // (a reach is below a known range; these are simply unestimable). The
      // neutral band-a-no-data note below carries this; don't flag it as risk.
    } else if (aSolid.length === 0 && aBorderline.length === 0) {
      // No Band A pick at/above the median = no real shot. Separate "you
      // have eligible-but-below-median picks" from "nothing even close"
      // (every A-slot is a reach / ineligible / no data).
      const bandARefs = bandA.map(slotRef);
      findings.push({
        id: "band-a-no-anchor",
        severity: "critical",
        title: t("find.noAnchor.title"),
        detail: bandAReviewDetail(),
        slots: bandARefs,
      });
    } else if (aSolid.length === 0) {
      findings.push({
        id: "band-a-borderline",
        severity: "warning",
        title: t("find.borderline.title"),
        detail: bandAReviewDetail(),
        slots: bandA.map(slotRef),
      });
    } else if (aspirationalA1) {
      // A1 is a reach but A2 & A3 are both solid – this is a deliberate dream
      // pick the rest of the band covers, not a problem to flag.
      const dreamRef = slotRef(aWeak[0].p);
      const backupRefs = aLaterSolid.map((x) => slotRef(x.p));
      findings.push({
        id: "band-a-aspirational",
        severity: "good",
        title: t("find.aspirational.title", { slots: listSlots([dreamRef], lang) }),
        detail: t("find.aspirational.detail", {
          dream: listSlots([dreamRef], lang),
          backups: listSlots(backupRefs, lang),
        }),
        slots: [dreamRef, ...backupRefs],
      });
    } else if (aWeak.length > 0) {
      // A strong pick exists, but specific choices are weak – name them.
      const weakRefs = aWeak.map((x) => slotRef(x.p));
      findings.push({
        id: "band-a-weak",
        severity: "warning",
        title: t(weakRefs.length === 1 ? "find.weak.title.one" : "find.weak.title.many", { slots: listSlots(weakRefs, lang) }),
        detail: t(aSolid.length === 1 ? "find.weak.detail.oneSolid" : "find.weak.detail.manySolid", {
          realistic: listSlots(aSolid.map((x) => slotRef(x.p)), lang),
          review: listSlots(weakRefs, lang),
          reasons: weakSummary(aWeak),
          action: bandAAction(),
        }),
        slots: weakRefs,
      });
    } else if (hasBandACoverage) {
      findings.push({
        id: "band-a-ok",
        severity: "good",
        title: t("find.bandAOk.title"),
        detail: t(aSolid.length === 1 ? "find.bandAOk.detail.one" : "find.bandAOk.detail.many", { slots: listSlots(aSolid.map((x) => slotRef(x.p)), lang) }),
        slots: aSolid.map((x) => slotRef(x.p)),
      });
    } else {
      findings.push({
        id: "band-a-thin",
        severity: "warning",
        title: t("find.bandAThin.title"),
        detail: bandAReviewDetail(),
        slots: aSolid.map((x) => slotRef(x.p)),
      });
    }
  }

  // 2b. No-data Band A picks – a new / unrecorded programme has no 2025
  //    benchmark, so we can't estimate chances. This is NOT a risk flag (it's
  //    fine to keep a new programme in Band A); it's a neutral heads-up to
  //    check it directly, since there's no number to fall back on.
  const aNoData = bandA.filter((p) => p.tier === "unknown");
  if (aNoData.length > 0) {
    const ndRefs = aNoData.map(slotRef);
    const one = aNoData.length === 1;
    findings.push({
      id: "band-a-no-data",
      severity: "info",
      title: t(one ? "find.noData.title.one" : "find.noData.title.many", { slots: listSlots(ndRefs, lang) }),
      detail: t(one ? "find.noData.detail.one" : "find.noData.detail.many", { slots: listSlots(ndRefs, lang) }),
      slots: ndRefs,
    });
  }

  // 3. Few-places warning – a small intake means the cut-off can swing a
  //    lot year to year, so even a Band A pick comfortably above the
  //    median isn't as safe as the score alone suggests. Flagged on its
  //    own so it stands out (and getSlotRisk already caps "safe" here).
  // few-places is its own caveat (volatile cut-off) and THIS finding owns it – the
  // weak reasons no longer mention intake, so there's no overlap. Exclude only
  // ineligible picks: a small-intake note is moot when you can't enter at all (and
  // the eligibility finding owns them).
  const aFewPlaces = bandA.filter((p) => p.fewPlaces && p.result.eligibility.eligible);
  if (aFewPlaces.length > 0) {
    const fpRefs = aFewPlaces.map(slotRef);
    const one = aFewPlaces.length === 1;
    // Title shows the actual intake per slot (e.g. "A1（15 個）、A3（22 個）") so the
    // "very few places" warning is concrete; the detail keeps the plain slot list
    // to avoid repeating the number next to "收生人數甚少".
    const fpSlotsWithQuota = aFewPlaces
      .map((p) => lang === "zh" ? `${p.slot}（${p.result.programme.quota} 個）` : `${p.slot} (${p.result.programme.quota})`)
      .join(lang === "zh" ? "、" : ", ");
    findings.push({
      id: "band-a-few-places",
      severity: "warning",
      title: t(one ? "find.fewPlaces.title.one" : "find.fewPlaces.title.many", { slots: fpSlotsWithQuota }),
      detail: t(one ? "find.fewPlaces.detail.one" : "find.fewPlaces.detail.many", { slots: listSlots(fpRefs, lang) }),
      slots: fpRefs,
    });
  }

  // 4. Non-academic requirements – an INFORMATIONAL reminder (interview /
  //    portfolio / audition / test / OEA) for any pick that has one. Never a risk
  //    and never critical: our data may be incomplete and these don't change the
  //    calculated score. Each pick's own chance row already lists its requirements
  //    inline, so here we summarise COMPACTLY by requirement TYPE → which slots
  //    need it (bounded by the ~8 types, not by the number of picks – which kept
  //    the old per-programme enumeration very long).
  // Exclude ineligible picks – reminding someone to prep an interview/portfolio
  // for a programme they can't enter is moot, and double-counts the eligibility
  // finding. Duties are for picks still in play.
  const isTentativeInterviewItem = (it: SelectionItem) => {
    const when = (it.when || "").toLowerCase();
    return it.type === "interview" && (!it.timing || /\bwhen necessary\b|\bif necessary\b|\bif required\b|\bwhere necessary\b/.test(when));
  };
  const dutyPicks = picks
    .map((p) => ({ ...p, selection: p.selection.filter((it) => !isTentativeInterviewItem(it)) }))
    .filter((p) => p.selection.length > 0 && p.result.eligibility.eligible);
  if (dutyPicks.length > 0) {
    const dutyRefs = dutyPicks.map(slotRef);
    const TYPE_ORDER: SelectionType[] = ["interview", "portfolio", "audition", "physical-test", "practical-test", "written-test", "aptitude-test", "oea"];
    const slotSep = lang === "zh" ? "、" : ", ";
    // Group label → slots. Interviews are split by official timing. Vague
    // "when necessary" entries are shown in Detail only, not called out here.
    const groupSlots = new Map<string, string[]>();
    const groupOrder: string[] = [];
    const addGroup = (label: string, slot: string) => {
      let slots = groupSlots.get(label);
      if (!slots) { slots = []; groupSlots.set(label, slots); groupOrder.push(label); }
      if (!slots.includes(slot)) slots.push(slot);
    };
    for (const ty of TYPE_ORDER) {
      for (const p of dutyPicks) {
        for (const it of p.selection) {
          if (it.type !== ty) continue;
          const label = ty === "interview"
            ? (it.timing === "both"
                ? t("find.duties.interviewBoth")
                : it.timing === "post-results"
                ? t("find.duties.interviewAfter")
                : it.timing === "pre-results"
                  ? t("find.duties.interviewBefore")
                  : t(selectionTypeKey(ty)))
            : t(selectionTypeKey(ty));
          addGroup(label, p.slot);
        }
      }
    }
    const groupJoin = lang === "zh" ? "、" : " · ";
    const labelSep = lang === "zh" ? "： " : " – ";
    const groups = groupOrder.map((label) => `${label}${labelSep}${groupSlots.get(label)!.join(slotSep)}`).join(groupJoin);
    findings.push({
      id: "non-academic-duties",
      severity: "info",
      title: t("find.duties.title"),
      detail: t("find.duties.detail", { groups }),
      slots: dutyRefs,
    });
  }

  // 5. Lower-band buffer – B/C choices are not the main strategy, but if the
  //    user fills them anyway, at least one should be clearly above the usual
  //    admitted score range. This is a reminder, not a risk warning.
  const lowerBandPossible = bandB.filter((p) => p.tier === "risky");
  if (bandA.length > 0 && lowerBandPossible.length === 0) {
    const hasLowerBandChoices = bandB.length > 0;
    findings.push({
      id: "lower-band-buffer",
      severity: "info",
      title: t("find.lowerBuffer.title"),
      detail: hasLowerBandChoices
        ? t("find.lowerBuffer.detail.weak", { slots: listSlots(bandB.map(slotRef), lang) })
        : t("find.lowerBuffer.detail.none"),
      slots: hasLowerBandChoices ? bandB.map(slotRef) : undefined,
    });
  }

  // 6. Score-isn't-everything caveat. A published LQ sitting ABOVE the median
  //    can't be a normal score distribution – it signals the programme isn't
  //    selecting on DSE results alone (interview / portfolio / band choice /
  //    other factors), so the numbers are reference-only, not predictive.
  const scoreCaveat = picks.filter((p) => {
    const s = p.result.programme.scores_2025 || {};
    return typeof s.lq === "number" && typeof s.median === "number" && s.lq > s.median;
  });
  if (scoreCaveat.length > 0) {
    const refs = scoreCaveat.map(slotRef);
    const many = refs.length > 1;
    findings.push({
      id: "score-not-decisive",
      severity: "info",
      title: t(many ? "find.scoreCaveat.title.many" : "find.scoreCaveat.title.one", { slots: listSlots(refs, lang) }),
      detail: t(many ? "find.scoreCaveat.detail.many" : "find.scoreCaveat.detail.one"),
      slots: refs,
    });
  }

  // 7. Retaker / repeater. (a) Score penalties actually applied to a pick, and
  //    (b) sitting-combination ("combined certs") rules — the latter only for a
  //    flagged retaker, and even on programmes with no score penalty (the
  //    warning-only HKU picks, e.g. "best single sitting" / "latest results").
  for (const p of picks) {
    const rp = p.result.calculation.retakePenalty;
    if (!rp) continue;
    findings.push({
      id: `retake-penalty-${p.result.programme.jupas_code}`,
      severity: "warning",
      title: t("retake.analysis.penaltyTitle", { code: p.result.programme.jupas_code }),
      detail: t("retake.analysis.penaltyBody", {
        inst: institutionLabel(p.result.programme.institution),
        pts: rp.deducted.toFixed(2),
        score: p.result.calculation.totalScore.toFixed(2),
      }),
      slots: [slotRef(p)],
    });
  }
  if (isRetaker) {
    const CONSIDER_KEY: Record<string, string> = {
      single: "retake.consider.single",
      latest: "retake.consider.latest",
      years: "retake.consider.years",
      sittings: "retake.consider.sittings",
      other: "",
    };
    for (const p of picks) {
      const consideration = classifyConsideration(p.result.programme.retake?.consideration);
      if (!consideration) continue;
      const sentence = CONSIDER_KEY[consideration.kind] ? t(CONSIDER_KEY[consideration.kind]) + " " : "";
      findings.push({
        id: `retake-consider-${p.result.programme.jupas_code}`,
        severity: consideration.severity,
        title: t("retake.analysis.considerTitle", { code: p.result.programme.jupas_code }),
        detail: `${sentence}${t("retake.consider.source", { text: consideration.text })}`,
        slots: [slotRef(p)],
      });
    }
  }

  // 8. Band B reality check — a programme placed BELOW Band A (any B/C/D/E slot)
  //    that gave zero Band B offers on record admits from Band A only, so the
  //    slot is very unlikely to convert (a competitive programme like Medicine
  //    put at C8 is the classic case). Uses the per-band OFFER statistics.
  const bandBNoTake = picks.filter((p) => {
    if (p.index < A_SLOT_COUNT) return false;
    const { known, takes } = takesBandB(p.result.programme);
    return known && !takes;
  });
  if (bandBNoTake.length > 0) {
    const refs = bandBNoTake.map(slotRef);
    const many = refs.length > 1;
    findings.push({
      id: "band-b-no-take",
      severity: "warning",
      title: t(many ? "find.bandBNoTake.title.many" : "find.bandBNoTake.title.one", { slots: listSlots(refs, lang) }),
      detail: t("find.bandBNoTake.detail"),
      slots: refs,
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // Verdict – mirrors the Band A bet, escalated by eligibility.
  let verdict: PortfolioAnalysis["verdict"];
  if (total === 0) {
    verdict = { tone: "info", headline: t("verdict.none.head"), sub: t("verdict.none.sub") };
  } else if (bandA.length === 0) {
    verdict = { tone: "warning", headline: t("verdict.noBandA.head"), sub: t("verdict.noBandA.sub") };
  } else if (aAllUnknown) {
    // Every Band A pick is a no-data programme – we can't estimate, but that's
    // not a failed plan. Stay neutral and point them to check directly.
    verdict = { tone: "info", headline: t("verdict.noData.head"), sub: t("verdict.noData.sub") };
  } else if (aSolid.length === 0) {
    // No Band A pick at/above the median → no real shot. Below-median
    // eligible picks are long shots, not strong picks.
    verdict = aBorderline.length > 0
      ? {
          tone: "warning",
          headline: t("verdict.borderline.head"),
          sub: t("verdict.borderline.sub", { slots: listSlots(aBorderline.map((x) => slotRef(x.p)), lang) }),
        }
      : aMarginal.length > 0
      ? { tone: "critical", headline: t("verdict.noSolid.head"), sub: t("verdict.noSolid.sub") }
      : { tone: "critical", headline: t("verdict.noOffer.head"), sub: t("verdict.noOffer.sub") };
  } else if (aspirationalA1) {
    verdict = {
      tone: "good",
      headline: t("verdict.aspirational.head"),
      sub: t(aLaterSolid.length === 1 ? "verdict.aspirational.sub.one" : "verdict.aspirational.sub.many", {
        dream: listSlots([slotRef(aWeak[0].p)], lang),
        backups: listSlots(aLaterSolid.map((x) => slotRef(x.p)), lang),
      }),
    };
  } else if (aBlocked.length > 0) {
    // An ineligible Band A pick beside a realistic anchor → critical (the slot
    // can't yield an offer). A score-reach alone does NOT reach here; it falls
    // to the "weak" branch below as a warning, matching its band-a-weak finding.
    // The sub names ONLY the ineligible pick(s) – weak/reach picks get their own
    // band-a-weak finding, so don't lump them under "ineligible" in this verdict.
    verdict = {
      tone: "critical",
      headline: t("verdict.followup.head"),
      sub: t("verdict.followup.sub", {
        blocked: listSlots(aBlocked.map((x) => slotRef(x.p)), lang),
      }),
    };
  } else if (aWeak.length > 0) {
    const weakRefs = aWeak.map((x) => slotRef(x.p));
    const solidRefs = aSolid.map((x) => slotRef(x.p));
    verdict = {
      tone: "warning",
      headline: t(aWeak.length === 1 ? "verdict.weak.head.one" : "verdict.weak.head.many", { slots: listSlots(weakRefs, lang) }),
      sub: t(aWeak.length === 1 ? "verdict.weak.sub.one" : "verdict.weak.sub.many", {
        problems: listSlots(weakRefs, lang),
        solid: listSlots(solidRefs, lang),
      }),
    };
  } else if (!hasBandACoverage) {
    verdict = {
      tone: "warning",
      headline: t("verdict.thin.head"),
      sub: t("verdict.thin.sub", { slots: listSlots(aSolid.map((x) => slotRef(x.p)), lang) }),
    };
  } else {
    verdict = { tone: "good", headline: t("verdict.good.head"), sub: t(aSolid.length === 1 ? "verdict.good.sub.one" : "verdict.good.sub.many", { n: aSolid.length }) };
  }

  return { total, eligibleCount, institutions, picks, bandA, bandB, findings, verdict };
}
