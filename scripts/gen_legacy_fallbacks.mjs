// Generate solid-colour fallbacks for every `color-mix()` declaration so the
// app stays usable on browsers without color-mix support (Safari < 16.2, i.e.
// iPhone 7/8-era and older, plus old Android). Output is wrapped in
// `@supports not (color: color-mix(...))`, which only those old browsers apply
// — modern browsers ignore the whole sheet and render exactly as before.
//
// Fallbacks are computed for the LIGHT theme (the default; dark mode on such an
// old device is a rare follow-up). Run: `node scripts/gen_legacy_fallbacks.mjs`.
import postcss from "postcss";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(SRC, "legacy-color-fallbacks.css");

// Light-theme design tokens (mirror :root in styles.css).
const TOKENS = {
  "--bg": "#f8f0ea", "--surface": "#f1e5dd", "--surface-strong": "#fffaf6",
  "--surface-mix": "color-mix(in srgb, var(--surface) 60%, white)",
  "--thead": "#eed9cb", "--hover": "#f3e2d6", "--active": "#eed8c9",
  "--row-bg": "rgba(255, 250, 246, 0.45)",
  "--soft-good": "#e1ecde", "--soft-bad": "#f5dad3", "--soft-warn": "#f3e4c4",
  "--soft-alert": "#f6ddc8", "--soft-neutral": "#eee0d5",
  "--ink": "#4d281a", "--muted": "#786257", "--line": "#dccabd",
  "--accent": "#c2452e", "--accent-contrast": "#ffffff", "--accent-2": "#1b3a6b",
  "--good": "#2a6a4a", "--bad": "#9c3527", "--warn": "#b08820", "--alert": "#bd5a22",
};

const NAMED = { white: "#ffffff", black: "#000000", transparent: "rgba(0,0,0,0)" };

// --- colour parsing -> [r,g,b,a] (0-255, a 0-1), or null if unresolvable ---
function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))); }

function parseColor(raw, depth = 0) {
  if (depth > 8) return null;
  let s = raw.trim();
  if (NAMED[s.toLowerCase()]) s = NAMED[s.toLowerCase()];
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
    return null;
  }
  if (s.startsWith("rgb")) {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[,/]/).map((x) => x.trim());
    if (parts.length < 3) return null;
    return [clamp255(+parts[0]), clamp255(+parts[1]), clamp255(+parts[2]), parts[3] != null ? +parts[3] : 1];
  }
  if (s.startsWith("var(")) {
    const inner = balanced(s, s.indexOf("(")); // contents of var(...)
    const comma = topComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
    if (TOKENS[name] != null) return parseColor(TOKENS[name], depth + 1);
    if (fallback) return parseColor(fallback, depth + 1);
    return null;
  }
  if (s.startsWith("color-mix(")) return parseColor(formatRgba(computeMix(s, depth)), depth + 1);
  return null;
}

// Index of the matching close paren for the `(` at position `open`; returns the
// inside string.
function balanced(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") { depth--; if (depth === 0) return str.slice(open + 1, i); }
  }
  return str.slice(open + 1);
}

// Top-level comma index (ignores commas nested in parens).
function topComma(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    else if (str[i] === "," && depth === 0) return i;
  }
  return -1;
}

// Split on top-level commas.
function topSplit(str) {
  const out = [];
  let depth = 0, last = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    else if (str[i] === "," && depth === 0) { out.push(str.slice(last, i)); last = i + 1; }
  }
  out.push(str.slice(last));
  return out.map((x) => x.trim());
}

// Premultiplied sRGB mix of color-mix(in srgb, C1 p1%, C2 p2%?).
function computeMix(expr, depth = 0) {
  const inner = balanced(expr, expr.indexOf("("));
  const parts = topSplit(inner);
  if (parts.length < 3 || !/in\s+srgb/i.test(parts[0])) throw new Error("unsupported color-mix: " + expr);
  const a = parsePctColor(parts[1], depth);
  const b = parsePctColor(parts[2], depth);
  let p1 = a.pct, p2 = b.pct;
  if (p1 == null && p2 == null) { p1 = 50; p2 = 50; }
  else if (p1 == null) p1 = 100 - p2;
  else if (p2 == null) p2 = 100 - p1;
  const sum = p1 + p2;
  const w1 = p1 / sum, w2 = p2 / sum;
  const [r1, g1, bl1, al1] = a.rgba, [r2, g2, bl2, al2] = b.rgba;
  const pa1 = al1 * w1, pa2 = al2 * w2;
  const outA = pa1 + pa2;
  const mix = (c1, c2) => outA === 0 ? 0 : (c1 * pa1 + c2 * pa2) / outA;
  return [clamp255(mix(r1, r2)), clamp255(mix(g1, g2)), clamp255(mix(bl1, bl2)), +outA.toFixed(4)];
}

function parsePctColor(token, depth) {
  const m = token.match(/(.*?)\s+(\d+(?:\.\d+)?)%\s*$/);
  if (m) { const c = parseColor(m[1], depth + 1); if (!c) throw new Error("bad color: " + token); return { rgba: c, pct: +m[2] }; }
  const c = parseColor(token, depth + 1); if (!c) throw new Error("bad color: " + token); return { rgba: c, pct: null };
}

function formatRgba([r, g, b, a]) {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Replace every color-mix(...) inside a declaration value with its solid
// equivalent, leaving the rest (lengths, other var()s) intact. Null if any fail.
function resolveValue(value) {
  let out = "", i = 0;
  while (i < value.length) {
    const idx = value.indexOf("color-mix(", i);
    if (idx === -1) { out += value.slice(i); break; }
    out += value.slice(i, idx);
    const inside = balanced(value, value.indexOf("(", idx));
    const full = `color-mix(${inside})`;
    try { out += formatRgba(computeMix(full)); }
    catch { return null; }
    i = idx + full.length;
  }
  return out;
}

// --- walk the stylesheets ---
const files = [
  path.join(SRC, "styles.css"),
  ...fs.readdirSync(path.join(SRC, "components")).filter((f) => f.endsWith(".css")).map((f) => path.join(SRC, "components", f)),
];

const skipped = [];
const blocks = []; // { media: string|null, selector, prop, value }

for (const file of files) {
  const css = fs.readFileSync(file, "utf8");
  const root = postcss.parse(css, { from: file });
  root.walkDecls((decl) => {
    if (!decl.value.includes("color-mix(")) return;
    const resolved = resolveValue(decl.value);
    if (resolved == null) { skipped.push(`${path.basename(file)}: ${decl.prop}: ${decl.value}`); return; }
    const rule = decl.parent;
    if (!rule || rule.type !== "rule") {
      // Custom property at :root etc. is still a rule; anything else we skip.
      skipped.push(`${path.basename(file)}: (non-rule) ${decl.prop}`); return;
    }
    // Collect ancestor @media (ignore nested @supports — none in source).
    let media = null;
    let p = rule.parent;
    while (p && p.type === "atrule") {
      if (p.name === "media") media = `@media ${p.params}`;
      p = p.parent;
    }
    blocks.push({ media, selector: rule.selector, prop: decl.prop, value: resolved });
  });
}

// Group by media -> selector to keep output compact.
const byMedia = new Map();
for (const b of blocks) {
  const mk = b.media || "";
  if (!byMedia.has(mk)) byMedia.set(mk, new Map());
  const sels = byMedia.get(mk);
  if (!sels.has(b.selector)) sels.set(b.selector, []);
  sels.get(b.selector).push(`    ${b.prop}: ${b.value};`);
}

let css = `/* AUTO-GENERATED by scripts/gen_legacy_fallbacks.mjs — do not edit by hand.
   Solid-colour fallbacks (light theme) for browsers without color-mix()
   (Safari < 16.2). Modern browsers skip this whole block. Re-run the script
   after changing any color-mix() declaration. */
@supports not (color: color-mix(in srgb, red, blue)) {
`;
for (const [media, sels] of byMedia) {
  const indent = media ? "  " : "";
  if (media) css += `  ${media} {\n`;
  for (const [selector, decls] of sels) {
    css += `${indent}  ${selector} {\n${decls.map((d) => indent + d).join("\n")}\n${indent}  }\n`;
  }
  if (media) css += `  }\n`;
}
css += `}\n`;

fs.writeFileSync(OUT, css);
console.log(`Wrote ${OUT}`);
console.log(`Fallbacks generated: ${blocks.length}, skipped: ${skipped.length}`);
if (skipped.length) console.log("Skipped:\n" + skipped.map((s) => "  - " + s).join("\n"));
