// Language-aware DSE subject display. The Chinese names themselves live in the
// central SUBJECTS map in strings.ts (single source of truth); this file is just
// the lookup helpers. The canonical English name is the key (and the English
// display form), shared with the data pipeline, so it must NOT change here.
import type { Lang } from "./i18n";
import { SUBJECTS } from "./strings";
import { canonicalSubject, shortSubjectName, subjectChipName } from "./subjects";

function entry(name: string): { zh: string; chip?: string } | undefined {
  return (SUBJECTS as Record<string, { zh: string; chip?: string }>)[name]
    ?? (SUBJECTS as Record<string, { zh: string; chip?: string }>)[canonicalSubject(name)];
}

/** Full subject name in the active language (English when no Chinese entry). */
export function localizedSubject(name: string, lang: Lang): string {
  if (lang !== "zh") return name;
  return entry(name)?.zh ?? name;
}

/** `shortSubjectName` but language-aware (Cat C languages, Math, etc.). */
export function localizedShortSubject(name: string, lang: Lang): string {
  if (lang !== "zh") return shortSubjectName(name);
  return entry(name)?.zh ?? shortSubjectName(name);
}

/** Compact chip label (grade-summary pills) in the active language. */
export function localizedSubjectChip(name: string, lang: Lang): string {
  if (lang !== "zh") return subjectChipName(name);
  return entry(name)?.chip ?? subjectChipName(name);
}
