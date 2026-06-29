// Category B (Applied Learning) consistency audit. Verifies the ApL model is
// COMPLETE and INTERNALLY CONSISTENT across every programme — coverage, per-
// institution invariants (policy kind / max / min-level / flags), conversion-table
// presence, restricted-list canonical-ness, PolyU weight injection, EdUHK ×1.5,
// HKUST bonus-only, SSSDP per-offering — plus a live calculator + eligibility sweep
// over all 422 programmes. Run after every data regen:  npm run audit:apl
// Exits non-zero on any issue. Authoritative policy: docs/manuals/APL_POLICY.md.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
const ROOT = new URL("..", import.meta.url).pathname;

async function load(entry) {
  const r = await build({ entryPoints: [ROOT + entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
}
const calc = await load("src/lib/calculator.ts");
const data = JSON.parse(readFileSync(ROOT + "data/processed/JUPAS_2026_Unified_Data.json", "utf8"));
const reg = JSON.parse(readFileSync(ROOT + "data/raw/subjects.canonical.json", "utf8"));
const catb = new Set(reg.category_b);
const byc = Object.fromEntries(data.map((p) => [p.jupas_code, p]));

const issues = [];
const flag = (cat, msg) => issues.push(`[${cat}] ${msg}`);
const kind = (pol) => (pol === undefined ? "unset" : pol === "none" ? "none" : pol === "any" ? "any" : "list");

// Per-institution invariant spec (mirrors docs/manuals/APL_POLICY.md).
const SPEC = {
  HKU: { kinds: ["none"], min: null, max: 1 },
  CUHK: { kinds: ["none", "any", "list"], min: "attained", max: 1 },
  HKUST: { kinds: ["none", "any"], min: "dist1", max: 1 },
  PolyU: { kinds: ["none", "list"], min: "dist1", max: 1 },
  CityUHK: { kinds: ["none", "any"], min: "dist1", max: 1 },
  HKBU: { kinds: ["none", "any", "list"], min: "dist1", max: 1 },
  LingnanU: { kinds: ["none", "any", "list"], min: "l3", max: 1 },
  EdUHK: { kinds: ["none", "any"], min: "dist1", max: 1 },
  HKMU: { kinds: ["none", "any"], min: "attained", max: 2 },
  SSSDP: { kinds: ["none", "any"], min: null, max: null }, // per offering inst (below)
};
const HKUST11 = new Set(["JS5101", "JS5102", "JS5103", "JS5118", "JS5181", "JS5411", "JS5412", "JS5711", "JS5811", "JS5812", "JS5813"]);
const SSSDP_OFF = {
  HKMU: { max: 2, min: "attained" }, HKSYU: { max: 1, min: "dist1" }, SFU: { max: 1, min: "attained" },
  "VTC-THEi": { max: 1, min: "attained" }, HSUHK: { max: 1, min: "attained" }, TWC: { max: 1, min: "attained" },
  UOWCHK: { max: 1, min: "attained" }, HKCHC: { max: 1, min: "attained" },
};

// ── 1. data invariants ──
for (const p of data) {
  const inst = p.institution, pol = p.apl_policy, code = p.jupas_code;
  if (pol === undefined) flag("coverage", `${code} ${inst}: no apl_policy`);
  const spec = SPEC[inst];
  if (!spec) { flag("inst", `${code}: unhandled institution ${inst}`); continue; }
  if (!spec.kinds.includes(kind(pol)) && kind(pol) !== "unset") flag("policy-kind", `${code} ${inst}: kind ${kind(pol)} not in ${spec.kinds}`);
  if (pol && pol !== "none") {
    const ml = p.apl_min_level ?? "dist1", mx = p.apl_max ?? 1;
    if (inst === "SSSDP") {
      const m = /Offered by ([^:]+):/.exec(p.name_en || "");
      const off = m ? m[1].trim() : "?";
      const e = SSSDP_OFF[off];
      if (!e) flag("sssdp-off", `${code}: unknown offering inst ${off}`);
      else { if (mx !== e.max) flag("sssdp-max", `${code} ${off}: max ${mx} != ${e.max}`); if (ml !== e.min) flag("sssdp-min", `${code} ${off}: min ${ml} != ${e.min}`); }
    } else if (inst === "EdUHK") {
      const want = (p.name_en || "").includes("Higher Diploma") ? 2 : 1;
      if (mx !== want) flag("max", `${code} EdUHK: max ${mx} != ${want}`);
      if (ml !== spec.min) flag("min", `${code} EdUHK: min ${ml} != ${spec.min}`);
    } else {
      if (spec.max && mx !== spec.max) flag("max", `${code} ${inst}: max ${mx} != ${spec.max}`);
      if (spec.min && ml !== spec.min) flag("min", `${code} ${inst}: min ${ml} != ${spec.min}`);
    }
    // conversion table must carry the levels ApL needs
    const ca = (p.score_conversion_table || {}).category_a || {};
    const need = ["4", "3"]; if ((p.apl_min_level) === "attained") need.push("2");
    for (const lv of need) if (!(lv in ca)) flag("conv", `${code} ${inst}: missing Cat-A level ${lv}`);
    // restricted lists canonical + PolyU weights injected
    if (Array.isArray(pol)) {
      if (!pol.length) flag("emptylist", `${code}: empty restricted list`);
      for (const s of pol) if (!catb.has(s)) flag("noncanon", `${code}: ${s} not canonical`);
      if (inst === "PolyU") { const w = p.subject_weights_2025 || {}; for (const s of pol) if (!(s in w)) flag("polyu-weight", `${code}: ${s} has no injected weight`); }
    }
  }
  // HKUST bonus-only flag integrity
  if (p.apl_bonus_only) { if (!HKUST11.has(code)) flag("hkust-bonus", `${code}: apl_bonus_only but not one of the 11`); if (pol !== "any") flag("hkust-bonus", `${code}: bonus_only but policy ${pol}`); }
  if (HKUST11.has(code) && !p.apl_bonus_only) flag("hkust-bonus", `${code}: expected apl_bonus_only`);
}
// EdUHK: no leftover "Specified ApL" stub
for (const p of data) if (p.institution === "EdUHK") for (const k of Object.keys(p.subject_weights_2025 || {})) if (k.includes("Specified ApL")) flag("eduhk-stub", `${p.jupas_code}: leftover ${k}`);

// ── 2. calculator + eligibility sweep ──
const base = { "Chinese Language": "4", "English Language": "4", "Mathematics (Compulsory Part)": "4", "Citizenship and Social Development": "Attained", "Biology": "4", "Chemistry": "3" };
const cores = { "Chinese Language": "5", "English Language": "5", "Mathematics (Compulsory Part)": "5", "Citizenship and Social Development": "Attained" };
const D2 = "Attained with Distinction (II)";
for (const p of data) {
  const pol = p.apl_policy;
  const apl = Array.isArray(pol) ? pol[0] : "AI and Robotics";
  let rN, rA, e;
  try { rN = calc.calculateScore(base, p, "2025"); rA = calc.calculateScore({ ...base, [apl]: D2 }, p, "2025"); e = calc.checkEligibility({ ...cores, [apl]: D2 }, p.min_requirements_2026 || {}, p); }
  catch (err) { flag("crash", `${p.jupas_code}: ${err.message}`); continue; }
  const inCand = rA.allCandidates.some((c) => c.subject === apl);
  const aplFillsElective = e.details.some((r) => /elect/i.test(r.label) && r.pass && String(r.got).includes("Distinction (II)"));
  if (pol === undefined || pol === "none") {
    if (inCand) flag("none-scored", `${p.jupas_code} ${p.institution}: ApL scored despite ${pol}`);
    if (Math.abs(rA.totalScore - rN.totalScore) > 1e-9) flag("none-delta", `${p.jupas_code}: score changed despite none`);
    if (aplFillsElective) flag("none-elig", `${p.jupas_code}: ApL filled an elective despite none`);
    continue;
  }
  if (!inCand) { flag("accept-missing", `${p.jupas_code} ${p.institution}: accepts ${apl} but not a candidate`); continue; }
  const cand = rA.allCandidates.find((c) => c.subject === apl);
  const expL4 = (p.score_conversion_table.category_a || {})["4"];
  if (expL4 !== undefined && cand.basePoints !== expL4) flag("conv-D2", `${p.jupas_code} ${p.institution}: D2 base ${cand.basePoints} != L4 ${expL4}`);
  if (p.apl_bonus_only) {
    const sel = rA.selected.find((c) => c.subject === apl);
    if (sel && !sel.isBonus) flag("hkust-best5", `${p.jupas_code}: bonus-only ApL in Best-5`);
    if (aplFillsElective) flag("bonus-elig", `${p.jupas_code}: bonus-only ApL filled an elective`);
  }
}

// ── report ──
const counts = {};
for (const p of data) { const k = `${p.institution}`; (counts[k] ??= {}); counts[k][kind(p.apl_policy)] = (counts[k][kind(p.apl_policy)] || 0) + 1; }
console.log("ApL policy by institution:");
for (const inst of Object.keys(SPEC)) console.log(`  ${inst.padEnd(9)} ${JSON.stringify(counts[inst])}`);
if (issues.length) {
  console.log(`\n✗ ${issues.length} ISSUE(S):`);
  issues.slice(0, 60).forEach((i) => console.log("  " + i));
  process.exit(1);
}
console.log(`\n✓ ApL model consistent — ${data.length} programmes, 0 issues.`);
