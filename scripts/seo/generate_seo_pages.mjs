// Static SEO page generator (a build-time SSG step, run after `vite build`).
//
// Writes a self-contained, fully-crawlable, BILINGUAL page PER PROGRAMME (+ a browse
// index + a 424-url sitemap) into dist/. To make each page look like the real app
// (not a bolted-on SEO doc), the pages LINK THE APP'S OWN BUILT CSS and reuse the
// app's real class names (app-topbar / app-shell / detail-panel / benchmark-grid /
// formula-card / stepper-next-btn …). The app uses plain (non-module) class names, so
// this stays in visual sync with the app automatically. A tiny inline script sets
// data-theme (matching the app's light/dark) before paint. Every CTA deep-links into
// the real calculator (/?p=<CODE>), which the app opens straight to that programme.
//
// Pages are STANDALONE (no app JS) and use ROOT-ABSOLUTE links (/, /p/, /assets/…),
// correct on the jupascal.com custom domain. Wired into `npm run build` (build:seo).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";

const SITE = "https://jupascal.com";
const OUT = "dist";
const DATA = "data/processed/JUPAS_2026_Unified_Data.json";
const data = JSON.parse(readFileSync(DATA, "utf8"));

// App's built CSS (hashed) — link them so the static pages inherit the app's design.
const cssFiles = (() => {
  try {
    const f = readdirSync(`${OUT}/assets`).filter((x) => x.endsWith(".css"));
    // index-*.css (base tokens) before App-*.css (components override).
    return f.sort((a, b) => (a.startsWith("index") ? -1 : 1) - (b.startsWith("index") ? -1 : 1));
  } catch { return []; }
})();
const APP_CSS = cssFiles.map((f) => `<link rel="stylesheet" href="/assets/${f}" />`).join("\n");
// Prefetch the app bundle + data so tapping a CTA drops into the calculator instantly.
const PREFETCH = (() => {
  try {
    const a = readdirSync(`${OUT}/assets`).filter((f) => /\.(js|css)$/.test(f));
    return ["/", ...a.map((f) => `/assets/${f}`), "/data/processed/JUPAS_2026_Unified_Data.json"]
      .map((h) => `<link rel="prefetch" href="${h}" />`).join("\n");
  } catch { return ""; }
})();

const LOGO = `<svg class="app-brand-logo" viewBox="32 30 284 214" aria-hidden="true" focusable="false"><path fill="currentColor" d="M172,33 176,33 312,103 173,172 36,103 171,34Z"></path><path fill="currentColor" d="M90,149 172,189 182,186 257,149 257,208 241,220 216,233 200,238 180,241 158,240 137,235 113,224 90,208 90,150Z"></path><path fill="#c2922e" d="M291,198 299,198 303,204 309,223 311,240 279,241 283,215 290,199Z"></path><path fill="#c2922e" d="M293,169 303,173 306,179 305,186 298,192 292,192 286,188 284,178 285,175 292,170Z"></path><path fill="#c2922e" d="M293,123 299,126 299,162 291,164 292,124Z"></path></svg>`;
// Match the app's initial theme: saved choice, else system preference. Runs before paint.
const THEME_SCRIPT = `<script>try{var t=localStorage.getItem('jupas-staging-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}</script>`;
// A few tweaks the app CSS can't cover for a standalone static page.
const EXTRA_CSS = `<style>
  a.stepper-next-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;width:100%}
  .seo-lede{color:var(--muted);font-size:.95rem;margin:2px 0 14px}
  .seo-en{color:var(--muted)}
  .detail-static .detail-header-text h2{margin:.1em 0 .15em}
  .seo-cta-wrap{margin:14px 0 4px}
  .seo-faq p.eyebrow{margin-top:0}
  .seo-faq h3{font-size:.98rem;margin:14px 0 3px}
  .seo-faq .a{color:var(--muted);font-size:.9rem;margin:0}
  .seo-rel a{display:inline-block;margin:0 0 4px}
  .app-shell.detail-static{padding-bottom:96px}
</style>`;

const INST = {
  HKU: { en: "The University of Hong Kong", zh: "香港大學" },
  CUHK: { en: "The Chinese University of Hong Kong", zh: "香港中文大學" },
  HKUST: { en: "The Hong Kong University of Science and Technology", zh: "香港科技大學" },
  PolyU: { en: "The Hong Kong Polytechnic University", zh: "香港理工大學" },
  CityUHK: { en: "City University of Hong Kong", zh: "香港城市大學" },
  HKBU: { en: "Hong Kong Baptist University", zh: "香港浸會大學" },
  LingnanU: { en: "Lingnan University", zh: "嶺南大學" },
  EdUHK: { en: "The Education University of Hong Kong", zh: "香港教育大學" },
  HKMU: { en: "Hong Kong Metropolitan University", zh: "香港都會大學" },
  SSSDP: { en: "SSSDP", zh: "SSSDP 指定專業／界別課程資助計劃" },
};
const instZh = (k) => (INST[k]?.zh || k);
const instEn = (k) => (INST[k]?.en || k);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (x) => (x == null || Number.isNaN(x) ? null : x);
const httpsHref = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

const SHORT = {
  "English Language": "English", "Chinese Language": "Chinese",
  "Mathematics (Compulsory Part)": "Maths", "Citizenship and Social Development": "CSD",
  "Mathematics Extended Part (Module 1)": "M1", "Mathematics Extended Part (Module 2)": "M2",
};
const shortSubj = (s) => SHORT[s] ?? s;
const REQ_ZH = { chi: "中文 Chinese", eng: "英文 English", math: "數學 Maths", csd: "公民科 CSD" };

function weightingList(p) {
  const parts = [];
  for (const [k, v] of Object.entries(p.subject_weights_2026 || {})) parts.push(`${esc(shortSubj(k))} ×${v}`);
  for (const pool of p.best_of_weights_2026 || []) {
    const subs = (pool.subjects || []).map(shortSubj).join(" / ");
    parts.push(`best ${pool.count ?? 1} of ${esc(subs)} ×${pool.weight}`);
  }
  return parts;
}

function requirements(p) {
  const r = p.min_requirements_2026 || {};
  const rows = [];
  if (r.chi) rows.push([REQ_ZH.chi, `L${esc(r.chi)}`]);
  if (r.eng) rows.push([REQ_ZH.eng, `L${esc(r.eng)}`]);
  if (r.math) rows.push([REQ_ZH.math, `L${esc(r.math)}`]);
  if (r.csd) rows.push([REQ_ZH.csd, `${esc(r.csd)}`]);
  for (const key of ["elect1", "elect2"]) {
    const e = r[key];
    if (e && (e.subjects?.length || e.grade)) {
      const subs = (e.subjects || []).join(" / ");
      rows.push([`選修科 Elective${e.count && e.count > 1 ? ` ×${e.count}` : ""}${subs ? ` (${esc(subs)})` : ""}`, `L${esc(e.grade || "—")}`]);
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
  return { year, apps: app.Total ?? null, appsBandA: app["Band A"] ?? null, offers: off?.Total ?? null, offersBandA: off?.["Band A"] ?? null, quota: app.Quota ?? off?.Quota ?? p.quota ?? null };
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
  if (p.score_basis === "cuhk_2026_recalculated") return { en: "These 2025 admission scores are CUHK's official figures recalculated with the revised 2026 scoring formula.", zh: "以下 2025 年收生分數為香港中文大學以 2026 年新計分方法重新計算的官方數字。" };
  if (p.score_basis === "cuhk_2026_simulated") return { en: "This programme's weighting changed for 2026. CUHK hasn't published a recalculated score, so these are JUPASCal's estimate — the 2026 weighting applied to CUHK's published subject grades of past admitted students.", zh: "此課程 2026 年的科目加權有所調整；香港中文大學未公佈重新計算的分數，故以下為 JUPASCal 的估算：以 2026 年加權方法套用於科大公佈的過往取錄學生各科成績。" };
  return null;
}

function head(title, desc, canonical, extraLd) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE}/og-image.png?v=2" />
<meta property="og:site_name" content="JUPASCal" />
<meta property="og:locale" content="zh_HK" />
<meta property="og:locale:alternate" content="en_US" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gelasio:wght@400;600;700&display=swap" />
${APP_CSS}
${EXTRA_CSS}
${PREFETCH}
${extraLd || ""}
${THEME_SCRIPT}
</head>
<body>
<header class="app-topbar">
  <div class="app-topbar-left"><a class="app-brand" href="/" aria-label="JUPASCal 2026">${LOGO}<span class="app-brand-name">JUPASCal <span class="app-brand-year">2026</span></span></a></div>
  <nav class="app-topbar-actions" aria-label="導覽"><a class="pill" href="/p/">所有課程 All programmes</a></nav>
</header>`;
}

function programmePage(p, siblings) {
  const code = p.jupas_code;
  const nameEn = p.name_en || code;
  const nameZh = p.name_zh || "";
  const inst = p.institution || "";
  const canonical = `${SITE}/p/${code}/`;
  const s = p.scores_2025 || {};
  const med = num(s.median), uq = num(s.uq), lq = num(s.lq);
  const wl = weightingList(p);
  const reqs = requirements(p);
  const note = basisNote(p);
  const os = offerStats(p);
  const stats = statsSentence(os);
  const plainWeights = wl.join(", ").replace(/×/g, "x").replace(/&amp;/g, "&");
  const formulaTxt = p.formula_2026 || p.formula_2025 || "Best 5 subjects";

  const title = `${nameZh ? nameZh + " " : ""}${nameEn} (${code}) · ${instZh(inst)} 收生分數及計分方法 2026 | JUPASCal`;
  const desc = `${nameZh ? nameZh + "（" + code + "）" : nameEn + " (" + code + ")"}｜${instZh(inst)}${med != null ? `：2025 年收生中位數 ${med}分` : ""}、2026 入學要求及計分比重。用 JUPASCal 估算你的 JUPAS 分數。`;

  const summary = `${nameEn} (${code}) is a JUPAS undergraduate programme offered by ${instEn(inst)} (${inst}).`
    + (med != null ? ` Its 2025 median admission score was ${med}${uq != null && lq != null ? ` (upper quartile ${uq}, lower quartile ${lq})` : ""}.` : "")
    + ` It is scored on ${formulaTxt}${wl.length ? ` with weighting: ${plainWeights}` : " with equal subject weighting"}.`
    + (os && os.apps != null ? ` In ${os.year} it received ${os.apps} applications for about ${os.quota ?? "?"} places.` : "");

  const reqShort = reqs.slice(0, 5).map(([k, v]) => `${k.replace(/&amp;/g, "&")} ${v}`).join("; ");
  const faqs = [];
  if (med != null) faqs.push([`${code} 2025 年收生分數是多少？ · What was the 2025 admission score for ${code}?`, `The 2025 median admission score for ${nameEn} (${code}) at ${inst} was ${med}${uq != null ? `, with an upper quartile of ${uq}` : ""}${lq != null ? ` and a lower quartile of ${lq}` : ""}.${note ? " " + note.en : ""}`]);
  if (reqs.length) faqs.push([`${code} 2026 入學要求？ · What are the 2026 entrance requirements for ${code}?`, `${nameEn} (${code}) requires ${reqShort}.`]);
  faqs.push([`${code} 的分數如何計算？ · How is the ${code} score calculated?`, `${nameEn} uses ${formulaTxt}${wl.length ? `, with these weightings: ${plainWeights}` : " with equal (x1) subject weighting"}. Eligibility is checked against the 2026 entrance requirements.`]);
  if (stats) faqs.push([`${code} 競爭有多大？ · How competitive is ${code}?`, stats.replace(/&amp;/g, "&")]);

  const courseLd = { "@context": "https://schema.org", "@type": "Course", name: nameEn, alternateName: nameZh || undefined, description: summary, url: canonical, inLanguage: ["zh-Hant", "en"], isAccessibleForFree: true, provider: { "@type": "CollegeOrUniversity", name: instEn(inst) } };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const crumbLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "JUPASCal", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "All programmes", item: `${SITE}/p/` },
    { "@type": "ListItem", position: 3, name: `${nameEn} (${code})`, item: canonical },
  ] };
  const extraLd = [courseLd, faqLd, crumbLd].map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");

  const cards = [];
  if (lq != null) cards.push(`<div class="benchmark-card"><span>LQ</span><strong>${lq}</strong></div>`);
  if (med != null) cards.push(`<div class="benchmark-card"><span>中位數 Median</span><strong>${med}</strong></div>`);
  if (uq != null) cards.push(`<div class="benchmark-card"><span>UQ</span><strong>${uq}</strong></div>`);

  const badges = [];
  if (p.year_changes?.weighting_changed || p.score_basis) badges.push(`<span class="status change">2026 計分方法更新 · Formula updated</span>`);
  if (p.quota) badges.push(`<span class="status neutral">學額 Quota ${esc(p.quota)}</span>`);

  const rel = siblings.filter((q) => q.jupas_code !== code).slice(0, 8)
    .map((q) => `<a href="/p/${q.jupas_code}/">${esc(q.name_zh || q.name_en || q.jupas_code)} <span class="muted">(${q.jupas_code})</span></a>`).join(" · ");

  const links = [];
  const site = httpsHref((p.programme_websites || [])[0]);
  if (site) links.push(`<a class="official-link" href="${esc(site)}" rel="nofollow noopener">課程官方網頁 Official page ↗</a>`);
  const jupas = httpsHref(p.jupas_url);
  if (jupas) links.push(`<a class="official-link" href="${esc(jupas)}" rel="nofollow noopener">JUPAS 課程資料 ↗</a>`);

  const cta = `<a class="stepper-next-btn" href="/?p=${code}">計算我的分數 · Calculate my score →</a>`;

  return head(title, desc, canonical, extraLd)
    + `<main class="app-shell layout-mobile detail-static">
  <aside class="panel detail-panel">
    <div class="detail-header-main">
      <div class="detail-header-text">
        <p class="eyebrow">${esc(instZh(inst))} · ${code}${p.faculty ? " · " + esc(p.faculty) : ""}</p>
        <h2>${esc(nameZh || nameEn)}</h2>
        ${nameZh ? `<p class="seo-en">${esc(nameEn)}</p>` : ""}
      </div>
    </div>
    ${badges.length ? `<div class="detail-badges">${badges.join("")}</div>` : ""}

    <p class="seo-lede">輸入你的 DSE 成績，即可按此課程的計分方法估算你的 JUPAS 分數，並對照往年收生分數。<span class="seo-en"> Estimate your score for this programme and compare it against past admission scores.</span></p>
    <div class="seo-cta-wrap">${cta}</div>

    <hr class="grade-section-divider" />
    <p class="eyebrow">收生分數 · Admission scores (2025)</p>
    ${cards.length ? `<div class="benchmark-grid">${cards.join("")}</div>` : `<p class="muted">暫無往年收生分數（多為新開辦課程）。No 2025 admission-score benchmark on record.</p>`}
    ${note ? `<p class="muted benchmark-caveat">${esc(note.zh)}<br><span class="seo-en">${esc(note.en)}</span></p>` : ""}

    <hr class="grade-section-divider" />
    <div class="extra-info-card formula-card">
      <div class="extra-info-eyebrow">計分方法 · Scoring &amp; weighting</div>
      <div class="extra-info-body"><p class="formula-text">${esc(formulaTxt)}</p>
      ${wl.length ? `<ul>${wl.map((w) => `<li>${w}</li>`).join("")}</ul>` : `<p class="muted">各科同等比重（×1）。Equal subject weighting.</p>`}</div>
    </div>

    <div class="extra-info-card formula-card">
      <div class="extra-info-eyebrow">入學要求 · 2026 requirements</div>
      <div class="extra-info-body">${reqs.length ? reqs.map(([k, v]) => `<div class="extra-info-row"><span>${k}</span><span class="extra-info-value">${v}</span></div>`).join("") : `<p class="muted">詳見課程官方網頁。See the official page.</p>`}</div>
    </div>

    ${stats ? `<div class="offers-card formula-card"><div class="offers-card-eyebrow">收生數據 · Admission statistics (${os.year})</div><div class="offers-body"><p class="formula-text">${esc(stats)}</p></div></div>` : ""}

    ${links.length ? `<p class="eyebrow">官方連結 · Official links</p><p>${links.join(" &nbsp; ")}</p>` : ""}

    <hr class="grade-section-divider" />
    <div class="seo-faq"><p class="eyebrow">常見問題 · FAQ</p>
    ${faqs.map(([q, a]) => `<h3>${esc(q)}</h3><p class="a">${esc(a)}</p>`).join("")}</div>

    ${rel ? `<hr class="grade-section-divider" /><p class="eyebrow">${esc(inst)} 其他課程 · Other programmes</p><p class="seo-rel">${rel}</p>` : ""}

    <p class="muted" style="margin-top:20px;font-size:.78rem">JUPASCal 為免費、非官方的 JUPAS／DSE 收生計分工具，分數僅供參考，請以 ${esc(instZh(inst))} 及 JUPAS 公佈為準。A free, unofficial JUPAS / HKDSE score calculator — estimates for reference only.</p>
  </aside>
</main>
<footer class="stepper-footer"><div class="stepper-footer-right" style="flex:1">${cta}</div></footer>
</body>
</html>`;
}

function indexPage(byInst) {
  const canonical = `${SITE}/p/`;
  const sections = Object.keys(byInst).sort().map((inst) => {
    const items = byInst[inst].slice().sort((a, b) => a.jupas_code.localeCompare(b.jupas_code))
      .map((p) => `<a class="seo-rel-item" href="/p/${p.jupas_code}/">${esc(p.name_zh || p.name_en || p.jupas_code)} <span class="muted">(${p.jupas_code})</span></a>`).join("");
    return `<p class="eyebrow" style="margin-top:22px">${esc(instZh(inst))} <span class="muted">${esc(inst)}</span></p><div class="seo-rel-grid">${items}</div>`;
  }).join("");
  const extra = `<style>.seo-rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:2px 20px}.seo-rel-item{padding:3px 0}main.detail-static .panel{max-width:940px}</style>`;
  return head("所有 JUPAS 課程 2026 — 收生分數及計分方法 | JUPASCal",
    "瀏覽全港十間院校所有 JUPAS 課程的 2025 年收生分數、計分比重及 2026 入學要求，並用 JUPASCal 估算你的分數。Browse every JUPAS programme across Hong Kong's 10 institutions.",
    canonical, extra)
    + `<main class="app-shell layout-mobile detail-static">
  <aside class="panel detail-panel">
    <div class="detail-header-main"><div class="detail-header-text"><p class="eyebrow">所有課程 · All programmes</p><h2>所有 JUPAS 課程</h2><p class="seo-en">Every JUPAS programme (2026)</p></div></div>
    <p class="seo-lede">全港十間院校所有 JUPAS 課程。選擇課程查看其 2025 年收生分數、計分比重及 2026 入學要求，或<a href="/">開啟計算機</a>估算你的分數。</p>
    <div class="seo-cta-wrap"><a class="stepper-next-btn" href="/">開啟計算機 · Open the calculator →</a></div>
    ${sections}
  </aside>
</main>
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

const urls = [`${SITE}/`, `${SITE}/p/`, ...data.map((p) => `${SITE}/p/${p.jupas_code}/`)];
writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><changefreq>weekly</changefreq><priority>${u === SITE + "/" ? "1.0" : "0.7"}</priority></url>`).join("\n")}
</urlset>
`);
console.log(`SEO: generated ${n} programme pages + /p/ index + sitemap (${urls.length} urls) [linked app CSS: ${cssFiles.join(", ") || "NONE"}]`);
