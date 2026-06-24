// Generate layout fallbacks for old browsers, alongside the colour generator:
//
//  1. Flex `gap` — unsupported on Safari < 14.1 (iPhone 6/old iOS). There is no
//     reliable CSS @supports test for FLEX gap (grid-gap is older, so
//     `@supports (gap:1px)` gives false positives), so main.tsx feature-detects
//     it and adds `.no-flex-gap` to <html>. Under that class we re-create the
//     spacing with margins on consecutive children.
//  2. clamp()/min()/max() — unsupported on Safari < 13.4. Emitted under
//     `@supports not (... clamp())` with the function's first argument as a
//     static fallback (for clamp that's the min, which is what a small old phone
//     would resolve to anyway).
//
// Both only affect old browsers; modern rendering is unchanged. Run:
//   node scripts/gen_legacy_layout_fallbacks.mjs
import postcss from "postcss";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(SRC, "legacy-layout-fallbacks.css");

// --- small parsing helpers (shared shape with the colour generator) ---
function balanced(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") { depth--; if (depth === 0) return str.slice(open + 1, i); }
  }
  return str.slice(open + 1);
}
function topSplit(str, sep) {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    else if (str[i] === sep && depth === 0) { out.push(str.slice(last, i)); last = i + 1; }
  }
  out.push(str.slice(last));
  return out.map((s) => s.trim()).filter(Boolean);
}

// Replace each top-level clamp() with its first argument (the min — which is
// what a small old phone resolves clamp() to anyway, so it's a safe fallback).
// min()/max() are deliberately NOT handled: their first arg is often the LARGE
// bound (e.g. `min(1760px, 100%)`), so a static fallback would overflow; letting
// them drop to the property's initial value (auto/none) is safer on old phones.
function fallbackMathValue(value) {
  let out = "", i = 0, changed = false;
  while (i < value.length) {
    const m = value.slice(i).match(/clamp\(/);
    if (!m) { out += value.slice(i); break; }
    const fnStart = i + m.index;
    out += value.slice(i, fnStart);
    const open = value.indexOf("(", fnStart);
    const inside = balanced(value, open);
    const first = topSplit(inside, ",")[0];
    // Nested math in the first arg → bail (rare); keep original so it's skipped.
    if (/(clamp|min|max)\(/.test(first)) return null;
    out += first;
    changed = true;
    i = open + inside.length + 2; // past the closing ")"
  }
  return changed ? out : null;
}

const files = [
  path.join(SRC, "styles.css"),
  ...fs.readdirSync(path.join(SRC, "components")).filter((f) => f.endsWith(".css")).map((f) => path.join(SRC, "components", f)),
];

const gapRules = [];   // { media, selector, prop, value }
const mathRules = [];  // { media, selector, prop, value }

function mediaOf(node) {
  let p = node.parent, media = null;
  while (p && p.type === "atrule") {
    if (p.name === "media") media = `@media ${p.params}`;
    p = p.parent;
  }
  return media;
}

for (const file of files) {
  const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
  root.walkRules((rule) => {
    if (rule.parent && rule.parent.type === "atrule" && rule.parent.name === "supports") return; // skip existing @supports
    // direct declarations of this rule
    const d = {};
    for (const node of rule.nodes || []) if (node.type === "decl") d[node.prop] = node.value;

    // (1) flex-gap
    const display = (d.display || "").trim();
    const hasGap = d.gap || d["row-gap"] || d["column-gap"];
    const isFlex = /\b(inline-)?flex\b/.test(display);
    const justify = (d["justify-content"] || "").trim();
    if (isFlex && hasGap && !/^space-/.test(justify)) {
      const dir = (d["flex-direction"] || "row").trim();
      const gapParts = d.gap ? topSplit(d.gap, " ") : [];
      const rowGap = d["row-gap"] || gapParts[0] || null;
      const colGap = d["column-gap"] || gapParts[1] || gapParts[0] || null;
      const isColumn = dir.startsWith("column");
      const spacing = isColumn ? rowGap : colGap;
      const marginProp = isColumn ? "margin-top" : "margin-left";
      if (spacing && spacing !== "0") {
        gapRules.push({ media: mediaOf(rule), selector: rule.selector, prop: marginProp, value: spacing });
      }
    }

    // (2) clamp/min/max in any direct decl
    for (const node of rule.nodes || []) {
      if (node.type !== "decl") continue;
      if (!/\bclamp\(/.test(node.value)) continue;
      const fb = fallbackMathValue(node.value);
      if (fb) mathRules.push({ media: mediaOf(rule), selector: rule.selector, prop: node.prop, value: fb });
    }
  });
}

function emitGrouped(rules, transformSelector) {
  const byMedia = new Map();
  for (const r of rules) {
    const mk = r.media || "";
    if (!byMedia.has(mk)) byMedia.set(mk, new Map());
    const sels = byMedia.get(mk);
    const sel = transformSelector(r.selector);
    if (!sels.has(sel)) sels.set(sel, []);
    sels.get(sel).push(`${r.prop}: ${r.value};`);
  }
  let css = "";
  for (const [media, sels] of byMedia) {
    const ind = media ? "    " : "  ";
    if (media) css += `  ${media} {\n`;
    for (const [sel, decls] of sels) css += `${ind}${sel} {\n${decls.map((x) => ind + "  " + x).join("\n")}\n${ind}}\n`;
    if (media) css += `  }\n`;
  }
  return css;
}

let css = `/* AUTO-GENERATED by scripts/gen_legacy_layout_fallbacks.mjs — do not edit by hand.
   Layout fallbacks for old browsers. Re-run after changing flex gap / clamp usage. */

/* Flex \`gap\` (Safari < 14.1). .no-flex-gap is set by main.tsx when flex gap is
   unsupported; re-create the spacing with margins on consecutive children. */
`;
css += emitGrouped(gapRules, (sel) =>
  sel.split(",").map((s) => `.no-flex-gap ${s.trim()} > * + *`).join(",\n  "));

css += `\n/* clamp()/min()/max() (Safari < 13.4) — static fallback (first argument). */\n`;
css += `@supports not (width: clamp(1px, 1px, 1px)) {\n`;
css += emitGrouped(mathRules, (sel) => sel).replace(/^/gm, "  ").replace(/^ {2}$/gm, "");
css += `}\n`;

fs.writeFileSync(OUT, css);
console.log(`Wrote ${OUT}`);
console.log(`flex-gap rules: ${gapRules.length}, clamp/min/max rules: ${mathRules.length}`);
