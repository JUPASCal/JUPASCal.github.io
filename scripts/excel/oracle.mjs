// Validation ORACLE: run the authoritative web-app scorer (src/lib/calculator.ts)
// for each test student × all 422 programmes, using the 2025 (Y-1) scoring logic —
// the same logic the generated Excel reproduces. Emits build/oracle_scores.json,
// which validate.py diffs against the recalc'd Excel. See BUILD_PLAN "Validation".
//   node scripts/excel/oracle.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;

async function load(entry) {
  const r = await build({ entryPoints: [ROOT + entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
}

const calc = await load("src/lib/calculator.ts");
const data = JSON.parse(readFileSync(ROOT + "data/processed/JUPAS_2026_Unified_Data.json", "utf8"));
const students = JSON.parse(readFileSync(ROOT + "scripts/excel/test_students.json", "utf8"));

function tsGrades(s) {
  const g = {
    "Chinese Language": s.cores.chi,
    "English Language": s.cores.eng,
    "Mathematics (Compulsory Part)": s.cores.math,
    "Citizenship and Social Development": "Attained",
  };
  if (s.m12) g[`Mathematics Extended Part (Module ${s.m12.module})`] = s.m12.grade;
  for (const e of s.electives) g[e.en] = e.grade;
  return g;
}

const out = {};
for (const s of students) {
  const g = tsGrades(s);
  out[s.name] = {};
  for (const p of data) out[s.name][p.jupas_code] = calc.calculateScore(g, p, "2025").totalScore;
}
writeFileSync(ROOT + "build/oracle_scores.json", JSON.stringify(out));
console.log(`oracle: ${students.length} students × ${data.length} programmes → build/oracle_scores.json`);
