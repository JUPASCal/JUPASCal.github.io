// Eligibility / subject-vocabulary audit — repeatable guard against the
// "non-canonical subject silently breaks exact-match eligibility" bug class.
//
// Run from the staging/ directory:   node scripts/audit_eligibility.mjs
// (or `npm run audit`). Exits non-zero if any hard gate fails, so it can sit in
// the annual update runbook / CI right after `validate_unified.py`.
//
// It bundles the REAL production calculator (src/lib/calculator.ts, which now
// imports the shared canonical registry) with esbuild and runs it against the
// freshly-unified data, so it tests exactly what ships.
//
// Gates (set exit code):
//   A. Perfect student — a candidate with every subject at the top grade must be
//      eligible for 100% of programmes. Any rejection ⇒ an unmatchable / broken
//      requirement pool.
//   B. Closed vocabulary — every subject in every elective / best-of pool must be
//      a canonical registry name (or a token). Any stray value ⇒ exact-match
//      eligibility/scoring is silently wrong.
// Informational (no exit effect):
//   C. Applicant scenarios — the previously-broken profiles (ICT/DAT/Combined
//      Science/BAFS/Tech & Living) are eligible for the programmes that accept them.

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/scripts
const STAGING = resolve(HERE, ".."); // repo root (app now lives at root)
const ROOT = STAGING;
const DATA_FILE = resolve(ROOT, "data/processed/JUPAS_2026_Unified_Data.json");
const REGISTRY_FILE = resolve(ROOT, "data/raw/subjects.canonical.json");

async function loadModule(entry) {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const code = res.outputFiles[0].text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

const calc = await loadModule(resolve(STAGING, "src/lib/calculator.ts"));
const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const byCode = Object.fromEntries(data.map((p) => [p.jupas_code, p]));

const ME = reg.math_extended;
const CANON = new Set([
  ...reg.core, ...reg.category_a, ...reg.category_c,
  ME.combined, ME.module_1, ME.module_2,
]);
const TOKENS = new Set(reg.tokens);

// ── perfect student: every subject at top grade ──
const PERFECT = {};
for (const s of [...reg.category_a, ...reg.core, ME.module_1, ME.module_2]) PERFECT[s] = "5**";
for (const s of reg.category_c) PERFECT[s] = "A";
PERFECT["Citizenship and Social Development"] = "Attained";

let failures = 0;
const fail = (msg) => { failures++; console.log("  ✗ " + msg); };

// ── Gate A ──
console.log("A. Perfect student must be eligible everywhere");
let aBad = 0;
for (const p of data) {
  const mr = p.min_requirements_2026;
  if (!mr) continue;
  const r = calc.checkEligibility(PERFECT, mr, p);
  if (!r.eligible) {
    aBad++;
    fail(`${p.jupas_code} ${p.institution}: ${r.details.filter((d) => !d.pass).map((d) => d.label).join(", ")}`);
  }
}
console.log(`   ${aBad === 0 ? "✓ PASS" : "✗ FAIL"} — ${aBad}/${data.length} reject a perfect student\n`);

// ── Gate B ──
console.log("B. Every elective / best-of pool subject must be canonical");
let bBad = 0;
for (const p of data) {
  const mr = p.min_requirements_2026 || {};
  for (const slot of ["elect1", "elect2"]) {
    const el = mr[slot];
    if (el && Array.isArray(el.subjects)) {
      for (const s of el.subjects) {
        if (!(typeof s === "string" && (CANON.has(s) || TOKENS.has(s)))) {
          bBad++; fail(`${p.jupas_code} ${slot}: non-canonical ${JSON.stringify(s)}`);
        }
      }
    }
  }
  for (const yr of ["2025", "2026"]) {
    for (const pool of p[`best_of_weights_${yr}`] || []) {
      for (const s of pool.subjects || []) {
        if (!(typeof s === "string" && (CANON.has(s) || TOKENS.has(s)))) {
          bBad++; fail(`${p.jupas_code} best_of_weights_${yr}: non-canonical ${JSON.stringify(s)}`);
        }
      }
    }
  }
}
console.log(`   ${bBad === 0 ? "✓ PASS" : "✗ FAIL"} — ${bBad} non-canonical subject(s)\n`);

// ── C (informational): previously-broken applicant profiles ──
console.log("C. Applicant scenarios (informational)");
const CORE = {
  "Chinese Language": "5**", "English Language": "5**",
  "Mathematics (Compulsory Part)": "5**", "Citizenship and Social Development": "Attained",
  "Visual Arts": "5**", // filler so an "any second elective" slot is fillable
};
const TARGETS = [
  reg.aliases.ICT, reg.aliases.DAT,
  "Technology and Living (Food Science and Technology)",
  "Combined Science: Biology + Chemistry", "Combined Science: Biology + Physics",
  "Business, Accounting and Financial Studies",
];
for (const target of TARGETS) {
  const grades = { ...CORE, [target]: "5**" };
  // programmes that explicitly accept this target in some elective slot
  const accepting = data.filter((p) => {
    const mr = p.min_requirements_2026 || {};
    return ["elect1", "elect2"].some((s) => mr[s]?.subjects?.includes(target));
  });
  const ok = accepting.filter((p) => calc.checkEligibility(grades, p.min_requirements_2026, p).eligible).length;
  console.log(`   ${target}: eligible for ${ok}/${accepting.length} accepting programmes`);
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} hard-gate failure(s)`);
process.exit(failures === 0 ? 0 : 1);
