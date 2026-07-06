// Static SEO page generator (a build-time SSG step, run after `vite build`).
//
// The app is a client-rendered SPA: the served HTML is near-empty, so search
// engines have almost nothing to index and individual programmes never rank for
// their own name/code. This script reads the unified dataset and writes a
// self-contained, fully-crawlable static HTML page PER PROGRAMME (plus a browse
// index and a complete sitemap) into dist/. Each page carries the programme's real
// content — name, institution, scoring formula + weightings, 2025 admission
// benchmarks, 2026 requirements — with proper <title>/description/canonical/OG and
// schema.org Course structured data, and a CTA into the interactive calculator.
//
// Pages are STANDALONE (inline CSS, no app bundle) because vite `base: "./"` would
// mis-resolve relative asset paths under /p/<CODE>/. They are real pages a human can
// read, not cloaking — the interactive tool is one click away.
//
// Wired into `npm run build` so it runs locally and in CI (GitHub Actions). Reads the
// source data/processed JSON (committed), writes to dist/.
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const SITE = "https://jupascal.com";
const OUT = "dist";
const DATA = "data/processed/JUPAS_2026_Unified_Data.json";
const data = JSON.parse(readFileSync(DATA, "utf8"));

const INST = {
  HKU: "The University of Hong Kong (HKU)",
  CUHK: "The Chinese University of Hong Kong (CUHK)",
  HKUST: "The Hong Kong University of Science and Technology (HKUST)",
  PolyU: "The Hong Kong Polytechnic University (PolyU)",
  CityUHK: "City University of Hong Kong (CityUHK)",
  HKBU: "Hong Kong Baptist University (HKBU)",
  LingnanU: "Lingnan University (LingnanU)",
  EdUHK: "The Education University of Hong Kong (EdUHK)",
  HKMU: "Hong Kong Metropolitan University (HKMU)",
  SSSDP: "SSSDP (Study Subsidy Scheme for Designated Professions/Sectors)",
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (x) => (x == null || Number.isNaN(x) ? null : x);
const httpsHref = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

// Short subject names for the weighting list.
const SHORT = {
  "English Language": "English", "Chinese Language": "Chinese",
  "Mathematics (Compulsory Part)": "Maths", "Citizenship and Social Development": "CSD",
  "Mathematics Extended Part (Module 1)": "M1", "Mathematics Extended Part (Module 2)": "M2",
};
const shortSubj = (s) => SHORT[s] ?? s;

function weightingList(p) {
  const parts = [];
  const sw = p.subject_weights_2026 || {};
  for (const [k, v] of Object.entries(sw)) parts.push(`${esc(shortSubj(k))} ×${v}`);
  for (const pool of p.best_of_weights_2026 || []) {
    const subs = (pool.subjects || []).map(shortSubj).join(" / ");
    parts.push(`best ${pool.count ?? 1} of ${esc(subs)} ×${pool.weight}`);
  }
  return parts;
}

function requirements(p) {
  const r = p.min_requirements_2026 || {};
  const rows = [];
  if (r.chi) rows.push(`Chinese Language — Level ${esc(r.chi)}`);
  if (r.eng) rows.push(`English Language — Level ${esc(r.eng)}`);
  if (r.math) rows.push(`Mathematics — Level ${esc(r.math)}`);
  if (r.csd) rows.push(`Citizenship &amp; Social Development — ${esc(r.csd)}`);
  for (const key of ["elect1", "elect2"]) {
    const e = r[key];
    if (e && (e.subjects?.length || e.grade)) {
      const subs = (e.subjects || []).join(" / ");
      rows.push(`Elective${e.count && e.count > 1 ? ` ×${e.count}` : ""}${subs ? ` (${esc(subs)})` : ""} — Level ${esc(e.grade || "—")}`);
    }
  }
  return rows;
}

function offerStats(p) {
  const rows = p.offer_statistics || [];
  const appYears = rows.filter((r) => r.Type === "Application").map((r) => r.Year);
  if (!appYears.length) return null;
  const year = Math.max(...appYears);
  const app = rows.find((r) => r.Year === year && r.Type === "Application");
  const off = rows.find((r) => r.Year === year && r.Type === "Offer");
  if (!app) return null;
  return {
    year,
    apps: app.Total ?? null,
    appsBandA: app["Band A"] ?? null,
    offers: off?.Total ?? null,
    offersBandA: off?.["Band A"] ?? null,
    quota: app.Quota ?? off?.Quota ?? p.quota ?? null,
  };
}

function statsSentence(os) {
  if (!os) return null;
  const bits = [];
  if (os.apps != null) bits.push(`received ${os.apps} applications${os.appsBandA != null ? ` (${os.appsBandA} Band A)` : ""}`);
  if (os.quota != null) bits.push(`for about ${os.quota} places`);
  let s = bits.length ? `In ${os.year}, this programme ${bits.join(" ")}.` : "";
  if (os.offers != null) s += ` It made ${os.offers} offer${os.offers === 1 ? "" : "s"}${os.offersBandA != null ? ` (${os.offersBandA} to Band A applicants)` : ""}.`;
  if (os.offersBandA != null && os.appsBandA) s += ` Band A offer rate: ${Math.round((os.offersBandA / os.appsBandA) * 100)}%.`;
  return s.trim() || null;
}

function basisNote(p) {
  if (p.score_basis === "cuhk_2026_recalculated")
    return "These 2025 admission scores are CUHK's official figures recalculated with the revised 2026 scoring formula, so they are comparable to a 2026-formula score.";
  if (p.score_basis === "cuhk_2026_simulated")
    return "This programme's weighting changed for 2026. As CUHK has not published a recalculated figure, these are JUPASCal's estimate — the 2026 weighting applied to CUHK's published subject grades of past admitted students (a close estimate).";
  return null;
}

function programmePage(p, siblings) {
  const code = p.jupas_code;
  const nameEn = p.name_en || code;
  const nameZh = p.name_zh || "";
  const instShort = p.institution || "";
  const instFull = INST[instShort] || instShort;
  const canonical = `${SITE}/p/${code}/`;
  const s = p.scores_2025 || {};
  const med = num(s.median), uq = num(s.uq), lq = num(s.lq);
  const wl = weightingList(p);
  const reqs = requirements(p);
  const note = basisNote(p);
  const changed = p.year_changes ? "This programme's 2026 scoring formula changed from 2025 — see the calculator for details." : "";

  const benchLine = med != null
    ? `2025 admission score — median ${med}${uq != null ? `, upper quartile ${uq}` : ""}${lq != null ? `, lower quartile ${lq}` : ""}.`
    : "No 2025 admission-score benchmark is on record (often a new or restructured programme).";

  const os = offerStats(p);
  const stats = statsSentence(os);
  const plainWeights = wl.join(", ").replace(/×/g, "x").replace(/&amp;/g, "&");
  const formulaTxt = p.formula_2026 || p.formula_2025 || "Best 5 subjects";
  // A concise, self-contained factual summary — the kind of paragraph an AI overview
  // (Google AI Overviews, Gemini, ChatGPT, Perplexity) lifts and cites verbatim.
  const summary = `${nameEn} (${code}) is a JUPAS undergraduate programme offered by ${instShort}.`
    + (med != null ? ` Its 2025 median admission score was ${med}${uq != null && lq != null ? ` (upper quartile ${uq}, lower quartile ${lq})` : ""}.` : "")
    + ` It is scored on ${formulaTxt}${wl.length ? ` with weighting: ${plainWeights}` : " with equal subject weighting"}.`
    + (os && os.apps != null ? ` In ${os.year} it received ${os.apps} applications for about ${os.quota ?? "?"} places.` : "");

  // Per-programme Q&A — highly extractable by AI engines, and eligible for FAQ rich results.
  const reqShort = reqs.slice(0, 5).map((r) => r.replace(/&amp;/g, "&")).join("; ");
  const faqs = [];
  if (med != null) faqs.push([`What was the 2025 admission score for ${code}?`, `The 2025 median admission score for ${nameEn} (${code}) at ${instShort} was ${med}${uq != null ? `, with an upper quartile of ${uq}` : ""}${lq != null ? ` and a lower quartile of ${lq}` : ""}.${note ? " " + note.replace(/&amp;/g, "&") : ""}`]);
  if (reqs.length) faqs.push([`What are the entrance requirements for ${code} in 2026?`, `${nameEn} (${code}) requires ${reqShort}.`]);
  faqs.push([`How is the ${code} admission score calculated?`, `${nameEn} uses ${formulaTxt}${wl.length ? `, with these weightings: ${plainWeights}` : " with equal (x1) subject weighting"}. Eligibility is checked against the 2026 entrance requirements.`]);
  if (stats) faqs.push([`How competitive is ${code} at ${instShort}?`, stats.replace(/&amp;/g, "&")]);
  const faqLd = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  })}</script>`;

  const title = `${nameEn} (${code}) · ${instShort} — JUPAS Score & Requirements 2026 | JUPASCal`;
  const desc = `${nameEn} (${code}) at ${instShort}: ${med != null ? `2025 median admission score ${med}, ` : ""}2026 entrance requirements and subject weighting. Estimate your JUPAS score for this programme with JUPASCal.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: nameEn,
    description: desc,
    url: canonical,
    provider: { "@type": "CollegeOrUniversity", name: instFull.replace(/\s*\([^)]*\)\s*$/, "") },
    inLanguage: ["en", "zh-Hant"],
    isAccessibleForFree: true,
  };

  const rel = siblings
    .filter((q) => q.jupas_code !== code)
    .slice(0, 8)
    .map((q) => `<li><a href="/p/${q.jupas_code}/">${esc(q.name_en || q.jupas_code)} (${q.jupas_code})</a></li>`)
    .join("");

  const officialLinks = [];
  const site = httpsHref((p.programme_websites || [])[0]);
  if (site) officialLinks.push(`<a href="${esc(site)}" rel="nofollow noopener">Official programme page ↗</a>`);
  const jupas = httpsHref(p.jupas_url);
  if (jupas) officialLinks.push(`<a href="${esc(jupas)}" rel="nofollow noopener">JUPAS listing ↗</a>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(nameEn)} (${code}) · ${esc(instShort)} | JUPASCal" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE}/og-image.png?v=2" />
<meta property="og:site_name" content="JUPASCal" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gelasio:wght@400;600;700&display=swap" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${faqLd}
<style>
  :root{color-scheme:light}
  body{background:#f8f0ea;margin:0;color:#3a2e28;font-family:'Gelasio',Georgia,serif;line-height:1.65}
  .wrap{max-width:720px;margin:0 auto;padding:40px 22px 64px}
  a{color:#9a5a3b}
  .eyebrow{color:#8a7a70;font-size:.85rem;letter-spacing:.02em;margin:0 0 6px}
  h1{font-size:1.9rem;margin:0 0 4px}
  .zh{color:#6b5d54;font-size:1.15rem;margin:0 0 20px}
  h2{font-size:1.15rem;margin:28px 0 8px;border-bottom:1px solid #e4d8cf;padding-bottom:4px}
  h3{font-size:1rem;margin:16px 0 4px}
  .summary{background:#fff;border:1px solid #e4d8cf;border-radius:9px;padding:12px 14px;font-size:.95rem;margin:0 0 16px}
  ul{margin:8px 0;padding-left:20px}
  .cta{display:inline-block;margin:24px 0 8px;background:#9a5a3b;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600}
  .note{background:#fff;border:1px solid #e4d8cf;border-left:3px solid #9a5a3b;border-radius:9px;padding:10px 13px;font-size:.9rem;color:#6b5d54;margin:10px 0}
  .muted{color:#8a7a70;font-size:.82rem}
  footer{margin-top:40px;border-top:1px solid #e4d8cf;padding-top:16px;font-size:.8rem;color:#8a7a70}
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow"><a href="/">JUPASCal</a> · <a href="/p/">All programmes</a> · ${esc(instShort)} · ${code}</p>
  <h1>${esc(nameEn)}</h1>
  ${nameZh ? `<p class="zh">${esc(nameZh)}</p>` : ""}
  <p class="summary">${esc(summary)}</p>
  <p>${esc(nameEn)} (JUPAS code <strong>${code}</strong>) is offered by ${esc(instFull)}${p.faculty ? `, ${esc(p.faculty)}` : ""}. Below are its JUPAS scoring method, subject weightings, recent admission scores and 2026 entrance requirements. ${changed}</p>

  <a class="cta" href="/?p=${code}">Estimate your score for ${code} →</a>

  <h2>Admission scores (2025)</h2>
  <p>${benchLine}</p>
  ${note ? `<p class="note">${note}</p>` : ""}

  <h2>Scoring formula &amp; subject weighting</h2>
  <p>${esc(p.formula_2026 || p.formula_2025 || "Best 5 subjects")}.</p>
  ${wl.length ? `<ul>${wl.map((w) => `<li>${w}</li>`).join("")}</ul>` : `<p class="muted">No subject is weighted heavier than ×1 (equal weighting).</p>`}

  <h2>2026 entrance requirements</h2>
  ${reqs.length ? `<ul>${reqs.map((r) => `<li>${r}</li>`).join("")}</ul>` : `<p class="muted">See the official programme page for detailed requirements.</p>`}
  ${p.quota ? `<p class="muted">Intake quota (approx.): ${esc(p.quota)}.</p>` : ""}
  ${p.tuition_fee_first_year ? `<p class="muted">First-year tuition: ${esc(p.tuition_fee_first_year)}.</p>` : ""}

  ${stats ? `<h2>Admission statistics (${os.year})</h2><p>${esc(stats)}</p>` : ""}

  ${officialLinks.length ? `<h2>Official links</h2><p>${officialLinks.join(" &nbsp;·&nbsp; ")}</p>` : ""}

  <h2>Frequently asked questions</h2>
  ${faqs.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("\n  ")}

  <a class="cta" href="/?p=${code}">Open ${code} in the JUPAS calculator →</a>

  ${rel ? `<h2>Other ${esc(instShort)} programmes</h2><ul>${rel}</ul>` : ""}

  <footer>
    JUPASCal is a free, unofficial JUPAS / HKDSE admission-score calculator. Scores are estimates for reference only — always confirm with ${esc(instShort)} and JUPAS. Score logic uses the latest available (2025) admission data; eligibility uses 2026 requirements.
  </footer>
</div>
</body>
</html>`;
}

function indexPage(byInst) {
  const canonical = `${SITE}/p/`;
  const sections = Object.keys(byInst).sort().map((inst) => {
    const items = byInst[inst].slice().sort((a, b) => a.jupas_code.localeCompare(b.jupas_code))
      .map((p) => `<li><a href="/p/${p.jupas_code}/">${esc(p.name_en || p.jupas_code)} <span class="muted">(${p.jupas_code})</span></a></li>`).join("");
    return `<h2 id="${esc(inst)}">${esc(INST[inst] || inst)}</h2><ul class="grid">${items}</ul>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>All JUPAS Programmes 2026 — Scores &amp; Requirements | JUPASCal</title>
<meta name="description" content="Browse every JUPAS degree programme across Hong Kong's 10 institutions. See each programme's 2025 admission scores, subject weighting and 2026 entrance requirements, and estimate your score with JUPASCal." />
<link rel="canonical" href="${canonical}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gelasio:wght@400;600;700&display=swap" />
<style>
  body{background:#f8f0ea;margin:0;color:#3a2e28;font-family:'Gelasio',Georgia,serif;line-height:1.6}
  .wrap{max-width:900px;margin:0 auto;padding:40px 22px 64px}
  a{color:#9a5a3b}
  h1{font-size:1.9rem;margin:0 0 6px}
  h2{font-size:1.2rem;margin:32px 0 10px;border-bottom:1px solid #e4d8cf;padding-bottom:4px}
  ul.grid{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:4px 20px}
  ul.grid li{padding:3px 0}
  .muted{color:#8a7a70;font-size:.82rem}
</style>
</head>
<body>
<div class="wrap">
  <p class="muted"><a href="/">← JUPASCal calculator</a></p>
  <h1>All JUPAS programmes (2026)</h1>
  <p>Every JUPAS degree programme across Hong Kong's ten institutions. Select a programme to see its 2025 admission scores, subject weighting and 2026 entrance requirements — or <a href="/">open the calculator</a> to estimate your own score.</p>
  ${sections}
</div>
</body>
</html>`;
}

// ---- generate ----
const byInst = {};
for (const p of data) (byInst[p.institution] ||= []).push(p);

let n = 0;
for (const p of data) {
  const dir = `${OUT}/p/${p.jupas_code}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, programmePage(p, byInst[p.institution] || []));
  n++;
}
mkdirSync(`${OUT}/p`, { recursive: true });
writeFileSync(`${OUT}/p/index.html`, indexPage(byInst));

// full sitemap (overwrites the minimal public/sitemap.xml)
const urls = [`${SITE}/`, `${SITE}/p/`, ...data.map((p) => `${SITE}/p/${p.jupas_code}/`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><changefreq>weekly</changefreq><priority>${u === SITE + "/" ? "1.0" : "0.7"}</priority></url>`).join("\n")}
</urlset>
`;
writeFileSync(`${OUT}/sitemap.xml`, sitemap);

console.log(`SEO: generated ${n} programme pages + /p/ index + sitemap (${urls.length} urls)`);
