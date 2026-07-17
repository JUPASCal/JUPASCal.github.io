// Non-academic requirement classification audit — VALIDATION surface for the
// selection model (src/lib/selection.ts). Run from staging/:
//   node scripts/selection_audit.mjs            (summary + heuristic items to vet)
//   node scripts/selection_audit.mjs --all      (every classified programme)
//
// Bundles the REAL selection.ts and runs it over the unified data so you review
// exactly what the analysis will see. Heuristic ("inferred") items are the ones
// to eyeball — confirm or correct them in CURATED.

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildDefines } from "./utils/build_defines.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(HERE, ".."); // repo root (app now lives at root)
const DATA = resolve(STAGING, "data/processed/JUPAS_2026_Unified_Data.json");
const ALL = process.argv.includes("--all");

async function loadModule(entry) {
  const res = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent", define: buildDefines });
  return import("data:text/javascript;base64," + Buffer.from(res.outputFiles[0].text).toString("base64"));
}
const { getSelection } = await loadModule(resolve(STAGING, "src/lib/selection.ts"));
const progs = JSON.parse(readFileSync(DATA, "utf8"));

const SAL = { required: "REQUIRED", weighty: "weighty ", optional: "optional" };
const item = (i) => `${i.type}:${i.salience}(${i.source})`;

const byType = {}, bySal = {}, bySrc = {};
const classified = [];
for (const p of progs) {
  const s = getSelection(p);
  if (!s.items.length) continue;
  classified.push({ p, s });
  for (const i of s.items) {
    byType[i.type] = (byType[i.type] || 0) + 1;
    bySal[i.salience] = (bySal[i.salience] || 0) + 1;
    bySrc[i.source] = (bySrc[i.source] || 0) + 1;
  }
}

console.log(`Programmes with a non-academic requirement: ${classified.length} / ${progs.length}`);
console.log("  by type:    ", byType);
console.log("  by salience:", bySal);
console.log("  by source:  ", bySrc, "  (heuristic = inferred, needs vetting)\n");

// Heuristic-only programmes are the validation focus.
const heuristicOnly = classified.filter((x) => x.s.items.every((i) => i.source === "heuristic"));
console.log(`── HEURISTIC-ONLY (${heuristicOnly.length}) — vet these; confirm/correct in CURATED ──`);
for (const { p, s } of heuristicOnly.sort((a, b) => a.p.jupas_code.localeCompare(b.p.jupas_code))) {
  console.log(`  ${p.jupas_code} ${p.institution.padEnd(8)} ${(p.name_en || "").slice(0, 46).padEnd(46)} ${s.items.map(item).join(" ")}`);
}

const withText = classified.filter((x) => x.s.items.some((i) => i.source !== "heuristic"));
console.log(`\n── HAS OFFICIAL TEXT / CURATED (${withText.length}) ──`);
for (const { p, s } of withText.sort((a, b) => a.p.jupas_code.localeCompare(b.p.jupas_code))) {
  console.log(`  ${p.jupas_code} ${p.institution.padEnd(8)} ${(p.name_en || "").slice(0, 46).padEnd(46)} ${s.items.map(item).join(" ")}`);
}

if (ALL) {
  console.log("\n── ALL classified ──");
  for (const { p, s } of classified) console.log(`  ${p.jupas_code} ${p.institution} ${p.name_en} → ${s.items.map(item).join(" ")}`);
}
