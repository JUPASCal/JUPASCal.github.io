// Alternative-suggestions audit — runs the REAL suggestAlternatives over the
// real dataset for a spread of profiles, prints what it proposes, and asserts
// invariants. Mirrors analysis_cases.mjs (esbuild-bundle the shipped TS).
//
// Run from staging/:  node scripts/suggestions_audit.mjs  (npm run audit:suggestions)
//
// Invariants (exit non-zero on violation):
//   1. Every suggestion is ELIGIBLE for the student.
//   2. Every suggestion sits at/above its own median (band ∈ {uq, med}).
//   3. No suggestion is a programme already picked.
//   4. No suggestion is the very pick it backs up.
//   5. ≤ 18 suggestions total (6 per slot × 3 A-slots); each forSlot is A1–A3.
//   6. A suggestion's median ≤ the median of the pick it backs up.
//   7. The section shows when there is ≥1 risky Band-A pick OR ≥1 backup found;
//      risky-slot backups rank before safe-slot ("just in case") ones.

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(HERE, ".."); // repo root (app now lives at root)
const ROOT = STAGING;
const DATA_FILE = resolve(ROOT, "data/processed/JUPAS_2026_Unified_Data.json");

async function loadModule(entry) {
  const res = await build({
    entryPoints: [entry], bundle: true, write: false,
    format: "esm", platform: "node", logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(res.outputFiles[0].text).toString("base64"));
}

const { buildProgrammeResult, effectiveBenchmarks } = await loadModule(resolve(STAGING, "src/lib/results.ts"));
const { getSlotRisk } = await loadModule(resolve(STAGING, "src/lib/analysis.ts"));
const { suggestAlternatives } = await loadModule(resolve(STAGING, "src/lib/suggestions.ts"));
const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const byCode = Object.fromEntries(data.map((p) => [p.jupas_code, p]));

const G = (core, electives) => ({
  "Chinese Language": core, "English Language": core,
  "Mathematics (Compulsory Part)": core,
  "Citizenship and Social Development": "Attained",
  ...electives,
});
const SCI = (g) => ({ "Biology": g, "Chemistry": g, "Physics": g });
const ARTS = (g) => ({ "Economics": g, "History": g, "Geography": g });

// Profiles chosen to create some reach Band-A picks. We pick, per profile, the
// 3 programmes the student sits furthest BELOW the median on (guaranteed reach),
// so the engine has risky picks to react to.
const PROFILES = {
  "mid-sci": G("4", SCI("4")),
  "mid-arts": G("4", ARTS("4")),
  "strong-sci": G("5", SCI("5")),
  "borderline": G("3", { "Biology": "3", "Economics": "3" }),
  "top-sci (no risky expected)": G("5**", SCI("5**")),
};

const RISKY = new Set(["risky", "high-risk", "unsafe", "blocked"]);
let violations = 0;
const fail = (m) => { violations++; console.log("   ✗ " + m); };

function marginBelowMedian(p, grades) {
  const r = buildProgrammeResult(p, grades);
  const med = effectiveBenchmarks(p).median;
  if (med == null || r.calculation.totalScore == null) return null;
  return med - r.calculation.totalScore; // >0 means below median (a reach)
}

console.log("Alternative-suggestions audit\n" + "=".repeat(78));

for (const [name, grades] of Object.entries(PROFILES)) {
  // Build a reachy Band-A: 3 most-below-median eligible-or-not programmes.
  const ranked = data
    .map((p) => ({ p, m: marginBelowMedian(p, grades) }))
    .filter((x) => x.m != null)
    .sort((a, b) => b.m - a.m);
  const aPicks = ranked.slice(0, 3).map((x) => x.p.jupas_code);
  // add two safe-ish lower picks for realism
  const safe = ranked.slice(-2).map((x) => x.p.jupas_code);
  const codes = [...aPicks, ...safe];
  const picks = codes.map((c) => buildProgrammeResult(byCode[c], grades));
  const pickedCodes = new Set(codes);

  const { hasRiskyPicks, show, suggestions, reason } = suggestAlternatives(picks, data.map((p) => buildProgrammeResult(p, grades)));

  // Recompute which A-picks are risky for the report + invariant 7.
  const riskyA = picks.slice(0, 3)
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => RISKY.has(getSlotRisk(r, i)));

  console.log(`\n▌ ${name}`);
  console.log(`  risky Band-A: ${riskyA.map(({ r, i }) => `A${i + 1} ${r.programme.jupas_code} (${getSlotRisk(r, i)})`).join(", ") || "(none)"}`);
  console.log(`  hasRiskyPicks=${hasRiskyPicks} show=${show} suggestions=${suggestions.length}${reason ? " reason=" + reason : ""}`);
  for (const s of suggestions) {
    const med = effectiveBenchmarks(s.result.programme).median;
    console.log(`    + ${s.result.programme.jupas_code} ${s.result.programme.institution}  band=${s.band} sim=${s.similarity} fac=${s.sharedFaculty} med=${med}  ← backup for ${s.forSlot} ${s.forCode}`);
  }

  // ── invariants ──
  if (hasRiskyPicks !== (riskyA.length > 0)) fail(`${name}: hasRiskyPicks=${hasRiskyPicks} but riskyA=${riskyA.length}`);
  if (show !== (riskyA.length > 0 || suggestions.length > 0)) fail(`${name}: show=${show} but risky=${riskyA.length} suggestions=${suggestions.length}`);
  if (suggestions.length > 18) fail(`${name}: ${suggestions.length} suggestions > 18 (6 per slot × 3)`);
  const pickMedByCode = Object.fromEntries(picks.map((r) => [r.programme.jupas_code, effectiveBenchmarks(r.programme).median]));
  for (const s of suggestions) {
    const code = s.result.programme.jupas_code;
    if (!s.result.eligibility.eligible) fail(`${name}: ${code} not eligible`);
    if (!(s.band === "uq" || s.band === "med")) fail(`${name}: ${code} band=${s.band}`);
    if (pickedCodes.has(code)) fail(`${name}: ${code} already picked`);
    if (code === s.forCode) fail(`${name}: ${code} backs up itself`);
    if (!/^A[1-3]$/.test(s.forSlot)) fail(`${name}: ${code} forSlot=${s.forSlot}`);
    if (picks[s.forSlotIndex]?.programme.jupas_code !== s.forCode) fail(`${name}: ${code} forSlotIndex ${s.forSlotIndex} != ${s.forCode}`);
    if (s.forSlotRisky !== RISKY.has(getSlotRisk(picks[s.forSlotIndex], s.forSlotIndex))) fail(`${name}: ${code} forSlotRisky=${s.forSlotRisky} mismatches slot ${s.forSlot} risk`);
    const candMed = effectiveBenchmarks(s.result.programme).median;
    const pickMed = pickMedByCode[s.forCode];
    if (candMed != null && pickMed != null && candMed > pickMed)
      fail(`${name}: ${code} median ${candMed} > pick ${s.forCode} median ${pickMed}`);
  }
  // Risky-slot backups must rank before safe-slot ("just in case") backups.
  let seenSafe = false;
  for (const s of suggestions) {
    if (!s.forSlotRisky) seenSafe = true;
    else if (seenSafe) { fail(`${name}: risky-slot backup ${s.result.programme.jupas_code} ranked after a safe-slot backup`); break; }
  }
}

console.log("\n" + "=".repeat(78));
console.log(violations === 0 ? "ALL INVARIANTS HOLD ✓" : `${violations} violation(s) — review above.`);
process.exit(violations === 0 ? 0 : 1);
