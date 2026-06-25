// Language-aware DSE subject display. The Chinese names themselves live in the
// central SUBJECTS map in strings.ts (single source of truth); this file is just
// the lookup helpers. The canonical English name is the key (and the English
// display form), shared with the data pipeline, so it must NOT change here.
import type { Lang } from "./i18n";
import { SUBJECTS } from "./strings";
import { canonicalSubject, shortSubjectName, subjectChipName } from "./subjects";

function entry(name: string): { zh: string; shortZh?: string; chip?: string } | undefined {
  type E = { zh: string; shortZh?: string; chip?: string };
  return (SUBJECTS as Record<string, E>)[name]
    ?? (SUBJECTS as Record<string, E>)[canonicalSubject(name)];
}

/** Full subject name in the active language (English when no Chinese entry). */
export function localizedSubject(name: string, lang: Lang): string {
  if (lang !== "zh") return name;
  return entry(name)?.zh ?? name;
}

/** `shortSubjectName` but language-aware (Cat C languages, Math, etc.). In 中文,
 * verbose cores use a short form (中文/英文/數學 via `shortZh`); electives fall
 * back to their full Chinese name (生物, 健康管理與社會關懷). */
export function localizedShortSubject(name: string, lang: Lang): string {
  if (lang !== "zh") return shortSubjectName(name);
  const e = entry(name);
  return e?.shortZh ?? e?.zh ?? shortSubjectName(name);
}

/** Compact chip label (grade-summary pills) in the active language. */
export function localizedSubjectChip(name: string, lang: Lang): string {
  if (lang !== "zh") return subjectChipName(name);
  return entry(name)?.chip ?? subjectChipName(name);
}
