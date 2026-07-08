// Static SEO page generator (build-time SSG, run after `vite build`).
//
// Writes a crawlable, bilingual page PER PROGRAMME (+ browse index + 424-url sitemap)
// into dist/. To make each page identical to the app, the templates LINK the app's own
// built CSS (index-*.css + App-*.css, filenames read from the build) and reproduce the
// APP'S EXACT DETAIL-PANEL DOM — the real class names AND nesting captured from the
// running app: app-topbar / app-shell layout-mobile / panel detail-panel / detail-header
// / detail-name / score-context > benchmark-grid / eligibility-card formula-card /
// formula-year-grid / offers-card / extra-info-card / official-card, dividers, and the
// stepper-next-btn CTA + stepper-footer. A tiny inline script sets data-theme before
// paint (saved choice → system), so it matches the app's light/dark. The two user-
// specific sections (your-score, pass/fail eligibility) are reframed for a no-user page:
// the score card prompts you to open the calculator, and eligibility is shown as the
// programme's REQUIREMENTS. Every CTA deep-links into the app (/?p=<CODE>).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";

const SITE = "https://jupascal.com";
const OUT = "dist";
const DATA = "data/processed/JUPAS_2026_Unified_Data.json";
const data = JSON.parse(readFileSync(DATA, "utf8"));
let DETAILS = {};
try { DETAILS = JSON.parse(readFileSync("data/processed/programme_details_2026.json", "utf8")); } catch {}

const cssFiles = (() => {
  try { return readdirSync(`${OUT}/assets`).filter((x) => x.endsWith(".css")).sort((a, b) => (a.startsWith("index") ? -1 : 1) - (b.startsWith("index") ? -1 : 1)); } catch { return []; }
})();
const APP_CSS = cssFiles.map((f) => `<link rel="stylesheet" href="/assets/${f}" />`).join("\n");
const PREFETCH = (() => {
  try {
    const a = readdirSync(`${OUT}/assets`).filter((f) => /\.(js|css)$/.test(f));
    return ["/", ...a.map((f) => `/assets/${f}`), "/data/processed/JUPAS_2026_Unified_Data.json"].map((h) => `<link rel="prefetch" href="${h}" />`).join("\n");
  } catch { return ""; }
})();

const LOGO = `<svg class="app-brand-logo" viewBox="32 30 284 214" aria-hidden="true" focusable="false"><path fill="currentColor" d="M172,33 176,33 312,103 173,172 36,103 171,34Z"></path><path fill="currentColor" d="M90,149 172,189 182,186 257,149 257,208 241,220 216,233 200,238 180,241 158,240 137,235 113,224 90,208 90,150Z"></path><path fill="#c2922e" d="M291,198 299,198 303,204 309,223 311,240 279,241 283,215 290,199Z"></path><path fill="#c2922e" d="M293,169 303,173 306,179 305,186 298,192 292,192 286,188 284,178 285,175 292,170Z"></path><path fill="#c2922e" d="M293,123 299,126 299,162 291,164 292,124Z"></path></svg>`;
const THEME_SCRIPT = `<script>try{document.documentElement.dataset.theme=localStorage.getItem('jupas-staging-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');}catch(e){}</script>`;
const EXTRA_CSS = `<style>
  a.stepper-next-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
  main.app-shell.detail-static{max-width:640px;margin:0 auto;padding-bottom:100px}
  .detail-static .detail-name h2{cursor:default}
  .seo-cta{margin:14px 0 4px}
  .seo-lede{color:var(--muted);font-size:.92rem;margin:0 0 4px}
  .seo-faq p.eyebrow,.seo-faq{margin-top:0}
  .seo-faq h4{font-size:.95rem;margin:14px 0 3px}
  .seo-faq .a{color:var(--muted);font-size:.88rem;margin:0}
  .seo-rel a{display:inline-block;margin:0 8px 4px 0}
  .stepper-footer .stepper-next-btn{width:100%}
</style>`;

const INST = {
  HKU: { en: "The University of Hong Kong", zh: "香港大學" }, CUHK: { en: "The Chinese University of Hong Kong", zh: "香港中文大學" },
  HKUST: { en: "The Hong Kong University of Science and Technology", zh: "香港科技大學" }, PolyU: { en: "The Hong Kong Polytechnic University", zh: "香港理工大學" },
  CityUHK: { en: "City University of Hong Kong", zh: "香港城市大學" }, HKBU: { en: "Hong Kong Baptist University", zh: "香港浸會大學" },
  LingnanU: { en: "Lingnan University", zh: "嶺南大學" }, EdUHK: { en: "The Education University of Hong Kong", zh: "香港教育大學" },
  HKMU: { en: "Hong Kong Metropolitan University", zh: "香港都會大學" }, SSSDP: { en: "SSSDP", zh: "SSSDP 指定專業／界別課程資助計劃" },
};
const instZh = (k) => (INST[k]?.zh || k);
const instEn = (k) => (INST[k]?.en || k);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (x) => (x == null || Number.isNaN(x) ? null : x);
const httpsHref = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);
const shortUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const SHORT = { "English Language": "English 英文", "Chinese Language": "Chinese 中文", "Mathematics (Compulsory Part)": "Maths 數學", "Citizenship and Social Development": "CSD 公民科", "Mathematics Extended Part (Module 1)": "M1", "Mathematics Extended Part (Module 2)": "M2" };
const shortSubj = (s) => SHORT[s] ?? s;
const REQ_ZH = { chi: "中文", eng: "英文", math: "數學", csd: "公民科" };

function weightItems(p) {
  const out = [];
  for (const [k, v] of Object.entries(p.subject_weights_2026 || {})) out.push([shortSubj(k), `x${v}`]);
  for (const pool of p.best_of_weights_2026 || []) out.push([`best ${pool.count ?? 1} of ${(pool.subjects || []).map(shortSubj).join(" / ")}`, `x${pool.weight}`]);
  return out;
}
function requirements(p) {
  const r = p.min_requirements_2026 || {};
  const rows = [];
  if (r.chi) rows.push([REQ_ZH.chi, esc(r.chi), null]);
  if (r.eng) rows.push([REQ_ZH.eng, esc(r.eng), null]);
  if (r.math) rows.push([REQ_ZH.math, esc(r.math), null]);
  if (r.csd) rows.push([REQ_ZH.csd, esc(r.csd), null]);
  for (const key of ["elect1", "elect2"]) {
    const e = r[key];
    if (e && (e.subjects?.length || e.grade)) rows.push([key === "elect1" ? "選修一" : "選修二", esc(e.grade || "—"), (e.subjects || []).join(" / ") || null]);
  }
  return rows;
}
function offerStats(p) {
  const rows = p.offer_statistics || [];
  const y = rows.filter((r) => r.Type === "Application").map((r) => r.Year);
  if (!y.length) return null;
  const year = Math.max(...y);
  const app = rows.find((r) => r.Year === year && r.Type === "Application");
  const off = rows.find((r) => r.Year === year && r.Type === "Offer");
  if (!app) return null;
  return { year, apps: app.Total ?? null, appsBandA: app["Band A"] ?? null, offers: off?.Total ?? null, offersBandA: off?.["Band A"] ?? null, quota: app.Quota ?? off?.Quota ?? p.quota ?? null };
}
function basisNote(p) {
  if (p.score_basis === "cuhk_2026_recalculated") return { en: "CUHK's official 2025 scores recalculated with the 2026 formula.", zh: "科大以 2026 年計分方法重新計算的 2025 年官方分數。" };
  if (p.score_basis === "cuhk_2026_simulated") return { en: "JUPASCal's estimate — the 2026 weighting applied to CUHK's published subject grades of past admitted students (no official recalc published).", zh: "JUPASCal 估算：以 2026 年加權套用於科大公佈的過往取錄學生成績（校方未公佈重算分數）。" };
  return null;
}

function head(title, desc, canonical, extraLd, extraStyle) {
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
${EXTRA_CSS}${extraStyle || ""}
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
  const nameEn = p.name_en || code, nameZh = p.name_zh || "", inst = p.institution || "";
  const canonical = `${SITE}/p/${code}/`;
  const s = p.scores_2025 || {};
  const med = num(s.median), uq = num(s.uq), lq = num(s.lq);
  const witems = weightItems(p);
  const reqs = requirements(p);
  const note = basisNote(p);
  const os = offerStats(p);
  const formulaTxt = p.formula_2026 || p.formula_2025 || "Best 5 subjects";
  const plainWeights = witems.map(([k, v]) => `${k} ${v}`).join(", ").replace(/&amp;/g, "&");

  const title = `${nameZh ? nameZh + " " : ""}${nameEn} (${code}) · ${instZh(inst)} 收生分數及計分方法 2026 | JUPASCal`;
  const desc = `${nameZh ? nameZh + "（" + code + "）" : nameEn + " (" + code + ")"}｜${instZh(inst)}${med != null ? `：2025 年收生中位數 ${med}分` : ""}、2026 入學要求及計分比重。用 JUPASCal 估算你的 JUPAS 分數。`;
  const summary = `${nameEn} (${code}) is a JUPAS undergraduate programme offered by ${instEn(inst)} (${inst}).`
    + (med != null ? ` Its 2025 median admission score was ${med}${uq != null && lq != null ? ` (upper quartile ${uq}, lower quartile ${lq})` : ""}.` : "")
    + ` It is scored on ${formulaTxt}${witems.length ? ` with weighting: ${plainWeights}` : " with equal subject weighting"}.`
    + (os && os.apps != null ? ` In ${os.year} it received ${os.apps} applications for about ${os.quota ?? "?"} places.` : "");
  const faqs = [];
  if (med != null) faqs.push([`${code} 2025 年收生分數是多少？ · What was the 2025 admission score for ${code}?`, `The 2025 median admission score for ${nameEn} (${code}) at ${inst} was ${med}${uq != null ? `, UQ ${uq}` : ""}${lq != null ? `, LQ ${lq}` : ""}.${note ? " " + note.en : ""}`]);
  if (reqs.length) faqs.push([`${code} 2026 入學要求？ · Entrance requirements for ${code}?`, `${nameEn} (${code}) requires ${reqs.map(([k, v]) => k.replace(/&amp;/g, "&") + " L" + v).join("; ")}.`]);
  faqs.push([`${code} 的分數如何計算？ · How is the ${code} score calculated?`, `${nameEn} uses ${formulaTxt}${witems.length ? `, with weightings: ${plainWeights}` : " with equal (x1) subject weighting"}.`]);

  const courseLd = { "@context": "https://schema.org", "@type": "Course", name: nameEn, alternateName: nameZh || undefined, description: summary, url: canonical, inLanguage: ["zh-Hant", "en"], isAccessibleForFree: true, provider: { "@type": "CollegeOrUniversity", name: instEn(inst) } };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const crumbLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "JUPASCal", item: `${SITE}/` }, { "@type": "ListItem", position: 2, name: "All programmes", item: `${SITE}/p/` }, { "@type": "ListItem", position: 3, name: `${nameEn} (${code})`, item: canonical },
  ] };
  const extraLd = [courseLd, faqLd, crumbLd].map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");

  const cards = [];
  if (uq != null) cards.push(`<div class="benchmark-card"><span>UQ</span><strong>${uq}</strong></div>`);
  if (med != null) cards.push(`<div class="benchmark-card"><span>中位數</span><strong>${med}</strong></div>`);
  if (lq != null) cards.push(`<div class="benchmark-card"><span>LQ</span><strong>${lq}</strong></div>`);

  const badges = [];
  if (p.year_changes?.weighting_changed || p.score_basis) badges.push(`<span class="status change">2026 計分方法更新</span>`);
  if (p.quota) badges.push(`<span class="status neutral">學額：${esc(p.quota)}</span>`);

  const reqRows = reqs.map(([k, v, note2]) => `<li class="eligibility-cell"><span class="eligibility-cell-mark" aria-hidden="true">·</span><span class="eligibility-cell-subject">${k}</span><span class="eligibility-cell-have"></span><span class="eligibility-cell-need"><em>要求</em><b>${v}</b></span>${note2 ? `<span class="eligibility-cell-note">${esc(note2)}</span>` : ""}</li>`).join("");

  const weightCloud = witems.length ? `<hr class="weight-divider"><div class="weight-cloud">${witems.map(([k, v]) => `<span class="weight-item"><span>${k}</span><span>${v}</span></span>`).join("")}</div>` : "";

  let offersHtml = "";
  if (os && os.apps != null) {
    const rate = os.offersBandA != null && os.appsBandA ? Math.round((os.offersBandA / os.appsBandA) * 100) : null;
    offersHtml = `<hr class="grade-section-divider"><section class="offers-card formula-card"><div class="offers-card-eyebrow"><span>Band A 取錄 · ${os.year}</span>${rate != null ? `<b class="tally-badge offers-tally">取錄率 ${rate}%</b>` : ""}</div><p class="formula-text">${os.appsBandA != null ? `${os.appsBandA} 名 Band A 申請人中，${os.offersBandA ?? "—"} 人獲取錄` : `${os.apps} 份申請`}${os.quota != null ? `，約 ${os.quota} 個學額` : ""}</p><small>Band A applications: ${os.appsBandA ?? os.apps}, offers: ${os.offersBandA ?? os.offers ?? "—"} (${os.year}).</small></section>`;
  }

  const det = DETAILS[code];
  const descBlock = det?.overview ? `<hr class="grade-section-divider"><section class="extra-info-card formula-card"><div class="extra-info-eyebrow"><span>課程概覽 · Overview</span></div><div class="extra-info-body"><p>${esc(String(det.overview).slice(0, 900))}</p></div></section>` : "";

  const links = [];
  const jupas = httpsHref(p.jupas_url);
  if (jupas) links.push(`<a class="official-link" href="${esc(jupas)}" target="_blank" rel="nofollow noopener"><strong>官方 JUPAS 頁面</strong><em>${code} · ${esc(inst)}</em></a>`);
  const site = httpsHref((p.programme_websites || [])[0]);
  if (site) links.push(`<a class="official-link" href="${esc(site)}" target="_blank" rel="nofollow noopener"><strong>課程網站 Programme site</strong><em>${esc(shortUrl(site))}</em></a>`);

  const cta = `<a class="stepper-next-btn" href="/?p=${code}">計算我的分數 · Calculate my score →</a>`;

  return head(title, desc, canonical, extraLd)
    + `<main class="app-shell layout-mobile detail-static">
  <aside class="panel detail-panel">
    <div class="detail-header"><div class="detail-header-main"><div class="detail-header-text">
      <p class="eyebrow">課程詳情 · ${esc(inst)} · ${code}</p>
      <div class="detail-name"><h2>${esc(nameZh || nameEn)}</h2>${nameZh ? `<p class="zh-name">${esc(nameEn)}</p>` : ""}</div>
    </div></div>
    ${badges.length ? `<div class="detail-badges">${badges.join("")}</div>` : ""}</div>

    <p class="seo-lede">輸入你的 DSE 成績即可按此課程計分方法估算分數，並對照往年收生。<span class="seo-en"> Enter your DSE grades to estimate your score for this programme.</span></p>
    <div class="seo-cta">${cta}</div>

    <section class="score-context">
      <div class="score-context-header" style="cursor:default">
        <div class="score-context-line"><div class="score-context-score"><em>收生分數 Admission scores</em><strong>2025</strong></div></div>
        <p class="score-context-note">往年取錄學生的分數分佈 · past admitted students</p>
      </div>
      ${cards.length ? `<div class="benchmark-grid">${cards.join("")}</div>` : `<p class="muted" style="padding:8px 4px">暫無往年收生分數（多為新課程）。No 2025 benchmark on record.</p>`}
    </section>
    ${note ? `<p class="muted benchmark-caveat">${esc(note.zh)}<br><span class="seo-en">${esc(note.en)}</span></p>` : ""}

    ${reqs.length ? `<hr class="grade-section-divider"><section class="eligibility-card formula-card"><div class="eligibility-card-eyebrow"><span>入學要求 · 2026 requirements</span></div><hr class="weight-divider"><div class="eligibility-body desktop-open"><ol class="eligibility-rows">${reqRows}</ol></div></section>` : ""}

    <hr class="grade-section-divider"><section><div class="formula-year-grid"><div class="formula-card"><span>計分方法 · Scoring 2026</span><p class="formula-text">${esc(formulaTxt)}</p><small>各科同等比重（×1），另有加權見下。</small>${weightCloud}</div></div></section>

    ${offersHtml}
    ${descBlock}

    ${links.length ? `<hr class="grade-section-divider"><section class="formula-card official-card"><span>官方頁面 · Official</span><div class="official-links">${links.join("")}</div></section>` : ""}

    <hr class="grade-section-divider"><section class="seo-faq"><p class="eyebrow">常見問題 · FAQ</p>${faqs.map(([q, a]) => `<h4>${esc(q)}</h4><p class="a">${esc(a)}</p>`).join("")}</section>

    ${siblings.length > 1 ? `<hr class="grade-section-divider"><p class="eyebrow">${esc(inst)} 其他課程 · Other programmes</p><p class="seo-rel">${siblings.filter((q) => q.jupas_code !== code).slice(0, 8).map((q) => `<a href="/p/${q.jupas_code}/">${esc(q.name_zh || q.name_en || q.jupas_code)} <span class="muted">(${q.jupas_code})</span></a>`).join(" ")}</p>` : ""}

    <p class="muted" style="margin-top:18px;font-size:.76rem">JUPASCal 為免費、非官方的 JUPAS／DSE 收生計分工具，分數僅供參考，請以 ${esc(instZh(inst))} 及 JUPAS 公佈為準。A free, unofficial JUPAS / HKDSE score calculator — estimates for reference only.</p>
  </aside>
</main>
<footer class="stepper-footer"><div class="stepper-footer-right" style="flex:1;justify-content:stretch">${cta}</div></footer>
</body>
</html>`;
}

function indexPage(byInst) {
  const canonical = `${SITE}/p/`;
  const sections = Object.keys(byInst).sort().map((inst) => {
    const items = byInst[inst].slice().sort((a, b) => a.jupas_code.localeCompare(b.jupas_code)).map((p) => `<a href="/p/${p.jupas_code}/">${esc(p.name_zh || p.name_en || p.jupas_code)} <span class="muted">(${p.jupas_code})</span></a>`).join(" ");
    return `<hr class="grade-section-divider"><p class="eyebrow">${esc(instZh(inst))} <span class="muted">${esc(inst)}</span></p><p class="seo-rel">${items}</p>`;
  }).join("");
  const extra = `<style>main.detail-static{max-width:760px}</style>`;
  return head("所有 JUPAS 課程 2026 — 收生分數及計分方法 | JUPASCal", "瀏覽全港十間院校所有 JUPAS 課程的 2025 年收生分數、計分比重及 2026 入學要求。Browse every JUPAS programme across Hong Kong's 10 institutions.", canonical, "", extra)
    + `<main class="app-shell layout-mobile detail-static"><aside class="panel detail-panel">
    <div class="detail-header"><div class="detail-header-main"><div class="detail-header-text"><p class="eyebrow">所有課程 · All programmes</p><div class="detail-name"><h2>所有 JUPAS 課程</h2><p class="zh-name">Every JUPAS programme (2026)</p></div></div></div></div>
    <p class="seo-lede">全港十間院校所有 JUPAS 課程。選擇課程查看收生分數、計分比重及入學要求。</p>
    <div class="seo-cta"><a class="stepper-next-btn" href="/">開啟計算機 · Open the calculator →</a></div>
    ${sections}
  </aside></main>
</body>
</html>`;
}

// ---- generate ----
const byInst = {};
for (const p of data) (byInst[p.institution] ||= []).push(p);
let n = 0;
for (const p of data) { const dir = `${OUT}/p/${p.jupas_code}`; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/index.html`, programmePage(p, byInst[p.institution] || [])); n++; }
mkdirSync(`${OUT}/p`, { recursive: true });
writeFileSync(`${OUT}/p/index.html`, indexPage(byInst));
const urls = [`${SITE}/`, `${SITE}/p/`, ...data.map((p) => `${SITE}/p/${p.jupas_code}/`)];
writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><changefreq>weekly</changefreq><priority>${u === SITE + "/" ? "1.0" : "0.7"}</priority></url>`).join("\n")}
</urlset>
`);
console.log(`SEO: ${n} programme pages + index + sitemap (${urls.length} urls) [app CSS: ${cssFiles.join(", ") || "NONE"}]`);
