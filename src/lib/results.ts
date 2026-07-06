import { applyExtraEligibility, calculateScore, checkEligibility } from "./calculator";
import { hasPostReleaseInterview, hasPreReleaseOnlyInterview } from "./selection";
import type { BenchmarkBand, BenchmarkComparison, BenchmarkKey, Programme, ProgrammeResult, StudentGrades } from "../types/jupas";

export type SortKey = "benchmark" | "code" | "name" | "institution" | "eligibility" | "score" | "lq" | "median" | "uq" | "quota";

// Interview-timing filter based on official source timing only. Vague entries
// such as "When necessary" are excluded from both timing filters.
export type InterviewFilter = "all" | "after" | "before";

export type Filters = {
  query: string;
  institutions: string[];
  eligibleOnly: boolean;
  band: BenchmarkBand | "all";
  interview: InterviewFilter;
};

export function buildProgrammeResult(programme: Programme, grades: StudentGrades): ProgrammeResult {
  const calculation = calculateScore(grades, programme, hasHistoricalScores(programme) ? "2025" : "2026");
  const eligibility = applyExtraEligibility(
    checkEligibility(grades, programme.min_requirements_2026, programme),
    programme,
    grades,
    calculation.totalScore,
  );
  const comparisons = buildComparisons(calculation.totalScore, programme);
  const band = getBenchmarkBand(calculation.totalScore, programme);
  return {
    programme,
    calculation,
    eligibility,
    comparisons,
    band,
    // Whether the PROGRAMME has 2025 admission-score data — independent of whether
    // the student has entered grades. (Was `comparisons.length > 0`, which was
    // false with no grades, wrongly flagging real benchmarks as "no data".)
    hasScoreData: hasHistoricalScores(programme),
  };
}

export function filterResults(results: ProgrammeResult[], filters: Filters) {
  const query = normalizeSearchText(filters.query);
  const compactQuery = compactSearchText(filters.query);
  return results.filter((result) => {
    const programme = result.programme;
    if (filters.institutions.length > 0 && !filters.institutions.includes(programme.institution)) return false;
    if (filters.eligibleOnly && !result.eligibility.eligible) return false;
    if (filters.band !== "all" && result.band !== filters.band) return false;
    if (filters.interview !== "all") {
      if (filters.interview === "after" && !hasPostReleaseInterview(programme)) return false;
      if (filters.interview === "before" && !hasPreReleaseOnlyInterview(programme)) return false;
    }
    if (!query) return true;
    const index = searchIndexFor(programme);
    if (isShortSearch(query, compactQuery)) return compactMatch(compactQuery, index);
    return index.normalized.includes(query)
      || compactMatch(compactQuery, index)
      || tokenPrefixMatch(query, index.tokens);
  });
}

export function sortResults(results: ProgrammeResult[], sortKey: SortKey, direction: "asc" | "desc", deltaMode: "points" | "percent" = "points") {
  // In % mode the benchmark-diff columns rank by percentage-of-benchmark, not
  // raw points, so the display and the ordering stay in the same unit.
  const pct = deltaMode === "percent";
  const benchDelta = (r: ProgrammeResult, key: BenchmarkKey) => (pct ? percentFor(r, key) : deltaFor(r, key));
  const central = (r: ProgrammeResult) => (pct ? centralPercentFor(r) : centralDeltaFor(r));
  const sorted = [...results].sort((a, b) => {
    const multiplier = direction === "asc" ? 1 : -1;
    if (sortKey === "benchmark") {
      const value = benchmarkRank(a) - benchmarkRank(b) || central(a) - central(b) || benchDelta(a, "lq") - benchDelta(b, "lq");
      return multiplier * value;
    }
    if (sortKey === "score") return multiplier * (a.calculation.totalScore - b.calculation.totalScore);
    if (sortKey === "quota") return multiplier * (numberForSort(a.programme.quota) - numberForSort(b.programme.quota));
    if (sortKey === "eligibility") return multiplier * (Number(a.eligibility.eligible) - Number(b.eligibility.eligible));
    if (sortKey === "median") return multiplier * (central(a) - central(b));
    if (sortKey === "lq" || sortKey === "uq") return multiplier * (benchDelta(a, sortKey) - benchDelta(b, sortKey));
    if (sortKey === "name") {
      return multiplier * (a.programme.name_en.localeCompare(b.programme.name_en) || a.programme.jupas_code.localeCompare(b.programme.jupas_code));
    }
    const left = sortKey === "code" ? a.programme.jupas_code : a.programme.institution;
    const right = sortKey === "code" ? b.programme.jupas_code : b.programme.institution;
    return multiplier * (left.localeCompare(right) || a.programme.jupas_code.localeCompare(b.programme.jupas_code));
  });
  return sorted;
}

export type BenchmarkSource = "actual" | "mean" | "expected" | "none";

export type EffectiveBenchmarks = {
  lq: number | null;
  median: number | null; // the central reference: median ?? mean ?? expected_score
  uq: number | null;
  source: BenchmarkSource;
};

// The central benchmark the app compares a score against. Most programmes
// publish a median (with LQ/UQ quartiles); when there's no median we fall back
// to the mean (all SSSDP, some PolyU) and then to CUHK's expected_score — both
// on the SAME scale as the computed score — so a programme with a real
// reference figure isn't treated as "no data". Only genuinely benchmark-less
// programmes (truly new / unrecorded) stay null. Single source of truth for the
// fallback, shared by the results band, the analysis risk read, and the score
// scale, so they never disagree.
export function effectiveBenchmarks(programme: Programme): EffectiveBenchmarks {
  const s = programme.scores_2025 || {};
  const lq = s.lq ?? null;
  const uq = s.uq ?? null;
  if (s.median != null) return { lq, median: s.median, uq, source: "actual" };
  if (s.mean != null) return { lq, median: s.mean, uq, source: "mean" };
  if (s.expected_score != null) return { lq, median: s.expected_score, uq, source: "expected" };
  return { lq, median: null, uq, source: "none" };
}

export function buildComparisons(totalScore: number, programme: Programme): BenchmarkComparison[] {
  const labels: Record<BenchmarkKey, string> = { uq: "UQ", median: "Median", lq: "LQ", mean: "Mean", expected_score: "Expected" };
  const scores = programme.scores_2025 || {};
  // expected_score is shown as a benchmark card ONLY when it's the fallback
  // reference (no median and no mean); beside published quartiles it's redundant.
  const keys: BenchmarkKey[] = ["uq", "median", "lq", "mean"];
  if (scores.median == null && scores.mean == null && scores.expected_score != null) keys.push("expected_score");
  return keys.flatMap((key) => {
    const score = scores[key];
    if (!score || !totalScore) return [];
    return [{
      key,
      label: labels[key],
      score,
      delta: totalScore - score,
      percent: ((totalScore - score) / score) * 100,
    }];
  });
}

export function getBenchmarkBand(totalScore: number, programme: Programme): BenchmarkBand {
  const { lq, median, uq } = effectiveBenchmarks(programme);
  if (!totalScore || (uq == null && median == null && lq == null)) return "no-score";
  if (uq != null && totalScore >= uq) return "above-uq";
  if (median != null && totalScore >= median) return "above-median";
  if (lq != null && totalScore >= lq) return "above-lq";
  return "below-lq";
}

export function bandLabel(band: BenchmarkBand) {
  return {
    "above-uq": "Above UQ",
    "above-median": "Above median",
    "above-lq": "Above LQ",
    "below-lq": "Below LQ",
    "no-score": "No score data",
  }[band];
}

// i18n key for a band's long label — feed to `t()` so band captions localize
// consistently wherever they render (results table/cards, share, analysis).
export function bandLabelKey(band: BenchmarkBand): string {
  return {
    "above-uq": "bandLong.aboveUq",
    "above-median": "bandLong.aboveMed",
    "above-lq": "bandLong.aboveLq",
    "below-lq": "bandLong.belowLq",
    "no-score": "bandLong.noScore",
  }[band];
}

export function benchmarkRank(result: ProgrammeResult) {
  return {
    "above-uq": 4,
    "above-median": 3,
    "above-lq": 2,
    "below-lq": 1,
    "no-score": 0,
  }[result.band];
}

export function deltaFor(result: ProgrammeResult, key: BenchmarkKey) {
  return result.comparisons.find((comparison) => comparison.key === key)?.delta ?? Number.NEGATIVE_INFINITY;
}

export function centralDeltaFor(result: ProgrammeResult) {
  return result.comparisons.find((comparison) => comparison.key === "median" || comparison.key === "mean")?.delta ?? Number.NEGATIVE_INFINITY;
}

export function percentFor(result: ProgrammeResult, key: BenchmarkKey) {
  return result.comparisons.find((comparison) => comparison.key === key)?.percent ?? Number.NEGATIVE_INFINITY;
}

export function centralPercentFor(result: ProgrammeResult) {
  return result.comparisons.find((comparison) => comparison.key === "median" || comparison.key === "mean")?.percent ?? Number.NEGATIVE_INFINITY;
}

function numberForSort(value?: number | null) {
  return value ?? Number.NEGATIVE_INFINITY;
}

export function formatDelta(value?: number) {
  if (value === undefined || value === Number.NEGATIVE_INFINITY) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function formatPercent(value?: number) {
  if (value === undefined || value === Number.NEGATIVE_INFINITY) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function hasHistoricalScores(programme: Programme) {
  const scores = programme.scores_2025 || {};
  return Boolean(scores.uq || scores.median || scores.lq || scores.mean);
}

type SearchIndex = {
  normalized: string;
  compact: string;
  aliases: string[];
  shortAliases: string[];
  tokens: string[];
};

const searchIndexCache = new WeakMap<Programme, SearchIndex>();

const SEARCH_ALIASES: Record<string, string[]> = {
  JS6896: ["ibgm", "international business global management", "hku ibgm"],
  JS6810: ["glaw", "govlaw", "government law", "government laws", "hku glaw"],
  JS6808: ["blaw", "bbalaw", "business law", "business and law", "hku blaw"],
};

const PATHWAY_ALIASES: Record<string, string[]> = {
  // JUPAS pages checked:
  // JS4801 lists Psychology as one of the Year 2-4 Major options.
  // JS6717 lists Psychology as an available additional second major.
  JS4801: [
    "architectural studies",
    "economics",
    "geography and resource management",
    "urban studies",
    "government and public administration",
    "journalism and communication",
    "global communication",
    "psychology",
    "sociology",
    "global studies",
    "data science and policy studies",
    "global economics and finance",
    "psychology pathway",
    "psy",
    "psych",
  ],
  JS6717: ["psychology", "psychology pathway", "psy", "psych"],
  // Explicit concentrations / streams on the JUPAS pages:
  JS4812: ["architecture", "architectural studies", "archi"],
  JS4838: [
    "urban planning",
    "urban design",
    "urban policy",
    "urban environment",
    "smart sustainable cities",
  ],
  JS4848: [
    "political science",
    "politics",
    "public administration",
    "public policy",
    "international relations",
  ],
  JS4850: [
    "journalism",
    "communication",
    "advertising",
    "public relations",
    "creative and new media",
    "new media",
  ],
  JS4858: ["global communication", "communication", "global comm"],
  JS4892: [
    "global studies",
    "global media",
    "global economy",
    "world politics",
    "planetary health",
    "quantitative methods",
  ],
  JS4893: [
    "data science",
    "policy studies",
    "social data and policy",
    "technology governance",
    "urban innovation",
    "environmental policy analytics",
  ],
  JS4254: ["global economics", "global finance", "economics", "finance", "banking"],
};

const ACRONYM_STOPWORDS = new Set([
  "and",
  "as",
  "at",
  "bachelor",
  "degree",
  "for",
  "honours",
  "hons",
  "in",
  "of",
  "offered",
  "programme",
  "program",
  "the",
  "with",
]);

function searchIndexFor(programme: Programme): SearchIndex {
  const cached = searchIndexCache.get(programme);
  if (cached) return cached;
  const aliases = programmeAliases(programme);
  const shortAliases = programmeShortAliases(programme);
  const values = [
    programme.jupas_code,
    programme.name_en,
    programme.name_zh || "",
    programme.short_description || "",
    programme.institution,
    programme.faculty || "",
    programme.remarks || "",
    ...(programme.programme_websites || []),
    ...aliases,
    ...shortAliases,
  ];
  const compactValues = [
    programme.jupas_code,
    programme.name_en,
    programme.name_zh || "",
    programme.short_description || "",
    ...(programme.programme_websites || []),
    ...aliases,
    ...shortAliases,
  ];
  const normalized = normalizeSearchText(values.join(" "));
  const compact = compactSearchText(compactValues.join(" "));
  const normalizedAliases = aliases.map(normalizeSearchText).filter(Boolean);
  const normalizedShortAliases = shortAliases.map(normalizeSearchText).filter(Boolean);
  const tokens = [...new Set(normalized.split(" ").filter(Boolean))];
  const index = { normalized, compact, aliases: normalizedAliases, shortAliases: normalizedShortAliases, tokens };
  searchIndexCache.set(programme, index);
  return index;
}

function programmeAliases(programme: Programme): string[] {
  const name = programme.name_en || "";
  const chineseName = programme.name_zh || "";
  const normalizedName = normalizeSearchText(name);
  const aliases = new Set<string>(SEARCH_ALIASES[programme.jupas_code] || []);

  for (const acronym of acronymCandidates(name)) aliases.add(acronym);
  for (const slug of websiteSlugs(programme.programme_websites || [])) aliases.add(slug);

  if (/\b(global|international)\b/.test(normalizedName) && /\bbusiness\b/.test(normalizedName)) {
    aliases.add("gbus");
    aliases.add("global business");
    aliases.add("international business");
  }
  if (/\bcomputer\b/.test(normalizedName) && /\bscience\b/.test(normalizedName)) aliases.add("cs");
  if (/\bdata\b/.test(normalizedName) && /\bscience\b/.test(normalizedName)) aliases.add("ds");
  if (/\bartificial\b/.test(normalizedName) && /\bintelligence\b/.test(normalizedName)) aliases.add("ai");
  if (/\blaw(s)?\b/.test(normalizedName)) aliases.add("law");
  if (/\bsocial work\b/.test(normalizedName)) aliases.add("sowk");
  if (/\binternational\b/.test(normalizedName)) aliases.add(normalizedName.replace(/\binternational\b/g, "intl"));
  if (/\bbusiness\b/.test(normalizedName)) aliases.add(normalizedName.replace(/\bbusiness\b/g, "biz"));
  for (const alias of PATHWAY_ALIASES[programme.jupas_code] || []) aliases.add(alias);
  for (const alias of chineseAliases(name, chineseName)) aliases.add(alias);

  return [...aliases].filter(Boolean);
}

function programmeShortAliases(programme: Programme): string[] {
  const en = normalizeSearchText(programme.name_en || "");
  const zh = programme.name_zh || "";
  const aliases = new Set<string>();

  // Generated two-letter acronyms are noisy (e.g. many unrelated chunks can
  // produce "ot"). Keep 1-2 character queries to deliberate shorthands.
  if (/computer science/.test(en) || /計算機科學|電腦科學/.test(zh)) aliases.add("cs");
  if (/data science/.test(en) || /數據科學|資料科學/.test(zh)) aliases.add("ds");
  if (/artificial intelligence/.test(en) || /人工智能/.test(zh)) aliases.add("ai");
  if (/electrical|electronic/.test(en) || /電機|電子/.test(zh)) aliases.add("ee");
  if (/physiotherapy/.test(en) || /物理治療/.test(zh)) aliases.add("pt");
  if (/occupational therapy/.test(en) || /職業治療/.test(zh)) aliases.add("ot");
  for (const alias of chineseAliases(programme.name_en || "", zh)) {
    if ([...alias].length <= 2) aliases.add(alias);
  }

  return [...aliases];
}

function chineseAliases(nameEn: string, nameZh: string): string[] {
  const aliases = new Set<string>();
  const en = normalizeSearchText(nameEn);
  const zh = nameZh || "";

  if ((/computational finance|financial technology|fintech/.test(en) || /計算金融|金融科技/.test(zh))) {
    aliases.add("計金");
    aliases.add("金科");
    aliases.add("金融科技");
  }
  if ((/\b(global|international)\b/.test(en) && /\bbusiness\b/.test(en)) || /環球商業|國際商業/.test(zh)) {
    aliases.add("環商");
    aliases.add("國商");
    aliases.add("環球商業");
  }
  // Business Administration: 「工管」 (and 「工商」) are the everyday short forms,
  // but neither is a contiguous substring of 「工商管理」, so they need to be
  // explicit aliases.
  if (/business administration|\bbba\b/.test(en) || /工商管理/.test(zh)) {
    aliases.add("工管");
    aliases.add("工商管理");
    aliases.add("bba");
    aliases.add("ba"); // BBA is also a "BA"; arts BAs get "ba" below — both are wanted
  }
  // Bachelor of Arts — deliberately broad: "ba" should surface both arts BAs and
  // BBAs (per owner). Matches a standalone "BA" token, the spelled-out degree, or
  // 文學士.
  if (/bachelor of arts\b|\bba\b/.test(en) || /文學士/.test(zh)) {
    aliases.add("ba");
  }
  // Urban Studies — 「城規」「城市規劃」 are how students search for the urban-direction
  // programmes (none is literally named 城市規劃). Scoped tightly to Urban Studies
  // (the genuine match), NOT to programmes that merely list 智慧城市 as a feature
  // (data/manufacturing engineering) nor the generic 規劃 (planning).
  if (/\burban\b/.test(en) || /城市研究/.test(zh)) {
    aliases.add("城規");
    aliases.add("城市規劃");
    aliases.add("城研");
    aliases.add("urban");
  }
  if (/human resource/.test(en) || /人力資源/.test(zh)) {
    aliases.add("人資");
    aliases.add("人力");
    aliases.add("hr");
  }
  if (/marketing/.test(en) || /市場|營銷/.test(zh)) {
    aliases.add("市場");
    aliases.add("市場學");
    aliases.add("mkt");
  }
  if (/statistic/.test(en) || /統計/.test(zh)) {
    aliases.add("統計");
    aliases.add("stats");
    aliases.add("stat");
  }
  if (/medical laboratory|laboratory science/.test(en) || /醫療化驗/.test(zh)) {
    aliases.add("醫化");
    aliases.add("醫療化驗");
    aliases.add("mls");
  }
  if (/social work/.test(en) || /社會工作/.test(zh)) {
    aliases.add("社工");
  }
  if (/computer science/.test(en) || /計算機科學|電腦科學/.test(zh)) {
    aliases.add("計科");
    aliases.add("電腦");
  }
  if (/data science/.test(en) || /數據科學|資料科學/.test(zh)) aliases.add("數科");
  if (/artificial intelligence/.test(en) || /人工智能/.test(zh)) aliases.add("人智");
  if (/\blaw(s)?\b/.test(en) || /法學|法律/.test(zh)) aliases.add("法律");
  if (/account/.test(en) || /會計/.test(zh)) aliases.add("會計");
  if (/account/.test(en) || /會計/.test(zh)) aliases.add("acct");
  if (/actuarial/.test(en) || /精算/.test(zh)) aliases.add("精算");
  if (/economics?/.test(en) || /經濟/.test(zh)) aliases.add("經濟");
  if (/economics?/.test(en) || /經濟/.test(zh)) aliases.add("econ");
  if (/finance|financial/.test(en) || /金融|財務/.test(zh)) aliases.add("金融");
  if (/finance|financial/.test(en) || /金融|財務/.test(zh)) aliases.add("fin");
  if (/architecture|architectural/.test(en) || /建築/.test(zh)) {
    aliases.add("建築");
    aliases.add("建築系");
    aliases.add("archi");
  }
  if (/civil engineering/.test(en) || /土木/.test(zh)) {
    aliases.add("土木");
    aliases.add("civil");
  }
  if (/mechanical|mechatronic/.test(en) || /機械/.test(zh)) {
    aliases.add("機械");
    aliases.add("mech");
  }
  if (/electrical|electronic/.test(en) || /電機|電子/.test(zh)) {
    aliases.add("電機");
    aliases.add("電子");
    aliases.add("ee");
    aliases.add("eee");
  }
  if (/chemical engineering/.test(en) || /化學及生物工程|化學工程/.test(zh)) {
    aliases.add("化工");
    aliases.add("chemeng");
  }
  if (/chemistry/.test(en) || /化學/.test(zh)) aliases.add("化學");
  if (/biolog|bioscience|biotechnology/.test(en) || /生物|生物科技/.test(zh)) aliases.add("生物");
  if (/biomedical/.test(en) || /生物醫學/.test(zh)) {
    aliases.add("生醫");
    aliases.add("生物醫學");
  }
  if (/communication|journalism|media/.test(en) || /傳播|傳理|新聞|媒體/.test(zh)) {
    aliases.add("傳理");
    aliases.add("傳播");
    aliases.add("媒體");
    aliases.add("comm");
  }
  if (/journalism/.test(en) || /新聞/.test(zh)) aliases.add("新聞");
  if (/design/.test(en) || /設計/.test(zh)) aliases.add("設計");
  if (/education/.test(en) || /教育/.test(zh)) {
    aliases.add("教育");
    aliases.add("edu");
  }
  if (/early childhood/.test(en) || /幼兒教育/.test(zh)) aliases.add("幼教");
  if (/social sciences?/.test(en) || /社會科學/.test(zh)) aliases.add("社科");
  if (/public affairs|public policy|government|politics/.test(en) || /公共事務|公共政策|政府|政治/.test(zh)) {
    aliases.add("政政");
    aliases.add("公管");
  }
  if (/international relations/.test(en) || /國際關係/.test(zh)) aliases.add("國關");
  if (/hotel|hospitality/.test(en) || /酒店|款待/.test(zh)) {
    aliases.add("酒管");
    aliases.add("hotel");
  }
  if (/tourism/.test(en) || /旅遊/.test(zh)) aliases.add("旅遊");
  if (/logistics|supply chain/.test(en) || /物流|供應鏈/.test(zh)) aliases.add("物流");
  if (/aviation|aerospace/.test(en) || /航空|航天/.test(zh)) aliases.add("航空");
  if (/environment/.test(en) || /環境/.test(zh)) {
    aliases.add("環境");
    aliases.add("env");
  }
  if (/chinese medicine/.test(en) || /中醫/.test(zh)) aliases.add("中醫");
  if (/pharmacy/.test(en) || /藥學|藥劑/.test(zh)) aliases.add("藥劑");
  if (/nursing/.test(en) || /護理/.test(zh)) {
    aliases.add("護理");
    aliases.add("nurse");
  }
  if (/physiotherapy/.test(en) || /物理治療/.test(zh)) {
    aliases.add("物治");
    aliases.add("物理治療");
    aliases.add("pt");
  }
  if (/occupational therapy/.test(en) || /職業治療/.test(zh)) {
    aliases.add("職治");
    aliases.add("職業治療");
    aliases.add("ot");
  }
  if (/radiography|medical imaging/.test(en) || /放射|醫療影像/.test(zh)) {
    aliases.add("放射");
    aliases.add("影像");
    aliases.add("rad");
    aliases.add("radi");
  }
  if (/optometry/.test(en) || /視光/.test(zh)) {
    aliases.add("視光");
    aliases.add("opto");
  }
  if (/speech/.test(en) || /言語/.test(zh)) {
    aliases.add("言語");
    aliases.add("言治");
    aliases.add("st");
    aliases.add("slp");
  }
  if (/psychology/.test(en) || /心理/.test(zh)) {
    aliases.add("心理");
    aliases.add("psy");
    aliases.add("psych");
  }
  if (/dent(al|istry)|dental surgery/.test(en) || /牙醫/.test(zh)) aliases.add("牙醫");
  if (/veterinary/.test(en) || /獸醫/.test(zh)) aliases.add("獸醫");
  if (
    /bachelor of medicine and bachelor of surgery|\bmbb?s\b|\bmbchb\b/.test(en)
    || /內外全科醫學士/.test(zh)
  ) {
    aliases.add("醫科");
    aliases.add("醫學");
    aliases.add("mbbs");
  }

  return [...aliases];
}

function acronymCandidates(value: string): string[] {
  const candidates = new Set<string>();
  const chunks = [
    value,
    ...value.split(/\b(?:in|of|for|with)\b/i).slice(1),
    ...value.split(/[()[\]:;/+-]/),
  ];
  for (const chunk of chunks) {
    const words = (chunk.match(/[A-Za-z0-9]+/g) || [])
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 1 && !ACRONYM_STOPWORDS.has(word));
    if (words.length < 2 || words.length > 8) continue;
    const acronym = words.map((word) => word[0]).join("");
    if (acronym.length >= 3) candidates.add(acronym);
  }
  const explicit = value.match(/\b[A-Z][A-Z0-9&]{1,}\b/g) || [];
  for (const token of explicit) {
    const normalizedToken = token.toLowerCase().replace(/&/g, "");
    if (normalizedToken.length >= 3) candidates.add(normalizedToken);
  }
  return [...candidates];
}

function websiteSlugs(urls: string[]): string[] {
  const slugs = new Set<string>();
  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl);
      for (const part of url.hostname.split(".")) {
        if (part.length > 1 && !["www", "com", "edu", "hk"].includes(part)) slugs.add(part);
      }
      for (const part of url.pathname.split(/[/?#._-]+/)) {
        if (part.length > 1) slugs.add(part);
      }
    } catch {
      // Ignore malformed source URLs.
    }
  }
  return [...slugs];
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function tokenPrefixMatch(query: string, indexTokens: string[]) {
  const queryTokens = query.split(" ").filter(Boolean);
  if (queryTokens.length === 0) return false;
  if (queryTokens.every((token) => token.length <= 2)) return false;
  return queryTokens.every((queryToken) => {
    if (queryToken.length === 1) return indexTokens.includes(queryToken);
    return indexTokens.some((token) => token.startsWith(queryToken));
  });
}

function compactMatch(compactQuery: string, index: SearchIndex) {
  if (compactQuery.length < 2) return false;
  if (compactQuery.length <= 2) {
    return index.shortAliases.includes(compactQuery);
  }
  return index.compact.includes(compactQuery);
}

function isShortSearch(query: string, compactQuery: string) {
  // The ≤2-char "alias only" gate exists to stop noisy Latin acronyms (e.g. "ba"
  // matching every "…ba…" substring). CJK is the opposite: two characters is a
  // precise term (數學, 物理, 工商, 統計…), so a CJK query should match the
  // programme name directly, not just curated aliases.
  if (/[一-鿿]/.test(query)) return false;
  return !query.includes(" ") && [...compactQuery].length <= 2;
}
