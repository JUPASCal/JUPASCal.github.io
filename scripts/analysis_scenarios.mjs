// Analysis-engine scenario harness — exhaustive invariant check over the
// portfolio-strategy read (src/lib/analysis.ts → analyzePortfolio).
//
// Run from the staging/ directory:   node scripts/analysis_scenarios.mjs
//                                     (or `npm run audit:analysis`)
//
// Why this works: analyzePortfolio is a PURE function of a small feature set per
// pick — the score-band the pick falls in (uq / med / near-med / near-lq /
// below-lq / far-below-lq / unknown), whether it's eligible, whether it needs an
// interview, and whether it has few places — plus portfolio-level counts. So the
// decision space is small enough to enumerate EXHAUSTIVELY rather than sample.
// We synthesise ProgrammeResults that land in each band (by setting scores +
// total so getScoreBand returns it) and feed the REAL analyzePortfolio.
//
// We don't assert a hand-written "correct" verdict for every case (that would
// just re-encode the logic). Instead we check INVARIANTS — properties that must
// hold for ANY sane portfolio read — and report violations as review candidates:
//   A. A "good" verdict must not coexist with a `critical` finding.
//   B. A "good" verdict must not coexist with a negative Band-A finding.
//   C. Exactly ONE primary Band-A finding fires when Band A is non-empty
//      (zero only when every filled Band-A pick is no-data).
//   D. Monotonicity — improving one slot's score-band by one step must never
//      make the verdict MORE alarming.
//   E. The verdict must not be MORE alarming than its worst finding.
//   F. Modifier wiring — the few-places / interview-stack findings fire exactly
//      when their conditions hold.
//   G. Band-B independence — the VERDICT depends only on Band A; adding or
//      changing Band-B / lower picks must never change it.
//   H. Modifier monotonicity — removing an interview/few-places risk flag from a
//      slot must never make the verdict MORE alarming.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(HERE, "..");

async function loadModule(entry) {
  const res = await build({
    entryPoints: [entry], bundle: true, write: false,
    format: "esm", platform: "node", logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(res.outputFiles[0].text).toString("base64"));
}

const { analyzePortfolio } = await loadModule(resolve(STAGING, "src/lib/analysis.ts"));
const t = (k) => k; // identity → finding titles come back as their i18n keys

// ── Band → synthetic scores/total ────────────────────────────────────────────
// Fixed reference: median 30, lq 27, uq 33  ⇒  rawSpread 3, spread 3.
//   uq:33  med:[30,33)  near-med:[28.5,30)  near-lq:[27,28.5)
//   below-lq:[24,27)  far-below-lq:(<24)
const TOTAL = {
  uq: 35, med: 31, "near-med": 29, "near-lq": 27.5, "below-lq": 25, "far-below-lq": 20, unknown: 30,
};
const KNOWN_BANDS = ["far-below-lq", "below-lq", "near-lq", "near-med", "med", "uq"]; // worst→best
// Per-slot input states: the 7 bands, plus "ineligible" and "empty".
const SLOT_STATES = ["uq", "med", "near-med", "near-lq", "below-lq", "far-below-lq", "unknown", "ineligible", "empty"];
const FILLED_STATES = SLOT_STATES.filter((s) => s !== "empty"); // 8

let codeSeq = 0;
// A Band-B-class pick (index ≥ 3): same band machinery, just placed lower.
function mkPick(state, { interview = false, fewPlaces = false } = {}) {
  if (state === "empty") return null;
  const eligible = state !== "ineligible";
  const band = eligible ? state : "med"; // ineligible: band irrelevant (blocked first)
  const scores = band === "unknown" ? { median: null, lq: null, uq: null } : { median: 30, lq: 27, uq: 33 };
  return {
    eligibility: { eligible, details: [] },
    calculation: { totalScore: TOTAL[band] },
    comparisons: [], band: "x", hasScoreData: band !== "unknown",
    programme: {
      jupas_code: "JS" + String(1000 + codeSeq++),
      institution: "HKU",
      scores_2025: scores,
      quota: fewPlaces ? 15 : 120,
      offer_statistics: [],
      ...(interview ? { jupas_requirements: { notes: ["Interview required"] } } : {}),
    },
  };
}

// states: per-slot state; opts: per-slot {interview,fewPlaces}; tail: extra
// (Band-B+) picks appended after A1-A3, each {state,interview?,fewPlaces?,inst?}.
function analyze(states, opts = [], tail = []) {
  codeSeq = 0;
  const picks = states.map((s, i) => mkPick(s, opts[i] || {}));
  for (const b of tail) {
    const p = mkPick(b.state, b);
    if (p && b.inst) p.programme.institution = b.inst;
    picks.push(p);
  }
  const a = analyzePortfolio(picks, t, "en");
  return {
    tone: a.verdict.tone,
    headline: a.verdict.headline,
    findings: a.findings.map((f) => ({ id: f.id, sev: f.severity })),
  };
}

const PRIMARY = ["band-a-no-anchor", "band-a-borderline", "band-a-aspirational", "band-a-weak", "band-a-ok", "band-a-thin"];
const NEGATIVE_BANDA = ["band-a-no-anchor", "band-a-borderline", "band-a-weak", "band-a-thin", "band-a-incomplete"];
const TONE_ALARM = { good: 0, info: 1, warning: 2, critical: 3 };
const SEV_ALARM = { good: 0, info: 1, warning: 2, critical: 3 };

const violations = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [] };
const fmt = (states, opts = []) =>
  "[" + states.map((s, i) => {
    const o = opts[i] || {}; const tags = [o.interview && "iv", o.fewPlaces && "fp"].filter(Boolean);
    return s + (tags.length ? `+${tags.join("+")}` : "");
  }).join(", ") + "]";
const findStr = (r) => r.findings.map((f) => `${f.sev}:${f.id}`).join("  ") || "(none)";

// Shared per-scenario invariant checks (A/B/C/E/F).
function checkScenario(states, opts, r) {
  const filled = states.map((s, i) => ({ s, i, o: opts[i] || {} })).filter((x) => x.s !== "empty");
  if (filled.length === 0) return;
  const ids = new Set(r.findings.map((f) => f.id));
  const hasCritical = r.findings.some((f) => f.sev === "critical");
  const primaryCount = PRIMARY.filter((id) => ids.has(id)).length;
  const allFilledUnknown = filled.every((x) => x.s === "unknown");

  if (r.tone === "good" && hasCritical) violations.A.push({ states, opts, r });
  if (r.tone === "good" && NEGATIVE_BANDA.some((id) => ids.has(id))) violations.B.push({ states, opts, r });
  const expectPrimary = allFilledUnknown ? 0 : 1;
  if (primaryCount !== expectPrimary) violations.C.push({ states, opts, r, primaryCount, expectPrimary });

  const maxFinding = r.findings.reduce((m, f) => Math.max(m, SEV_ALARM[f.sev]), 0);
  if (TONE_ALARM[r.tone] > maxFinding) violations.E.push({ states, opts, r, maxFinding });

  // F. modifier wiring. few-places fires for any ELIGIBLE Band-A pick with a small
  // intake; ineligible picks are excluded (the eligibility finding owns them — a
  // small-intake note is moot when you can't enter). Interview/portfolio is
  // informational (`non-academic-duties`), not a risk finding, so not checked here.
  const anyFewPlaces = filled.some((x) => x.o.fewPlaces && x.s !== "ineligible");
  if (ids.has("band-a-few-places") !== anyFewPlaces) violations.F.push({ states, opts, r, which: "few-places" });
}

let n = 0;

// ── Pass 1: core Band A, no modifiers (9³, minus all-empty) ───────────────────
for (const s1 of SLOT_STATES) for (const s2 of SLOT_STATES) for (const s3 of SLOT_STATES) {
  const states = [s1, s2, s3];
  if (states.every((s) => s === "empty")) continue;
  n++; checkScenario(states, [], analyze(states));
}

// ── Pass 2: with interview / few-places modifiers (8 filled states × 4 mods)³ ──
// Interview is no longer a risk input (it's an informational reminder), so the
// only risk-affecting modifier left to fuzz is few-places.
const MODS = [{}, { fewPlaces: true }];
for (const s1 of FILLED_STATES) for (const m1 of MODS)
  for (const s2 of FILLED_STATES) for (const m2 of MODS)
    for (const s3 of FILLED_STATES) for (const m3 of MODS) {
      const states = [s1, s2, s3], opts = [m1, m2, m3];
      n++; checkScenario(states, opts, analyze(states, opts));
    }

// ── Pass D: monotonicity over known bands (6³), all eligible, no mods ──────────
let dChecked = 0;
for (const s1 of KNOWN_BANDS) for (const s2 of KNOWN_BANDS) for (const s3 of KNOWN_BANDS) {
  const base = [s1, s2, s3];
  const baseR = analyze(base);
  for (let i = 0; i < 3; i++) {
    const bi = KNOWN_BANDS.indexOf(base[i]);
    if (bi === KNOWN_BANDS.length - 1) continue;
    const better = [...base]; better[i] = KNOWN_BANDS[bi + 1];
    const betterR = analyze(better); dChecked++;
    if (TONE_ALARM[betterR.tone] > TONE_ALARM[baseR.tone]) violations.D.push({ base, baseR, slot: i, better, betterR });
  }
}

// ── Pass G: Band-B independence — the verdict must not change with lower picks ──
// For every core Band-A config, the verdict must be identical with no tail and
// with assorted Band-B/C tails (strong / reach / ineligible / no-data / a full
// same-institution lower band that also trips the institution-concentration note).
let gChecked = 0;
const TAILS = [
  [{ state: "uq" }],
  [{ state: "far-below-lq" }],
  [{ state: "ineligible" }],
  [{ state: "unknown" }],
  [{ state: "uq" }, { state: "med" }, { state: "near-lq" }], // total ≥ 6, same inst
];
for (const s1 of SLOT_STATES) for (const s2 of SLOT_STATES) for (const s3 of SLOT_STATES) {
  const states = [s1, s2, s3];
  if (states.every((s) => s === "empty")) continue;
  const baseR = analyze(states);
  for (const tail of TAILS) {
    const r = analyze(states, [], tail); gChecked++;
    if (r.tone !== baseR.tone || r.headline !== baseR.headline)
      violations.G.push({ states, baseR, tail, r });
  }
}

// ── Pass H: modifier monotonicity — clearing a risk flag can't worsen verdict ──
let hChecked = 0;
for (const s1 of KNOWN_BANDS) for (const s2 of KNOWN_BANDS) for (const s3 of KNOWN_BANDS) {
  const states = [s1, s2, s3];
  for (const flag of ["fewPlaces"]) {
    for (let i = 0; i < 3; i++) {
      const onOpts = [{}, {}, {}]; onOpts[i] = { [flag]: true };
      const on = analyze(states, onOpts);
      const off = analyze(states); hChecked++;
      if (TONE_ALARM[off.tone] > TONE_ALARM[on.tone])
        violations.H.push({ states, flag, slot: i, on, off });
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`Scenarios (A/B/C/E/F): ${n}   D: ${dChecked}   G: ${gChecked}   H: ${hChecked}\n`);

function report(key, title, rows, render) {
  console.log(`── ${key}. ${title} — ${rows.length} violation(s)`);
  rows.slice(0, 12).forEach((v) => console.log("   " + render(v)));
  if (rows.length > 12) console.log(`   … +${rows.length - 12} more`);
  if (rows.length === 0) console.log("   ✓ none");
  console.log("");
}

report("A", '"good" verdict + a CRITICAL finding', violations.A,
  (v) => `${fmt(v.states, v.opts)} → ${v.r.tone}/${v.r.headline}  |  ${findStr(v.r)}`);
report("B", '"good" verdict + a negative Band-A finding', violations.B,
  (v) => `${fmt(v.states, v.opts)} → ${v.r.tone}/${v.r.headline}  |  ${findStr(v.r)}`);
report("C", "primary Band-A finding count off", violations.C,
  (v) => `${fmt(v.states, v.opts)} got ${v.primaryCount} expected ${v.expectPrimary}  |  ${findStr(v.r)}`);
report("D", "monotonicity — improving a slot made the verdict MORE alarming", violations.D,
  (v) => `${fmt(v.base)} ${v.baseR.tone} → bump A${v.slot + 1} → ${fmt(v.better)} ${v.betterR.tone}  (${v.baseR.headline} → ${v.betterR.headline})`);
report("E", "verdict MORE alarming than its worst finding", violations.E,
  (v) => `${fmt(v.states, v.opts)} → verdict ${v.r.tone}  |  ${findStr(v.r)}`);
report("F", "few-places / interview-stack finding mis-wired", violations.F,
  (v) => `${fmt(v.states, v.opts)} [${v.which}]  |  ${findStr(v.r)}`);
report("G", "Band-B/lower picks changed the verdict", violations.G,
  (v) => `${fmt(v.states)} ${v.baseR.tone}/${v.baseR.headline} → +tail ${JSON.stringify(v.tail.map((x) => x.state))} → ${v.r.tone}/${v.r.headline}`);
report("H", "clearing an interview/few-places flag made the verdict MORE alarming", violations.H,
  (v) => `${fmt(v.states)} ${v.flag}@A${v.slot + 1}: off=${v.off.tone} on=${v.on.tone}  (off ${v.off.headline} vs on ${v.on.headline})`);

const total = Object.values(violations).reduce((s, a) => s + a.length, 0);
console.log(total === 0 ? "ALL INVARIANTS HOLD ✓" : `${total} invariant violation(s) — review above.`);
process.exit(total === 0 ? 0 : 1);
