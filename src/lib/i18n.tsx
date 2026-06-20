import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { STRINGS, type Entry } from "./strings";

export type Lang = "en" | "zh";

const LANG_KEY = "jupas-staging-lang";

// Known string keys — gives `t()` editor autocomplete and flags typo'd keys,
// while `(string & {})` still lets dynamic keys (e.g. `bandLabelKey()`) through.
export type StringKey = keyof typeof STRINGS;

const TABLE = STRINGS as Record<string, Entry>;

export function loadLang(): Lang {
  if (typeof localStorage === "undefined") return "en";
  try {
    return localStorage.getItem(LANG_KEY) === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

type Vars = Record<string, string | number>;

export type Translate = (key: StringKey | (string & {}), vars?: Vars) => string;

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
};

const LangContext = createContext<LangContextValue | null>(null);

// Look up `key` in the active language, falling back to English then to the raw
// key (so a missing translation renders the English source / is visibly the
// key, never blank). Interpolates `{name}` placeholders.
function translate(lang: Lang, key: string, vars?: Vars): string {
  const entry = TABLE[key];
  let value = entry ? entry[lang] ?? entry.en : key;
  if (vars) {
    for (const [name, v] of Object.entries(vars)) {
      value = value.split(`{${name}}`).join(String(v));
    }
  }
  return value;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadLang());

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Storage can be unavailable in some private/locked-down browsers.
    }
    document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const t = useCallback<Translate>((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo<LangContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within a LangProvider");
  return ctx;
}

// Programme display name in the active language, falling back to English when a
// Chinese name is missing (data has 100% name_zh coverage today, but be safe).
export function pickName(
  programme: { name_en: string; name_zh?: string | null },
  lang: Lang,
): string {
  if (lang === "zh" && programme.name_zh) return programme.name_zh;
  return programme.name_en;
}
