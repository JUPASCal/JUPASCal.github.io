// Localise the English requirement/advisory text that JUPAS scrapes carry —
// the elective-pool notes shown in the eligibility rows ("Level 3 in one
// elective subject from: …", "Category A subject (excluding M1/M2)", "Any") and
// the advisory admission notes ("Good results in Chinese/English preferred").
// Elective notes are template-shaped, so we pattern-translate them and localise
// the subject names inside; the free-text advisory notes come from a small
// hand-authored dictionary. Both fall back to the English string when unmatched
// (advisory strictly so — never franken-translate a sentence we don't know).
import type { Lang } from "./i18n";
import { localizedShortSubject } from "./subjectsI18n";
import { SUBJECTS } from "./strings";

// Subject names as they appear in scraped notes → canonical key for localisation.
const NOTE_SUBJECT_ALIAS: Record<string, string> = {
  "Mathematics (Extended Part) Module I or Module II": "Mathematics Extended Part (Module 1 or 2)",
  "Mathematics Extended Module 1 or 2": "Mathematics Extended Part (Module 1 or 2)",
  "Mathematics (Extended Module 1 or Module 2)": "Mathematics Extended Part (Module 1 or 2)",
  "M1 (Calculus and Statistics)": "Mathematics Extended Part (Module 1)",
  "M2 (Algebra and Calculus)": "Mathematics Extended Part (Module 2)",
  "M1": "Mathematics Extended Part (Module 1)",
  "M2": "Mathematics Extended Part (Module 2)",
  "Combined Science (Biology and Physics)": "Combined Science: Biology + Physics",
  "ICT": "Information and Communication Technology",
};
// Note-only phrases with no canonical subject key → direct Chinese display.
const NOTE_PHRASE_ZH: Record<string, string> = {
  "Combined Science with Chemistry": "組合科學（含化學）",
  "Combined Science with Physics": "組合科學（含物理）",
  "Combined Science with Biology": "組合科學（含生物）",
  "Combined Science": "組合科學",
  "Technology and Living": "科技與生活",
  "Business Accounting and Financial Studies": "企業、會計與財務概論",
  "(Accounting)": "（會計）",
  "(Business Management)": "（企業管理）",
};

// [English, Chinese] replacement pairs, longest-English-first so multi-word /
// combined-science names win over their substrings.
const SUBJECT_PAIRS: [string, string][] = (() => {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const [en, zh] of Object.entries(NOTE_PHRASE_ZH)) {
    seen.add(en);
    pairs.push([en, zh]);
  }
  for (const [en, canon] of Object.entries(NOTE_SUBJECT_ALIAS)) {
    if (seen.has(en)) continue;
    seen.add(en);
    pairs.push([en, localizedShortSubject(canon, "zh")]);
  }
  for (const en of Object.keys(SUBJECTS)) {
    if (seen.has(en)) continue;
    seen.add(en);
    pairs.push([en, localizedShortSubject(en, "zh")]);
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
})();

// Localise the subject names inside a list string, preserving separators, then
// translate the connectors (/, and, or, comma) to their Chinese forms.
function localizeSubjectsInline(text: string, lang: Lang): string {
  if (lang !== "zh") return text;
  let out = text;
  for (const [en, zh] of SUBJECT_PAIRS) {
    if (out.includes(en)) out = out.split(en).join(zh);
  }
  return out
    .replace(/\s*\/\s*/g, "／")
    .replace(/,?\s+or\s+/gi, "或")
    .replace(/\s+and\s+/gi, "和")
    .replace(/,\s*/g, "、")
    .replace(/\s+（/g, "（")
    .replace(/[\s.*]+$/, "")
    .trim();
}

// Fixed elective phrases (exact match).
const FIXED_ZH: Record<string, string> = {
  "university baseline": "大學基本要求",
  "any": "任何選修科",
  "one of the following": "以下其中一科",
};

/** Elective-pool note shown in an eligibility row. Templates + subject-list
 *  fallback; unknown strings fall through the inline subject localiser. */
export function localizeElectiveNote(note: string | null | undefined, lang: Lang): string {
  const raw = (note ?? "").trim();
  if (!raw || lang !== "zh") return raw;
  const norm = raw.toLowerCase().replace(/\s+/g, " ");
  if (FIXED_ZH[norm]) return FIXED_ZH[norm];

  if (/^category a subject \(excluding m1\/m2\)$/i.test(raw)) return "甲類選修科（M1／M2 除外）";

  let m: RegExpMatchArray | null;
  m = raw.match(/^Level (\d) in any (two |one )?elective subjects\b(.*)$/i);
  if (m) {
    const cnt = m[2]?.trim() === "two" ? "兩科" : "";
    const except = /other languages/i.test(m[3]) ? "（「其他語言」除外）" : "";
    return `任何${cnt}選修科取得 Lv.${m[1]}${except}`;
  }
  m = raw.match(/^Level (\d) in one elective subject from:\s*(.+)$/i);
  if (m) return `以下其中一科選修取得 Lv.${m[1]}：${localizeSubjectsInline(m[2], lang)}`;
  m = raw.match(/^Level (\d) in two elective subjects?:\s*(.+)$/i);
  if (m) return `以下兩科選修取得 Lv.${m[1]}：${localizeSubjectsInline(m[2], lang)}`;
  m = raw.match(/^Level (\d) or above in one of the following subjects?:\s*(.+)$/i);
  if (m) return `以下其中一科取得 Lv.${m[1]} 或以上：${localizeSubjectsInline(m[2], lang)}`;
  m = raw.match(/^Level (\d) or above in two of the following subjects?:\s*(.+)$/i);
  if (m) return `以下兩科取得 Lv.${m[1]} 或以上：${localizeSubjectsInline(m[2], lang)}`;
  m = raw.match(/^One elective subject must be (.+)$/i);
  if (m) return `其中一科選修必須為${localizeSubjectsInline(m[1], lang)}`;
  m = raw.match(/^Any (\d+) other subjects?$/i);
  if (m) return `任何其他 ${m[1]} 科`;
  m = raw.match(/^Level (\d) or above in (.+)$/i);
  if (m) return `${localizeSubjectsInline(m[2], lang)}取得 Lv.${m[1]} 或以上`;
  m = raw.match(/^Level (\d) in (.+)$/i);
  if (m) return `${localizeSubjectsInline(m[2], lang)}取得 Lv.${m[1]}`;
  m = raw.match(/^One of:\s*(.+)$/i);
  if (m) return `以下其中一科：${localizeSubjectsInline(m[1], lang)}`;
  m = raw.match(/^in\s+(.+)$/i);
  if (m) return localizeSubjectsInline(m[1], lang);

  // Bare subject list ("Physics", "Biology/Chemistry", "M1/…(Module 2)").
  return localizeSubjectsInline(raw, lang);
}

// Advisory admission notes (jupas_requirements.notes) — hand-translated.
const ADVISORY_ZH: Record<string, string> = {
  "good results in chinese language and english language subjects are preferred.":
    "優先考慮中文及英文科成績良好的申請人。",
  "high choice banding in jupas application is preferred.":
    "優先考慮在 JUPAS 申請中將本課程列於較高選擇位置的申請人。",
  "applicants who have obtained level 2 or above in chinese literature will have an advantage.":
    "中國文學科取得 Lv.2 或以上的申請人會較佔優。",
  "level 3 or above in mathematics (extended module 1 or module 2) is preferred (but not required).":
    "優先考慮數學延伸部分（單元一或二）取得 Lv.3 或以上者（非必須）。",
  "level 3 or above in mathematics extended part (module 1 or 2) is preferred (but not required).":
    "優先考慮數學延伸部分（單元一或二）取得 Lv.3 或以上者（非必須）。",
  "level 3 or above in mathematics extended part (module 1 or 2) is preferred.":
    "優先考慮數學延伸部分（單元一或二）取得 Lv.3 或以上者。",
  "preferred subjects: biology, chemistry, physics, and mathematics extended module 1 or 2.":
    "優先考慮科目：生物、化學、物理及數學延伸部分（單元一或二）。",
  "preferred subjects include biology, physics.":
    "優先考慮科目包括：生物、物理。",
  "preferred subjects include biology, chemistry, physics, mathematics (extended part) module i or module ii, or information and communication technology.":
    "優先考慮科目包括：生物、化學、物理、數學延伸部分（單元一或二）或資訊及通訊科技。",
  "* preferred subject: biology, chemistry, physics or combined science with chemistry":
    "＊優先考慮科目：生物、化學、物理或組合科學（含化學）",
  "there is no compulsory subject requirement. preferred subjects with the highest weighting for admission score calculation include:":
    "本課程沒有必修科目要求。收生計分比重最高的優先考慮科目包括：",
  "preference will be given to applicants who have obtained:":
    "優先考慮取得以下成績的申請人：",
  "preference will be given to applicants who have obtained level 4 or above in english language and biology / physics / combined science (biology and physics)* in hkdse.":
    "優先考慮在文憑試英文科取得 Lv.4 或以上，並在生物／物理／組合科學（生物、物理）＊取得良好成績的申請人。",
  "preference will be given to applicants who have obtained: level 4 or above in english language in hkdse level 3 or above in physics / chemisty / biology / combined science with physics* in hkdse":
    "優先考慮在文憑試英文科取得 Lv.4 或以上，並在物理／化學／生物／組合科學（含物理）＊取得 Lv.3 或以上的申請人。",
  "preference will be given to applicants who have obtained: level 4 or above in english language in hkdse. level 3 or above in biology or combined science with biology* in hkdse.":
    "優先考慮在文憑試英文科取得 Lv.4 或以上，並在生物或組合科學（含生物）＊取得 Lv.3 或以上的申請人。",
};

/** Advisory admission note. Dictionary-only — unknown sentences stay English
 *  rather than being partially/wrongly translated. */
export function localizeAdmissionNote(note: string | null | undefined, lang: Lang): string {
  const raw = (note ?? "").trim();
  if (!raw || lang !== "zh") return raw;
  return ADVISORY_ZH[raw.toLowerCase().replace(/\s+/g, " ")] ?? raw;
}
