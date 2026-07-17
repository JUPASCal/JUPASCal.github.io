// Shared esbuild `define` map for the audit harnesses. Several audits bundle app
// modules (analysis.ts, results.ts, selection.ts …) that reference the Vite
// compile-time globals (e.g. selection.ts's top-level
// `parseInt(__ADMISSION_CYCLE__)`). esbuild doesn't know Vite's `define`, so
// those globals are `undefined` in a bundled audit and throw at eval time. This
// mirrors vite.config.ts's `define` so any harness that imports it stays in sync
// — add a new Vite define here too and every audit keeps working.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

let programmeCount = 0;
try {
  programmeCount = JSON.parse(readFileSync(resolve(ROOT, "data/processed/JUPAS_2026_Unified_Data.json"), "utf8")).length;
} catch {
  // Data file absent — leave the count at 0; audits that need it fetch data separately.
}

export const buildDefines = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __PROGRAMME_COUNT__: JSON.stringify(programmeCount),
  __ADMISSION_CYCLE__: JSON.stringify(pkg.admissionCycle ?? ""),
  // Build stamps are irrelevant to audits — a placeholder keeps the globals defined.
  __BUILD_SHA__: JSON.stringify("audit"),
  __BUILD_DATE__: JSON.stringify("audit"),
};
