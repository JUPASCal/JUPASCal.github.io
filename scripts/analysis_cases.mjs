// End-to-end analysis-mode case harness — complements analysis_scenarios.mjs.
//
// Run from staging/:   node scripts/analysis_cases.mjs
//
// Where analysis_scenarios.mjs fuzzes analyzePortfolio over SYNTHETIC bands to
// prove the logic's invariants, THIS harness runs the REAL pipeline end to end:
//   real grades → calculateScore → checkEligibility → buildProgrammeResult →
//   getSelection (interview/portfolio) → analyzePortfolio
// against the REAL 2026 dataset. It surfaces "weird out of the box" behaviour
// that only shows up with real data: odd score bands, real interview programmes,
// cross-institution quirks, eligibility failures, ordering sensitivity, etc.
//
// It prints a compact block per case for human review, AND auto-flags a handful
// of "this should never happen with real data" sanity checks (⚠ lines).

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildDefines } from "./utils/build_defines.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(HERE, ".."); // repo root (app now lives at root)
const ROOT = STAGING;
const DATA_FILE = resolve(ROOT, "data/processed/JUPAS_2026_Unified_Data.json");
const REGISTRY_FILE = resolve(ROOT, "data/raw/subjects.canonical.json");

async function loadModule(entry) {
  const res = await build({
    entryPoints: [entry], bundle: true, write: false,
    format: "esm", platform: "node", logLevel: "silent",
    define: buildDefines,
  });
  return import("data:text/javascript;base64," + Buffer.from(res.outputFiles[0].text).toString("base64"));
}

const { buildProgrammeResult } = await loadModule(resolve(STAGING, "src/lib/results.ts"));
const { analyzePortfolio } = await loadModule(resolve(STAGING, "src/lib/analysis.ts"));
const { getSelection } = await loadModule(resolve(STAGING, "src/lib/selection.ts"));
const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const byCode = Object.fromEntries(data.map((p) => [p.jupas_code, p]));
const t = (k) => k; // identity → finding titles are their i18n keys

// ── Grade profiles ───────────────────────────────────────────────────────────
// Core (4 subjects everyone takes). CSD is Attained/Not. We vary the elective mix
// + the overall grade level to sweep score ranges and science/arts/mixed loads.
const G = (core, electives) => ({
  "Chinese Language": core, "English Language": core,
  "Mathematics (Compulsory Part)": core,
  "Citizenship and Social Development": "Attained",
  ...electives,
});
const SCI = (g) => ({ "Biology": g, "Chemistry": g, "Physics": g });
const ARTS = (g) => ({ "Economics": g, "History": g, "Geography": g });
const MIXED = (g) => ({ "Biology": g, "Economics": g, "Mathematics (Extended Part) Module 2": g });

const PROFILES = {
  "top-sci":        G("5**", SCI("5**")),
  "top-arts":       G("5**", ARTS("5**")),
  "strong-sci":     G("5*", SCI("5*")),
  "strong-mixed":   G("5*", MIXED("5")),
  "mid-sci":        G("4", SCI("4")),
  "mid-arts":       G("4", ARTS("4")),
  "mid-mixed":      G("4", MIXED("4")),
  "borderline":     G("3", { "Biology": "3", "Economics": "3" }),
  "weak":           G("2", { "Biology": "2", "Economics": "2" }),
  "fail-eng":       G("3", { ...SCI("4") }), // English forced low below
  "minimal":        G("3", { "Biology": "3" }), // one elective only
  "m1-heavy":       G("5", { "Physics": "5", "Chemistry": "5", "Mathematics (Extended Part) Module 1": "5*" }),
};
PROFILES["fail-eng"]["English Language"] = "2"; // many programmes need Eng L3

// ── Helpers to pick real programmes by criteria, relative to a profile ─────────
const needsInterview = (p) => getSelection(p).items.some((s) => s.type === "interview");
const scored = (grades, p) => {
  const r = buildProgrammeResult(p, grades);
  return { r, score: r.calculation.totalScore, eligible: r.eligibility.eligible, hasData: r.hasScoreData };
};
// position of a profile's score vs a programme's median: >0 above, <0 below.
function marginVsMedian(grades, p) {
  const r = buildProgrammeResult(p, grades);
  const med = (r.comparisons.find((c) => c.key === "median") || {}).score;
  if (med == null || r.calculation.totalScore == null) return null;
  return r.calculation.totalScore - med;
}
// pick N codes matching a predicate, optionally sorted by a key fn (desc)
function pick(pred, n, sortKey) {
  let list = data.filter(pred);
  if (sortKey) list = list.sort((a, b) => (sortKey(b) ?? -1e9) - (sortKey(a) ?? -1e9));
  return list.slice(0, n).map((p) => p.jupas_code);
}

// ── Case builder ───────────────────────────────────────────────────────────────
const CASES = [];
const add = (label, profile, codes) => CASES.push({ label, profile, codes });

// Reusable code pools (computed once, profile-independent where possible)
const IV = data.filter(needsInterview);              // interview-gated programmes
const NOIV = data.filter((p) => !needsInterview(p)); // no interview
const INSTS = ["HKU", "CUHK", "HKUST", "PolyU", "CityUHK", "HKBU", "LingnanU", "EdUHK", "HKMU", "SSSDP"];
const byInst = (inst) => data.filter((p) => p.institution === inst);
const fewPlaces = data.filter((p) => typeof p.quota === "number" && p.quota > 0 && p.quota <= 20);

// 1. Per-profile: realistic reach / match / safe portfolios (relative to score) ──
for (const [name, grades] of Object.entries(PROFILES)) {
  // rank all programmes by how far the profile sits below the median (reach = most below)
  const withMargin = data
    .map((p) => ({ p, m: marginVsMedian(grades, p) }))
    .filter((x) => x.m != null);
  const reach = [...withMargin].sort((a, b) => a.m - b.m).slice(0, 3).map((x) => x.p.jupas_code);   // most below median
  const safe  = [...withMargin].sort((a, b) => b.m - a.m).slice(0, 3).map((x) => x.p.jupas_code);   // most above median
  const match = [...withMargin].sort((a, b) => Math.abs(a.m) - Math.abs(b.m)).slice(0, 3).map((x) => x.p.jupas_code); // near median
  add(`${name} · all-reach`, name, reach);
  add(`${name} · all-safe`, name, safe);
  add(`${name} · all-match`, name, match);
  // realistic mix: reach A1, match A2, safe A3, + 3 lower band
  add(`${name} · reach→safe ladder +bandB`, name, [reach[0], match[0], safe[0], reach[1], match[1], safe[1]]);
}

// 2. Ordering sensitivity: same 3 programmes, different A1/A2/A3 order ──────────
{
  const g = "strong-mixed";
  const m = CASES.find((c) => c.label.startsWith(g) && c.label.includes("match")).codes;
  const trio = [m[0], m[1], m[2]];
  add(`${g} · order ABC`, g, [trio[0], trio[1], trio[2]]);
  add(`${g} · order CBA`, g, [trio[2], trio[1], trio[0]]);
  add(`${g} · order BCA`, g, [trio[1], trio[2], trio[0]]);
}

// 3. Interview vs no-interview Band A ──────────────────────────────────────────
add("top-sci · all-interview BandA", "top-sci", IV.slice(0, 3).map((p) => p.jupas_code));
add("top-sci · all-no-interview BandA", "top-sci", NOIV.slice(0, 3).map((p) => p.jupas_code));
add("mid-mixed · interview stack (3 IV)", "mid-mixed", IV.slice(0, 3).map((p) => p.jupas_code));
add("strong-sci · 1 IV + 2 noIV", "strong-sci", [IV[0].jupas_code, NOIV[0].jupas_code, NOIV[1].jupas_code]);

// 4. Cross-institution spread ──────────────────────────────────────────────────
add("top-arts · 6 institutions", "top-arts", INSTS.slice(0, 6).map((i) => byInst(i)[0]?.jupas_code).filter(Boolean));
add("strong-mixed · all-same-inst (HKU)", "strong-mixed", byInst("HKU").slice(0, 5).map((p) => p.jupas_code));
add("mid-sci · self-funded mix (HKMU+SSSDP)", "mid-sci",
  [...byInst("HKMU").slice(0, 2), ...byInst("SSSDP").slice(0, 2)].map((p) => p.jupas_code));

// 5. Few-places (small intake) programmes ──────────────────────────────────────
add("top-sci · 3 few-places", "top-sci", fewPlaces.slice(0, 3).map((p) => p.jupas_code));
add("mid-arts · 1 few-places + 2 normal", "mid-arts",
  [fewPlaces[0]?.jupas_code, NOIV[0].jupas_code, NOIV[1].jupas_code].filter(Boolean));

// 6. Failure / eligibility scenarios ───────────────────────────────────────────
// fail-eng student aimed at competitive programmes → expect ineligibility findings
add("fail-eng · competitive reach", "fail-eng", pick((p) => p.institution === "HKU", 3));
add("weak · top-tier reach (ineligible-ish)", "weak", pick((p) => p.institution === "CUHK", 3));
add("minimal · 1 elective vs sci-heavy progs", "minimal", pick((p) => p.institution === "HKUST", 3));

// 7. Sparse / degenerate portfolios ────────────────────────────────────────────
add("strong-mixed · single pick", "strong-mixed", [CASES[0].codes[0]]);
add("strong-mixed · two picks", "strong-mixed", byInst("PolyU").slice(0, 2).map((p) => p.jupas_code));
add("strong-mixed · gap A1 empty", "strong-mixed", [null, byInst("HKU")[0].jupas_code, byInst("CUHK")[0].jupas_code]);
add("strong-mixed · only Band B (A empty)", "strong-mixed",
  [null, null, null, byInst("HKU")[0].jupas_code, byInst("CUHK")[0].jupas_code]);
add("strong-mixed · full 6 picks", "strong-mixed",
  INSTS.slice(0, 6).map((i) => byInst(i)[0]?.jupas_code).filter(Boolean));

// 8. No-score-data programmes (if any lack benchmarks) ──────────────────────────
const noData = data.filter((p) => buildProgrammeResult(PROFILES["top-sci"], p).comparisons.length === 0);
if (noData.length) add("top-sci · no-benchmark-data progs", "top-sci", noData.slice(0, 3).map((p) => p.jupas_code));

// ── Run + report ───────────────────────────────────────────────────────────────
const SEV_ICON = { critical: "🔴", warning: "🟠", info: "🔵", good: "🟢" };
let warnFlags = 0;
const flag = (msg) => { warnFlags++; return "   ⚠ " + msg; };

console.log(`Running ${CASES.length} end-to-end analysis cases against ${data.length} real programmes\n`);
console.log("=".repeat(90));

for (const c of CASES) {
  const grades = PROFILES[c.profile];
  const picks = c.codes.map((code) => (code ? buildProgrammeResult(byCode[code], grades) : null));
  const a = analyzePortfolio(picks, t, "en");

  const lines = [];
  lines.push(`\n▌ ${c.label}`);
  lines.push(`  verdict: ${SEV_ICON[a.verdict.tone]} ${a.verdict.tone.toUpperCase()} — ${a.verdict.headline}`);
  lines.push(`           ${a.verdict.sub}`);
  // per-pick
  for (const pk of a.picks) {
    const p = pk.result.programme;
    const med = (pk.result.comparisons.find((x) => x.key === "median") || {}).score;
    const iv = pk.selection.map((s) => s.type).join("+") || "—";
    lines.push(`    ${pk.slot.padEnd(3)} ${p.jupas_code} ${p.institution.padEnd(8)} ` +
      `score=${pk.result.calculation.totalScore?.toFixed(1) ?? "?"} med=${med ?? "?"} ` +
      `elig=${pk.result.eligibility.eligible ? "Y" : "N"} risk=${pk.tier} ` +
      `${pk.fewPlaces ? "fewPlaces " : ""}sel=${iv}`);
  }
  // findings
  if (a.findings.length === 0) lines.push("    findings: (none)");
  for (const f of a.findings) lines.push(`    ${SEV_ICON[f.severity]} [${f.id}] ${f.title}`);

  // ── Auto sanity flags (things that should never happen with real data) ──
  const ids = new Set(a.findings.map((f) => f.id));
  const hasCritical = a.findings.some((f) => f.severity === "critical");
  const filled = a.picks.length;
  if (a.verdict.tone === "good" && hasCritical) lines.push(flag("good verdict coexists with a CRITICAL finding"));
  if (filled > 0 && a.bandA.length > 0) {
    const allIneligible = a.bandA.every((pk) => !pk.result.eligibility.eligible);
    if (allIneligible && a.verdict.tone === "good") lines.push(flag("all Band-A ineligible but verdict is GOOD"));
  }
  for (const pk of a.picks) {
    if (pk.result.calculation.totalScore == null && pk.result.eligibility.eligible && pk.result.hasScoreData)
      lines.push(flag(`${pk.result.programme.jupas_code} eligible+hasData but null score`));
    if (pk.tier === undefined || pk.tier === null) lines.push(flag(`${pk.result.programme.jupas_code} has no risk tier`));
  }
  // A warning/critical VERDICT must be backed by a finding at least as severe.
  // (good/info are neutral baselines — the empty/no-finding state is info, fine.)
  const SEV = { good: 0, info: 1, warning: 2, critical: 3 };
  const worst = a.findings.reduce((m, f) => Math.max(m, SEV[f.severity]), 0);
  if (SEV[a.verdict.tone] >= 2 && SEV[a.verdict.tone] > worst)
    lines.push(flag("alarming verdict not backed by any finding of equal severity"));

  console.log(lines.join("\n"));
}

console.log("\n" + "=".repeat(90));
console.log(warnFlags === 0
  ? `\n✓ ${CASES.length} cases ran clean — no auto-flags. Review the blocks above for subjective weirdness.`
  : `\n⚠ ${warnFlags} auto-flag(s) raised across ${CASES.length} cases — see ⚠ lines above.`);
