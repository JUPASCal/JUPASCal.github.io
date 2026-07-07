// Static SEO page generator (a build-time SSG step, run after `vite build`).
//
// The app is a client-rendered SPA: the served HTML is near-empty, so search /AI
// engines have almost nothing to index and individual programmes never rank for
// their own name/code. This writes a self-contained, fully-crawlable, BILINGUAL,
// on-brand landing page PER PROGRAMME (plus a browse index and a 424-url sitemap)
// into dist/. Each page mirrors the app's look (cream theme, brand header, benchmark
// cards, dark-mode) so a visitor who lands from search feels they've arrived at the
// product — with a prominent CTA into the interactive calculator (/?p=<CODE>).
//
// Pages are STANDALONE (no app bundle) because vite `base: "./"` would mis-resolve
// relative asset paths under /p/<CODE>/. They use root-absolute links (/, /p/, /?p=).
//
// Wired into `npm run build` (build:seo) so it runs locally and in CI.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";

const SITE = "https://jupascal.com";
const OUT = "dist";
const DATA = "data/processed/JUPAS_2026_Unified_Data.json";
const data = JSON.parse(readFileSync(DATA, "utf8"));

// Prefetch the app's hashed JS/CSS (+ the runtime data) so that when a visitor taps
// the CTA, the calculator is already in cache and opens instantly — turning the
// static-page → app hand-off into a single seamless step. These are low-priority
// hints the browser fetches while idle and skips on save-data / slow connections
// (no SEO impact — it's preloading, not a redirect). Runs after `vite build`.
let PREFETCH = "";
try {
  const assets = readdirSync(`${OUT}/assets`).filter((f) => /\.(js|css)$/.test(f));
  PREFETCH = ["/", ...assets.map((f) => `/assets/${f}`), "/data/processed/JUPAS_2026_Unified_Data.json"]
    .map((h) => `<link rel="prefetch" href="${h}" />`).join("\n");
} catch { PREFETCH = ""; }

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
  SSSDP: { en: "SSSDP", zh: "指定專業／界別課程資助計劃（SSSDP）" },
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
// bilingual label for the core requirement subjects
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
  if (r.chi) rows.push(`${REQ_ZH.chi} — L${esc(r.chi)}`);
  if (r.eng) rows.push(`${REQ_ZH.eng} — L${esc(r.eng)}`);
  if (r.math) rows.push(`${REQ_ZH.math} — L${esc(r.math)}`);
  if (r.csd) rows.push(`${REQ_ZH.csd} — ${esc(r.csd)}`);
  for (const key of ["elect1", "elect2"]) {
    const e = r[key];
    if (e && (e.subjects?.length || e.grade)) {
      const subs = (e.subjects || []).join(" / ");
      rows.push(`選修科 Elective${e.count && e.count > 1 ? ` ×${e.count}` : ""}${subs ? ` (${esc(subs)})` : ""} — L${esc(e.grade || "—")}`);
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
    year, apps: app.Total ?? null, appsBandA: app["Band A"] ?? null,
    offers: off?.Total ?? null, offersBandA: off?.["Band A"] ?? null,
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

// Bilingual benchmark-basis note {en, zh} for CUHK recalculated / self-simulated programmes.
function basisNote(p) {
  if (p.score_basis === "cuhk_2026_recalculated") return {
    en: "These 2025 admission scores are CUHK's official figures recalculated with the revised 2026 scoring formula.",
    zh: "以下 2025 年收生分數為香港中文大學以 2026 年新計分方法重新計算的官方數字。",
  };
  if (p.score_basis === "cuhk_2026_simulated") return {
    en: "This programme's weighting changed for 2026. CUHK hasn't published a recalculated score, so these are JUPASCal's estimate — the 2026 weighting applied to CUHK's published subject grades of past admitted students.",
    zh: "此課程 2026 年的科目加權有所調整；香港中文大學未公佈重新計算的分數，故以下為 JUPASCal 的估算：以 2026 年加權方法套用於科大公佈的過往取錄學生各科成績。",
  };
  return null;
}

const SHELL_CSS = `
  :root{--bg:#f8f0ea;--surface:#f1e5dd;--surface-strong:#fffaf6;--ink:#4d281a;--muted:#786257;--line:#dccabd;--accent:#c2452e;--accent-2:#1b3a6b;--good:#2a6a4a;--radius:14px;--shadow:0 8px 24px rgba(33,26,20,.08)}
  @media (prefers-color-scheme:dark){:root{--bg:#11100e;--surface:#191816;--surface-strong:#22201d;--ink:#eee8dc;--muted:#a59d90;--line:#3a352d;--accent:#d2a86f;--accent-2:#9fb0a3;--shadow:0 8px 24px rgba(0,0,0,.35)}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:'Gelasio','Iowan Old Style','Source Serif Pro',Charter,Georgia,serif;line-height:1.62;-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .site-header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .site-header .row{max-width:760px;margin:0 auto;padding:11px 20px;display:flex;align-items:center;gap:9px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:1.15rem;color:var(--ink)}
  .brand img{width:26px;height:26px}
  .brand .yr{font-size:.7rem;font-weight:700;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:1px 5px}
  .brand-nav{margin-left:auto;font-size:.85rem}
  .wrap{max-width:760px;margin:0 auto;padding:26px 20px 80px}
  .crumb{font-size:.8rem;color:var(--muted);margin:0 0 14px}
  .badges{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 10px}
  .badge{font-size:.74rem;font-weight:700;letter-spacing:.02em;padding:3px 9px;border-radius:99px;background:var(--surface);border:1px solid var(--line);color:var(--muted)}
  h1{font-size:2rem;line-height:1.15;margin:0 0 4px}
  .subtitle{color:var(--muted);font-size:1.15rem;margin:0 0 14px}
  .lede{background:var(--surface-strong);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin:0 0 20px;font-size:.98rem}
  .cta{display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;padding:13px 22px;border-radius:12px;font-weight:700;font-size:1.02rem;box-shadow:var(--shadow);margin:4px 0}
  .cta:hover{text-decoration:none;filter:brightness(1.05)}
  h2{font-size:1.15rem;margin:32px 0 12px;display:flex;align-items:baseline;gap:9px}
  h2 .en{font-size:.82rem;font-weight:400;color:var(--muted)}
  h3{font-size:1rem;margin:16px 0 4px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:6px 0}
  .stat{background:var(--surface-strong);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;text-align:center}
  .stat .k{font-size:.78rem;color:var(--muted);display:block}
  .stat .v{font-size:1.9rem;font-weight:700;color:var(--accent);display:block;line-height:1.1;margin-top:2px}
  .panel{background:var(--surface-strong);border:1px solid var(--line);border-radius:var(--radius);padding:14px 17px;margin:6px 0}
  ul{margin:6px 0;padding-left:20px}
  li{margin:2px 0}
  .note{background:color-mix(in srgb,var(--accent) 7%,var(--surface-strong));border:1px solid color-mix(in srgb,var(--accent) 26%,var(--line));border-left:3px solid var(--accent);border-radius:11px;padding:11px 14px;font-size:.9rem;color:var(--muted);margin:12px 0}
  .note .zh{color:var(--ink);display:block;margin-bottom:3px}
  .muted{color:var(--muted);font-size:.85rem}
  .faq h3{margin-top:18px}
  .faq p{margin:2px 0 0}
  footer{margin-top:44px;border-top:1px solid var(--line);padding-top:18px;font-size:.8rem;color:var(--muted)}
  .cta-bar{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;justify-content:center;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(10px);border-top:1px solid var(--line)}
  .cta-bar .cta{margin:0;width:100%;max-width:440px;justify-content:center;box-shadow:none}
`;

function head(title, desc, canonical, extraLd, htmlLang = "zh-Hant") {
  return `<!doctype html>
<html lang="${htmlLang}">
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
${PREFETCH}
${extraLd || ""}
<style>${SHELL_CSS}</style>
</head>
<body>
<header class="site-header"><div class="row">
  <a class="brand" href="/"><img src="/logo.svg" alt="" /><span>JUPASCal</span><span class="yr">2026</span></a>
  <a class="brand-nav" href="/p/">所有課程 All programmes</a>
</div></header>`;
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

  // AI-liftable factual summary (English, self-contained).
  const summary = `${nameEn} (${code}) is a JUPAS undergraduate programme offered by ${instEn(inst)} (${inst}).`
    + (med != null ? ` Its 2025 median admission score was ${med}${uq != null && lq != null ? ` (upper quartile ${uq}, lower quartile ${lq})` : ""}.` : "")
    + ` It is scored on ${formulaTxt}${wl.length ? ` with weighting: ${plainWeights}` : " with equal subject weighting"}.`
    + (os && os.apps != null ? ` In ${os.year} it received ${os.apps} applications for about ${os.quota ?? "?"} places.` : "");

  const reqShort = reqs.slice(0, 5).map((r) => r.replace(/&amp;/g, "&")).join("; ");
  const faqs = [];
  if (med != null) faqs.push([`${code} 2025 年收生分數是多少？ · What was the 2025 admission score for ${code}?`, `The 2025 median admission score for ${nameEn} (${code}) at ${inst} was ${med}${uq != null ? `, with an upper quartile of ${uq}` : ""}${lq != null ? ` and a lower quartile of ${lq}` : ""}.${note ? " " + note.en : ""}`]);
  if (reqs.length) faqs.push([`${code} 2026 年入學要求是什麼？ · What are the 2026 entrance requirements for ${code}?`, `${nameEn} (${code}) requires ${reqShort}.`]);
  faqs.push([`${code} 的分數如何計算？ · How is the ${code} score calculated?`, `${nameEn} uses ${formulaTxt}${wl.length ? `, with these weightings: ${plainWeights}` : " with equal (x1) subject weighting"}. Eligibility is checked against the 2026 entrance requirements.`]);
  if (stats) faqs.push([`${code} 競爭有多大？ · How competitive is ${code}?`, stats.replace(/&amp;/g, "&")]);

  const courseLd = {
    "@context": "https://schema.org", "@type": "Course", name: nameEn, alternateName: nameZh || undefined,
    description: summary, url: canonical, inLanguage: ["zh-Hant", "en"], isAccessibleForFree: true,
    provider: { "@type": "CollegeOrUniversity", name: instEn(inst) },
  };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const breadcrumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "JUPASCal", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "All programmes", item: `${SITE}/p/` },
      { "@type": "ListItem", position: 3, name: `${nameEn} (${code})`, item: canonical },
    ],
  };
  const extraLd = [courseLd, faqLd, breadcrumbLd].map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");

  const statCards = [];
  if (lq != null) statCards.push(`<div class="stat"><span class="k">下四分位 LQ</span><span class="v">${lq}</span></div>`);
  if (med != null) statCards.push(`<div class="stat"><span class="k">中位數 Median</span><span class="v">${med}</span></div>`);
  if (uq != null) statCards.push(`<div class="stat"><span class="k">上四分位 UQ</span><span class="v">${uq}</span></div>`);

  const rel = siblings.filter((q) => q.jupas_code !== code).slice(0, 8)
    .map((q) => `<li><a href="/p/${q.jupas_code}/">${esc(q.name_zh || q.name_en || q.jupas_code)} <span class="muted">(${q.jupas_code})</span></a></li>`).join("");

  const officialLinks = [];
  const site = httpsHref((p.programme_websites || [])[0]);
  if (site) officialLinks.push(`<a href="${esc(site)}" rel="nofollow noopener">課程官方網頁 Official page ↗</a>`);
  const jupas = httpsHref(p.jupas_url);
  if (jupas) officialLinks.push(`<a href="${esc(jupas)}" rel="nofollow noopener">JUPAS 課程資料 ↗</a>`);

  return head(title, desc, canonical, extraLd)
    + `<div class="wrap">
  <p class="crumb"><a href="/">JUPASCal</a> › <a href="/p/">所有課程</a> › ${esc(inst)} › ${code}</p>
  <div class="badges"><span class="badge">${esc(inst)}</span><span class="badge">${code}</span>${p.faculty ? `<span class="badge">${esc(p.faculty)}</span>` : ""}</div>
  <h1>${esc(nameZh || nameEn)}</h1>
  ${nameZh ? `<p class="subtitle">${esc(nameEn)}</p>` : ""}
  <p class="lede">用 JUPASCal 輸入你的 DSE 成績，即可按此課程的計分方法估算你的 JUPAS 分數，並對照往年收生分數。<span lang="en"> Estimate your score for this programme and compare it against past admission scores.</span></p>
  <a class="cta" href="/?p=${code}">計算我的分數 · Calculate my score →</a>

  <h2>收生分數 <span class="en">Admission scores (2025)</span></h2>
  ${statCards.length ? `<div class="cards">${statCards.join("")}</div>` : `<p class="muted">暫無往年收生分數（多為新開辦課程）。No 2025 admission-score benchmark on record.</p>`}
  ${note ? `<div class="note"><span class="zh">${esc(note.zh)}</span><span lang="en">${esc(note.en)}</span></div>` : ""}

  <h2>計分方法 <span class="en">Scoring & weighting</span></h2>
  <div class="panel"><p style="margin:0 0 6px"><strong>${esc(formulaTxt)}</strong></p>
  ${wl.length ? `<ul>${wl.map((w) => `<li>${w}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">各科同等比重（×1）。Equal subject weighting.</p>`}</div>

  <h2>入學要求 <span class="en">2026 requirements</span></h2>
  ${reqs.length ? `<div class="panel"><ul style="margin:0">${reqs.map((r) => `<li>${r}</li>`).join("")}</ul></div>` : `<p class="muted">詳見課程官方網頁。See the official page.</p>`}
  ${p.quota ? `<p class="muted">學額 Intake quota：約 ${esc(p.quota)}。</p>` : ""}

  ${stats ? `<h2>收生數據 <span class="en">Admission statistics (${os.year})</span></h2><div class="panel"><p style="margin:0">${esc(stats)}</p></div>` : ""}

  ${officialLinks.length ? `<h2>官方連結 <span class="en">Official links</span></h2><p>${officialLinks.join(" &nbsp;·&nbsp; ")}</p>` : ""}

  <div class="faq"><h2>常見問題 <span class="en">FAQ</span></h2>
  ${faqs.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("\n  ")}</div>

  ${rel ? `<h2>${esc(inst)} 其他課程 <span class="en">Other programmes</span></h2><ul>${rel}</ul>` : ""}

  <footer>JUPASCal 為免費、非官方的 JUPAS／DSE 收生計分工具，所有分數僅供參考，請以 ${esc(instZh(inst))} 及 JUPAS 公佈為準。計分採用最新（2025 年）收生數據，入學資格採用 2026 年要求。<br>JUPASCal is a free, unofficial JUPAS / HKDSE score calculator — estimates for reference only.</footer>
</div>
<div class="cta-bar"><a class="cta" href="/?p=${code}">計算我的分數 · Calculate my score →</a></div>
</body>
</html>`;
}

function indexPage(byInst) {
  const canonical = `${SITE}/p/`;
  const sections = Object.keys(byInst).sort().map((inst) => {
    const items = byInst[inst].slice().sort((a, b) => a.jupas_code.localeCompare(b.jupas_code))
      .map((p) => `<li><a href="/p/${p.jupas_code}/">${esc(p.name_zh || p.name_en || p.jupas_code)} <span class="muted">(${p.jupas_code})</span></a></li>`).join("");
    return `<h2 id="${esc(inst)}">${esc(instZh(inst))} <span class="en">${esc(inst)}</span></h2><ul class="grid">${items}</ul>`;
  }).join("");
  const extra = `<style>.wrap{max-width:920px}ul.grid{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:2px 22px}ul.grid li{padding:3px 0}</style>`;
  return head("所有 JUPAS 課程 2026 — 收生分數及計分方法 | JUPASCal",
    "瀏覽全港十間院校所有 JUPAS 課程的 2025 年收生分數、計分比重及 2026 入學要求，並用 JUPASCal 估算你的分數。Browse every JUPAS programme across Hong Kong's 10 institutions.",
    canonical, extra)
    + `<div class="wrap">
  <h1>所有 JUPAS 課程</h1>
  <p class="subtitle" lang="en">All JUPAS programmes (2026)</p>
  <p class="lede">全港十間院校所有 JUPAS 課程。選擇課程查看其 2025 年收生分數、計分比重及 2026 入學要求，或<a href="/">開啟計算機</a>估算你的分數。</p>
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

const urls = [`${SITE}/`, `${SITE}/p/`, ...data.map((p) => `${SITE}/p/${p.jupas_code}/`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><changefreq>weekly</changefreq><priority>${u === SITE + "/" ? "1.0" : "0.7"}</priority></url>`).join("\n")}
</urlset>
`;
writeFileSync(`${OUT}/sitemap.xml`, sitemap);

console.log(`SEO: generated ${n} programme pages + /p/ index + sitemap (${urls.length} urls)`);
