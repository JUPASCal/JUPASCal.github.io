import type { Programme } from "../types/jupas";

// HKDSE retake / repeater support. Two institution models live in the data
// (`programme.retake`, from data/raw/retake_2026.json → unify 4b-i-retake):
//   • HKU  — 10% off each RETAKEN subject's contribution, for a short explicit
//            list of programmes only (Medicine/BioMed etc.). Every other HKU
//            programme carries only a `consideration` (which sittings combine),
//            surfaced as an informational "combined certs" warning.
//   • CUHK — a band off the WHOLE admission score for retakers, for the listed
//            programmes only. The band is a RANGE, so we apply its worst-case
//            upper bound (see cuhkWorstCaseFactor) and label the score estimated.
// The calculator consumes cuhkWorstCaseFactor + the `retake.penalty` flag; the
// UI (DetailPanel, Analysis) consumes classifyConsideration for the warnings.

export const HKU_RETAKE_RATE = 0.1; // "10%" off the retaken subject

// CUHK band → the worst-case (largest) multiplier we keep of the score. The
// bands are open ranges, so the upper bound is the conservative planning figure:
//   "5% or less" → up to 5% off → keep 95%
//   "6% to 10%"  → up to 10% off → keep 90%
export function cuhkWorstCaseFactor(band: string | null | undefined): number {
  if (!band) return 1;
  const nums = band.match(/\d+/g)?.map(Number) ?? [];
  const worstPct = nums.length ? Math.max(...nums) : 0;
  return 1 - worstPct / 100;
}

// Does this programme deduct a score penalty for retakers (vs. warning-only)?
export function hasRetakeScorePenalty(programme: Programme): boolean {
  return Boolean(programme.retake?.penalty);
}

// The severity + machine-readable kind of an HKU sitting-combination rule. The
// render layer maps `kind` to a localized sentence (strings.ts); `severity`
// drives the tone. `single` and `latest` are the retaker-hostile ones:
//   • single  — only ONE sitting is counted, so a retaker CANNOT mix a better
//               subject from a different year into the same offer.
//   • latest  — the LATEST sitting's grade is used (not the best), so a subject
//               that dropped in a later resit actively hurts.
//   • years   — best across specific listed years only.
//   • sittings — best across the latest N (or "2 or more") sittings.
export type ConsiderationKind = "single" | "latest" | "years" | "sittings" | "other";

export type RetakeConsideration = {
  kind: ConsiderationKind;
  severity: "warning" | "info";
  text: string; // the raw source phrasing, shown as a quote
};

export function classifyConsideration(raw: string | null | undefined): RetakeConsideration | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/\bsingle sitting\b/.test(lower)) {
    return { kind: "single", severity: "warning", text };
  }
  if (/^latest results\b/.test(lower)) {
    return { kind: "latest", severity: "warning", text };
  }
  if (/\bsitting/.test(lower)) {
    return { kind: "sittings", severity: "info", text };
  }
  if (/\byear\b/.test(lower)) {
    return { kind: "years", severity: "info", text };
  }
  return { kind: "other", severity: "info", text };
}

// The consideration attached to a programme (HKU only today), classified.
export function programmeConsideration(programme: Programme): RetakeConsideration | null {
  return classifyConsideration(programme.retake?.consideration);
}
